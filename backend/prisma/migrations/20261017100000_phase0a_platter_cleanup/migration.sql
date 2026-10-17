BEGIN;

UPDATE "recipe_ingredients"
SET "quantity_per_yield" = 0
WHERE "id" = 'cmv6bc2hd01y0n68qpho34nod'
  AND "quantity_per_yield" = 31;

UPDATE "recipe_ingredients"
SET "quantity_per_yield" = 0
WHERE "id" = 'cmv6be3cj01zzn68qqgsbq7p4'
  AND "quantity_per_yield" = 25;

UPDATE "recipes"
SET "status" = 'superseded by composition'
WHERE "selling_product_id" IN (
  'cmv3t2qgp008i6unsxzqdac41',
  'cmv3t2qgu008p6uns8bb6rof5'
);

UPDATE "selling_products"
SET "is_available" = false
WHERE "id" IN (
  'cmv3t2qgp008i6unsxzqdac41',
  'cmv3t2qgu008p6uns8bb6rof5'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "recipe_ingredients"
    WHERE "id" = 'cmv6bc2hd01y0n68qpho34nod'
      AND "quantity_per_yield" <> 0
  ) OR EXISTS (
    SELECT 1
    FROM "recipe_ingredients"
    WHERE "id" = 'cmv6be3cj01zzn68qqgsbq7p4'
      AND "quantity_per_yield" <> 0
  ) THEN
    RAISE EXCEPTION 'Classic platter Crabstick cleanup did not update both expected recipe lines';
  END IF;

  IF (
    SELECT count(*)
    FROM "selling_products"
    WHERE "id" IN (
      'cmv3t2qgp008i6unsxzqdac41',
      'cmv3t2qgu008p6uns8bb6rof5'
    )
      AND "is_available" = false
  ) <> 2 THEN
    RAISE EXCEPTION 'Both Classic Platter products must be marked unavailable';
  END IF;
END $$;

COMMIT;
