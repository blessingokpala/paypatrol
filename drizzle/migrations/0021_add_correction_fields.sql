ALTER TABLE public.purchases
  ADD COLUMN invoice_date date,
  ADD COLUMN due_date date,
  ADD COLUMN buyer_name text,
  ADD COLUMN subtotal_minor bigint,
  ADD COLUMN tax_minor bigint,
  ADD COLUMN shipping_minor bigint;