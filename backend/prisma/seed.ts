import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ProductSeed = {
  name: string;
  category: string;
  price: number;
  description?: string;
  recipe: Array<{ material: string; quantity: number; unit: string }>;
};

const rawMaterials = [
  { name: "Rice", unit: "kg", current_stock: 25, reorder_level: 5, cost_per_unit: 85 },
  { name: "Salmon", unit: "kg", current_stock: 8, reorder_level: 2, cost_per_unit: 950 },
  { name: "Tuna", unit: "kg", current_stock: 7, reorder_level: 2, cost_per_unit: 820 },
  { name: "Nori", unit: "sheet", current_stock: 200, reorder_level: 40, cost_per_unit: 6 },
  { name: "Crabstick", unit: "piece", current_stock: 180, reorder_level: 40, cost_per_unit: 12 },
  { name: "Cucumber", unit: "kg", current_stock: 6, reorder_level: 2, cost_per_unit: 90 },
  { name: "Mango", unit: "kg", current_stock: 8, reorder_level: 2, cost_per_unit: 120 },
  { name: "Ebiko", unit: "kg", current_stock: 4, reorder_level: 1, cost_per_unit: 720 },
  { name: "Tamago", unit: "piece", current_stock: 80, reorder_level: 20, cost_per_unit: 18 },
  { name: "Cream cheese", unit: "kg", current_stock: 4, reorder_level: 1, cost_per_unit: 430 },
  { name: "Tempura flakes", unit: "kg", current_stock: 6, reorder_level: 2, cost_per_unit: 180 },
  { name: "Unagi", unit: "kg", current_stock: 3, reorder_level: 1, cost_per_unit: 1100 },
  { name: "Shrimp", unit: "kg", current_stock: 7, reorder_level: 2, cost_per_unit: 520 },
  { name: "Avocado", unit: "piece", current_stock: 40, reorder_level: 10, cost_per_unit: 55 },
  { name: "Spring onion", unit: "kg", current_stock: 2, reorder_level: 0.5, cost_per_unit: 160 },
  { name: "Sesame seeds", unit: "kg", current_stock: 2, reorder_level: 0.5, cost_per_unit: 280 },
  { name: "Spicy mayo", unit: "L", current_stock: 5, reorder_level: 1, cost_per_unit: 240 },
  { name: "Teriyaki sauce", unit: "L", current_stock: 5, reorder_level: 1, cost_per_unit: 220 },
  { name: "Sriracha", unit: "L", current_stock: 4, reorder_level: 1, cost_per_unit: 260 },
  { name: "Bonito flakes", unit: "kg", current_stock: 2, reorder_level: 0.5, cost_per_unit: 850 },
  { name: "Lettuce", unit: "kg", current_stock: 4, reorder_level: 1, cost_per_unit: 130 },
  { name: "Pineapple tidbits", unit: "kg", current_stock: 4, reorder_level: 1, cost_per_unit: 140 },
  { name: "Kani tempura", unit: "piece", current_stock: 80, reorder_level: 20, cost_per_unit: 18 },
  { name: "Nachos", unit: "kg", current_stock: 3, reorder_level: 1, cost_per_unit: 190 },
  { name: "Chili", unit: "kg", current_stock: 2, reorder_level: 0.5, cost_per_unit: 180 },
  { name: "Tuna sashimi block", unit: "kg", current_stock: 6, reorder_level: 2, cost_per_unit: 900 },
  { name: "Salmon sashimi block", unit: "kg", current_stock: 6, reorder_level: 2, cost_per_unit: 1050 },
  { name: "Chicken", unit: "kg", current_stock: 6, reorder_level: 2, cost_per_unit: 240 },
  { name: "Aonori", unit: "kg", current_stock: 1, reorder_level: 0.25, cost_per_unit: 680 }
];

const classicBase = [
  { material: "Rice", quantity: 0.2, unit: "kg" },
  { material: "Nori", quantity: 1, unit: "sheet" }
];

const hosoBase = [
  { material: "Rice", quantity: 0.1, unit: "kg" },
  { material: "Nori", quantity: 1, unit: "sheet" }
];

const defaultRoll = (protein: string, secondary: string) => [
  ...classicBase,
  { material: protein, quantity: 0.03, unit: "kg" },
  { material: secondary, quantity: 0.02, unit: "kg" }
];

