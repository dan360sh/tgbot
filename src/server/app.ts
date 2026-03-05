import express from "express";
import cors from "cors";
import path from "path";
import authRoutes from "./routes/auth";
import groupRoutes from "./routes/groups";
import contactRoutes from "./routes/contacts";
import settingsRoutes from "./routes/settings";
import blacklistRoutes from "./routes/blacklist";

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

  return app;
}
