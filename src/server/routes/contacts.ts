import { Router } from "express";
import { prisma } from "../../db";
import { authMiddleware } from "../middleware/auth";

const router = Router();
router.use(authMiddleware);

// List all contact-group assignments
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const contacts = await prisma.contactGroup.findMany({
    where: { userId: user.id },
    include: { group: { select: { id: true, name: true } } },
  });
  res.json(contacts.map((c) => ({
    id: c.id,
    telegramContactId: c.telegramContactId.toString(),
    group: c.group,
  })));
});

// Assign contact to group
router.post("/", async (req, res) => {
  const user = (req as any).user;
  const { telegramContactId, groupId } = req.body;
  if (!telegramContactId || !groupId) { res.status(400).json({ error: "telegramContactId and groupId required" }); return; }

  const group = await prisma.group.findFirst({ where: { id: parseInt(groupId), userId: user.id } });
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const contact = await prisma.contactGroup.upsert({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId: BigInt(telegramContactId) } },
    create: { userId: user.id, telegramContactId: BigInt(telegramContactId), groupId: group.id },
    update: { groupId: group.id },
    include: { group: { select: { id: true, name: true } } },
  });
  res.json({ ...contact, telegramContactId: contact.telegramContactId.toString() });
});

// Remove contact from group
router.delete("/:telegramContactId", async (req, res) => {
  const user = (req as any).user;
  const telegramContactId = BigInt(req.params.telegramContactId);
  await prisma.contactGroup.deleteMany({ where: { userId: user.id, telegramContactId } });
  res.json({ ok: true });
});

export default router;
