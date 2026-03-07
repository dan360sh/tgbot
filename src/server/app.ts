import express from "express";
import cors from "cors";
import path from "path";
import authRoutes from "./routes/auth";
import groupRoutes from "./routes/groups";
import contactRoutes from "./routes/contacts";
import settingsRoutes from "./routes/settings";
import blacklistRoutes from "./routes/blacklist";
import dialogsRoutes from "./routes/dialogs";
import paymentsRoutes from "./routes/payments";
import { AI_MODELS } from "../bot/models";
import { config } from "../config";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), "public")));

  app.use("/api/auth", authRoutes);
  app.use("/api/groups", groupRoutes);
  app.use("/api/contacts", contactRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/blacklist", blacklistRoutes);
  app.use("/api/dialogs", dialogsRoutes);
  app.use("/api/payments", paymentsRoutes);

  // Public endpoint — list available AI models
  app.get("/api/models", (_req, res) => {
    res.json(AI_MODELS.map((m) => ({ id: m.id, name: m.name, costPer1000Words: m.costPer1000Words })));
  });

  // Public config (testnet flag, etc.)
  app.get("/api/config", (_req, res) => {
    res.json({ testnet: config.tonTestnet });
  });

  return app;
}
