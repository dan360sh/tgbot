import { Request, Response, NextFunction } from "express";
import { prisma } from "../../db";

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { token } });
  if (!user) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  (req as any).user = user;
  next();
}
