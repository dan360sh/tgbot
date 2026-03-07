import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "../../db";
import { config } from "../../config";
import crypto from "crypto";

const router = Router();

// Packages: amount in TON → tokens
const PACKAGES: Record<string, { amountTon: number; tokens: number }> = {
  "1": { amountTon: 1, tokens: 1000 },
  "3": { amountTon: 3, tokens: 3500 },
  "7": { amountTon: 7, tokens: 9000 },
};

// POST /api/payments/create — create pending payment, return orderId + wallet + amount
router.post("/create", authMiddleware, async (req, res) => {
  const user = (req as any).user;
  const { packageId } = req.body;

  const pkg = PACKAGES[packageId];
  if (!pkg) return res.status(400).json({ error: "Invalid package" });

  if (!config.tonWallet) return res.status(500).json({ error: "TON wallet not configured" });

  const orderId = crypto.randomBytes(8).toString("hex");

  await prisma.tonPayment.create({
    data: {
      userId: user.id,
      orderId,
      amountTon: pkg.amountTon,
      tokens: pkg.tokens,
      status: "pending",
    },
  });

  res.json({
    orderId,
    wallet: config.tonWallet,
    amountTon: pkg.amountTon,
    tokens: pkg.tokens,
    // comment to include in TON transaction
    comment: orderId,
  });
});

// GET /api/payments/status/:orderId — poll payment status
router.get("/status/:orderId", authMiddleware, async (req, res) => {
  const user = (req as any).user;
  const payment = await prisma.tonPayment.findUnique({
    where: { orderId: req.params.orderId as string },
  });

  if (!payment || payment.userId !== user.id) {
    return res.status(404).json({ error: "Not found" });
  }

  res.json({ status: payment.status, tokens: payment.tokens });
});

export default router;
