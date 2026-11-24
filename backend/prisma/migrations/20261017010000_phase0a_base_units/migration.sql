BEGIN;

DO $$
DECLARE
  db_name TEXT := current_database();
BEGIN
  IF db_name <> 'katana_sushi_dev' OR current_schema() <> 'public' THEN
    RAISE EXCEPTION 'Phase 0A migration is restricted to katana_sushi_dev.public (connected to %.%)',
      db_name, current_schema();
  END IF;
  IF (SELECT count(*) FROM public.raw_materials) <> 42
    OR (SELECT count(*) FROM public.recipes) <> 57
    OR (SELECT count(*) FROM public.recipe_ingredients) <> 161
    OR (SELECT count(*) FROM public.inventory_snapshots) <> 42 THEN
    RAISE EXCEPTION 'Phase 0A preflight counts changed; expected 42 materials, 57 recipes, 161 recipe lines, and 42 snapshots.';
  END IF;
END $$;

CREATE TABLE public.inventory_snapshot_archives (
  snapshot_id TEXT PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  raw_material_id TEXT NOT NULL,
  quantity BIGINT NOT NULL,
  unit TEXT NOT NULL,
  total_value DECIMAL(18, 2) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL,
  archived_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archive_reason TEXT NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'cmv3t32dl00061da4l74v2ku0'
      AND name = 'Softdrinks (Coke/Sprite/Royal)'
      AND unit = 'bottle'
      AND current_stock = 0 AND reorder_level = 0 AND cost_per_unit = 0
  ) OR NOT EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'cmv6blwod028vn68q5g33s23u'
      AND name = 'Softdrinks '
      AND unit = 'bottle'
      AND current_stock = 0 AND reorder_level = 0 AND cost_per_unit = 0
  ) THEN
    RAISE EXCEPTION 'Softdrinks records no longer match the approved merge preflight.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_snapshots
    WHERE id = 'cmv96a4t600xsmbt88ki6vgne'
      AND raw_material_id = 'cmv3t32dl00061da4l74v2ku0'
      AND snapshot_date = DATE '2026-10-14' AND quantity = 0
      AND unit = 'bottle' AND total_value = 0
  ) OR NOT EXISTS (
    SELECT 1 FROM public.inventory_snapshots
    WHERE id = 'cmv96a4tc00xymbt8tf5o4626'
      AND raw_material_id = 'cmv6blwod028vn68q5g33s23u'
      AND snapshot_date = DATE '2026-10-14' AND quantity = 0
      AND unit = 'bottle' AND total_value = 0
  ) THEN
    RAISE EXCEPTION 'Softdrinks snapshots no longer match the approved archive decision.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.raw_materials WHERE name = 'Softdrinks' AND id <> 'cmv3t32dl00061da4l74v2ku0')
    OR EXISTS (SELECT 1 FROM public.material_batches WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.recipe_ingredients WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.inventory_transactions WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.catering_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.reservation_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.takeout_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u')
    OR EXISTS (SELECT 1 FROM public.dine_in_ingredient_locks WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u') THEN
    RAISE EXCEPTION 'Softdrinks references changed after the approved merge preflight.';
  END IF;
END $$;

INSERT INTO public.inventory_snapshot_archives
  (snapshot_id, snapshot_date, raw_material_id, quantity, unit, total_value, created_at, archive_reason)
SELECT id, snapshot_date, raw_material_id, quantity::BIGINT, unit, total_value, created_at,
  'Duplicate zero-valued Softdrinks snapshot archived during approved material merge; keeper snapshot retained.'
FROM public.inventory_snapshots
WHERE id = 'cmv96a4tc00xymbt8tf5o4626';

DELETE FROM public.inventory_snapshots
WHERE id = 'cmv96a4tc00xymbt8tf5o4626';

ALTER TABLE public.raw_materials
  ADD COLUMN cost_source_amount DECIMAL(18, 8),
  ADD COLUMN cost_source_quantity BIGINT,
  ADD COLUMN cost_source_unit TEXT;
ALTER TABLE public.raw_materials
  ALTER COLUMN cost_per_unit TYPE DECIMAL(18, 8) USING cost_per_unit::DECIMAL(18, 8);
ALTER TABLE public.material_batches
  ALTER COLUMN cost_per_unit TYPE DECIMAL(18, 8) USING cost_per_unit::DECIMAL(18, 8);

UPDATE public.raw_materials
SET name = 'Softdrinks'
WHERE id = 'cmv3t32dl00061da4l74v2ku0';

UPDATE public.material_batches
SET raw_material_id = 'cmv3t32dl00061da4l74v2ku0'
WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u';
UPDATE public.recipe_ingredients
SET raw_material_id = 'cmv3t32dl00061da4l74v2ku0'
WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u';
UPDATE public.inventory_transactions
SET raw_material_id = 'cmv3t32dl00061da4l74v2ku0'
WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u';
UPDATE public.inventory_movements
SET raw_material_id = 'cmv3t32dl00061da4l74v2ku0'
WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u';
UPDATE public.catering_ingredient_locks
SET raw_material_id = 'cmv3t32dl00061da4l74v2ku0'
WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u';
UPDATE public.reservation_ingredient_locks
SET raw_material_id = 'cmv3t32dl00061da4l74v2ku0'
WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u';
UPDATE public.takeout_ingredient_locks
SET raw_material_id = 'cmv3t32dl00061da4l74v2ku0'
WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u';
UPDATE public.dine_in_ingredient_locks
SET raw_material_id = 'cmv3t32dl00061da4l74v2ku0'
WHERE raw_material_id = 'cmv6blwod028vn68q5g33s23u';

UPDATE public.raw_materials
SET is_deleted = TRUE
WHERE id = 'cmv6blwod028vn68q5g33s23u';

CREATE TEMP TABLE phase0a_material_units ON COMMIT DROP AS
SELECT
  id AS raw_material_id,
  CASE
    WHEN lower(trim(unit)) IN ('kg', 'kilogram', 'kilograms') THEN 1000::NUMERIC
    WHEN lower(trim(unit)) IN ('l', 'liter', 'liters', 'litre', 'litres') THEN 1000::NUMERIC
    WHEN id = 'cmv3t2q9e000j6unseq0pion3' AND lower(trim(unit)) IN ('piece', 'pieces', 'pc', 'pcs') THEN 150::NUMERIC
    ELSE 1::NUMERIC
  END AS factor,
  CASE
    WHEN lower(trim(unit)) IN ('kg', 'kilogram', 'kilograms') THEN 'g'
    WHEN lower(trim(unit)) IN ('l', 'liter', 'liters', 'litre', 'litres') THEN 'ml'
    WHEN id = 'cmv3t2q9e000j6unseq0pion3' THEN 'g'
    WHEN lower(trim(unit)) IN ('pieces', 'pc', 'pcs') THEN 'piece'
    WHEN lower(trim(unit)) IN ('sheets') THEN 'sheet'
    ELSE unit
  END AS target_unit
FROM public.raw_materials
WHERE is_deleted = FALSE;

UPDATE public.raw_materials
SET cost_source_amount = cost_per_unit,
    cost_source_quantity = 150,
    cost_source_unit = 'g'
WHERE id = 'cmv3t2q9e000j6unseq0pion3';

UPDATE public.raw_materials AS material
SET current_stock = (material.current_stock * units.factor)::BIGINT,
    reorder_level = (material.reorder_level * units.factor)::BIGINT,
    cost_per_unit = (material.cost_per_unit / units.factor)::DECIMAL(18, 8),
    unit = units.target_unit
FROM phase0a_material_units AS units
WHERE material.id = units.raw_material_id;

UPDATE public.material_batches AS batch
SET quantity = batch.quantity * units.factor,
    remaining_quantity = batch.remaining_quantity * units.factor,
    cost_per_unit = CASE WHEN batch.cost_per_unit IS NULL THEN NULL ELSE batch.cost_per_unit / units.factor END
FROM phase0a_material_units AS units
WHERE batch.raw_material_id = units.raw_material_id;

UPDATE public.inventory_transactions AS entry
SET quantity = entry.quantity * units.factor,
    unit = units.target_unit
FROM phase0a_material_units AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.inventory_movements AS entry
SET quantity = entry.quantity * units.factor,
    quantity_before = entry.quantity_before * units.factor,
    quantity_after = entry.quantity_after * units.factor,
    reserved_before = entry.reserved_before * units.factor,
    reserved_after = entry.reserved_after * units.factor,
    unit = units.target_unit
FROM phase0a_material_units AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.inventory_snapshots AS entry
SET quantity = entry.quantity * units.factor,
    unit = units.target_unit
FROM phase0a_material_units AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.catering_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM phase0a_material_units AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.reservation_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM phase0a_material_units AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.takeout_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM phase0a_material_units AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.dine_in_ingredient_locks AS entry
SET reserved_quantity = entry.reserved_quantity * units.factor,
    unit = units.target_unit
FROM phase0a_material_units AS units
WHERE entry.raw_material_id = units.raw_material_id;

UPDATE public.recipe_ingredients AS ingredient
SET quantity_per_yield = CASE
    WHEN ingredient.id = 'cmv6baost01xan68qhhj97dy7' THEN 20
    WHEN ingredient.id = 'cmv6bag7s01wjn68qe4lq2d69' THEN 30
    WHEN ingredient.id = 'cmv6baost01xbn68q8tav8a0a' THEN 1
    WHEN ingredient.id = 'cmv6bag7s01wkn68q829r7uk7' THEN 2
    WHEN ingredient.id = 'cmv6baost01xcn68qcqez027w' THEN 200
    WHEN ingredient.id = 'cmv6bag7s01wln68q6e54qui0' THEN 300
    WHEN material.id = 'cmv3t2q9e000j6unseq0pion3' THEN 20
    WHEN material.id = 'cmv3t2q9e000a6uns2k14t1n0' AND ingredient.id IN (
      'cmv6bag7s01win68qon6art8h',
      'cmv6baost01x9n68qvtz0jc9e',
      'cmv6awhnl0193n68qm5l4gjcl',
      'cmv6axev401aln68q87wrki4t',
      'cmv6ay5hv01bnn68qbjqgwtwf',
      'cmv6awsu4019un68qln8d6nvu',
      'cmv6bc2hd01y0n68qpho34nod',
      'cmv6be3cj01zzn68qqgsbq7p4',
      'cmv6b0ydg01ian68qwonjy2pd',
      'cmv6b2ble01kjn68qhdy5d407',
      'cmv6b343901msn68qz8ftz6h3',
      'cmv6bejpl020qn68qjo2wswph'
    ) THEN CASE
      WHEN ingredient.id = 'cmv6bag7s01win68qon6art8h' THEN 3
      WHEN ingredient.id = 'cmv6baost01x9n68qvtz0jc9e' THEN 2
      WHEN ingredient.id = 'cmv6bc2hd01y0n68qpho34nod' THEN 31
      WHEN ingredient.id = 'cmv6be3cj01zzn68qqgsbq7p4' THEN 25
      WHEN ingredient.id IN ('cmv6awsu4019un68qln8d6nvu') THEN 3
      WHEN ingredient.id IN ('cmv6awhnl0193n68qm5l4gjcl','cmv6axev401aln68q87wrki4t','cmv6ay5hv01bnn68qbjqgwtwf','cmv6b0ydg01ian68qwonjy2pd','cmv6b2ble01kjn68qhdy5d407','cmv6b343901msn68qz8ftz6h3','cmv6bejpl020qn68qjo2wswph') THEN 4
      ELSE ingredient.quantity_per_yield
    END
    WHEN material.id = 'cmv3t2q9e000s6uns4m4awz41' THEN 10
    ELSE ingredient.quantity_per_yield * units.factor
  END,
  unit = CASE
    WHEN material.id = 'cmv3t2q9e000j6unseq0pion3' THEN 'g'
    WHEN material.id = 'cmv3t2q9e000a6uns2k14t1n0' THEN 'piece'
    WHEN material.id = 'cmv3t2q9e000s6uns4m4awz41' THEN 'ml'
    ELSE units.target_unit
  END
FROM public.raw_materials AS material
JOIN phase0a_material_units AS units ON units.raw_material_id = material.id
WHERE ingredient.raw_material_id = material.id;

UPDATE public.recipe_ingredients
SET quantity_per_yield = 1,
    unit = 'piece'
WHERE id = 'cmv6ayjfr01cen68qfiqfx72i';

UPDATE public.recipe_ingredients
SET quantity_per_yield = 1,
    unit = 'g'
WHERE id = 'cmv6asqc8014an68qbcvklzoc';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.raw_materials WHERE current_stock <> trunc(current_stock) OR reorder_level <> trunc(reorder_level))
    OR EXISTS (SELECT 1 FROM public.material_batches WHERE quantity <> trunc(quantity) OR remaining_quantity <> trunc(remaining_quantity))
    OR EXISTS (SELECT 1 FROM public.inventory_snapshots WHERE quantity <> trunc(quantity))
    OR EXISTS (SELECT 1 FROM public.recipes WHERE total_yield_quantity <> trunc(total_yield_quantity))
    OR EXISTS (SELECT 1 FROM public.recipe_ingredients WHERE quantity_per_yield <> trunc(quantity_per_yield))
    OR EXISTS (SELECT 1 FROM public.inventory_transactions WHERE quantity <> trunc(quantity))
    OR EXISTS (SELECT 1 FROM public.inventory_movements WHERE quantity <> trunc(quantity)
      OR quantity_before <> trunc(quantity_before) OR quantity_after <> trunc(quantity_after)
      OR reserved_before <> trunc(reserved_before) OR reserved_after <> trunc(reserved_after))
    OR EXISTS (SELECT 1 FROM public.catering_ingredient_locks WHERE reserved_quantity <> trunc(reserved_quantity))
    OR EXISTS (SELECT 1 FROM public.reservation_ingredient_locks WHERE reserved_quantity <> trunc(reserved_quantity))
    OR EXISTS (SELECT 1 FROM public.takeout_ingredient_locks WHERE reserved_quantity <> trunc(reserved_quantity))
    OR EXISTS (SELECT 1 FROM public.dine_in_ingredient_locks WHERE reserved_quantity <> trunc(reserved_quantity)) THEN
    RAISE EXCEPTION 'Fractional quantity remains; refusing to round during whole-unit migration.';
  END IF;
END $$;

ALTER TABLE public.raw_materials
  ALTER COLUMN current_stock TYPE BIGINT USING current_stock::BIGINT,
  ALTER COLUMN reorder_level TYPE BIGINT USING reorder_level::BIGINT;

ALTER TABLE public.material_batches
  ALTER COLUMN quantity TYPE BIGINT USING quantity::BIGINT,
  ALTER COLUMN remaining_quantity TYPE BIGINT USING remaining_quantity::BIGINT;

ALTER TABLE public.inventory_snapshots
  ALTER COLUMN quantity TYPE BIGINT USING quantity::BIGINT,
  ALTER COLUMN total_value TYPE DECIMAL(18, 2) USING total_value::DECIMAL(18, 2);

ALTER TABLE public.recipes
  ALTER COLUMN total_yield_quantity TYPE BIGINT USING total_yield_quantity::BIGINT,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'recipe not confirmed';

ALTER TABLE public.recipe_ingredients
  ALTER COLUMN quantity_per_yield TYPE BIGINT USING quantity_per_yield::BIGINT;

ALTER TABLE public.inventory_transactions
  ALTER COLUMN quantity TYPE BIGINT USING quantity::BIGINT;

ALTER TABLE public.inventory_movements
  ALTER COLUMN quantity TYPE BIGINT USING quantity::BIGINT,
  ALTER COLUMN quantity_before TYPE BIGINT USING quantity_before::BIGINT,
  ALTER COLUMN quantity_after TYPE BIGINT USING quantity_after::BIGINT,
  ALTER COLUMN reserved_before TYPE BIGINT USING reserved_before::BIGINT,
  ALTER COLUMN reserved_after TYPE BIGINT USING reserved_after::BIGINT;

ALTER TABLE public.catering_ingredient_locks
  ALTER COLUMN reserved_quantity TYPE BIGINT USING reserved_quantity::BIGINT;

ALTER TABLE public.reservation_ingredient_locks
  ALTER COLUMN reserved_quantity TYPE BIGINT USING reserved_quantity::BIGINT;

ALTER TABLE public.takeout_ingredient_locks
  ALTER COLUMN reserved_quantity TYPE BIGINT USING reserved_quantity::BIGINT;

ALTER TABLE public.dine_in_ingredient_locks
  ALTER COLUMN reserved_quantity TYPE BIGINT USING reserved_quantity::BIGINT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.system_settings
    WHERE default_reorder_level IS NULL
      OR default_reorder_level <> trunc(default_reorder_level)
  ) THEN
    RAISE EXCEPTION 'Fractional default reorder level found; refusing to round during whole-unit migration.';
  END IF;
