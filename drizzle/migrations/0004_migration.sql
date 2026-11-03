
do $$ declare t text; begin
  foreach t in array array['organizations','memberships','spending_policies','suppliers','supplier_versions','listings','purchases','purchase_line_items',
    'invoice_documents','findings','supplier_change_requests','verification_records','approvals','budget_reservations','payment_attempts','paypal_orders',
    'paypal_captures','webhook_events','audit_events'] loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
revoke insert, delete, truncate on public.profiles from anon, authenticated;
revoke all on public.profiles from anon;
