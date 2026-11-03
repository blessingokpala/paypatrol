DO $$ BEGIN
EXECUTE replace(pg_get_functiondef('public.decide_supplier_change(uuid,boolean,text)'::regprocedure),
  '''rejected_recipient'',cr.proposed_recipient)', '''rejected_recipient'',cr.proposed_recipient,''retained_version_id'',cr.base_version_id)');
END $$;