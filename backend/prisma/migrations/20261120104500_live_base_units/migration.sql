BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT unit FROM public.raw_materials
      UNION ALL SELECT unit FROM public.inventory_snapshots
      UNION ALL SELECT unit FROM public.recipe_ingredients
      UNION ALL SELECT unit FROM public.inventory_transactions
      UNION ALL SELECT unit FROM public.inventory_movements
      UNION ALL SELECT unit FROM public.catering_ingredient_locks
      UNION ALL SELECT unit FROM public.reservation_ingredient_locks
      UNION ALL SELECT unit FROM public.takeout_ingredient_locks
      UNION ALL SELECT unit FROM public.dine_in_ingredient_locks
    ) AS units
    WHERE unit IS NULL
      OR lower(btrim(unit)) NOT IN (
        'kg', 'kilogram', 'kilograms',
        'l', 'liter', 'liters', 'litre', 'litres',
        'g', 'ml',
        'piece', 'pieces', 'pc', 'pcs',
        'sheet', 'sheets',
        'bottle', 'cup'
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected unit value found in a base-unit migration table; no changes were made.';
  END IF;
END $$;

CREATE TEMP TABLE live_base_unit_materials ON COMMIT DROP AS
SELECT
  id AS raw_material_id,
  CASE
    WHEN lower(btrim(unit)) IN ('kg', 'kilogram', 'kilograms') THEN 1000::NUMERIC
    WHEN lower(btrim(unit)) IN ('l', 'liter', 'liters', 'litre', 'litres') THEN 1000::NUMERIC
    ELSE 1::NUMERIC
  END AS factor,
  CASE
    WHEN lower(btrim(unit)) IN ('kg', 'kilogram', 'kilograms') THEN 'g'
    WHEN lower(btrim(unit)) IN ('l', 'liter', 'liters', 'litre', 'litres') THEN 'ml'
    WHEN lower(btrim(unit)) IN ('pieces', 'pc', 'pcs') THEN 'piece'
    WHEN lower(btrim(unit)) = 'sheets' THEN 'sheet'
  END AS target_unit
FROM public.raw_materials
WHERE lower(btrim(unit)) IN (
  'kg', 'kilogram', 'kilograms',
  'l', 'liter', 'liters', 'litre', 'litres',
  'pieces', 'pc', 'pcs', 'sheets'
);

UPDATE public.raw_materials AS material
SET current_stock = material.current_stock * units.factor,
    reorder_level = material.reorder_level * units.factor,
    cost_per_unit = material.cost_per_unit / units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE material.id = units.raw_material_id;

UPDATE public.material_batches AS batch
SET quantity = batch.quantity * units.factor,
    remaining_quantity = batch.remaining_quantity * units.factor,
    cost_per_unit = batch.cost_per_unit / units.factor
FROM live_base_unit_materials AS units
WHERE batch.raw_material_id = units.raw_material_id;

UPDATE public.inventory_snapshots AS entry
SET quantity = entry.quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.recipe_ingredients AS entry
SET quantity_per_yield = entry.quantity_per_yield * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.inventory_transactions AS entry
SET quantity = entry.quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.inventory_movements AS entry
SET quantity = entry.quantity * units.factor,
    quantity_before = entry.quantity_before * units.factor,
    quantity_after = entry.quantity_after * units.factor,
    reserved_before = entry.reserved_before * units.factor,
    reserved_after = entry.reserved_after * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.catering_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.reservation_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.takeout_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.dine_in_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM live_base_unit_materials AS units
    JOIN public.raw_materials AS material
      ON material.id = units.raw_material_id
    LEFT JOIN public.recipe_ingredients AS ingredient
      ON ingredient.raw_material_id = material.id
    WHERE material.unit IS DISTINCT FROM units.target_unit
       OR (
         ingredient.id IS NOT NULL
         AND ingredient.unit IS DISTINCT FROM material.unit
       )
  ) THEN
    RAISE EXCEPTION 'Converted material and recipe ingredient units do not match.';
  END IF;
END $$;

COMMIT;
