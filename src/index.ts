// src/index.ts - 主入口
import { startServer } from "./chat/server.ts";

startServer().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});