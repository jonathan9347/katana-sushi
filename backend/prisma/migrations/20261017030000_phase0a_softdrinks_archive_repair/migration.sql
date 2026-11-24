BEGIN;

DO $$
BEGIN
  IF current_database() <> 'katana_sushi_dev' OR current_schema() <> 'public' THEN
    RAISE EXCEPTION 'Softdrinks archive correction is restricted to katana_sushi_dev.public.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'cmv3t32dl00061da4l74v2ku0'
      AND name = 'Softdrinks'
      AND is_deleted = FALSE
      AND unit = 'bottle'
      AND current_stock = 0
      AND reorder_level = 0
      AND cost_per_unit = 0
  ) OR NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'cmv6blwod028vn68q5g33s23u'
      AND name = 'Softdrinks '
      AND is_deleted = FALSE
      AND unit = 'bottle'
      AND current_stock = 0
      AND reorder_level = 0
      AND cost_per_unit = 0
  ) THEN
    RAISE EXCEPTION 'Softdrinks records no longer match the inspected correction preflight.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE name = 'Softdrinks (Coke/Sprite/Royal)'
      AND id <> 'cmv3t32dl00061da4l74v2ku0'
  ) THEN
    RAISE EXCEPTION 'A second descriptive Softdrinks material exists; refusing to rename keeper.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_snapshot_archives
    WHERE snapshot_id = 'cmv96a4tc00xymbt8tf5o4626'
      AND raw_material_id = 'cmv6blwod028vn68q5g33s23u'
      AND quantity = 0
      AND unit = 'bottle'
      AND total_value = 0
  ) THEN
    RAISE EXCEPTION 'Archived duplicate Softdrinks snapshot was not found; refusing correction.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.material_batches WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.recipe_ingredients WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.inventory_transactions WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.catering_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.reservation_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.takeout_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.dine_in_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u') THEN
    RAISE EXCEPTION 'Operational references still point at duplicate Softdrinks; refusing to archive.';
  END IF;
END $$;

UPDATE public.raw_materials
SET name = 'Softdrinks (Coke/Sprite/Royal)'
WHERE id = 'cmv3t32dl00061da4l74v2ku0';

UPDATE public.raw_materials
SET is_deleted = TRUE
WHERE id = 'cmv6blwod028vn68q5g33s23u';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'cmv3t32dl00061da4l74v2ku0'
      AND name = 'Softdrinks (Coke/Sprite/Royal)'
      AND is_deleted = FALSE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'cmv6blwod028vn68q5g33s23u'
      AND name = 'Softdrinks '
      AND is_deleted = TRUE
  ) THEN
    RAISE EXCEPTION 'Softdrinks keeper rename/archive verification failed.';
  END IF;
END $$;

COMMIT;
