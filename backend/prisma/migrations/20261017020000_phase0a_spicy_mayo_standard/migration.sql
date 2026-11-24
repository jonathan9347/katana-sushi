BEGIN;

DO $$
BEGIN
  IF current_database() <> 'katana_sushi_dev' OR current_schema() <> 'public' THEN
    RAISE EXCEPTION 'Phase 0A standard correction is restricted to katana_sushi_dev.public.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.raw_materials
    WHERE id = 'cmv3t2q9e000m6unsk4h57uq8'
      AND name = 'Spicy mayo'
      AND unit = 'ml'
  ) OR (
    SELECT count(*)
    FROM public.recipe_ingredients
    WHERE raw_material_id = 'cmv3t2q9e000m6unsk4h57uq8'
  ) <> 6 THEN
    RAISE EXCEPTION 'Spicy mayo recipe lines changed from the approved six-line standardization plan.';
  END IF;
END $$;

UPDATE public.recipe_ingredients
SET quantity_per_yield = 10,
    unit = 'ml'
WHERE raw_material_id = 'cmv3t2q9e000m6unsk4h57uq8';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.recipe_ingredients
    WHERE raw_material_id = 'cmv3t2q9e000m6unsk4h57uq8'
      AND (quantity_per_yield <> 10 OR unit <> 'ml')
  ) THEN
    RAISE EXCEPTION 'Spicy mayo standard verification failed.';
  END IF;
END $$;

COMMIT;
