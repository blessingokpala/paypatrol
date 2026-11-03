ALTER TABLE public.budget_reservations ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes');

CREATE OR REPLACE FUNCTION public.require_recent_authentication() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE authenticated_at timestamptz;
BEGIN
  SELECT max(to_timestamp((v->>'timestamp')::double precision)) INTO authenticated_at
  FROM jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) v
  WHERE v->>'method' IN ('password','oauth','totp') AND (v->>'timestamp') ~ '^[0-9]+$';
  IF auth.uid() IS NULL OR authenticated_at IS NULL OR authenticated_at < now() - interval '5 minutes' OR authenticated_at > now() + interval '30 seconds' THEN
    RAISE EXCEPTION 'Recent sign-in required. Sign in again before changing spending rules or approving recipient changes.';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.require_recent_authentication() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_sensitive_control_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.organizations WHERE id = new.org_id FOR UPDATE;
  IF TG_TABLE_NAME = 'spending_policies' THEN
    IF EXISTS (SELECT 1 FROM public.spending_policies WHERE org_id = new.org_id AND id <> new.id) THEN
      PERFORM public.require_recent_authentication();
    END IF;
  ELSIF TG_TABLE_NAME = 'supplier_change_requests' AND new.status = 'approved' AND old.status IS DISTINCT FROM new.status THEN
    PERFORM public.require_recent_authentication();
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_attempts WHERE org_id = new.org_id AND status NOT IN ('failed','cancelled','completed','paid')) THEN
    RAISE EXCEPTION 'Payment execution or confirmation is pending. Resolve the existing payment before changing trusted controls.';
  END IF;
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.guard_sensitive_control_changes() FROM public, anon, authenticated;
CREATE TRIGGER guard_spending_policy_changes BEFORE INSERT OR UPDATE ON public.spending_policies FOR EACH ROW EXECUTE FUNCTION public.guard_sensitive_control_changes();
CREATE TRIGGER guard_recipient_change_approval BEFORE UPDATE ON public.supplier_change_requests FOR EACH ROW WHEN (new.status = 'approved') EXECUTE FUNCTION public.guard_sensitive_control_changes();

CREATE OR REPLACE FUNCTION public.guard_purchase_execution() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_attempts WHERE purchase_id = old.id AND status NOT IN ('failed','cancelled','completed','paid')) THEN
    IF new.version IS DISTINCT FROM old.version OR new.total_minor IS DISTINCT FROM old.total_minor OR new.currency IS DISTINCT FROM old.currency OR new.requested_recipient IS DISTINCT FROM old.requested_recipient OR new.supplier_version_id IS DISTINCT FROM old.supplier_version_id OR new.policy_version_id IS DISTINCT FROM old.policy_version_id OR new.status = 'cancelled' THEN
      RAISE EXCEPTION 'An existing payment attempt must be resolved before editing or cancelling this request.';
    END IF;
  END IF;
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.guard_purchase_execution() FROM public, anon, authenticated;
CREATE TRIGGER guard_purchase_execution BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_execution();

CREATE OR REPLACE FUNCTION public.guard_reservation_release() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF old.status = 'active' AND new.status = 'released' AND EXISTS (SELECT 1 FROM public.payment_attempts WHERE purchase_id = old.purchase_id AND status NOT IN ('failed','cancelled','completed','paid')) THEN
    RAISE EXCEPTION 'Payment confirmation pending. Its reserved budget cannot be released.';
  END IF;
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.guard_reservation_release() FROM public, anon, authenticated;
CREATE TRIGGER guard_reservation_release BEFORE UPDATE ON public.budget_reservations FOR EACH ROW EXECUTE FUNCTION public.guard_reservation_release();

CREATE OR REPLACE FUNCTION public.expire_safe_reservations(_org uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id = _org FOR UPDATE;
  UPDATE public.budget_reservations r SET status = 'released', released_at = now()
  WHERE r.org_id = _org AND r.status = 'active' AND r.expires_at <= now()
    AND NOT EXISTS (SELECT 1 FROM public.payment_attempts a WHERE a.purchase_id = r.purchase_id AND a.status NOT IN ('failed','cancelled','completed','paid'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.expire_safe_reservations(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_budget(_pid uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.purchases%rowtype; pol public.spending_policies%rowtype; v_res uuid; v_status public.purchase_status; v_week timestamptz;
BEGIN
  SELECT * INTO p FROM public.purchases WHERE id = _pid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.reserve_budget(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reserve_budget(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_reservation(_pid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.purchases%rowtype;
BEGIN
  SELECT * INTO p FROM public.purchases WHERE id = _pid;
  IF NOT (public.has_org_role(p.org_id,'payer') OR public.has_org_role(p.org_id,'owner')) THEN RAISE EXCEPTION 'Not permitted'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = p.org_id FOR UPDATE;
  PERFORM 1 FROM public.purchases WHERE id = _pid FOR UPDATE;
  UPDATE public.budget_reservations SET status = 'released', released_at = now() WHERE purchase_id = _pid AND status = 'active';
  PERFORM public.log_audit(p.org_id,'budget_released','purchase',_pid,null,'{}');
END $$;
REVOKE ALL ON FUNCTION public.release_reservation(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.release_reservation(uuid) TO authenticated;