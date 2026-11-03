ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS is_test_workspace boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.organizations.is_test_workspace IS 'Explicit classification for automated-test workspaces; hidden from the normal switcher, never deleted.';

CREATE OR REPLACE FUNCTION public.mark_test_workspace(_org uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_org_role(_org, 'owner') THEN RAISE EXCEPTION 'Only the workspace owner can classify it as a test workspace'; END IF;
  UPDATE public.organizations SET is_test_workspace = true WHERE id = _org AND NOT is_test_workspace;
  IF FOUND THEN
    PERFORM public.log_audit(_org, 'workspace_classified_test', 'organization', _org, NULL,
      jsonb_build_object('reason', coalesce(_reason, 'Automated test workspace')), 'user');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.mark_test_workspace(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_test_workspace(uuid, text) TO authenticated;

-- Backfill: classify the five workspaces created by automated test scripts (by ID, not name).
UPDATE public.organizations SET is_test_workspace = true WHERE id IN (
 '386ad640-8d12-4584-b82b-2aee96830c2e','b47bd9c5-9de9-4ee5-8450-d844dc7b0b01','92031fb3-3adb-4387-b294-ae1e3f949876',
 '5d8b1f53-c1a8-412a-b999-f720484af414','40c929cc-5e81-497b-b9b0-27211403d5a8');
INSERT INTO public.audit_events (org_id, actor_kind, action, entity_type, entity_id, details)
SELECT id, 'system', 'workspace_classified_test', 'organization', id,
  jsonb_build_object('reason','Created by automated test script (concurrent_budget.py / sandbox_checkpoint.py) using the owner account; kept for evidence')
FROM public.organizations WHERE id IN (
 '386ad640-8d12-4584-b82b-2aee96830c2e','b47bd9c5-9de9-4ee5-8450-d844dc7b0b01','92031fb3-3adb-4387-b294-ae1e3f949876',
 '5d8b1f53-c1a8-412a-b999-f720484af414','40c929cc-5e81-497b-b9b0-27211403d5a8');