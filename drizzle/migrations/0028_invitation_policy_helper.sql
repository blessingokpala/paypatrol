CREATE OR REPLACE FUNCTION public.my_verified_email() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(email) FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.my_verified_email() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_verified_email() TO authenticated;
DROP POLICY "Invitees see invitations to their verified email" ON public.org_invitations;
CREATE POLICY "Invitees see invitations to their verified email" ON public.org_invitations FOR SELECT TO authenticated
  USING (lower(email) = public.my_verified_email());