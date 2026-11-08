-- Gate the Paid transition on a verified signed webhook for the exact capture.
-- A synchronous PayPal capture API response alone now records only a PENDING
-- confirmation; completion requires a verified PAYMENT.CAPTURE.COMPLETED event
-- bound to the same order and capture.

-- 1. Verified events now store the capture id alongside the order id.
DROP FUNCTION public.record_verified_sandbox_event(text, text, text);
CREATE FUNCTION public.record_verified_sandbox_event(_event text, _type text, _order text, _capture text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE oid uuid; n integer;
BEGIN
  SELECT org_id INTO oid FROM public.paypal_orders WHERE paypal_order_id=_order;
  IF oid IS NULL THEN RAISE EXCEPTION 'Unknown payment'; END IF;
  INSERT INTO public.webhook_events(org_id,provider,event_id,event_type,verified,payload)
  VALUES (oid,'paypal_sandbox',_event,_type,true,jsonb_build_object('order_id',_order,'capture_id',_capture))
  ON CONFLICT (provider,event_id) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN n>0 OR EXISTS (SELECT 1 FROM public.webhook_events WHERE provider='paypal_sandbox' AND event_id=_event AND processed_at IS NULL AND org_id=oid);
END $function$;

-- 2. Capture recording: COMPLETED is honoured only when a verified signed
-- webhook for the same order and capture already exists; otherwise the capture
-- is stored as PENDING and the attempt remains confirmation_pending.
CREATE OR REPLACE FUNCTION public.record_sandbox_capture(_attempt uuid, _order text, _capture text, _status text, _merchant text, _amount bigint, _currency text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a public.payment_attempts%rowtype; o public.paypal_orders%rowtype; p public.purchases%rowtype;
BEGIN
  SELECT * INTO a FROM public.payment_attempts WHERE id=_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=a.org_id FOR UPDATE;
  SELECT * INTO p FROM public.purchases WHERE id=a.purchase_id FOR UPDATE;
  SELECT * INTO a FROM public.payment_attempts WHERE id=_attempt FOR UPDATE;
  SELECT * INTO o FROM public.paypal_orders WHERE payment_attempt_id=a.id AND paypal_order_id=_order AND org_id=a.org_id FOR UPDATE;
  IF NOT FOUND OR _merchant IS DISTINCT FROM a.merchant_id OR _amount IS DISTINCT FROM a.amount_minor OR _currency IS DISTINCT FROM a.currency OR p.version IS DISTINCT FROM a.purchase_version OR p.digest IS DISTINCT FROM a.digest THEN RAISE EXCEPTION 'Capture does not match authorised payment'; END IF;
  IF _status NOT IN ('COMPLETED','PENDING') OR a.status NOT IN ('ordered','capturing','confirmation_pending','completed') THEN RAISE EXCEPTION 'Unsupported capture state'; END IF;
  IF _status='COMPLETED' AND NOT EXISTS (
    SELECT 1 FROM public.webhook_events we
    WHERE we.provider='paypal_sandbox' AND we.verified AND we.event_type='PAYMENT.CAPTURE.COMPLETED'
      AND we.org_id=a.org_id AND we.payload->>'order_id'=_order AND we.payload->>'capture_id'=_capture
  ) THEN
    _status := 'PENDING';
  END IF;
  INSERT INTO public.paypal_captures(org_id,paypal_order_row_id,paypal_capture_id,status,amount_minor,currency) VALUES (a.org_id,o.id,_capture,_status,_amount,_currency)
  ON CONFLICT (paypal_capture_id) DO UPDATE SET status=excluded.status WHERE paypal_captures.paypal_order_row_id=excluded.paypal_order_row_id AND paypal_captures.status<>'COMPLETED';
  IF NOT EXISTS (SELECT 1 FROM public.paypal_captures WHERE paypal_capture_id=_capture AND paypal_order_row_id=o.id AND org_id=a.org_id) THEN RAISE EXCEPTION 'Capture ownership mismatch'; END IF;
  IF _status='COMPLETED' THEN
    IF a.status<>'completed' THEN
      UPDATE public.payment_attempts SET status='completed',updated_at=now() WHERE id=a.id;
      UPDATE public.budget_reservations SET status='consumed' WHERE id=a.reservation_id AND status='active';
      IF NOT FOUND THEN RAISE EXCEPTION 'No reserved budget to consume'; END IF;
      UPDATE public.purchases SET status='paid',updated_at=now() WHERE id=p.id;
      PERFORM public.log_audit(a.org_id,'sandbox_capture_completed','purchase',p.id,p.version,jsonb_build_object('order_id',_order,'capture_id',_capture,'amount_minor',_amount),'server');
    END IF;
  ELSE
    UPDATE public.payment_attempts SET status='confirmation_pending',updated_at=now() WHERE id=a.id AND status<>'completed';
  END IF;
END $function$;

-- 3. Backfill the historical verified COMPLETED event with the capture id PayPal
-- sent, so the completed CA$25 record satisfies the same binding.
UPDATE public.webhook_events
SET payload = payload || jsonb_build_object('capture_id','2X730686B0899582N')
WHERE provider='paypal_sandbox' AND event_type='PAYMENT.CAPTURE.COMPLETED'
  AND payload->>'order_id'='6PP262896T830104W' AND payload->>'capture_id' IS NULL;