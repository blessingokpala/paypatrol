CREATE OR REPLACE FUNCTION public.probe_sig(_pid uuid, _amount_minor bigint, _currency text, _recipient text, _invoice_ref text, _category text, _invoice_date date, _due_date date, _buyer text, _subtotal_minor bigint, _tax_minor bigint, _shipping_minor bigint, _reason text)
 RETURNS purchase_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN 'draft';
END $function$;
DROP FUNCTION public.probe_sig(uuid, bigint, text, text, text, text, date, date, text, bigint, bigint, bigint, text);