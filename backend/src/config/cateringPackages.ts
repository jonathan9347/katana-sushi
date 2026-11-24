import { Prisma } from "@prisma/client";

const sushiInclusions = [
  "California Maki",
  "Mango Roll",
  "Volcano Roll",
  "Tori Teriyaki Roll",
  "Salmon Cheese Maki",
  "Futo California",
  "Tamago Sushi",
  "Kani Sushi",
  "Salmon Nigiri"
];

const galleryImages = ["/images/cateringf.jpg", "/images/sushi2.png", "/images/sushi4.png"];

export const CATERING_PACKAGE_SEEDS: Prisma.CateringPackageCreateManyInput[] = [
  ...[
    { id: "pkg_sushi_50_60", minPax: 50, maxPax: 60, price: 6000 },
    { id: "pkg_sushi_75_85", minPax: 75, maxPax: 85, price: 9000 },
    { id: "pkg_sushi_100_120", minPax: 100, maxPax: 120, price: 12000 },
    { id: "pkg_sushi_150_170", minPax: 150, maxPax: 170, price: 17500 },
    { id: "pkg_sushi_200_220", minPax: 200, maxPax: 220, price: 23000 }
  ].map(({ id, minPax, maxPax, price }, index) => ({
    id,
    name: "Sushi Station",
    stationType: "sushi_station",
    isActive: true,
    pricePerPerson: 0,
    minPax,
    maxPax,
    description: `${minPax}-${maxPax} pax`,
    imageUrl: galleryImages[0],
    items: {
      pricingType: "flat",
      pricingModel: "tier",
      flatPrice: price,
      stationOrder: 1,
      optionOrder: index + 1,
      inclusions: sushiInclusions,
      galleryImages
    }
  })),
  {
    id: "pkg_whole_tuna",
    name: "Whole Tuna",
    stationType: "whole_tuna",
    isActive: true,
    pricePerPerson: 0,
    minPax: 0,
    maxPax: 0,
    description: "Whole tuna sold by weight; 20-40 kg at PHP 1,200/kg. Can be booked on its own or alongside other catering packages.",
    imageUrl: "/images/catering-banner.jpg",
    items: {
      pricingType: "range",
      pricingModel: "per_unit",
      pricePerKg: 1200,
      pricePerUnit: 1200,
      unit: "kg",
      minimum: 20,
      minKg: 20,
      step: 1,
      stepKg: 1,
      maximum: 40,
      maxKg: 40,
      minPrice: 24000,
      maxPrice: 48000,
      stationOrder: 2,
      optionOrder: 1,
      bookingRole: "standalone",
      galleryImages: ["/images/catering-banner.jpg", "/images/sushi5.png", "/images/Menu-head.png"]
    }
  },
  {
    id: "pkg_sashimi_tuna",
    name: "Tuna",
    stationType: "tuna_add_on",
    isActive: true,
    pricePerPerson: 0,
    minPax: 0,
    maxPax: 0,
    description: "Tuna add-on, 1-40 kg at PHP 1,200/kg.",
    imageUrl: "/images/catering-banner.jpg",
    items: {
      pricingType: "range",
      pricingModel: "per_unit",
      pricePerKg: 1200,
      pricePerUnit: 1200,
      unit: "kg",
      minimum: 1,
      minKg: 1,
      step: 1,
      stepKg: 1,
      maximum: 40,
      maxKg: 40,
      minPrice: 1200,
      maxPrice: 48000,
      stationOrder: 3,
      optionOrder: 1,
      bookingRole: "add_on",
      galleryImages: ["/images/catering-banner.jpg", "/images/sushi5.png", "/images/Menu-head.png"]
    }
  },
  {
    id: "pkg_sashimi_salmon",
    name: "Salmon",
    stationType: "salmon_add_on",
    isActive: true,
    pricePerPerson: 0,
    minPax: 0,
    maxPax: 0,
    description: "Salmon add-on, 1-40 kg at PHP 2,400/kg.",
    imageUrl: "/images/catering-banner.jpg",
    items: {
      pricingType: "range",
      pricingModel: "per_unit",
      pricePerKg: 2400,
      pricePerUnit: 2400,
      unit: "kg",
      minimum: 1,
      minKg: 1,
      step: 1,
      stepKg: 1,
      maximum: 40,
      maxKg: 40,
      minPrice: 2400,
      maxPrice: 96000,
      stationOrder: 4,
      optionOrder: 1,
      bookingRole: "add_on",
      galleryImages: ["/images/catering-banner.jpg", "/images/sushi5.png", "/images/Menu-head.png"]
    }
  },
  {
    id: "pkg_tempura_live",
    name: "Live Tempura",
    stationType: "tempura_live",
    isActive: true,
    pricePerPerson: 0,
    minPax: 50,
    maxPax: 50,
    description: "Fixed 50-pax tempura package.",
    imageUrl: "/images/unli-dining.jpg",
    items: {
      pricingType: "flat",
      pricingModel: "fixed",
      flatPrice: 6000,
      fixedPrice: 6000,
      fixedPax: 50,
      unit: "pax",
      stationOrder: 5,
      optionOrder: 1,
      inventoryRequirements: [
        { materialName: "Shrimp", quantity: 5000, unit: "g" }
      ],
      inclusions: ["Live tempura cooking station"],
      galleryImages: ["/images/unli-dining.jpg", "/images/hero-banner.jpg", "/images/cateringf.jpg"]
    }
  }
];
