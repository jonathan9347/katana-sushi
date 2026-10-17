BEGIN;

DO $table_layout$
DECLARE
  unexpected_statuses TEXT;
  unexpected_capacities TEXT;
  unexpected_new_table_capacities TEXT;
  existing_new_table_count INTEGER;
  expected_old_table_count INTEGER;
  expected_old_table_layout BOOLEAN;
  has_table_insert_columns BOOLEAN;
BEGIN
  IF to_regclass('public.tables') IS NULL THEN
    RAISE NOTICE 'Skipping table layout: public.tables does not exist.';
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tables'
        AND column_name = 'id'
    ) OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tables'
        AND column_name = 'table_number'
    ) OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tables'
        AND column_name = 'capacity'
    ) OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tables'
        AND column_name = 'status'
    ) THEN
      RAISE NOTICE 'Skipping table layout: public.tables is missing a required column.';
    ELSE
      SELECT string_agg(
        format('T%s=%s', table_number, COALESCE(status, '<NULL>')),
        ', ' ORDER BY table_number
      )
      INTO unexpected_statuses
      FROM public.tables
      WHERE status IS NULL
         OR lower(btrim(status)) NOT IN ('available', 'occupied', 'reserved');

      IF unexpected_statuses IS NOT NULL THEN
        RAISE EXCEPTION
          'Phase 1 table migration stopped: unexpected table status value(s): %.',
          unexpected_statuses;
      END IF;

      SELECT string_agg(
        format('T%s currently has %s seats', t.table_number, t.capacity),
        ', ' ORDER BY t.table_number
      )
      INTO unexpected_capacities
      FROM public.tables AS t
      JOIN (
        VALUES
          (1, 2, 4),
          (2, 4, 4),
          (3, 4, 4),
          (4, 2, 4),
          (5, 4, 4),
          (6, 6, 4),
          (7, 2, 4),
          (8, 4, 4),
          (9, 8, 2),
          (10, 4, 2)
      ) AS expected(table_number, old_capacity, new_capacity)
        ON expected.table_number = t.table_number
      WHERE t.capacity NOT IN (expected.old_capacity, expected.new_capacity);

      IF unexpected_capacities IS NOT NULL THEN
        RAISE EXCEPTION
          'Phase 1 table migration stopped: unexpected existing capacity value(s): %.',
          unexpected_capacities;
      END IF;

      SELECT string_agg(
        format('T%s currently has %s seats', table_number, capacity),
        ', ' ORDER BY table_number
      )
      INTO unexpected_new_table_capacities
      FROM public.tables
      WHERE table_number BETWEEN 11 AND 16
        AND capacity <> 2;

      IF unexpected_new_table_capacities IS NOT NULL THEN
        RAISE EXCEPTION
          'Phase 1 table migration stopped: expected existing T11-T16 rows to have 2 seats: %.',
          unexpected_new_table_capacities;
      END IF;

      UPDATE public.tables
      SET status = lower(btrim(status));

      UPDATE public.tables AS t
      SET capacity = expected.new_capacity
      FROM (
        VALUES
          (1, 2, 4),
          (2, 4, 4),
          (3, 4, 4),
          (4, 2, 4),
          (5, 4, 4),
          (6, 6, 4),
          (7, 2, 4),
          (8, 4, 4),
          (9, 8, 2),
          (10, 4, 2)
      ) AS expected(table_number, old_capacity, new_capacity)
      WHERE t.table_number = expected.table_number
        AND t.capacity <> expected.new_capacity;

      SELECT
        count(*) FILTER (WHERE table_number BETWEEN 1 AND 10),
        count(*) FILTER (
          WHERE (table_number BETWEEN 1 AND 8 AND capacity = 4)
             OR (table_number BETWEEN 9 AND 10 AND capacity = 2)
        )
      INTO existing_new_table_count, expected_old_table_count
      FROM public.tables;

      expected_old_table_layout :=
        existing_new_table_count = 10
        AND expected_old_table_count = 10;

      SELECT count(*)
      INTO existing_new_table_count
      FROM public.tables
      WHERE table_number BETWEEN 11 AND 16;

      SELECT count(*) = 7
      INTO has_table_insert_columns
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tables'
        AND column_name IN (
          'id',
          'table_number',
          'capacity',
          'status',
          'created_at',
          'is_archived',
          'archived_at'
        );

      IF NOT expected_old_table_layout THEN
        RAISE NOTICE
          'Skipping T11-T16 inserts: T1-T10 are not all present with the expected seats after updates.';
      ELSIF NOT has_table_insert_columns THEN
        RAISE NOTICE
          'Skipping T11-T16 inserts: public.tables is missing a column required by the verified table-row shape.';
      ELSIF existing_new_table_count = 0 THEN
        INSERT INTO public.tables (
          id,
          table_number,
          capacity,
          status,
          created_at,
          is_archived,
          archived_at
        )
        SELECT
          gen_random_uuid()::text,
          requested.table_number,
          2,
          'available',
          CURRENT_TIMESTAMP,
          false,
          NULL
        FROM generate_series(11, 16) AS requested(table_number);
        RAISE NOTICE 'Inserted the complete T11-T16 two-seat table set.';
      ELSIF existing_new_table_count = 6 THEN
        RAISE NOTICE 'T11-T16 already exist; no table rows were inserted.';
      ELSE
        RAISE NOTICE
          'Skipping T11-T16 inserts: found only % of the six rows; no partial layout was created.',
          existing_new_table_count;
      END IF;
    END IF;
  END IF;
