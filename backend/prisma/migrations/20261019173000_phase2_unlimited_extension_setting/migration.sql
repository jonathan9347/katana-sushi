DO $migration$
DECLARE
  existing_column_type text;
  existing_column_nullable text;
  existing_column_default text;
BEGIN
  IF to_regclass('public.unlimited_settings') IS NULL THEN
    RAISE NOTICE 'Skipping extension_minutes migration: public.unlimited_settings does not exist.';
    RETURN;
  END IF;

  SELECT c.data_type, c.is_nullable, c.column_default
    INTO existing_column_type, existing_column_nullable, existing_column_default
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'unlimited_settings'
    AND c.column_name = 'extension_minutes';

  IF NOT FOUND THEN
    ALTER TABLE public.unlimited_settings
      ADD COLUMN extension_minutes INTEGER NOT NULL DEFAULT 30;
  ELSIF existing_column_type <> 'integer'
     OR existing_column_nullable <> 'NO'
     OR existing_column_default IS DISTINCT FROM '30' THEN
    RAISE EXCEPTION
      'Cannot add unlimited_settings.extension_minutes: existing column has unexpected shape (type %, nullable %, default %). Expected INTEGER NOT NULL DEFAULT 30.',
      existing_column_type, existing_column_nullable, existing_column_default;
  END IF;
END
$migration$;
