CREATE OR REPLACE FUNCTION public.prepare_sandbox_capture(_attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.payment_attempts%rowtype; p public.purchases%rowtype; st public.purchase_status;
BEGIN
 SELECT * INTO a FROM public.payment_attempts WHERE id=_attempt;
 IF NOT FOUND OR NOT (public.has_org_role(a.org_id,'owner') OR public.has_org_role(a.org_id,'payer')) THEN RAISE EXCEPTION 'Payer required'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=a.org_id FOR UPDATE;
 SELECT * INTO p FROM public.purchases WHERE id=a.purchase_id FOR UPDATE;
 SELECT * INTO a FROM public.payment_attempts WHERE id=_attempt FOR UPDATE;
 IF a.status IN ('completed','paid','capturing','confirmation_pending') THEN RETURN to_jsonb(a)||jsonb_build_object('execute_capture',false); END IF;
 IF a.status <> 'ordered' THEN RAISE EXCEPTION 'No verified order is ready'; END IF;
 IF p.version IS DISTINCT FROM a.purchase_version OR p.digest IS DISTINCT FROM a.digest OR p.total_minor IS DISTINCT FROM a.amount_minor OR p.currency IS DISTINCT FROM a.currency OR p.requested_recipient IS DISTINCT FROM a.merchant_id OR public.active_policy_id(a.org_id) IS DISTINCT FROM a.policy_id THEN RAISE EXCEPTION 'Payment authorisation changed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id=p.supplier_id AND current_version_id=a.supplier_version_id AND status='active') THEN RAISE EXCEPTION 'Supplier changed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.budget_reservations WHERE id=a.reservation_id AND status='active' AND purchase_version=a.purchase_version AND amount_minor=a.amount_minor AND currency=a.currency AND period_start=public.org_week_start((SELECT timezone FROM public.spending_policies WHERE id=a.policy_id))) THEN RAISE EXCEPTION 'Reservation is not valid'; END IF;
 UPDATE public.purchases SET status='draft' WHERE id=p.id;
 st := public.evaluate_purchase(p.id);
 IF st <> 'cleared_for_checkout' THEN RAISE EXCEPTION 'Current payment controls refuse capture: %',st; END IF;
 IF (SELECT digest FROM public.purchases WHERE id=p.id) IS DISTINCT FROM a.digest THEN RAISE EXCEPTION 'Payment digest changed'; END IF;
 UPDATE public.purchases SET status='payment_pending' WHERE id=p.id;
 UPDATE public.payment_attempts SET status='capturing',operation_started_at=now(),updated_at=now() WHERE id=a.id RETURNING * INTO a;
 RETURN to_jsonb(a)||jsonb_build_object('execute_capture',true);
END $$;
REVOKE ALL ON FUNCTION public.prepare_sandbox_capture(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.prepare_sandbox_capture(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.reset_uncaptured_sandbox_attempt(_attempt uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.payment_attempts SET status='ordered',updated_at=now() WHERE id=_attempt AND status='capturing';
END $$;
REVOKE ALL ON FUNCTION public.reset_uncaptured_sandbox_attempt(uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reset_uncaptured_sandbox_attempt(uuid) TO service_role;