END;
$table_layout$;

DO $estimated_duration$
BEGIN
  IF to_regclass('public.system_settings') IS NULL THEN
    RAISE NOTICE 'Skipping estimated dining duration setting: public.system_settings does not exist.';
  ELSE
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'system_settings'
        AND column_name = 'estimated_dining_duration_minutes'
        AND data_type <> 'integer'
    ) THEN
      RAISE EXCEPTION
        'Phase 1 table migration stopped: system_settings.estimated_dining_duration_minutes exists but is not an integer.';
    END IF;

    ALTER TABLE public.system_settings
      ADD COLUMN IF NOT EXISTS estimated_dining_duration_minutes INTEGER
      NOT NULL DEFAULT 120;

    UPDATE public.system_settings
    SET estimated_dining_duration_minutes = 120
    WHERE estimated_dining_duration_minutes IS NULL;

    ALTER TABLE public.system_settings
      ALTER COLUMN estimated_dining_duration_minutes SET DEFAULT 120,
      ALTER COLUMN estimated_dining_duration_minutes SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'system_settings'
        AND column_name IN ('id', 'singleton_key', 'updated_at')
      GROUP BY table_schema, table_name
      HAVING count(*) = 3
    ) THEN
      RAISE NOTICE
        'Skipping default system settings row: public.system_settings is missing id, singleton_key, or updated_at.';
    ELSE
      INSERT INTO public.system_settings (
        id,
        singleton_key,
        estimated_dining_duration_minutes,
        updated_at
      )
      SELECT
        gen_random_uuid()::text,
        'default',
        120,
        CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.system_settings
        WHERE singleton_key = 'default'
      )
      ON CONFLICT (singleton_key) DO NOTHING;
    END IF;
  END IF;
END;
$estimated_duration$;

DO $session_group$
DECLARE
  has_sessions BOOLEAN;
  has_combinations BOOLEAN;
  has_members BOOLEAN;
  has_tables BOOLEAN;
BEGIN
  has_sessions := to_regclass('public.dining_table_sessions') IS NOT NULL;
  has_combinations := to_regclass('public.table_combinations') IS NOT NULL;
  has_members := to_regclass('public.table_combination_members') IS NOT NULL;
  has_tables := to_regclass('public.tables') IS NOT NULL;

  IF NOT has_sessions THEN
    RAISE NOTICE 'Skipping dining session group link and seat snapshot: public.dining_table_sessions does not exist.';
  ELSE
    ALTER TABLE public.dining_table_sessions
      ADD COLUMN IF NOT EXISTS table_combination_id TEXT,
      ADD COLUMN IF NOT EXISTS seat_count_at_start INTEGER;

    IF has_combinations THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.dining_table_sessions'::regclass
          AND conname = 'dining_table_sessions_table_combination_id_fkey'
      ) THEN
        ALTER TABLE public.dining_table_sessions
          ADD CONSTRAINT dining_table_sessions_table_combination_id_fkey
          FOREIGN KEY (table_combination_id)
          REFERENCES public.table_combinations(id)
          ON DELETE RESTRICT
          ON UPDATE CASCADE;
      END IF;

      CREATE INDEX IF NOT EXISTS dining_table_sessions_table_combination_id_idx
        ON public.dining_table_sessions (table_combination_id);
    ELSE
      RAISE NOTICE 'Skipping table-combination foreign key: public.table_combinations does not exist.';
    END IF;

    IF has_combinations AND has_members AND has_tables THEN
      EXECUTE $function_ddl$
        CREATE OR REPLACE FUNCTION public.set_dining_session_seat_snapshot()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $seat_snapshot$
        DECLARE
          seats INTEGER;
        BEGIN
          IF NEW.seat_count_at_start IS NOT NULL THEN
            RETURN NEW;
          END IF;

          IF NEW.table_combination_id IS NOT NULL THEN
            SELECT COALESCE(SUM(table_row.capacity), 0)::INTEGER
            INTO seats
            FROM public.table_combination_members AS member
            JOIN public.tables AS table_row ON table_row.id = member.table_id
            WHERE member.table_combination_id = NEW.table_combination_id;

            IF seats <= 0 THEN
              RAISE EXCEPTION
                'Cannot start dining session: table group % has no member tables with seats. Add its member rows before starting the session.',
                NEW.table_combination_id;
            END IF;
          ELSE
            SELECT capacity
            INTO seats
            FROM public.tables
            WHERE id = NEW.table_id;

            IF seats IS NULL OR seats <= 0 THEN
              RAISE EXCEPTION
                'Cannot start dining session: table % does not exist or has no valid seat capacity.',
                COALESCE(NEW.table_id, '<NULL>');
            END IF;
          END IF;

          NEW.seat_count_at_start := seats;
          RETURN NEW;
        END;
        $seat_snapshot$;
      $function_ddl$;

      DROP TRIGGER IF EXISTS dining_table_sessions_set_seat_snapshot
        ON public.dining_table_sessions;

      CREATE TRIGGER dining_table_sessions_set_seat_snapshot
        BEFORE INSERT ON public.dining_table_sessions
        FOR EACH ROW
        EXECUTE FUNCTION public.set_dining_session_seat_snapshot();
    ELSE
      RAISE NOTICE
        'Skipping dining seat snapshot trigger: a required table, table-combination, or member table does not exist.';
    END IF;
  END IF;
END;
$session_group$;

COMMIT;
