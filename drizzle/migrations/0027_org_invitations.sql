CREATE TABLE public.org_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  org_name text NOT NULL,
  email text NOT NULL,
  roles public.member_role[] NOT NULL,
  invited_by uuid NOT NULL,
  inviter_name text,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  send_count integer NOT NULL DEFAULT 1,
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_invitations_status_chk CHECK (status IN ('pending','accepted','revoked')),
  CONSTRAINT org_invitations_roles_chk CHECK (cardinality(roles) > 0)
);
CREATE UNIQUE INDEX org_invitations_one_pending ON public.org_invitations(org_id, lower(email)) WHERE status = 'pending';
GRANT SELECT ON public.org_invitations TO authenticated;
GRANT ALL ON public.org_invitations TO service_role;
ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners see their business invitations" ON public.org_invitations FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, 'owner'));
CREATE POLICY "Invitees see invitations to their verified email" ON public.org_invitations FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt()->>'email','')) AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL));

CREATE OR REPLACE FUNCTION public.create_invitation(_org uuid, _email text, _roles public.member_role[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_email text := lower(trim(_email)); v_name text; v_inviter text;
BEGIN
  IF NOT public.has_org_role(_org,'owner') THEN RAISE EXCEPTION 'Only business owners can invite members'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid email address'; END IF;
  IF _roles IS NULL OR cardinality(_roles) = 0 THEN RAISE EXCEPTION 'Choose at least one role'; END IF;
  IF EXISTS (SELECT 1 FROM public.org_invitations WHERE org_id=_org AND lower(email)=v_email AND status='pending' AND expires_at > now()) THEN
    RAISE EXCEPTION 'A pending invitation already exists for this email. Resend or revoke it instead.'; END IF;
  -- An expired pending invitation is closed so a fresh one can be issued; history is kept.
  UPDATE public.org_invitations SET status='revoked', revoked_at=now() WHERE org_id=_org AND lower(email)=v_email AND status='pending';
  SELECT name INTO v_name FROM public.organizations WHERE id=_org;
  SELECT coalesce(display_name, email) INTO v_inviter FROM public.profiles WHERE id=auth.uid();
  INSERT INTO public.org_invitations(org_id, org_name, email, roles, invited_by, inviter_name)
  VALUES (_org, v_name, v_email, (SELECT array_agg(DISTINCT r) FROM unnest(_roles) r), auth.uid(), v_inviter) RETURNING id INTO v_id;
  PERFORM public.log_audit(_org,'invitation_created','invitation',v_id,null,jsonb_build_object('email',v_email,'roles',_roles));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.resend_invitation(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.org_invitations;
BEGIN
  SELECT * INTO i FROM public.org_invitations WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR NOT public.has_org_role(i.org_id,'owner') THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF i.status <> 'pending' THEN RAISE EXCEPTION 'Only pending invitations can be resent (this one is %)', i.status; END IF;
  UPDATE public.org_invitations SET expires_at=now()+interval '7 days', last_sent_at=now(), send_count=send_count+1 WHERE id=_id;
  PERFORM public.log_audit(i.org_id,'invitation_resent','invitation',_id,null,jsonb_build_object('email',i.email));
END $$;

CREATE OR REPLACE FUNCTION public.revoke_invitation(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.org_invitations;
BEGIN
  SELECT * INTO i FROM public.org_invitations WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR NOT public.has_org_role(i.org_id,'owner') THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF i.status <> 'pending' THEN RAISE EXCEPTION 'This invitation is already %', i.status; END IF;
  UPDATE public.org_invitations SET status='revoked', revoked_at=now() WHERE id=_id;
  PERFORM public.log_audit(i.org_id,'invitation_revoked','invitation',_id,null,jsonb_build_object('email',i.email));
END $$;

CREATE OR REPLACE FUNCTION public.accept_invitation(_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.org_invitations; v_email text; v_conf timestamptz; r public.member_role;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT lower(email), email_confirmed_at INTO v_email, v_conf FROM auth.users WHERE id=auth.uid();
  SELECT * INTO i FROM public.org_invitations WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF lower(i.email) <> v_email THEN RAISE EXCEPTION 'This invitation was sent to a different email address. Sign in with the invited account.'; END IF;
  IF v_conf IS NULL THEN RAISE EXCEPTION 'Confirm your email address before accepting'; END IF;
  IF i.status = 'accepted' THEN RAISE EXCEPTION 'This invitation has already been accepted'; END IF;
  IF i.status = 'revoked' THEN RAISE EXCEPTION 'This invitation was revoked. Ask the business owner for a new one.'; END IF;
  IF i.expires_at <= now() THEN RAISE EXCEPTION 'This invitation has expired. Ask the business owner to resend it.'; END IF;
  FOREACH r IN ARRAY i.roles LOOP
    INSERT INTO public.memberships(org_id,user_id,role) VALUES (i.org_id, auth.uid(), r) ON CONFLICT DO NOTHING;
  END LOOP;
  UPDATE public.org_invitations SET status='accepted', accepted_by=auth.uid(), accepted_at=now() WHERE id=_id;
  PERFORM public.log_audit(i.org_id,'invitation_accepted','invitation',_id,null,jsonb_build_object('email',i.email,'roles',i.roles));
  RETURN i.org_id;
END $$;

REVOKE ALL ON FUNCTION public.create_invitation(uuid,text,public.member_role[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.resend_invitation(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.revoke_invitation(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.accept_invitation(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_invitation(uuid,text,public.member_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid) TO authenticated;