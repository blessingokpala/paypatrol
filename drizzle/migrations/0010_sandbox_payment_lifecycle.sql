CREATE TABLE public.paypal_merchant_configs (
 org_id uuid PRIMARY KEY REFERENCES public.organizations(id), merchant_id text NOT NULL CHECK (merchant_id ~ '^[2-9A-HJ-NP-Z]{13}$'), supplier_id uuid NOT NULL REFERENCES public.suppliers(id), cad_confirmed boolean NOT NULL DEFAULT false, configured_by uuid NOT NULL, configured_at timestamptz NOT NULL DEFAULT now(), authentication_checked_at timestamptz NOT NULL DEFAULT now(), order_validated_at timestamptz
);
GRANT SELECT ON public.paypal_merchant_configs TO authenticated;
GRANT ALL ON public.paypal_merchant_configs TO service_role;
ALTER TABLE public.paypal_merchant_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read sandbox merchant" ON public.paypal_merchant_configs FOR SELECT TO authenticated USING (public.is_org_member(org_id));
ALTER TABLE public.payment_attempts ADD COLUMN digest text, ADD COLUMN amount_minor bigint, ADD COLUMN currency text, ADD COLUMN merchant_id text, ADD COLUMN reservation_id uuid REFERENCES public.budget_reservations(id), ADD COLUMN policy_id uuid, ADD COLUMN supplier_version_id uuid, ADD COLUMN operation_started_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX one_unresolved_payment_per_purchase ON public.payment_attempts(purchase_id) WHERE status NOT IN ('failed','cancelled','completed','paid');
CREATE UNIQUE INDEX one_paypal_order_per_attempt ON public.paypal_orders(payment_attempt_id);

