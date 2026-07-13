import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

type TokenPayload = {
  sub: string;
  email: string;
  role: string;
};

const jwtSecret = process.env.JWT_SECRET ?? "katana-super-secret-key-change-in-production";

function getUserFromRequest(req: Request): TokenPayload | null {
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

export const roleGuard = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getUserFromRequest(req);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized - Please log in" });
    }

    const normalizedRole = user.role?.toLowerCase();

    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(403).json({
        error: "Forbidden - You do not have permission to access this resource"
      });
    }

    (req as any).user = user;
    next();
  };
};

export const ROLES = {
  ADMIN: ["admin"],
  INVENTORY: ["admin", "inventory_manager"],
  CASHIER: ["admin", "cashier"],
  RECEPTION: ["admin", "receptionist"],
  EVENT: ["admin", "event_coordinator"],
  CHEF_READ: ["admin", "inventory_manager", "chef"],
  ANY_STAFF: ["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef"]
};