const products: ProductSeed[] = [
  {
    name: "California Maki",
    category: "Classic Roll",
    price: 290,
    description: "Classic maki with crabstick, cucumber, mango, and ebiko.",
    recipe: [
      ...classicBase,
      { material: "Crabstick", quantity: 4, unit: "piece" },
      { material: "Cucumber", quantity: 0.03, unit: "kg" },
      { material: "Mango", quantity: 0.04, unit: "kg" },
      { material: "Ebiko", quantity: 0.01, unit: "kg" }
    ]
  },
  {
    name: "Mango Roll",
    category: "Classic Roll",
    price: 220,
    recipe: [...classicBase, { material: "Crabstick", quantity: 4, unit: "piece" }, { material: "Mango", quantity: 0.04, unit: "kg" }]
  },
  {
    name: "Volcano Roll",
    category: "Classic Roll",
    price: 220,
    recipe: [
      ...classicBase,
      { material: "Crabstick", quantity: 3, unit: "piece" },
      { material: "Mango", quantity: 0.03, unit: "kg" },
      { material: "Cucumber", quantity: 0.03, unit: "kg" },
      { material: "Ebiko", quantity: 0.01, unit: "kg" }
    ]
  },
  {
    name: "Tuna Mayo Roll",
    category: "Classic Roll",
    price: 220,
    recipe: [
      ...classicBase,
      { material: "Tuna", quantity: 0.03, unit: "kg" },
      { material: "Spicy mayo", quantity: 0.01, unit: "L" },
      { material: "Pineapple tidbits", quantity: 0.02, unit: "kg" }
    ]
  },
  {
    name: "Crunchy Roll",
    category: "Classic Roll",
    price: 240,
    recipe: [
      ...classicBase,
      { material: "Crabstick", quantity: 4, unit: "piece" },
      { material: "Cucumber", quantity: 0.03, unit: "kg" },
      { material: "Mango", quantity: 0.02, unit: "kg" },
      { material: "Tempura flakes", quantity: 0.02, unit: "kg" }
    ]
  },
  {
    name: "Tori Teriyaki Roll",
    category: "Classic Roll",
    price: 240,
    recipe: [
      ...classicBase,
      { material: "Chicken", quantity: 0.03, unit: "kg" },
      { material: "Cream cheese", quantity: 0.02, unit: "kg" },
      { material: "Teriyaki sauce", quantity: 0.01, unit: "L" }
    ]
  },
  {
    name: "Spicy Tuna Roll",
    category: "Classic Roll",
    price: 240,
    recipe: [
      ...classicBase,
      { material: "Tuna", quantity: 0.03, unit: "kg" },
      { material: "Spicy mayo", quantity: 0.01, unit: "L" },
      { material: "Aonori", quantity: 0.005, unit: "kg" }
    ]
  },
  { name: "Mango Hoso", category: "Fried Roll", price: 250, recipe: defaultRoll("Crabstick", "Mango") },
  { name: "Bomb Hoso", category: "Fried Roll", price: 260, recipe: defaultRoll("Tuna", "Spicy mayo") },
  { name: "Futo California", category: "Fried Roll", price: 200, recipe: defaultRoll("Crabstick", "Mango") },
  { name: "Futo California", category: "Futo Maki", price: 190, recipe: defaultRoll("Crabstick", "Cucumber") },
  { name: "Futo Ebi", category: "Futo Maki", price: 210, recipe: defaultRoll("Shrimp", "Cucumber") },
  { name: "Futo Salmon", category: "Futo Maki", price: 240, recipe: defaultRoll("Salmon", "Cream cheese") },
  { name: "Futo Crab Mango", category: "Futo Maki", price: 210, recipe: defaultRoll("Crabstick", "Mango") },
  { name: "Futo Dynamite", category: "Futo Maki", price: 210, recipe: defaultRoll("Kani tempura", "Spicy mayo") },
  { name: "Tuna Hoso", category: "Hoso Maki", price: 160, recipe: [...hosoBase, { material: "Tuna", quantity: 0.03, unit: "kg" }] },
  { name: "Salmon Hoso", category: "Hoso Maki", price: 180, recipe: [...hosoBase, { material: "Salmon", quantity: 0.03, unit: "kg" }] },
  { name: "Kani Hoso", category: "Hoso Maki", price: 150, recipe: [...hosoBase, { material: "Crabstick", quantity: 3, unit: "piece" }] },
  { name: "Tamago Hoso", category: "Hoso Maki", price: 140, recipe: [...hosoBase, { material: "Tamago", quantity: 3, unit: "piece" }] },
  { name: "Unagi Roll", category: "Special Roll", price: 290, recipe: defaultRoll("Unagi", "Cucumber") },
  { name: "Rainbow Roll", category: "Special Roll", price: 290, recipe: defaultRoll("Salmon", "Tuna") },
  { name: "American Dream Roll", category: "Special Roll", price: 290, recipe: defaultRoll("Shrimp", "Avocado") },
  { name: "Salmon Cheese Maki", category: "Special Roll", price: 290, recipe: defaultRoll("Salmon", "Cream cheese") },
  { name: "Ebi Imperial", category: "Special Roll", price: 260, recipe: defaultRoll("Shrimp", "Cream cheese") },
  { name: "Crunchy Crab", category: "Special Roll", price: 220, recipe: defaultRoll("Crabstick", "Tempura flakes") },
  { name: "Spicy Tiger Roll", category: "Special Roll", price: 280, recipe: defaultRoll("Shrimp", "Spicy mayo") },
  { name: "Spicy Crab", category: "Special Roll", price: 220, recipe: defaultRoll("Crabstick", "Spicy mayo") },
  { name: "Nacho Maki", category: "Special Roll", price: 240, recipe: defaultRoll("Crabstick", "Nachos") },
  { name: "Mango Chili Aburi", category: "Special Roll", price: 300, recipe: defaultRoll("Salmon", "Chili") },
  {
    name: "Salmon Nigiri (2pcs)",
    category: "Nigiri",
    price: 170,
    recipe: [{ material: "Rice", quantity: 0.04, unit: "kg" }, { material: "Salmon", quantity: 0.04, unit: "kg" }]
  },
  {
    name: "Tuna Nigiri (2pcs)",
    category: "Nigiri",
    price: 150,
    recipe: [{ material: "Rice", quantity: 0.04, unit: "kg" }, { material: "Tuna", quantity: 0.04, unit: "kg" }]
  },
  {
    name: "Tamago Sushi (3pcs)",
    category: "Nigiri",
    price: 80,
    recipe: [{ material: "Rice", quantity: 0.06, unit: "kg" }, { material: "Tamago", quantity: 3, unit: "piece" }]
  },
  {
    name: "Kani Sushi (4pcs)",
    category: "Nigiri",
    price: 100,
    recipe: [{ material: "Rice", quantity: 0.08, unit: "kg" }, { material: "Crabstick", quantity: 4, unit: "piece" }]
  },
  {
    name: "Unagi Nigiri (3pcs)",
    category: "Nigiri",
    price: 230,
    recipe: [{ material: "Rice", quantity: 0.06, unit: "kg" }, { material: "Unagi", quantity: 0.045, unit: "kg" }]
  },
  { name: "Salmon Sashimi 100g", category: "Sashimi", price: 260, recipe: [{ material: "Salmon sashimi block", quantity: 0.1, unit: "kg" }] },
  { name: "Salmon Sashimi 500g", category: "Sashimi", price: 1200, recipe: [{ material: "Salmon sashimi block", quantity: 0.5, unit: "kg" }] },
  { name: "Salmon Sashimi 1000g", category: "Sashimi", price: 2300, recipe: [{ material: "Salmon sashimi block", quantity: 1, unit: "kg" }] },
  { name: "Tuna Sashimi 100g", category: "Sashimi", price: 160, recipe: [{ material: "Tuna sashimi block", quantity: 0.1, unit: "kg" }] },
  { name: "Tuna Sashimi 500g", category: "Sashimi", price: 700, recipe: [{ material: "Tuna sashimi block", quantity: 0.5, unit: "kg" }] },
  { name: "Tuna Sashimi 1000g", category: "Sashimi", price: 1300, recipe: [{ material: "Tuna sashimi block", quantity: 1, unit: "kg" }] },
  { name: "Baked Sushi California Small", category: "Baked Sushi", price: 320, recipe: defaultRoll("Crabstick", "Ebiko") },
  { name: "Baked Sushi California Medium", category: "Baked Sushi", price: 600, recipe: defaultRoll("Crabstick", "Ebiko") },
  { name: "Large Classic Platter (71pcs)", category: "Platter", price: 1400, recipe: defaultRoll("Salmon", "Crabstick") },
  { name: "Medium Classic Platter (40pcs)", category: "Platter", price: 750, recipe: defaultRoll("Tuna", "Crabstick") },
  { name: "Kani Spring Roll (3pcs)", category: "Spring Roll", price: 150, recipe: defaultRoll("Crabstick", "Lettuce") },
  { name: "Tuna Gyozai (4pcs)", category: "Gyozai", price: 160, recipe: defaultRoll("Tuna", "Spring onion") },
  { name: "Bottled Water", category: "Beverage", price: 20, recipe: [] },
  { name: "Softdrinks (Coke/Sprite/Royal)", category: "Beverage", price: 35, recipe: [] },
  { name: "Iced Tea", category: "Beverage", price: 45, recipe: [] },
  { name: "Japanese Soda Ramune", category: "Beverage", price: 80, recipe: [] },
  { name: "Green Tea (Hot/Cold)", category: "Beverage", price: 50, recipe: [] },
  { name: "Sapporo Beer", category: "Beverage", price: 120, recipe: [] },
  { name: "Asahi Beer", category: "Beverage", price: 120, recipe: [] },
  { name: "Sake (Small)", category: "Beverage", price: 150, recipe: [] },
  { name: "Sake (Large)", category: "Beverage", price: 280, recipe: [] },
  { name: "Calamansi Juice", category: "Beverage", price: 40, recipe: [] },
  { name: "Mango Shake", category: "Beverage", price: 65, recipe: [] }
];

