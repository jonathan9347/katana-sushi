UPDATE "catering_packages"
SET "is_active" = FALSE
WHERE "id" IN ('pkg_sashimi_20_29', 'pkg_sashimi_30_40');

INSERT INTO "catering_packages"
  ("id", "name", "station_type", "is_active", "price_per_person", "min_pax", "max_pax", "description", "image_url", "items", "created_at", "updated_at")
VALUES
  (
    'pkg_whole_tuna',
    'Whole Tuna',
    'whole_tuna',
    TRUE,
    0,
    0,
    0,
    'Whole tuna sold by weight; 20-40 kg at PHP 1,200/kg. Booked as a standalone item.',
    '/images/catering-banner.jpg',
    '{"pricingType":"range","pricingModel":"per_unit","pricePerKg":1200,"pricePerUnit":1200,"unit":"kg","minimum":20,"minKg":20,"step":1,"stepKg":1,"maximum":40,"maxKg":40,"minPrice":24000,"maxPrice":48000,"stationOrder":2,"optionOrder":1,"bookingRole":"standalone","galleryImages":["/images/catering-banner.jpg","/images/sushi5.png","/images/Menu-head.png"]}'::jsonb,
    NOW(),
    NOW()
  )
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "station_type" = EXCLUDED."station_type",
  "is_active" = EXCLUDED."is_active",
  "price_per_person" = EXCLUDED."price_per_person",
  "min_pax" = EXCLUDED."min_pax",
  "max_pax" = EXCLUDED."max_pax",
  "description" = EXCLUDED."description",
  "items" = EXCLUDED."items",
  "updated_at" = NOW();

UPDATE "catering_packages"
SET "name" = 'Tuna',
    "station_type" = 'tuna_add_on',
    "is_active" = TRUE,
    "min_pax" = 0,
    "max_pax" = 0,
    "description" = 'Tuna add-on, 2-40 kg at PHP 1,200/kg.',
    "items" = COALESCE("items", '{}'::jsonb) || jsonb_build_object(
      'pricingType', 'range',
      'pricingModel', 'per_unit',
      'pricePerKg', 1200,
      'pricePerUnit', 1200,
      'unit', 'kg',
      'minimum', 2,
      'minKg', 2,
      'step', 1,
      'stepKg', 1,
      'maximum', 40,
      'maxKg', 40,
      'minPrice', 2400,
      'maxPrice', 48000,
      'bookingRole', 'add_on'
    ),
    "updated_at" = NOW()
WHERE "id" = 'pkg_sashimi_tuna';

UPDATE "catering_packages"
SET "name" = 'Salmon',
    "station_type" = 'salmon_add_on',
    "is_active" = TRUE,
    "min_pax" = 0,
    "max_pax" = 0,
    "description" = 'Salmon add-on, 2-40 kg at PHP 2,400/kg.',
    "items" = COALESCE("items", '{}'::jsonb) || jsonb_build_object(
      'pricingType', 'range',
      'pricingModel', 'per_unit',
      'pricePerKg', 2400,
      'pricePerUnit', 2400,
      'unit', 'kg',
      'minimum', 2,
      'minKg', 2,
      'step', 1,
      'stepKg', 1,
      'maximum', 40,
      'maxKg', 40,
      'minPrice', 4800,
      'maxPrice', 96000,
      'bookingRole', 'add_on'
    ),
    "updated_at" = NOW()
WHERE "id" = 'pkg_sashimi_salmon';

UPDATE "catering_packages"
SET "name" = 'Live Tempura',
    "station_type" = 'tempura_live',
    "is_active" = TRUE,
    "price_per_person" = 0,
    "min_pax" = 50,
    "max_pax" = 50,
    "description" = 'Fixed 50-pax tempura package.',
    "items" = COALESCE("items", '{}'::jsonb) || jsonb_build_object(
      'pricingType', 'flat',
      'pricingModel', 'fixed',
      'flatPrice', 6000,
      'fixedPrice', 6000,
      'fixedPax', 50,
      'unit', 'pax',
      'inventoryRequirements', jsonb_build_array(
        jsonb_build_object('materialName', 'Shrimp', 'quantity', 5000, 'unit', 'g'),
        jsonb_build_object('materialName', 'Tempura flour', 'quantity', 2000, 'unit', 'g'),
        jsonb_build_object('materialName', 'Cooking oil', 'quantity', 3000, 'unit', 'ml'),
        jsonb_build_object('materialName', 'Dipping sauce', 'quantity', 1500, 'unit', 'ml')
      )
    ),
    "updated_at" = NOW()
WHERE "id" = 'pkg_tempura_live';
