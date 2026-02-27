// src/chat/server.ts - Webhook 服务器
import { consola } from "consola";
import { createBot } from "./bot.ts";
import { loadAppConfig } from "../config/index.ts";

export interface ServerOptions {
  port?: number;
  configPath?: string;
}

export async function startServer(options: ServerOptions = {}) {
  const port = options.port ?? Number(process.env["PORT"]) ?? 3000;

  // 加载配置
  const { config, path: cfgPath } = loadAppConfig(options.configPath);
  consola.info(`[server] loaded config from ${cfgPath}`);

  // 创建 bot
  const { chat, stateAdapter } = createBot(config);

  // 初始化
  await stateAdapter.connect();
  await chat.initialize();
  consola.info("[server] bot initialized");

  // 启动 Bun.serve
  const server = Bun.serve({
    port,
    routes: {
      // Health check
      "/health": new Response("ok"),

      // Telegram webhook
      "/api/webhooks/telegram": {
        POST: async (req) => {
          try {
            return await chat.webhooks.telegram(req);
          } catch (err) {
            consola.error("[server] webhook error:", err);
            return new Response("Internal Server Error", { status: 500 });
          }
        },
      },

      // Home page
      "/": new Response("yee88 bot is running"),
    },
  });

  consola.info(`[server] listening on http://localhost:${server.port}`);
  consola.info(`[server] webhook URL: http://localhost:${server.port}/api/webhooks/telegram`);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    consola.info("[server] shutting down...");
    await chat.shutdown();
    await stateAdapter.disconnect();
    server.stop();
    process.exit(0);
  });

  return server;
}