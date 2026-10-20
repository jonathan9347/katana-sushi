import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { INVENTORY_STANDARDS } from "../config/inventoryStandards";
import { assertDevelopmentDatabase } from "../lib/seedSafety";

export async function seedDemoData(prisma: PrismaClient) {
  await assertDevelopmentDatabase(prisma);

  type ProductSeed = {
    name: string;
    category: string;
    price: number;
    description?: string;
    is_available?: boolean;
    recipe: Array<{ material: string; quantity: number; unit: string }>;
  };

  type RawMaterialSeed = {
    name: string;
    unit: string;
    current_stock: bigint;
    reorder_level: bigint;
    cost_per_unit: number;
    cost_source_amount?: number;
    cost_source_quantity?: bigint;
    cost_source_unit?: string;
  };

  const rawMaterials: RawMaterialSeed[] = [
    { name: "Rice", unit: "g", current_stock: 25000n, reorder_level: 5000n, cost_per_unit: 0.085 },
    { name: "Salmon", unit: "g", current_stock: 8000n, reorder_level: 2000n, cost_per_unit: 0.95 },
    { name: "Tuna", unit: "g", current_stock: 7000n, reorder_level: 2000n, cost_per_unit: 0.82 },
    { name: "Nori", unit: "sheet", current_stock: 200n, reorder_level: 40n, cost_per_unit: 6 },
    { name: "Crabstick", unit: "piece", current_stock: 180n, reorder_level: 40n, cost_per_unit: 12 },
    { name: "Cucumber", unit: "g", current_stock: 6000n, reorder_level: 2000n, cost_per_unit: 0.09 },
    { name: "Mango", unit: "g", current_stock: 8000n, reorder_level: 2000n, cost_per_unit: 0.12 },
    { name: "Ebiko", unit: "g", current_stock: 4000n, reorder_level: 1000n, cost_per_unit: 0.72 },
    { name: "Tamago", unit: "piece", current_stock: 80n, reorder_level: 20n, cost_per_unit: 18 },
    { name: "Cream cheese", unit: "g", current_stock: 4000n, reorder_level: 1000n, cost_per_unit: 0.43 },
    { name: "Tempura flakes", unit: "g", current_stock: 6000n, reorder_level: 2000n, cost_per_unit: 0.18 },
    { name: "Unagi", unit: "g", current_stock: 3000n, reorder_level: 1000n, cost_per_unit: 1.1 },
    { name: "Shrimp", unit: "g", current_stock: 7000n, reorder_level: 2000n, cost_per_unit: 0.52 },
    {
      name: "Avocado",
      unit: "g",
      current_stock: 6000n,
      reorder_level: 1500n,
      cost_per_unit: 0.36666667,
      cost_source_amount: 55,
      cost_source_quantity: 150n,
      cost_source_unit: "g"
    },
    { name: "Spring onion", unit: "g", current_stock: 2000n, reorder_level: 500n, cost_per_unit: 0.16 },
    { name: "Sesame seeds", unit: "g", current_stock: 2000n, reorder_level: 500n, cost_per_unit: 0.28 },
    { name: "Spicy mayo", unit: "ml", current_stock: 5000n, reorder_level: 1000n, cost_per_unit: 0.24 },
    { name: "Teriyaki sauce", unit: "ml", current_stock: 5000n, reorder_level: 1000n, cost_per_unit: 0.22 },
    { name: "Sriracha", unit: "ml", current_stock: 4000n, reorder_level: 1000n, cost_per_unit: 0.26 },
    { name: "Bonito flakes", unit: "g", current_stock: 2000n, reorder_level: 500n, cost_per_unit: 0.85 },
    { name: "Lettuce", unit: "g", current_stock: 4000n, reorder_level: 1000n, cost_per_unit: 0.13 },
    { name: "Pineapple tidbits", unit: "g", current_stock: 4000n, reorder_level: 1000n, cost_per_unit: 0.14 },
    { name: "Kani tempura", unit: "piece", current_stock: 80n, reorder_level: 20n, cost_per_unit: 18 },
    { name: "Nachos", unit: "g", current_stock: 3000n, reorder_level: 1000n, cost_per_unit: 0.19 },
    { name: "Chili", unit: "g", current_stock: 2000n, reorder_level: 500n, cost_per_unit: 0.18 },
    { name: "Tuna sashimi block", unit: "g", current_stock: 6000n, reorder_level: 2000n, cost_per_unit: 0.9 },
    { name: "Salmon sashimi block", unit: "g", current_stock: 6000n, reorder_level: 2000n, cost_per_unit: 1.05 },
    { name: "Chicken", unit: "g", current_stock: 6000n, reorder_level: 2000n, cost_per_unit: 0.24 },
    { name: "Aonori", unit: "g", current_stock: 1000n, reorder_level: 250n, cost_per_unit: 0.68 },
    { name: "Bottled Water", unit: "bottle", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 },
    { name: "Softdrinks", unit: "bottle", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 },
    { name: "Iced Tea", unit: "bottle", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 },
    { name: "Japanese Soda Ramune", unit: "bottle", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 },
    { name: "Green Tea (Hot/Cold)", unit: "cup", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 },
    { name: "Sapporo Beer", unit: "bottle", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 },
    { name: "Asahi Beer", unit: "bottle", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 },
    { name: "Sake (Small)", unit: "bottle", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 },
    { name: "Sake (Large)", unit: "bottle", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 },
    { name: "Calamansi Juice", unit: "bottle", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 },
    { name: "Mango Shake", unit: "cup", current_stock: 0n, reorder_level: 0n, cost_per_unit: 0 }
  ];
  const beverageMaterialNames = new Set([
    "Bottled Water",
    "Softdrinks",
    "Iced Tea",
    "Japanese Soda Ramune",
    "Green Tea (Hot/Cold)",
    "Sapporo Beer",
    "Asahi Beer",
    "Sake (Small)",
    "Sake (Large)",
    "Calamansi Juice",
    "Mango Shake"
  ]);

  const classicBase = [
    { material: "Rice", quantity: 200, unit: "g" },
    { material: "Nori", quantity: 1, unit: "sheet" }
  ];

  const hosoBase = [
    { material: "Rice", quantity: 100, unit: "g" },
    { material: "Nori", quantity: 1, unit: "sheet" }
  ];

  const defaultRoll = (protein: string, secondary: string) => {
    const ingredient = (material: string, quantity: number, unit: string) => ({ material, quantity, unit });
    const proteinIngredient = protein === "Crabstick"
      ? ingredient(protein, 4, "piece")
      : protein === "Kani tempura"
        ? ingredient(protein, 1, "piece")
        : ingredient(protein, 30, "g");
    const secondaryIngredient = secondary === "Spicy mayo"
      ? ingredient(secondary, INVENTORY_STANDARDS.ownerConfirmedSpicyMayoMlPerServing, "ml")
      : secondary === "Crabstick"
        ? ingredient(secondary, 4, "piece")
        : ingredient(secondary, 20, "g");
    return [...classicBase, proteinIngredient, secondaryIngredient];
  };

  const bakedRoll = (isMedium: boolean) => [
    { material: "Rice", quantity: isMedium ? 300 : 200, unit: "g" },
    { material: "Nori", quantity: isMedium ? 2 : 1, unit: "sheet" },
    { material: "Crabstick", quantity: isMedium ? 3 : 2, unit: "piece" },
    { material: "Ebiko", quantity: isMedium ? 30 : 20, unit: "g" }
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
        { material: "Cucumber", quantity: 30, unit: "g" },
        { material: "Mango", quantity: 40, unit: "g" },
        { material: "Ebiko", quantity: 10, unit: "g" }
      ]
    },
    {
      name: "Mango Roll",
      category: "Classic Roll",
      price: 220,
      recipe: [...classicBase, { material: "Crabstick", quantity: 4, unit: "piece" }, { material: "Mango", quantity: 40, unit: "g" }]
    },
    {
      name: "Volcano Roll",
      category: "Classic Roll",
      price: 220,
      recipe: [
        ...classicBase,
        { material: "Crabstick", quantity: 3, unit: "piece" },
        { material: "Mango", quantity: 30, unit: "g" },
        { material: "Cucumber", quantity: 30, unit: "g" },
        { material: "Ebiko", quantity: 10, unit: "g" }
      ]
    },
    {
      name: "Tuna Mayo Roll",
      category: "Classic Roll",
      price: 220,
      recipe: [
        ...classicBase,
        { material: "Tuna", quantity: 30, unit: "g" },
        { material: "Spicy mayo", quantity: 10, unit: "ml" },
        { material: "Pineapple tidbits", quantity: 20, unit: "g" }
      ]
    },
    {
      name: "Crunchy Roll",
      category: "Classic Roll",
      price: 240,
      recipe: [
        ...classicBase,
        { material: "Crabstick", quantity: 4, unit: "piece" },
        { material: "Cucumber", quantity: 30, unit: "g" },
        { material: "Mango", quantity: 20, unit: "g" },
        { material: "Tempura flakes", quantity: 20, unit: "g" }
      ]
    },
    {
      name: "Tori Teriyaki Roll",
      category: "Classic Roll",
      price: 240,
      recipe: [
        ...classicBase,
        { material: "Chicken", quantity: 30, unit: "g" },
        { material: "Cream cheese", quantity: 20, unit: "g" },
        { material: "Teriyaki sauce", quantity: 10, unit: "ml" }
      ]
    },
    {
      name: "Spicy Tuna Roll",
      category: "Classic Roll",
      price: 240,
      recipe: [
        ...classicBase,
        { material: "Tuna", quantity: 30, unit: "g" },
        { material: "Spicy mayo", quantity: 10, unit: "ml" },
        // Estimated at 1 g per serving; confirm with the owner or kitchen.
        { material: "Aonori", quantity: 1, unit: "g" }
      ]
    },
    {
      name: "Mango Hoso",
      category: "Fried Roll",
      price: 250,
      recipe: [...classicBase, { material: "Crabstick", quantity: 3, unit: "piece" }, { material: "Mango", quantity: 20, unit: "g" }]
    },
    { name: "Bomb Hoso", category: "Fried Roll", price: 260, recipe: defaultRoll("Tuna", "Spicy mayo") },
    { name: "Futo California", category: "Fried Roll", price: 200, recipe: defaultRoll("Crabstick", "Mango") },
    { name: "Futo California", category: "Futo Maki", price: 190, recipe: defaultRoll("Crabstick", "Cucumber") },
    { name: "Futo Ebi", category: "Futo Maki", price: 210, recipe: defaultRoll("Shrimp", "Cucumber") },
    { name: "Futo Salmon", category: "Futo Maki", price: 240, recipe: defaultRoll("Salmon", "Cream cheese") },
    { name: "Futo Crab Mango", category: "Futo Maki", price: 210, recipe: defaultRoll("Crabstick", "Mango") },
    { name: "Futo Dynamite", category: "Futo Maki", price: 210, recipe: defaultRoll("Kani tempura", "Spicy mayo") },
    { name: "Tuna Hoso", category: "Hoso Maki", price: 160, recipe: [...hosoBase, { material: "Tuna", quantity: 30, unit: "g" }] },
    { name: "Salmon Hoso", category: "Hoso Maki", price: 180, recipe: [...hosoBase, { material: "Salmon", quantity: 30, unit: "g" }] },
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
      recipe: [{ material: "Rice", quantity: 40, unit: "g" }, { material: "Salmon", quantity: 40, unit: "g" }]
    },
    {
      name: "Tuna Nigiri (2pcs)",
      category: "Nigiri",
      price: 150,
      recipe: [{ material: "Rice", quantity: 40, unit: "g" }, { material: "Tuna", quantity: 40, unit: "g" }]
    },
    {
      name: "Tamago Sushi (3pcs)",
      category: "Nigiri",
      price: 80,
      recipe: [{ material: "Rice", quantity: 60, unit: "g" }, { material: "Tamago", quantity: 3, unit: "piece" }]
    },
    {
      name: "Kani Sushi (4pcs)",
      category: "Nigiri",
      price: 100,
      recipe: [{ material: "Rice", quantity: 80, unit: "g" }, { material: "Crabstick", quantity: 4, unit: "piece" }]
    },
    {
      name: "Unagi Nigiri (3pcs)",
      category: "Nigiri",
      price: 230,
      recipe: [{ material: "Rice", quantity: 60, unit: "g" }, { material: "Unagi", quantity: 45, unit: "g" }]
    },
    { name: "Salmon Sashimi 100g", category: "Sashimi", price: 260, recipe: [{ material: "Salmon sashimi block", quantity: 100, unit: "g" }] },
    { name: "Salmon Sashimi 500g", category: "Sashimi", price: 1200, recipe: [{ material: "Salmon sashimi block", quantity: 500, unit: "g" }] },
    { name: "Salmon Sashimi 1000g", category: "Sashimi", price: 2300, recipe: [{ material: "Salmon sashimi block", quantity: 1000, unit: "g" }] },
    { name: "Tuna Sashimi 100g", category: "Sashimi", price: 160, recipe: [{ material: "Tuna sashimi block", quantity: 100, unit: "g" }] },
    { name: "Tuna Sashimi 500g", category: "Sashimi", price: 700, recipe: [{ material: "Tuna sashimi block", quantity: 500, unit: "g" }] },
    { name: "Tuna Sashimi 1000g", category: "Sashimi", price: 1300, recipe: [{ material: "Tuna sashimi block", quantity: 1000, unit: "g" }] },
    { name: "Baked Sushi California Small", category: "Baked Sushi", price: 320, recipe: bakedRoll(false) },
    { name: "Baked Sushi California Medium", category: "Baked Sushi", price: 600, recipe: bakedRoll(true) },
    {
      name: "Large Classic Platter (71pcs)",
      category: "Platter",
      price: 1400,
      is_available: false,
      // Keep unavailable until platter composition and component deduction are implemented.
      recipe: [...classicBase, { material: "Salmon", quantity: 30, unit: "g" }, { material: "Crabstick", quantity: 0, unit: "piece" }]
    },
    {
      name: "Medium Classic Platter (40pcs)",
      category: "Platter",
      price: 750,
      is_available: false,
      // Keep unavailable until platter composition and component deduction are implemented.
      recipe: [...classicBase, { material: "Tuna", quantity: 30, unit: "g" }, { material: "Crabstick", quantity: 0, unit: "piece" }]
    },
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
  await prisma.diningOrder.deleteMany();
  await prisma.diningTableSession.deleteMany();
  await prisma.tableCombinationMember.deleteMany();
  await prisma.tableCombination.deleteMany();
  await prisma.table.updateMany({ data: { linked_to_table_id: null } });
  await prisma.table.deleteMany();
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.sellingProduct.deleteMany();
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

  await prisma.rawMaterial.createMany({
    data: rawMaterials.map((material) => ({
      ...material,
      category: beverageMaterialNames.has(material.name) ? "Beverage" : "Raw Material"
    }))
  });

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
        is_available: product.is_available ?? true,
        description: product.description ?? `${product.category} menu item`,
        image_url: chosenImage
      }
    });

    const recipe = await prisma.recipe.create({
      data: {
        selling_product_id: sellingProduct.id,
        total_yield_quantity: 1,
        yield_unit: "serving",
        status: product.category === "Platter" ? "superseded by composition" : "recipe not confirmed"
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
            quantity_per_yield: BigInt(ingredient.quantity),
            unit: ingredient.unit,
            recipe_id: recipe.id,
            raw_material_id: rawMaterialId
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
    data: Array.from({ length: 16 }, (_, index) => ({
      table_number: index + 1,
      capacity: index < 8 ? 4 : 2,
      status: "available"
    })),
    skipDuplicates: true
  });
}
