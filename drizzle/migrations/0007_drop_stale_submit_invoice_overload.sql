-- Keep exactly one invoice submission path so a browser call cannot land on the
-- older overload that ignores the approved-quote link.
drop function public.submit_invoice(uuid, uuid, text, bigint, text, text, text, text, text, text, text, text);