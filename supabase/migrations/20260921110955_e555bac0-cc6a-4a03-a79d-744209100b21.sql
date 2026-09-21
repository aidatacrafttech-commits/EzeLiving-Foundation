
-- Backend (service role) access to the existing app tables
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

-- Atomic sequential document numbers (invoices, purchases, returns, holds)
CREATE OR REPLACE FUNCTION public.next_document_number(p_document_type text, p_year integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO public.document_counters (document_type, year, last_number)
  VALUES (p_document_type, p_year, 1)
  ON CONFLICT (document_type, year)
  DO UPDATE SET last_number = public.document_counters.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN v_next;
END;
$$;
GRANT EXECUTE ON FUNCTION public.next_document_number(text, integer) TO service_role;

-- Demo accounts (password: password123)
INSERT INTO public.users (name, email, password_hash, role, updated_at)
VALUES
  ('Admin User', 'admin@example.com', '$2b$10$kreKlXKMv8xQK3D8uOfMF.8MKtrFliP3rJoaK9/Bmb4SFUH3iImZy', 'admin', now()),
  ('Staff User', 'staff@example.com', '$2b$10$kreKlXKMv8xQK3D8uOfMF.8MKtrFliP3rJoaK9/Bmb4SFUH3iImZy', 'staff', now())
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash, is_active = true, updated_at = now();

-- Warehouses / showrooms
INSERT INTO public.warehouses (name, location, contact_person, phone)
SELECT * FROM (VALUES
  ('Showroom 1', 'MG Road, Pune', 'Rahul Sharma', '9876500001'),
  ('Showroom 2', 'City Mall, Pune', 'Priya Desai', '9876500002'),
  ('Warehouse', 'MIDC, Pune', 'Amit Kulkarni', '9876500003')
) AS v(name, location, contact_person, phone)
WHERE NOT EXISTS (SELECT 1 FROM public.warehouses);

-- Products
INSERT INTO public.products (name, sku, barcode, category, brand, mrp, selling_price, tax_percent, unit, updated_at)
SELECT * FROM (VALUES
  ('Colgate Toothpaste 100g','SKU-0001','8901030710001','Personal Care','Colgate',55,49,12,'pcs'),
  ('Parle-G Biscuits 200g','SKU-0002','8901030710002','Grocery','Parle',30,28,5,'pcs'),
  ('Tata Salt 1kg','SKU-0003','8901030710003','Grocery','Tata',25,24,5,'pcs'),
  ('Dettol Handwash 200ml','SKU-0004','8901030710004','Personal Care','Dettol',99,89,18,'pcs'),
  ('Maggi Noodles 70g','SKU-0005','8901030710005','Grocery','Nestle',14,14,5,'pcs'),
  ('Amul Butter 500g','SKU-0006','8901030710006','Dairy','Amul',275,265,12,'pcs'),
  ('Surf Excel Detergent 1kg','SKU-0007','8901030710007','Household','Surf Excel',130,119,18,'pcs'),
  ('Boat Rockerz 235 Earphones','SKU-0008','8901030710008','Electronics','Boat',1499,1199,18,'pcs'),
  ('Classmate Notebook 200pg','SKU-0009','8901030710009','Stationery','Classmate',60,55,12,'pcs'),
  ('Cello Ballpoint Pen (Pack of 5)','SKU-0010','8901030710010','Stationery','Cello',50,45,12,'pack'),
  ('Philips LED Bulb 9W','SKU-0011','8901030710011','Electronics','Philips',150,129,18,'pcs'),
  ('Bisleri Water Bottle 1L','SKU-0012','8901030710012','Beverages','Bisleri',20,20,5,'pcs'),
  ('Britannia Bread 400g','SKU-0013','8901030710013','Bakery','Britannia',45,42,5,'pcs'),
  ('Fortune Sunflower Oil 1L','SKU-0014','8901030710014','Grocery','Fortune',165,155,5,'pcs'),
  ('Lays Chips 52g','SKU-0015','8901030710015','Snacks','Lays',20,20,12,'pcs'),
  ('HP 20L Printer Paper Ream','SKU-0016','8901030710016','Stationery','HP',320,299,12,'pcs'),
  ('Samsung USB-C Cable 1m','SKU-0017','8901030710017','Electronics','Samsung',499,399,18,'pcs'),
  ('Nivea Body Lotion 200ml','SKU-0018','8901030710018','Personal Care','Nivea',210,189,18,'pcs')
) AS v(name, sku, barcode, category, brand, mrp, selling_price, tax_percent, unit), LATERAL (SELECT now()) AS t(updated_at)
WHERE NOT EXISTS (SELECT 1 FROM public.products);

-- Stock for every product in every warehouse
INSERT INTO public.stock (product_id, warehouse_id, quantity, reorder_level, updated_at)
SELECT p.id, w.id,
       CASE w.rn WHEN 1 THEN 20 + ((p.rn * 7) % 40)
                 WHEN 2 THEN CASE WHEN p.rn % 4 = 0 THEN 0 ELSE 5 + ((p.rn * 3) % 20) END
                 ELSE 50 + ((p.rn * 11) % 60) END,
       CASE w.rn WHEN 1 THEN 10 WHEN 2 THEN 5 ELSE 15 END,
       now()
FROM (SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn FROM public.products) p
CROSS JOIN (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM public.warehouses) w
WHERE NOT EXISTS (SELECT 1 FROM public.stock);

-- Customers
INSERT INTO public.customers (name, phone, email, updated_at)
SELECT * FROM (VALUES
  ('Walk-in Customer', NULL, NULL),
  ('Suresh Patel', '9822011111', 'suresh.patel@example.com'),
  ('Anita Rao', '9822022222', 'anita.rao@example.com')
) AS v(name, phone, email), LATERAL (SELECT now()) AS t(updated_at)
WHERE NOT EXISTS (SELECT 1 FROM public.customers);
