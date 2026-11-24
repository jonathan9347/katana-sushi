BEGIN;

DO $phase2_table_id_history_snapshot$
DECLARE
  pos_transactions_table REGCLASS := to_regclass('public.pos_transactions');
  id_type TEXT;
  id_nullable TEXT;
  snapshot_type TEXT;
  snapshot_nullable TEXT;
  snapshot_default TEXT;
BEGIN
  IF pos_transactions_table IS NULL THEN
    RAISE EXCEPTION 'Table ID history migration stopped: public.pos_transactions does not exist.';
  END IF;

  SELECT c.data_type, c.is_nullable
    INTO id_type, id_nullable
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'pos_transactions'
    AND c.column_name = 'id';

  IF NOT FOUND
     OR id_type IS DISTINCT FROM 'text'
     OR id_nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'Table ID history migration stopped: pos_transactions.id must be TEXT NOT NULL.';
  END IF;

  SELECT c.data_type, c.is_nullable, c.column_default
    INTO snapshot_type, snapshot_nullable, snapshot_default
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'pos_transactions'
    AND c.column_name = 'table_ids_snapshot';

  IF NOT FOUND THEN
    ALTER TABLE public.pos_transactions
      ADD COLUMN IF NOT EXISTS table_ids_snapshot JSONB;

    SELECT c.data_type, c.is_nullable, c.column_default
      INTO snapshot_type, snapshot_nullable, snapshot_default
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'pos_transactions'
      AND c.column_name = 'table_ids_snapshot';
  END IF;

  IF snapshot_type IS DISTINCT FROM 'jsonb'
     OR snapshot_nullable IS DISTINCT FROM 'YES'
     OR snapshot_default IS NOT NULL THEN
    RAISE EXCEPTION 'Table ID history migration stopped: table_ids_snapshot must be nullable JSONB with no default.';
  END IF;
END;
$phase2_table_id_history_snapshot$;

COMMIT;
