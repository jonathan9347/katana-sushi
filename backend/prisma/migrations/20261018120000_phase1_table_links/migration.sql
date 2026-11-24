BEGIN;

DO $manage_table_links$
DECLARE
  linked_column_type TEXT;
  reason_column_type TEXT;
  fk_definition TEXT;
  self_check_definition TEXT;
  link_index_definition TEXT;
BEGIN
  IF to_regclass('public.tables') IS NULL THEN
    RAISE NOTICE 'Skipping Phase 3a table link fields: public.tables does not exist.';
  ELSIF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tables'
      AND ((column_name = 'id' AND data_type = 'text')
        OR (column_name = 'status' AND data_type = 'text')
        OR (column_name = 'is_archived' AND data_type = 'boolean'))
  ) <> 3 THEN
    RAISE NOTICE 'Skipping Phase 3a table link fields: public.tables is missing an expected id/text, status/text, or is_archived/boolean column.';
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.tables'::regclass
      AND i.indisunique
      AND i.indnkeyatts = 1
      AND i.indkey[0] = (
        SELECT a.attnum
        FROM pg_attribute a
        WHERE a.attrelid = 'public.tables'::regclass
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
  ) THEN
    RAISE NOTICE 'Skipping Phase 3a table link fields: public.tables.id is not uniquely indexed.';
  ELSE
    SELECT data_type INTO linked_column_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tables'
      AND column_name = 'linked_to_table_id';

    SELECT data_type INTO reason_column_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tables'
      AND column_name = 'unavailable_reason';

    IF linked_column_type IS NOT NULL AND linked_column_type <> 'text' THEN
      RAISE EXCEPTION 'Phase 3a migration stopped: tables.linked_to_table_id exists with type %, expected text.', linked_column_type;
    END IF;
    IF reason_column_type IS NOT NULL AND reason_column_type <> 'text' THEN
      RAISE EXCEPTION 'Phase 3a migration stopped: tables.unavailable_reason exists with type %, expected text.', reason_column_type;
    END IF;

    ALTER TABLE public.tables
      ADD COLUMN IF NOT EXISTS linked_to_table_id TEXT,
      ADD COLUMN IF NOT EXISTS unavailable_reason TEXT;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.tables'::regclass
        AND conname = 'tables_linked_to_table_id_fkey'
    ) THEN
      SELECT pg_get_constraintdef(oid) INTO fk_definition
      FROM pg_constraint
      WHERE conrelid = 'public.tables'::regclass
        AND conname = 'tables_linked_to_table_id_fkey';
      IF lower(fk_definition) NOT LIKE 'foreign key (linked_to_table_id) references tables(id)%on update cascade%on delete restrict%' THEN
        RAISE EXCEPTION 'Phase 3a migration stopped: constraint tables_linked_to_table_id_fkey exists with unexpected definition: %.', fk_definition;
      END IF;
    ELSE
      ALTER TABLE public.tables
        ADD CONSTRAINT tables_linked_to_table_id_fkey
        FOREIGN KEY (linked_to_table_id)
        REFERENCES public.tables(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.tables'::regclass
        AND conname = 'tables_linked_to_table_not_self_check'
    ) THEN
      SELECT pg_get_constraintdef(oid) INTO self_check_definition
      FROM pg_constraint
      WHERE conrelid = 'public.tables'::regclass
        AND conname = 'tables_linked_to_table_not_self_check';
      IF lower(regexp_replace(self_check_definition, '[[:space:]"()]', '', 'g')) <> 'checklinked_to_table_idisnullorlinked_to_table_id<>id' THEN
        RAISE EXCEPTION 'Phase 3a migration stopped: constraint tables_linked_to_table_not_self_check exists with unexpected definition: %.', self_check_definition;
      END IF;
    ELSE
      ALTER TABLE public.tables
        ADD CONSTRAINT tables_linked_to_table_not_self_check
        CHECK (linked_to_table_id IS NULL OR linked_to_table_id <> id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'tables'
        AND indexname = 'tables_linked_to_table_id_idx'
    ) THEN
      SELECT indexdef INTO link_index_definition
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'tables'
        AND indexname = 'tables_linked_to_table_id_idx';
      IF lower(link_index_definition) NOT LIKE '%using btree (linked_to_table_id)%' THEN
        RAISE EXCEPTION 'Phase 3a migration stopped: index tables_linked_to_table_id_idx exists with unexpected definition: %.', link_index_definition;
      END IF;
    ELSE
      CREATE INDEX tables_linked_to_table_id_idx
        ON public.tables (linked_to_table_id);
    END IF;
  END IF;
END;
$manage_table_links$;

COMMIT;
