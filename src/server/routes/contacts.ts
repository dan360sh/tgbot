import { Router } from "express";
import { prisma } from "../../db";
import { authMiddleware } from "../middleware/auth";
import { botManager } from "../../bot/manager";

const router = Router();
router.use(authMiddleware);

// List contact-group assignments, optionally filtered by groupId
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const groupId = req.query.groupId ? parseInt(req.query.groupId as string) : undefined;
  const contacts = await prisma.contactGroup.findMany({
    where: { userId: user.id, ...(groupId && { groupId }) },
    include: { group: { select: { id: true, name: true } } },
  });
  res.json(contacts.map((c) => ({
    id: c.id,
    telegramContactId: c.telegramContactId.toString(),
    displayName: c.displayName,
    group: c.group,
  })));
});

// Assign contact to group (accepts numeric ID or @username)
router.post("/", async (req, res) => {
  const user = (req as any).user;
  const { contactInput, groupId } = req.body;
  if (!contactInput || !groupId) { res.status(400).json({ error: "contactInput and groupId required" }); return; }

  const group = await prisma.group.findFirst({ where: { id: parseInt(groupId), userId: user.id } });
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  let telegramContactId: bigint;
  let displayName: string | null = null;

  const input = String(contactInput).trim();
  if (/^\d+$/.test(input)) {
    // Numeric ID
    telegramContactId = BigInt(input);
    displayName = input;
  } else {
    // @username — resolve via bot client
    const username = input.startsWith("@") ? input.slice(1) : input;
    const client = botManager.getClient(user.id);
    if (!client) { res.status(503).json({ error: "Bot not connected. Start the bot first." }); return; }
    try {
      const entity = await client.getEntity(username) as any;
      telegramContactId = BigInt(entity.id.toString());
      displayName = `@${username}`;
    } catch {
      res.status(400).json({ error: `User @${username} not found` });
      return;
    }
  }

  const contact = await prisma.contactGroup.upsert({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId } },
    create: { userId: user.id, telegramContactId, groupId: group.id, displayName },
    update: { groupId: group.id, displayName },
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
