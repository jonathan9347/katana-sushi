import express from "express";
import jwt from "jsonwebtoken";
import { Request, Response } from "express";

const router = express.Router();
const jwtSecret = process.env.JWT_SECRET ?? "katana-super-secret-key-change-in-production";

type TokenPayload = {
  sub: string;
  email: string;
  role: string;
};

function getUserFromRequest(req: Request) {
  const bearerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : null;
  const token = req.cookies?.token ?? bearerToken;

  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, jwtSecret) as TokenPayload;
  } catch {
    return null;
  }
}

function requireRole(req: Request, res: Response, roles: string[]) {
  const user = getUserFromRequest(req);
  const role = user?.role?.toLowerCase();

  if (!user || !role) {
    res.status(401).json({ message: "Please sign in again." });
    return null;
  }

  if (!roles.includes(role)) {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }

  return user;
}

router.get("/staff/dashboard/stats", (req, res) => {
  const user = requireRole(req, res, ["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef"]);
  if (!user) return;

  res.json({
    role: user.role,
    widgets: {
      totalSales: user.role === "admin" || user.role === "cashier" ? 15240 : undefined,
      pendingApprovals: user.role === "admin" ? 4 : undefined,
      lowStockItems: user.role === "admin" || user.role === "inventory_manager" || user.role === "chef" ? 3 : undefined,
      upcomingEvents: user.role === "admin" || user.role === "event_coordinator" ? 2 : undefined,
      todayGuests: user.role === "receptionist" ? 24 : undefined
    }
  });
});

router.get("/staff/dashboard/admin", (req, res) => {
  const user = requireRole(req, res, ["admin"]);
  if (!user) return;

  res.json({
    role: "admin",
    widgets: {
      totalSales: 15240,
      pendingApprovals: 4,
      lowStockItems: 3,
      upcomingEvents: 2,
      recentTransactions: [
        { id: "KTN-001", amount: 1450 },
        { id: "KTN-002", amount: 890 },
        { id: "KTN-003", amount: 2396 }
      ]
    }
  });
});

router.get("/staff/dashboard/cashier", (req, res) => {
  const user = requireRole(req, res, ["admin", "cashier"]);
  if (!user) return;

  res.json({
    role: "cashier",
    widgets: {
      totalSales: 8450,
      ordersToday: 12,
      averageOrder: 704,
      recentTransactions: [
        { id: "KTN-001", amount: 1450, customer: "John" },
        { id: "KTN-002", amount: 890, customer: "Maria" },
        { id: "KTN-003", amount: 2396, customer: "Pedro" }
      ]
    }
  });
});

router.get("/staff/dashboard/inventory", (req, res) => {
  const user = requireRole(req, res, ["admin", "inventory_manager"]);
  if (!user) return;

  res.json({
    role: "inventory_manager",
    widgets: {
      totalMaterials: 26,
      lowStockItems: 3,
      criticalItems: 1,
      yieldEstimate: 45000,
      inventorySummary: [
        { item: "Rice", amount: "50kg", status: "80%" },
        { item: "Salmon", amount: "12kg", status: "60%" },
        { item: "Tuna", amount: "8kg", status: "40%" },
        { item: "Nori", amount: "500 sheets", status: "Available" }
      ]
    }
  });
});

router.get("/staff/dashboard/reception", (req, res) => {
  const user = requireRole(req, res, ["admin", "receptionist"]);
  if (!user) return;

  res.json({
    role: "receptionist",
    widgets: {
      todayGuests: 24,
      pendingApprovals: 2,
      totalTables: 10,
      walkIns: 3,
      todaysReservations: [
        { time: "7:00 PM", guest: "John", count: 4 },
        { time: "7:30 PM", guest: "Maria", count: 2 },
        { time: "8:00 PM", guest: "Pedro", count: 6 }
      ]
    }
  });
});

router.get("/staff/dashboard/events", (req, res) => {
  const user = requireRole(req, res, ["admin", "event_coordinator"]);
  if (!user) return;

  res.json({
    role: "event_coordinator",
    widgets: {
      upcomingEvents: 3,
      activeEvents: 1,
      lockedItems: 8,
      pendingInquiries: 2,
      eventSummary: [
        { name: "Wedding", date: "June 25", headcount: 100 },
        { name: "Birthday", date: "June 20", headcount: 50 },
        { name: "Corporate", date: "June 30", headcount: 80 }
      ]
    }
  });
});

router.get("/staff/dashboard/chef", (req, res) => {
  const user = requireRole(req, res, ["admin", "chef"]);
  if (!user) return;

  res.json({
    role: "chef",
    widgets: {
      todaysOrders: 15,
      prepRequired: "8 items",
      criticalStock: 1,
      prepList: [
        { item: "California Maki", quantity: 12 },
        { item: "Mango Roll", quantity: 8 },
        { item: "Salmon Nigiri", quantity: 20 },
        { item: "Volcano Roll", quantity: 6 }
      ],
      inventoryLevels: [
        { item: "Rice", status: "Available" },
        { item: "Salmon", status: "Low" },
        { item: "Tuna", status: "Available" },
        { item: "Nori", status: "Available" }
      ]
    }
  });
});

export default router;