END $$;
ALTER TABLE public.system_settings
  ALTER COLUMN default_reorder_level TYPE INTEGER USING default_reorder_level::INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.raw_materials
    WHERE id = 'cmv3t2q9e000j6unseq0pion3'
      AND (unit <> 'g' OR current_stock <> 0 OR reorder_level <> 1500
        OR cost_per_unit <> 0.36666667 OR cost_source_amount <> 55
        OR cost_source_quantity <> 150 OR cost_source_unit <> 'g')
  ) THEN
    RAISE EXCEPTION 'Avocado base-unit conversion validation failed.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('cmv6baost01x9n68qvtz0jc9e', 2::BIGINT),
      ('cmv6bag7s01win68qon6art8h', 3::BIGINT),
      ('cmv6baost01xan68qhhj97dy7', 20::BIGINT),
      ('cmv6bag7s01wjn68qe4lq2d69', 30::BIGINT),
      ('cmv6baost01xbn68q8tav8a0a', 1::BIGINT),
      ('cmv6bag7s01wkn68q829r7uk7', 2::BIGINT),
      ('cmv6baost01xcn68qcqez027w', 200::BIGINT),
      ('cmv6bag7s01wln68q6e54qui0', 300::BIGINT)
    ) AS expected(id, quantity)
    LEFT JOIN public.recipe_ingredients AS ingredient ON ingredient.id = expected.id
    WHERE ingredient.id IS NULL OR ingredient.quantity_per_yield <> expected.quantity
  ) THEN
    RAISE EXCEPTION 'Baked Sushi Small/Medium temporary estimate validation failed.';
  END IF;
  IF (SELECT count(*) FROM public.inventory_snapshots) <> 41
    OR (SELECT count(*) FROM public.inventory_snapshot_archives WHERE snapshot_id = 'cmv96a4tc00xymbt8tf5o4626') <> 1
    OR (SELECT count(*) FROM public.recipes) <> 57
    OR (SELECT count(*) FROM public.recipe_ingredients) <> 161 THEN
    RAISE EXCEPTION 'Phase 0A post-migration count or snapshot-archive validation failed.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.recipe_ingredients AS ingredient
    JOIN public.raw_materials AS material ON material.id = ingredient.raw_material_id
    WHERE material.is_deleted = FALSE AND ingredient.unit <> material.unit
  ) THEN
    RAISE EXCEPTION 'Recipe/material unit mismatch remains after Phase 0A conversion.';
  END IF;
END $$;

COMMIT;
