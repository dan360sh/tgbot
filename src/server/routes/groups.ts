import { Router } from "express";
import { prisma } from "../../db";
import { authMiddleware } from "../middleware/auth";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req, res) => {
  const user = (req as any).user;
  const groups = await prisma.group.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  res.json(groups);
});

router.post("/", async (req, res) => {
  const user = (req as any).user;
  const { name, systemPrompt } = req.body;
  if (!name || !systemPrompt) { res.status(400).json({ error: "name and systemPrompt required" }); return; }
  try {
    const group = await prisma.group.create({ data: { userId: user.id, name, systemPrompt } });
    res.json(group);
  } catch {
    res.status(409).json({ error: "Group with this name already exists" });
  }
});

router.put("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);
  const { name, systemPrompt } = req.body;
  const group = await prisma.group.findFirst({ where: { id, userId: user.id } });
  if (!group) { res.status(404).json({ error: "Not found" }); return; }
  const updated = await prisma.group.update({ where: { id }, data: { name, systemPrompt } });
  res.json(updated);
});

router.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const id = parseInt(req.params.id);
  const group = await prisma.group.findFirst({ where: { id, userId: user.id } });
  if (!group) { res.status(404).json({ error: "Not found" }); return; }
  await prisma.group.delete({ where: { id } });
  // Clear if was default/newcomers
  await prisma.user.update({
    where: { id: user.id },
    data: {
      defaultGroupId: user.defaultGroupId === id ? null : undefined,
      newcomersGroupId: user.newcomersGroupId === id ? null : undefined,
    },
  });
  res.json({ ok: true });
});

export default router;
