-- Recreating the recorder in 0035 reset its default PUBLIC EXECUTE privilege.
-- Only the verified server webhook path may attest a PayPal event.
REVOKE ALL ON FUNCTION public.record_verified_sandbox_event(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_sandbox_event(text,text,text,text) TO service_role;
COMMENT ON FUNCTION public.record_verified_sandbox_event(text,text,text,text) IS 'Service-only: call only after PayPal signature verification; never callable by browser roles.';