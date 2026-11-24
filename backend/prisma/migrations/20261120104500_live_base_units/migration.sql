BEGIN;

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
  'kg', 'kilogram', 'kilograms', 'l', 'liter', 'liters', 'litre', 'litres', 'pieces', 'pc', 'pcs', 'sheets'
);

UPDATE public.raw_materials AS material
SET current_stock = material.current_stock * units.factor,
    reorder_level = material.reorder_level * units.factor,
    cost_per_unit = material.cost_per_unit / units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE material.id = units.raw_material_id
  AND material.unit IS NOT NULL;

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
WHERE entry.raw_material_id = units.raw_material_id
  AND entry.unit IS NOT NULL;

UPDATE public.recipe_ingredients AS entry
SET quantity_per_yield = entry.quantity_per_yield * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id
  AND entry.unit IS NOT NULL;

UPDATE public.inventory_transactions AS entry
SET quantity = entry.quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id
  AND entry.unit IS NOT NULL;

UPDATE public.catering_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id
  AND entry.unit IS NOT NULL;

UPDATE public.reservation_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id
  AND entry.unit IS NOT NULL;

UPDATE public.takeout_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id
  AND entry.unit IS NOT NULL;

UPDATE public.dine_in_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM live_base_unit_materials AS units
WHERE entry.raw_material_id = units.raw_material_id
  AND entry.unit IS NOT NULL;

COMMIT;
