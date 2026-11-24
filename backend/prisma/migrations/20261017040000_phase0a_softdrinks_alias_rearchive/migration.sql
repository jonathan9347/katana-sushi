BEGIN;

DO $$
BEGIN
  IF current_database() <> 'katana_sushi_dev' OR current_schema() <> 'public' THEN
    RAISE EXCEPTION 'Softdrinks alias re-archive is restricted to katana_sushi_dev.public.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'cmv3t32dl00061da4l74v2ku0'
      AND name = 'Softdrinks (Coke/Sprite/Royal)'
      AND is_deleted = FALSE
  ) THEN
    RAISE EXCEPTION 'Descriptive Softdrinks keeper is missing; refusing alias archive.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'cmv6blwod028vn68q5g33s23u'
      AND name = 'Softdrinks '
      AND is_deleted = FALSE
      AND unit = 'bottle'
      AND current_stock = 0
      AND reorder_level = 0
      AND cost_per_unit = 0
  ) THEN
    RAISE EXCEPTION 'Reactivated Softdrinks alias no longer matches the inspected zero-stock record.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.material_batches WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.recipe_ingredients WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.inventory_transactions WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.catering_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.reservation_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.takeout_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.dine_in_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.inventory_snapshots WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u') THEN
    RAISE EXCEPTION 'Operational history still points at the Softdrinks alias; refusing to archive.';
  END IF;
END $$;

UPDATE public.raw_materials
SET is_deleted = TRUE
WHERE id = 'cmv6blwod028vn68q5g33s23u';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'cmv6blwod028vn68q5g33s23u'
      AND name = 'Softdrinks '
      AND is_deleted = TRUE
  ) THEN
    RAISE EXCEPTION 'Softdrinks alias archive verification failed.';
  END IF;
END $$;

COMMIT;