const unlimitedIncludedProductNames = new Set([
  "Tuna Gyozai (4pcs)",
  "Tuna Sashimi 100g",
  "California Maki",
  "Mango Roll",
  "Volcano Roll",
  "Tuna Mayo Roll",
  "Crunchy Roll",
  "Tori Teriyaki Roll",
  "Spicy Tuna Roll",
  "Futo California",
  "Futo Ebi",
  "Futo Crab Mango",
  "Futo Dynamite",
  "Ebi Imperial",
  "Crunchy Crab",
  "Spicy Crab",
  "Nacho Maki",
  "Tuna Nigiri (2pcs)",
  "Tamago Sushi (3pcs)",
  "Kani Sushi (4pcs)",
  "Iced Tea"
]);

async function main() {
  await prisma.auditLog.deleteMany();
  await prisma.cateringInquiry.deleteMany();
  await prisma.cateringPackage.deleteMany();
  await prisma.cateringIngredientLock.deleteMany();
  await prisma.inventorySnapshot.deleteMany();
  await prisma.inventoryTransaction.deleteMany();
  await prisma.materialBatch.deleteMany();
  await prisma.posItem.deleteMany();
  await prisma.posTransaction.deleteMany();
  await prisma.unlimitedLeftoverItem.deleteMany();
  await prisma.unlimitedOrderItem.deleteMany();
  await prisma.unlimitedRound.deleteMany();
  await prisma.unlimitedIncludedProduct.deleteMany();
  await prisma.unlimitedSetting.deleteMany();
  await prisma.unlimitedSession.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.table.deleteMany();
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.sellingProduct.deleteMany();
  await prisma.conversionRule.deleteMany();
  await prisma.rawMaterial.deleteMany();
  await prisma.user.deleteMany();

  const users = [
    { email: "admin@katana.com", password: "Admin123!", name: "System Administrator", role: "admin" },
    { email: "inventory@katana.com", password: "Inventory123!", name: "Inventory Manager", role: "inventory_manager" },
    { email: "cashier@katana.com", password: "Cashier123!", name: "Cashier", role: "cashier" },
    { email: "reception@katana.com", password: "Reception123!", name: "Receptionist", role: "receptionist" },
    { email: "events@katana.com", password: "Events123!", name: "Event Coordinator", role: "event_coordinator" },
    { email: "chef@katana.com", password: "Chef123!", name: "Chef", role: "chef" }
  ];

  await Promise.all(
    users.map(async (user) => {
      await prisma.user.create({
        data: {
          email: user.email,
          password_hash: await bcrypt.hash(user.password, 10),
          role: user.role,
          name: user.name
        }
      });
    })
  );

  await prisma.rawMaterial.createMany({ data: rawMaterials });

  const materials = await prisma.rawMaterial.findMany();
  const materialByName = new Map(materials.map((material) => [material.name, material.id]));

  const imageCandidates = [
    "/images/sushi2.png",
    "/images/sushi4.png",
    "/images/sushi5.png",
    "/images/Menu-head.png",
    "/images/hero-banner.jpg",
    "/images/katana-logo.jpg",
    "/images/unli-dining.jpg"
  ];

  for (const [index, product] of products.entries()) {
    const chosenImage = imageCandidates[index % imageCandidates.length];

    const sellingProduct = await prisma.sellingProduct.create({
      data: {
        name: product.name,
        category: product.category,
        price: product.price,
        description: product.description ?? `${product.category} menu item`,
        image_url: chosenImage
      }
    });

    const recipe = await prisma.recipe.create({
      data: {
        selling_product_id: sellingProduct.id,
        total_yield_quantity: 1,
        yield_unit: "serving"
      }
    });

    if (product.recipe.length > 0) {
      await prisma.recipeIngredient.createMany({
        data: product.recipe.map((ingredient) => {
          const rawMaterialId = materialByName.get(ingredient.material);

          if (!rawMaterialId) {
            throw new Error(`Missing raw material for recipe: ${ingredient.material}`);
          }

          return {
            recipe_id: recipe.id,
            raw_material_id: rawMaterialId,
            quantity_per_yield: ingredient.quantity,
            unit: ingredient.unit
          };
        })
      });
    }
  }

  const sellingProducts = await prisma.sellingProduct.findMany();

  await prisma.unlimitedSetting.create({
    data: {
      price_per_person: 599,
      time_limit_minutes: 90,
      leftover_charge_percent: 100
    }
  });

  await prisma.unlimitedIncludedProduct.createMany({
    data: sellingProducts.map((product) => ({
      selling_product_id: product.id,
      is_included: unlimitedIncludedProductNames.has(product.name)
    }))
  });

  await prisma.conversionRule.createMany({
    data: [
      { name: "Raw rice to cooked rice", from_quantity: 1, from_unit: "kg raw rice", to_quantity: 2.5, to_unit: "kg cooked rice" },
      { name: "Salmon usable yield", from_quantity: 1, from_unit: "kg salmon", to_quantity: 0.9, to_unit: "kg usable salmon" },
      { name: "Tuna usable yield", from_quantity: 1, from_unit: "kg tuna", to_quantity: 0.85, to_unit: "kg usable tuna" }
    ]
  });

  await prisma.cateringPackage.createMany({
    data: [
      {
        id: "pkg_classic",
        name: "Classic Station",
        description: "California Maki, Mango Roll, Volcano Roll, Iced Tea",
        pricePerPerson: 350,
        minPax: 10,
        maxPax: 100,
        imageUrl: "/images/catering/classic-station.jpg",
        items: ["California Maki", "Mango Roll", "Volcano Roll", "Iced Tea"]
      },
      {
        id: "pkg_premium",
        name: "Premium Station",
        description: "Tori Teriyaki Roll, Salmon Cheese Maki, Futomaki, Iced Tea",
        pricePerPerson: 550,
        minPax: 10,
        maxPax: 100,
        imageUrl: "/images/catering/premium-station.jpg",
        items: ["Tori Teriyaki Roll", "Salmon Cheese Maki", "Futomaki", "Iced Tea"]
      },
      {
        id: "pkg_nigiri",
        name: "Nigiri Station",
        description: "Tamago Sushi, Salmon Nigiri, Kani Sushi, Iced Tea",
        pricePerPerson: 300,
        minPax: 10,
        maxPax: 100,
        imageUrl: "/images/catering/nigiri-station.jpg",
        items: ["Tamago Sushi", "Salmon Nigiri", "Kani Sushi", "Iced Tea"]
      },
      {
        id: "pkg_mix",
        name: "Mix Station",
        description: "California Maki, Mango Roll, Salmon Nigiri, Tamago Sushi, Iced Tea",
        pricePerPerson: 450,
        minPax: 10,
        maxPax: 100,
        imageUrl: "/images/catering/mix-station.jpg",
        items: ["California Maki", "Mango Roll", "Salmon Nigiri", "Tamago Sushi", "Iced Tea"]
      },
      {
        id: "pkg_sashimi",
        name: "Sashimi Bar",
        description: "Salmon Sashimi, Tuna Sashimi, Assorted Nigiri, Iced Tea",
        pricePerPerson: 650,
        minPax: 20,
        maxPax: 100,
        imageUrl: "/images/catering/sashimi-bar.jpg",
        items: ["Salmon Sashimi", "Tuna Sashimi", "Assorted Nigiri", "Iced Tea"]
      }
    ]
  });

  await prisma.table.createMany({
    data: [2, 4, 4, 2, 4, 6, 2, 4, 8, 4].map((capacity, index) => ({
      table_number: index + 1,
      capacity,
      status: "AVAILABLE"
    }))
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
