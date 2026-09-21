
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
  END LOOP;
END $$;

REVOKE ALL ON SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_document_number(text, integer) FROM PUBLIC, anon, authenticated;
