CREATE OR REPLACE FUNCTION public.cancel_uncaptured_sandbox_attempt(_attempt uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 DECLARE a public.payment_attempts%rowtype;
 BEGIN
  SELECT * INTO a FROM public.payment_attempts WHERE id=_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown payment'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=a.org_id FOR UPDATE;
  PERFORM 1 FROM public.purchases WHERE id=a.purchase_id FOR UPDATE;
  SELECT * INTO a FROM public.payment_attempts WHERE id=_attempt FOR UPDATE;
  IF a.status='cancelled' THEN RETURN; END IF;
  IF a.status<>'ordered' THEN RAISE EXCEPTION 'Payment may be executing. Reconcile it before cancelling.'; END IF;
  UPDATE public.payment_attempts SET status='cancelled',updated_at=now() WHERE id=a.id;
  -- Recovery path: the request itself is not cancelled; it returns to checkout so the payer can retry.
  UPDATE public.purchases SET status='cleared_for_checkout',updated_at=now() WHERE id=a.purchase_id;
  UPDATE public.budget_reservations SET status='released',released_at=now() WHERE id=a.reservation_id AND status='active';
  PERFORM public.log_audit(a.org_id,'sandbox_checkout_cancelled','purchase',a.purchase_id,a.purchase_version,jsonb_build_object('attempt_id',a.id,'uncaptured_order',true),'server');
 END $function$;