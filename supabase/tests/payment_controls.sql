-- PayPatrol payment-control tests.
-- Run each DO block with the backend SQL runner. Every block ends by raising
-- 'RESULTS: ...' on purpose, so all test data is rolled back. Every line must read PASS
-- (or show the expected status values).

-- Block 1: scenarios, independent reviewer, hard limits, approval invalidation, atomic budget, isolation
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  b uuid := '00000000-0000-0000-0000-00000000000b';
  c uuid := '00000000-0000-0000-0000-00000000000c';
  v_org uuid; v_org2 uuid; v_p1 uuid; v_p2 uuid; v_cr uuid; v_sup uuid; v_st text; v_n int; res text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  v_org := public.create_organization('Test Grocery', true);
  insert into public.memberships(org_id,user_id,role) values (v_org,b,'change_approver'),(v_org,b,'payer');
  select id, status into v_p1, v_st from public.purchases where org_id=v_org and fixture_label like 'Scenario one%';
  res := res || 'S1 status=' || v_st || '; ';  -- expect verification_required
  select count(*) into v_n from public.payment_attempts where purchase_id = v_p1;
  res := res || 'S1 payment attempts=' || v_n || '; ';  -- expect 0
  select status into v_st from public.purchases where org_id=v_org and fixture_label like 'Scenario two%';
  res := res || 'S2 status=' || v_st || '; ';  -- expect blocked
  select id into v_cr from public.supplier_change_requests where purchase_id = v_p1;
  begin perform public.record_verification(v_cr,'+1 902 555 0100','Sam',now(),'denied','called'); res := res || 'FAIL self-verify allowed; ';
  exception when others then res := res || 'PASS self-verify blocked; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  begin perform public.record_verification(v_cr,'+1 902 555 0199','Sam',now(),'confirmed','called new number'); res := res || 'FAIL untrusted channel allowed; ';
  exception when others then res := res || 'PASS untrusted channel blocked; '; end;
  perform public.record_verification(v_cr,'+1 902 555 0100','Sam Harbour',now(),'denied','Known supplier denies any change.');
  begin perform public.decide_supplier_change(v_cr,true,'x'); res := res || 'FAIL approve after deny; ';
  exception when others then res := res || 'PASS approve without confirm blocked; '; end;
  perform public.decide_supplier_change(v_cr,false,'Supplier denied change');
  select status into v_st from public.purchases where id=v_p1; res := res || 'S1 after reject=' || v_st || '; ';
  select v.paypal_merchant_id, s.id into v_st, v_sup from public.suppliers s join public.supplier_versions v on v.id=s.current_version_id where s.org_id=v_org;
  res := res || 'retained recipient=' || v_st || '; ';
  select id into v_p2 from public.purchases where org_id=v_org and fixture_label like 'Scenario two%';
  begin perform public.approve_purchase(v_p2,1,null); res := res || 'FAIL hard limit approved; ';
  exception when others then res := res || 'PASS hard limit approval rejected; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  v_p2 := public.submit_invoice(v_org, v_sup, 'INV-120', 12000, 'CAD', 'DEMO-MERCHANT-HARBOUR-001', null, 'packaging', 'Test', 'msg', null, null);
  begin perform public.approve_purchase(v_p2,1,null); res := res || 'FAIL self-approve; ';
  exception when others then res := res || 'PASS self-approve blocked; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  v_st := public.approve_purchase(v_p2,1,'ok'); res := res || 'after approve=' || v_st || '; ';
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  v_st := public.edit_purchase(v_p2, 12500, 'CAD', 'DEMO-MERCHANT-HARBOUR-001', 'INV-120', 'packaging');
  select count(*) into v_n from public.approvals where purchase_id=v_p2 and is_valid;
  res := res || 'after edit=' || v_st || ' valid approvals=' || v_n || '; ';
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  begin perform public.approve_purchase(v_p2,1,'stale'); res := res || 'FAIL stale version approved; ';
  exception when others then res := res || 'PASS stale version rejected; '; end;
  perform public.approve_purchase(v_p2,2,'ok');
  perform public.reserve_budget(v_p2);
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  v_p1 := public.submit_invoice(v_org, v_sup, 'INV-75B', 7500, 'CAD', 'DEMO-MERCHANT-HARBOUR-001', null, 'packaging', 'T', null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  perform public.reserve_budget(v_p1);
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  v_p1 := public.submit_invoice(v_org, v_sup, 'INV-80A', 8000, 'CAD', 'DEMO-MERCHANT-HARBOUR-001', null, 'packaging', 'T', null, null, null);
  v_p2 := public.submit_invoice(v_org, v_sup, 'INV-80B', 8000, 'CAD', 'DEMO-MERCHANT-HARBOUR-001', null, 'packaging', 'T', null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  perform public.reserve_budget(v_p1);
  begin perform public.reserve_budget(v_p2); res := res || 'FAIL second 80 reserved; ';
  exception when others then res := res || 'PASS second 80 rejected; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  v_org2 := public.create_organization('Other Org', false);
  begin perform public.approve_purchase(v_p2,1,null); res := res || 'FAIL outsider approve; ';
  exception when others then res := res || 'PASS outsider approve blocked; '; end;
  set local role authenticated;
  select count(*) into v_n from public.purchases where org_id = v_org; res := res || 'outsider sees purchases=' || v_n || '; ';
  reset role;
  raise exception 'RESULTS: %', res;
end $$;

-- Block 2: ordinary browser writes are refused
do $$
declare a uuid := '00000000-0000-0000-0000-00000000000a'; v_org uuid; res text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  v_org := public.create_organization('Test Grocery', true);
  set local role authenticated;
  begin update public.purchases set status='paid' where org_id = v_org; res := res || 'FAIL member direct paid update; ';
  exception when insufficient_privilege then res := res || 'PASS member cannot mark Paid; '; end;
  begin update public.supplier_versions set paypal_merchant_id='X' where org_id = v_org; res := res || 'FAIL supplier write; ';
  exception when insufficient_privilege then res := res || 'PASS member cannot modify trusted payment record; '; end;
  begin update public.supplier_change_requests set status='approved' where org_id = v_org; res := res || 'FAIL change approve write; ';
  exception when insufficient_privilege then res := res || 'PASS member cannot approve change directly; '; end;
  begin insert into public.approvals(org_id,purchase_id,purchase_version,digest,amount_minor,currency,approver_id) select org_id,id,1,'x',1,'CAD',a from public.purchases where org_id=v_org limit 1; res := res || 'FAIL approval insert; ';
  exception when insufficient_privilege then res := res || 'PASS member cannot insert approvals; '; end;
  begin perform public.evaluate_purchase((select id from public.purchases where org_id=v_org limit 1)); res := res || 'FAIL internal fn callable; ';
  exception when insufficient_privilege then res := res || 'PASS internal evaluation not callable; '; end;
  reset role;
  raise exception 'RESULTS: %', res;
end $$;

-- Block 3: approved-quote checks. The invoice amount is compared with the approved
-- quote, both are kept, and a difference is held rather than paid.
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  v_org uuid; v_sup uuid; v_listing uuid; v_rec text; v_price bigint; v_max int;
  v_p uuid; v_st text; v_n int; res text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  v_org := public.create_organization('Quote Test Grocery', true);
  select l.id, l.supplier_id, l.unit_price_minor, l.max_quantity into v_listing, v_sup, v_price, v_max
  from public.listings l where l.org_id = v_org and l.is_active order by l.name limit 1;
  select v.paypal_merchant_id into v_rec from public.suppliers s
  join public.supplier_versions v on v.id = s.current_version_id where s.id = v_sup;

  -- invoice asks for more than the approved quote -> held, difference reported
  v_p := public.submit_invoice(v_org, v_sup, 'INV-Q1', v_price + 3000, 'CAD', v_rec, null, 'packaging', 'T', null, null, null, v_listing, 1);
  select status into v_st from public.purchases where id = v_p;
  select count(*) into v_n from public.findings where purchase_id = v_p and code = 'AMOUNT_DIFFERS_FROM_QUOTE';
  res := res || 'MISMATCH status=' || v_st || ' findings=' || v_n || '; ';
  select count(*) into v_n from public.findings where purchase_id = v_p and code = 'AMOUNT_DIFFERS_FROM_QUOTE'
    and message like '%' || (v_price + 3000) || '%' and message like '%' || v_price || '%';
  res := res || 'both amounts shown=' || v_n || '; ';

  -- invoice matches the approved quote -> no quote finding
  v_p := public.submit_invoice(v_org, v_sup, 'INV-Q2', v_price, 'CAD', v_rec, null, 'packaging', 'T', null, null, null, v_listing, 1);
  select count(*) into v_n from public.findings where purchase_id = v_p and code = 'AMOUNT_DIFFERS_FROM_QUOTE';
  res := res || 'MATCH quote findings=' || v_n || '; ';

  -- quantity above the listing's own limit is reported
  v_p := public.submit_invoice(v_org, v_sup, 'INV-Q3', v_price, 'CAD', v_rec, null, 'packaging', 'T', null, null, null, v_listing, v_max + 1);
  select count(*) into v_n from public.findings where purchase_id = v_p and code = 'QUANTITY_OVER_LISTING_LIMIT';
  res := res || 'OVERLIMIT findings=' || v_n || '; ';

  -- correcting the request keeps the quote link
  perform public.edit_purchase(v_p, v_price, 'CAD', v_rec, 'INV-Q3', 'packaging');
  select count(*) into v_n from public.purchase_line_items where purchase_id = v_p and listing_id = v_listing;
  res := res || 'quote line after edit=' || v_n || '; ';

  raise exception 'RESULTS: %', res;
end $$;
