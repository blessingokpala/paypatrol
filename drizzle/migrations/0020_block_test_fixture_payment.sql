CREATE OR REPLACE FUNCTION public.reserve_budget(_pid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p public.purchases%rowtype; pol public.spending_policies%rowtype; v_res uuid; v_status public.purchase_status; v_week timestamptz;
BEGIN
  SELECT * INTO p FROM public.purchases WHERE id = _pid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;
  IF p.is_test_fixture THEN RAISE EXCEPTION 'Demonstration requests cannot be reserved or paid'; END IF;
  IF NOT (public.has_org_role(p.org_id,'payer') OR public.has_org_role(p.org_id,'owner')) THEN RAISE EXCEPTION 'Only payers or owners can reserve budget'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = p.org_id FOR UPDATE;
  SELECT * INTO p FROM public.purchases WHERE id = _pid FOR UPDATE;
  PERFORM public.expire_safe_reservations(p.org_id);
  IF EXISTS (SELECT 1 FROM public.payment_attempts WHERE purchase_id = _pid AND status NOT IN ('failed','cancelled','completed','paid')) THEN RAISE EXCEPTION 'Resolve the existing payment attempt first'; END IF;
  v_status := public.evaluate_purchase(_pid);
  IF v_status <> 'cleared_for_checkout' THEN RAISE EXCEPTION 'Only requests cleared for checkout can reserve budget (status: %)', v_status; END IF;
  SELECT * INTO p FROM public.purchases WHERE id = _pid;
  SELECT * INTO pol FROM public.spending_policies WHERE id = p.policy_version_id;
  v_week := public.org_week_start(pol.timezone);
  SELECT id INTO v_res FROM public.budget_reservations WHERE purchase_id = _pid AND status = 'active' AND purchase_version = p.version AND amount_minor = p.total_minor AND currency = p.currency AND period_start = v_week AND expires_at > now();
  IF v_res IS NOT NULL THEN RETURN v_res; END IF;
  UPDATE public.budget_reservations SET status = 'released', released_at = now() WHERE purchase_id = _pid AND status = 'active';
  IF public.week_committed_minor(p.org_id, _pid) + p.total_minor > pol.weekly_limit_minor THEN RAISE EXCEPTION 'Weekly limit reached'; END IF;
  INSERT INTO public.budget_reservations(org_id,purchase_id,purchase_version,amount_minor,currency,period_start,created_by)
  VALUES (p.org_id,_pid,p.version,p.total_minor,p.currency,v_week,auth.uid()) RETURNING id INTO v_res;
  PERFORM public.log_audit(p.org_id,'budget_reserved','purchase',_pid,p.version,jsonb_build_object('amount_minor',p.total_minor,'period_start',v_week));
  RETURN v_res;
END $function$;

CREATE OR REPLACE FUNCTION public.begin_sandbox_payment(_pid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p public.purchases%rowtype; a public.payment_attempts%rowtype; c public.paypal_merchant_configs%rowtype; rid uuid;
BEGIN
 SELECT * INTO p FROM public.purchases WHERE id=_pid;
 IF NOT FOUND OR NOT (public.has_org_role(p.org_id,'owner') OR public.has_org_role(p.org_id,'payer')) THEN RAISE EXCEPTION 'Payer required'; END IF;
 IF p.is_test_fixture THEN RAISE EXCEPTION 'Demonstration requests cannot be reserved or paid'; END IF;
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
END $function$;