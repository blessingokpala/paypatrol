-- Scripted, isolated fixture; no partner identity and no payment execution.
-- Expected exception rolls back everything, including test memberships/events.
DO $$
DECLARE a uuid='00000000-0000-0000-0000-00000000000a';
b uuid='00000000-0000-0000-0000-00000000000b';
c uuid='00000000-0000-0000-0000-00000000000c';
d uuid='00000000-0000-0000-0000-00000000000d';
o uuid; s uuid; p uuid; cr uuid; n uuid; before_count integer;
BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
 o=public.create_organization('Notification regression — fictional',true);
 PERFORM public.mark_test_workspace(o,'Isolated notification regression');
 INSERT INTO memberships(org_id,user_id,role) VALUES(o,b,'payer'),(o,b,'change_approver'),(o,c,'preparer'),(o,d,'owner');
 SELECT id INTO s FROM suppliers WHERE org_id=o LIMIT 1;
 p=public.submit_invoice(o,s,'NOTIFY-REGRESSION',13500,'CAD','DEMO-MERCHANT-HARBOUR-001',null,'packaging','Fictional notification fixture',null,null,null);
 IF (SELECT count(*) FROM review_notifications WHERE purchase_id=p AND kind='spending_review')<>2 THEN RAISE EXCEPTION 'FAIL spending reviewer routing'; END IF;
 IF EXISTS(SELECT 1 FROM review_notifications WHERE purchase_id=p AND user_id IN(a,c)) THEN RAISE EXCEPTION 'FAIL submitter/preparer notified'; END IF;
 SELECT count(*) INTO before_count FROM review_notifications WHERE purchase_id=p;
 PERFORM deliver_pending_purchase_review(p); PERFORM deliver_pending_purchase_review(p);
 IF (SELECT count(*) FROM review_notifications WHERE purchase_id=p)<>before_count THEN RAISE EXCEPTION 'FAIL retry duplicates'; END IF;
 SELECT id INTO n FROM review_notifications WHERE purchase_id=p AND user_id=b;
 IF public.can_read_review_notification(b,o,'spending_review') THEN RAISE EXCEPTION 'FAIL other account read'; END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
 IF NOT public.can_read_review_notification(b,o,'spending_review') THEN RAISE EXCEPTION 'FAIL payer read'; END IF;
 PERFORM mark_review_notification_read(n); PERFORM mark_review_notification_read(n);
 IF (SELECT read_at FROM review_notifications WHERE id=n) IS NULL THEN RAISE EXCEPTION 'FAIL persistent read'; END IF;
 PERFORM public.reject_spending(p,1,'Scripted rejection reason');
 IF NOT EXISTS(SELECT 1 FROM review_notifications WHERE purchase_id=p AND user_id=a AND kind='outcome' AND title='Spending rejected' AND detail LIKE '%Scripted rejection reason%') THEN RAISE EXCEPTION 'FAIL requester rejection outcome'; END IF;
 IF EXISTS(SELECT 1 FROM budget_reservations WHERE purchase_id=p) OR EXISTS(SELECT 1 FROM payment_attempts WHERE purchase_id=p) THEN RAISE EXCEPTION 'FAIL accounting changed'; END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
 p=public.submit_invoice(o,s,'NOTIFY-APPROVE',13500,'CAD','DEMO-MERCHANT-HARBOUR-001',null,'packaging','Fictional approval fixture',null,null,null);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
 PERFORM public.approve_purchase(p,1,'Scripted approval','individual');
 IF NOT EXISTS(SELECT 1 FROM review_notifications WHERE purchase_id=p AND user_id=a AND title='Spending approved') THEN RAISE EXCEPTION 'FAIL approval outcome'; END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
 p=public.submit_invoice(o,s,'NOTIFY-SUPPLIER',7500,'CAD','UNSUPPORTED-TEST',null,'packaging','Fictional supplier review',null,null,null);
 SELECT id INTO cr FROM supplier_change_requests WHERE purchase_id=p;
 IF (SELECT count(*) FROM review_notifications WHERE change_request_id=cr AND kind='supplier_review')<>2 THEN RAISE EXCEPTION 'FAIL supplier reviewer routing'; END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
 PERFORM public.decide_supplier_change(cr,false,'Unsupported fixture recipient');
 IF NOT EXISTS(SELECT 1 FROM review_notifications WHERE change_request_id=cr AND user_id=a AND title='Supplier change rejected' AND detail LIKE '%Unsupported fixture recipient%') THEN RAISE EXCEPTION 'FAIL supplier rejection outcome'; END IF;
 IF (SELECT requested_recipient FROM purchases WHERE id=p)<>'UNSUPPORTED-TEST' OR (SELECT status FROM purchases WHERE id=p) IN ('paid','cancelled','cleared_for_checkout') THEN RAISE EXCEPTION 'FAIL supplier rejection changed payment authorisation'; END IF;
 DELETE FROM memberships WHERE org_id=o AND user_id=b;
 IF public.can_read_review_notification(b,o,'supplier_review') THEN RAISE EXCEPTION 'FAIL removed membership access'; END IF;
 RAISE EXCEPTION 'PASS: spending/supplier eligibility; owner eligibility; submitter/preparer exclusion; retry deduplication; own-account reads; persistent read; spending approval/rejection outcomes; supplier rejection reason; unchanged recipient/payment controls; revoked membership. ROLLED BACK';
END $$;