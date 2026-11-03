
create policy "preparers upload invoices to own org" on storage.objects for insert to authenticated
with check (bucket_id = 'invoices' and (
  public.has_org_role(((storage.foldername(name))[1])::uuid,'preparer') or public.has_org_role(((storage.foldername(name))[1])::uuid,'owner')));
create policy "members read org invoices" on storage.objects for select to authenticated
using (bucket_id = 'invoices' and public.is_org_member(((storage.foldername(name))[1])::uuid));
