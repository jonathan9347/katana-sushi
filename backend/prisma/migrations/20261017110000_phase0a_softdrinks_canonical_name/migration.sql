BEGIN;

DO $$
DECLARE
  renamed_rows INTEGER;
BEGIN
  UPDATE public.raw_materials AS keeper
  SET name = 'Softdrinks'
  WHERE keeper.id = 'cmv3t32dl00061da4l74v2ku0'
    AND keeper.name = 'Softdrinks (Coke/Sprite/Royal)'
    AND keeper.is_deleted = FALSE
    AND NOT EXISTS (
      SELECT 1
      FROM public.raw_materials AS other
      WHERE other.name = 'Softdrinks'
        AND other.is_deleted = FALSE
        AND other.id <> keeper.id
    );

  GET DIAGNOSTICS renamed_rows = ROW_COUNT;

  IF renamed_rows > 0 AND NOT EXISTS (
    SELECT 1
    FROM public.raw_materials
    WHERE id = 'cmv3t32dl00061da4l74v2ku0'
      AND name = 'Softdrinks'
      AND is_deleted = FALSE
  ) THEN
    RAISE EXCEPTION 'Softdrinks canonical rename verification failed.';
  END IF;
END $$;

COMMIT;
