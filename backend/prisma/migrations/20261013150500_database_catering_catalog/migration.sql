ALTER TABLE "catering_packages"
ADD COLUMN IF NOT EXISTS "station_type" TEXT;

ALTER TABLE "catering_packages"
ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "catering_inquiries"
ALTER COLUMN "headcount" DROP NOT NULL;

INSERT INTO "catering_packages"
  ("id", "name", "station_type", "is_active", "price_per_person", "min_pax", "max_pax", "description", "image_url", "items", "created_at", "updated_at")
VALUES
  ('pkg_sushi_50_60', 'Sushi Station', 'sushi_station', TRUE, 0, 50, 60, '50-60 pax', '/images/cateringf.jpg',
   '{"pricingType":"flat","pricingModel":"tier","flatPrice":6000,"stationOrder":1,"optionOrder":1,"inclusions":["California Maki","Mango Roll","Volcano Roll","Tori Teriyaki Roll","Salmon Cheese Maki","Futo California","Tamago Sushi","Kani Sushi","Salmon Nigiri"],"galleryImages":["/images/cateringf.jpg","/images/sushi2.png","/images/sushi4.png"]}'::jsonb, NOW(), NOW()),
  ('pkg_sushi_75_85', 'Sushi Station', 'sushi_station', TRUE, 0, 75, 85, '75-85 pax', '/images/cateringf.jpg',
   '{"pricingType":"flat","pricingModel":"tier","flatPrice":9000,"stationOrder":1,"optionOrder":2,"inclusions":["California Maki","Mango Roll","Volcano Roll","Tori Teriyaki Roll","Salmon Cheese Maki","Futo California","Tamago Sushi","Kani Sushi","Salmon Nigiri"],"galleryImages":["/images/cateringf.jpg","/images/sushi2.png","/images/sushi4.png"]}'::jsonb, NOW(), NOW()),
  ('pkg_sushi_100_120', 'Sushi Station', 'sushi_station', TRUE, 0, 100, 120, '100-120 pax', '/images/cateringf.jpg',
   '{"pricingType":"flat","pricingModel":"tier","flatPrice":12000,"stationOrder":1,"optionOrder":3,"inclusions":["California Maki","Mango Roll","Volcano Roll","Tori Teriyaki Roll","Salmon Cheese Maki","Futo California","Tamago Sushi","Kani Sushi","Salmon Nigiri"],"galleryImages":["/images/cateringf.jpg","/images/sushi2.png","/images/sushi4.png"]}'::jsonb, NOW(), NOW()),
  ('pkg_sushi_150_170', 'Sushi Station', 'sushi_station', TRUE, 0, 150, 170, '150-170 pax', '/images/cateringf.jpg',
   '{"pricingType":"flat","pricingModel":"tier","flatPrice":17500,"stationOrder":1,"optionOrder":4,"inclusions":["California Maki","Mango Roll","Volcano Roll","Tori Teriyaki Roll","Salmon Cheese Maki","Futo California","Tamago Sushi","Kani Sushi","Salmon Nigiri"],"galleryImages":["/images/cateringf.jpg","/images/sushi2.png","/images/sushi4.png"]}'::jsonb, NOW(), NOW()),
  ('pkg_sushi_200_220', 'Sushi Station', 'sushi_station', TRUE, 0, 200, 220, '200-220 pax', '/images/cateringf.jpg',
   '{"pricingType":"flat","pricingModel":"tier","flatPrice":23000,"stationOrder":1,"optionOrder":5,"inclusions":["California Maki","Mango Roll","Volcano Roll","Tori Teriyaki Roll","Salmon Cheese Maki","Futo California","Tamago Sushi","Kani Sushi","Salmon Nigiri"],"galleryImages":["/images/cateringf.jpg","/images/sushi2.png","/images/sushi4.png"]}'::jsonb, NOW(), NOW()),
  ('pkg_sashimi_20_29', 'Sashimi Bar', 'sashimi_bar', FALSE, 0, 20, 29, '20-29kg whole tuna', '/images/catering-banner.jpg',
   '{"pricingType":"range","pricingModel":"per_unit","pricePerKg":750,"pricePerUnit":750,"unit":"kg","minKg":20,"minimum":20,"stepKg":1,"step":1,"maxKg":29,"maximum":29,"minPrice":15000,"maxPrice":21750,"stationOrder":2,"optionOrder":1,"inclusions":["Whole tuna sashimi service"],"galleryImages":["/images/catering-banner.jpg","/images/sushi5.png","/images/Menu-head.png"]}'::jsonb, NOW(), NOW()),
  ('pkg_sashimi_30_40', 'Sashimi Bar', 'sashimi_bar', FALSE, 0, 30, 40, '30-40kg whole tuna', '/images/catering-banner.jpg',
   '{"pricingType":"range","pricingModel":"per_unit","pricePerKg":750,"pricePerUnit":750,"unit":"kg","minKg":30,"minimum":30,"stepKg":1,"step":1,"maxKg":40,"maximum":40,"minPrice":22500,"maxPrice":30000,"stationOrder":2,"optionOrder":2,"inclusions":["Whole tuna sashimi service"],"galleryImages":["/images/catering-banner.jpg","/images/sushi5.png","/images/Menu-head.png"]}'::jsonb, NOW(), NOW()),
  ('pkg_tempura_live', 'Live Tempura', 'tempura_live', TRUE, 0, 50, 50, 'Live tempura station', '/images/unli-dining.jpg',
   '{"pricingType":"flat","pricingModel":"fixed","flatPrice":6000,"fixedPrice":6000,"fixedPax":50,"unit":"pax","stationOrder":3,"optionOrder":1,"inclusions":["Live tempura cooking station"],"galleryImages":["/images/unli-dining.jpg","/images/hero-banner.jpg","/images/cateringf.jpg"]}'::jsonb, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

UPDATE "catering_packages"
SET "station_type" = 'sushi_station',
    "is_active" = TRUE,
    "items" = COALESCE("items", '{}'::jsonb) || jsonb_build_object(
      'pricingModel', 'tier',
      'stationOrder', 1,
      'optionOrder', CASE "id"
        WHEN 'pkg_sushi_50_60' THEN 1
        WHEN 'pkg_sushi_75_85' THEN 2
        WHEN 'pkg_sushi_100_120' THEN 3
        WHEN 'pkg_sushi_150_170' THEN 4
        ELSE 5
      END
    )
WHERE "id" LIKE 'pkg_sushi_%';

UPDATE "catering_packages"
SET "station_type" = 'sashimi_bar',
    "is_active" = FALSE
WHERE "id" IN ('pkg_sashimi_20_29', 'pkg_sashimi_30_40');

INSERT INTO "catering_packages"
  ("id", "name", "station_type", "is_active", "price_per_person", "min_pax", "max_pax", "description", "image_url", "items", "created_at", "updated_at")
SELECT
  'pkg_sashimi_tuna', 'Tuna', 'sashimi_bar', TRUE, 0, 0, 0, 'Tuna',
  COALESCE(old_option."image_url", '/images/catering-banner.jpg'),
  jsonb_build_object(
    'pricingType', 'range',
    'pricingModel', 'per_unit',
    'pricePerKg', 1200,
    'pricePerUnit', 1200,
    'unit', 'kg',
    'minKg', 2,
    'minimum', 2,
    'stepKg', 1,
    'step', 1,
    'maxKg', 40,
    'maximum', 40,
    'minPrice', 2400,
    'maxPrice', 48000,
    'stationOrder', 2,
    'optionOrder', 1,
    'inclusions', jsonb_build_array('Tuna sashimi service'),
    'galleryImages', COALESCE(old_option."items"->'galleryImages', '["/images/catering-banner.jpg","/images/sushi5.png","/images/Menu-head.png"]'::jsonb)
  ),
  NOW(), NOW()
FROM (SELECT 1) AS seed
LEFT JOIN "catering_packages" AS old_option ON old_option."id" = 'pkg_sashimi_20_29'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "catering_packages"
  ("id", "name", "station_type", "is_active", "price_per_person", "min_pax", "max_pax", "description", "image_url", "items", "created_at", "updated_at")
SELECT
  'pkg_sashimi_salmon', 'Salmon', 'sashimi_bar', TRUE, 0, 0, 0, 'Salmon',
  COALESCE(old_option."image_url", '/images/catering-banner.jpg'),
  jsonb_build_object(
    'pricingType', 'range',
    'pricingModel', 'per_unit',
    'pricePerKg', 2400,
    'pricePerUnit', 2400,
    'unit', 'kg',
    'minKg', 2,
    'minimum', 2,
    'stepKg', 1,
    'step', 1,
    'maxKg', 40,
    'maximum', 40,
    'minPrice', 4800,
    'maxPrice', 96000,
    'stationOrder', 2,
    'optionOrder', 2,
    'inclusions', jsonb_build_array('Salmon sashimi service'),
    'galleryImages', COALESCE(old_option."items"->'galleryImages', '["/images/catering-banner.jpg","/images/sushi5.png","/images/Menu-head.png"]'::jsonb)
  ),
  NOW(), NOW()
FROM (SELECT 1) AS seed
LEFT JOIN "catering_packages" AS old_option ON old_option."id" = 'pkg_sashimi_20_29'
ON CONFLICT ("id") DO NOTHING;

UPDATE "catering_packages"
SET "station_type" = 'sashimi_bar',
    "is_active" = TRUE
WHERE "id" IN ('pkg_sashimi_tuna', 'pkg_sashimi_salmon');

UPDATE "catering_packages"
SET "name" = 'Live Tempura',
    "station_type" = 'tempura_live',
    "is_active" = TRUE,
    "price_per_person" = 0,
    "min_pax" = 50,
    "max_pax" = 50,
    "description" = 'Live tempura station',
    "items" = jsonb_build_object(
      'pricingType', 'flat',
      'pricingModel', 'fixed',
      'flatPrice', 6000,
      'fixedPrice', 6000,
      'fixedPax', 50,
      'unit', 'pax',
      'stationOrder', 3,
      'optionOrder', 1,
      'inclusions', COALESCE("items"->'inclusions', '["Live tempura cooking station"]'::jsonb),
      'galleryImages', COALESCE("items"->'galleryImages', '["/images/unli-dining.jpg","/images/hero-banner.jpg","/images/cateringf.jpg"]'::jsonb)
    )
WHERE "id" = 'pkg_tempura_live';