CREATE OR REPLACE FUNCTION public.configure_sandbox_merchant(_org uuid, _supplier uuid, _merchant text, _actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.suppliers%rowtype; sv public.supplier_versions%rowtype; nv uuid; r record;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id=_org AND user_id=_actor AND role='owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF _merchant !~ '^[2-9A-HJ-NP-Z]{13}$' THEN RAISE EXCEPTION 'Invalid merchant ID'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=_org FOR UPDATE;
 IF EXISTS (SELECT 1 FROM public.payment_attempts WHERE org_id=_org AND status NOT IN ('failed','cancelled','completed','paid')) THEN RAISE EXCEPTION 'Resolve pending payments first'; END IF;
 SELECT * INTO s FROM public.suppliers WHERE id=_supplier AND org_id=_org FOR UPDATE;
 IF NOT FOUND OR s.status <> 'active' THEN RAISE EXCEPTION 'Active approved supplier required'; END IF;
 SELECT * INTO sv FROM public.supplier_versions WHERE id=s.current_version_id;
 IF sv.paypal_merchant_id <> _merchant THEN
  IF sv.enrolment_status <> 'demo_fixture' THEN RAISE EXCEPTION 'A real recipient change requires independent verification'; END IF;
  INSERT INTO public.supplier_versions(org_id,supplier_id,version,paypal_merchant_id,trusted_contact_channel,trusted_contact_value,verification_evidence,enrolment_status,status,created_by,approved_by,approved_at)
  VALUES (_org,s.id,sv.version+1,_merchant,sv.trusted_contact_channel,sv.trusted_contact_value,'Owner-authorised fictional baseline replacement for Sandbox account; CAD wallet confirmed. PayPal order payee must match before capture.','enrolled','active',_actor,_actor,now()) RETURNING id INTO nv;
  UPDATE public.supplier_versions SET status='superseded' WHERE id=sv.id;
  UPDATE public.suppliers SET current_version_id=nv WHERE id=s.id;
 ELSE
  UPDATE public.supplier_versions SET enrolment_status='enrolled' WHERE id=sv.id;
 END IF;
 INSERT INTO public.paypal_merchant_configs(org_id,merchant_id,supplier_id,cad_confirmed,configured_by) VALUES (_org,_merchant,_supplier,true,_actor)
 ON CONFLICT (org_id) DO UPDATE SET merchant_id=excluded.merchant_id,supplier_id=excluded.supplier_id,cad_confirmed=true,configured_by=excluded.configured_by,configured_at=now(),authentication_checked_at=now(),order_validated_at=null;
 FOR r IN SELECT id FROM public.purchases WHERE org_id=_org AND status NOT IN ('paid','failed','cancelled','payment_pending') LOOP
  PERFORM public.invalidate_approvals(r.id,'Sandbox supplier baseline configured');
  PERFORM public.evaluate_purchase(r.id);
 END LOOP;
 PERFORM public.log_audit(_org,'sandbox_merchant_configured','supplier',_supplier,null,jsonb_build_object('merchant_id',_merchant,'cad_owner_confirmed',true,'historical_requested_recipients_unchanged',true),'server');
END $$;
REVOKE ALL ON FUNCTION public.configure_sandbox_merchant(uuid,uuid,text,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_sandbox_merchant(uuid,uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.begin_sandbox_payment(_pid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.purchases%rowtype; a public.payment_attempts%rowtype; c public.paypal_merchant_configs%rowtype; rid uuid;
BEGIN
 SELECT * INTO p FROM public.purchases WHERE id=_pid;
 IF NOT FOUND OR NOT (public.has_org_role(p.org_id,'owner') OR public.has_org_role(p.org_id,'payer')) THEN RAISE EXCEPTION 'Payer required'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p.org_id FOR UPDATE;
 SELECT * INTO p FROM public.purchases WHERE id=_pid FOR UPDATE;
 SELECT * INTO a FROM public.payment_attempts WHERE purchase_id=_pid AND status NOT IN ('failed','cancelled') ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN RETURN to_jsonb(a); END IF;
 IF public.evaluate_purchase(_pid) <> 'cleared_for_checkout' THEN RAISE EXCEPTION 'Payment controls have not cleared this request'; END IF;
 SELECT * INTO p FROM public.purchases WHERE id=_pid;
 SELECT * INTO c FROM public.paypal_merchant_configs WHERE org_id=p.org_id;
 IF NOT FOUND OR NOT c.cad_confirmed OR c.supplier_id IS DISTINCT FROM p.supplier_id OR c.merchant_id IS DISTINCT FROM p.requested_recipient OR p.currency <> 'CAD' THEN RAISE EXCEPTION 'Sandbox supplier configuration does not match this purchase'; END IF;
 rid := public.reserve_budget(_pid);
 INSERT INTO public.payment_attempts(org_id,purchase_id,purchase_version,idempotency_key,status,created_by,digest,amount_minor,currency,merchant_id,reservation_id,policy_id,supplier_version_id)
 VALUES (p.org_id,p.id,p.version,gen_random_uuid()::text,'creating',auth.uid(),p.digest,p.total_minor,p.currency,p.requested_recipient,rid,p.policy_version_id,p.supplier_version_id) RETURNING * INTO a;
 UPDATE public.purchases SET status='payment_pending' WHERE id=_pid;
 PERFORM public.log_audit(p.org_id,'sandbox_payment_started','purchase',p.id,p.version,jsonb_build_object('attempt_id',a.id,'amount_minor',p.total_minor),'server');
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.begin_sandbox_payment(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.begin_sandbox_payment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_sandbox_capture(_attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.payment_attempts%rowtype; p public.purchases%rowtype; st public.purchase_status;
BEGIN
 SELECT * INTO a FROM public.payment_attempts WHERE id=_attempt;
 IF NOT FOUND OR NOT (public.has_org_role(a.org_id,'owner') OR public.has_org_role(a.org_id,'payer')) THEN RAISE EXCEPTION 'Payer required'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=a.org_id FOR UPDATE;
 SELECT * INTO p FROM public.purchases WHERE id=a.purchase_id FOR UPDATE;
 SELECT * INTO a FROM public.payment_attempts WHERE id=_attempt FOR UPDATE;
 IF a.status IN ('completed','paid') THEN RETURN to_jsonb(a); END IF;
 IF a.status IN ('capturing','confirmation_pending') THEN RETURN to_jsonb(a); END IF;
 IF a.status <> 'ordered' THEN RAISE EXCEPTION 'No verified order is ready'; END IF;
 IF p.version IS DISTINCT FROM a.purchase_version OR p.digest IS DISTINCT FROM a.digest OR p.total_minor IS DISTINCT FROM a.amount_minor OR p.currency IS DISTINCT FROM a.currency OR p.requested_recipient IS DISTINCT FROM a.merchant_id OR public.active_policy_id(a.org_id) IS DISTINCT FROM a.policy_id THEN RAISE EXCEPTION 'Payment authorisation changed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id=p.supplier_id AND current_version_id=a.supplier_version_id AND status='active') THEN RAISE EXCEPTION 'Supplier changed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.budget_reservations WHERE id=a.reservation_id AND status='active' AND purchase_version=a.purchase_version AND amount_minor=a.amount_minor AND currency=a.currency AND period_start=public.org_week_start((SELECT timezone FROM public.spending_policies WHERE id=a.policy_id))) THEN RAISE EXCEPTION 'Reservation is not valid for this payment'; END IF;
 UPDATE public.purchases SET status='draft' WHERE id=p.id;
 st := public.evaluate_purchase(p.id);
 IF st <> 'cleared_for_checkout' THEN RAISE EXCEPTION 'Current payment controls refuse capture: %',st; END IF;
 SELECT * INTO p FROM public.purchases WHERE id=p.id;
 IF p.digest IS DISTINCT FROM a.digest THEN RAISE EXCEPTION 'Payment digest changed'; END IF;
 UPDATE public.purchases SET status='payment_pending' WHERE id=p.id;
 UPDATE public.payment_attempts SET status='capturing',operation_started_at=now(),updated_at=now() WHERE id=a.id RETURNING * INTO a;
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.prepare_sandbox_capture(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.prepare_sandbox_capture(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_sandbox_order(_attempt uuid,_order text,_status text,_merchant text,_amount bigint,_currency text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.payment_attempts%rowtype; p public.purchases%rowtype;
BEGIN
 SELECT * INTO a FROM public.payment_attempts WHERE id=_attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=a.org_id FOR UPDATE;
 SELECT * INTO p FROM public.purchases WHERE id=a.purchase_id FOR UPDATE;
 SELECT * INTO a FROM public.payment_attempts WHERE id=_attempt FOR UPDATE;
 IF _merchant IS DISTINCT FROM a.merchant_id OR _amount IS DISTINCT FROM a.amount_minor OR _currency IS DISTINCT FROM a.currency THEN RAISE EXCEPTION 'PayPal order does not match authorised purchase'; END IF;
 IF a.status NOT IN ('creating','ordered') THEN RAISE EXCEPTION 'Attempt is not creating an order'; END IF;
 IF EXISTS (SELECT 1 FROM public.paypal_orders WHERE payment_attempt_id=a.id AND paypal_order_id<>_order) THEN RAISE EXCEPTION 'Conflicting order'; END IF;
 INSERT INTO public.paypal_orders(org_id,payment_attempt_id,paypal_order_id,status,payee_merchant_id,amount_minor,currency) VALUES (a.org_id,a.id,_order,_status,_merchant,_amount,_currency) ON CONFLICT (paypal_order_id) DO NOTHING;
 IF NOT EXISTS (SELECT 1 FROM public.paypal_orders WHERE payment_attempt_id=a.id AND org_id=a.org_id AND paypal_order_id=_order) THEN RAISE EXCEPTION 'Order ownership mismatch'; END IF;
 UPDATE public.payment_attempts SET status='ordered',updated_at=now() WHERE id=a.id;
 UPDATE public.paypal_merchant_configs SET order_validated_at=now() WHERE org_id=a.org_id AND merchant_id=_merchant;
END $$;
REVOKE ALL ON FUNCTION public.record_sandbox_order(uuid,text,text,text,bigint,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_sandbox_order(uuid,text,text,text,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_sandbox_capture(_attempt uuid,_order text,_capture text,_status text,_merchant text,_amount bigint,_currency text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.record_sandbox_capture(uuid,text,text,text,text,bigint,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_sandbox_capture(uuid,text,text,text,text,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_sandbox_uncertain(_attempt uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.payment_attempts SET status='confirmation_pending',updated_at=now(),error_detail='Provider outcome uncertain; reconcile existing attempt' WHERE id=_attempt AND status='capturing';
END $$;
REVOKE ALL ON FUNCTION public.mark_sandbox_uncertain(uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sandbox_uncertain(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_verified_sandbox_event(_event text,_type text,_order text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE oid uuid; n integer;
BEGIN
 SELECT org_id INTO oid FROM public.paypal_orders WHERE paypal_order_id=_order;
 IF oid IS NULL THEN RAISE EXCEPTION 'Unknown payment'; END IF;
 INSERT INTO public.webhook_events(org_id,provider,event_id,event_type,verified,payload) VALUES (oid,'paypal_sandbox',_event,_type,true,jsonb_build_object('order_id',_order)) ON CONFLICT (provider,event_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n>0 OR EXISTS (SELECT 1 FROM public.webhook_events WHERE provider='paypal_sandbox' AND event_id=_event AND processed_at IS NULL AND org_id=oid);
END $$;
REVOKE ALL ON FUNCTION public.record_verified_sandbox_event(text,text,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_sandbox_event(text,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.finish_sandbox_event(_event text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ UPDATE public.webhook_events SET processed_at=now() WHERE provider='paypal_sandbox' AND event_id=_event $$;
REVOKE ALL ON FUNCTION public.finish_sandbox_event(text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_sandbox_event(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_safe_reservations(uuid) TO service_role;