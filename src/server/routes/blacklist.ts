import { Router } from "express";
import { prisma } from "../../db";
import { authMiddleware } from "../middleware/auth";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req, res) => {
  const user = (req as any).user;
  const list = await prisma.blacklistEntry.findMany({ where: { userId: user.id } });
  res.json(list.map((e) => ({ id: e.id, telegramContactId: e.telegramContactId.toString() })));
});

router.post("/", async (req, res) => {
  const user = (req as any).user;
  const { telegramContactId } = req.body;
  if (!telegramContactId) { res.status(400).json({ error: "telegramContactId required" }); return; }
  const entry = await prisma.blacklistEntry.upsert({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId: BigInt(telegramContactId) } },
    create: { userId: user.id, telegramContactId: BigInt(telegramContactId) },
    update: {},
  });
  res.json({ id: entry.id, telegramContactId: entry.telegramContactId.toString() });
});

router.delete("/:telegramContactId", async (req, res) => {
  const user = (req as any).user;
  await prisma.blacklistEntry.deleteMany({
    where: { userId: user.id, telegramContactId: BigInt(req.params.telegramContactId) },
  });
  res.json({ ok: true });
});

export default router;
