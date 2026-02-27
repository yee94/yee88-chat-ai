// src/chat/server.ts - Webhook/Polling 服务器
import { consola } from "consola";
import { createBot } from "./bot.ts";
import { loadAppConfig } from "../config/index.ts";
import { generateStartupMessage } from "./startup.ts";
import { TelegramPoller, type TelegramUpdate } from "./polling.ts";

export interface ServerOptions {
  port?: number;
  configPath?: string;
  mode?: "webhook" | "polling";
}

export async function startServer(options: ServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT) ?? 3000;
  const mode = options.mode ?? (process.env.YEE88_MODE as "webhook" | "polling") ?? "polling";

  // 加载配置
  const { config, path: cfgPath } = loadAppConfig(options.configPath);
  consola.info(`[server] loaded config from ${cfgPath}`);

  // 创建 bot
  const { chat, stateAdapter } = createBot(config);

  // 初始化
  await stateAdapter.connect();
  await chat.initialize();
  consola.info("[server] bot initialized");

  // 生成启动消息（仅日志输出，不发送到 chat）
  const startupMsg = await generateStartupMessage(config);
  consola.info(`\n${startupMsg.replace(/\*\*/g, "").replace(/_/g, "")}\n`);

  let poller: TelegramPoller | null = null;

  if (mode === "polling") {
    // Polling 模式：主动轮询 Telegram API
    const botToken = config.telegram?.bot_token;
    if (!botToken) {
      throw new Error("Missing telegram.bot_token in config");
    }

    poller = new TelegramPoller({
      botToken,
      onUpdate: async (update: TelegramUpdate) => {
        consola.info("[polling] raw update:", JSON.stringify(update).slice(0, 500));
        
        // 将 update 包装成 Request，调用 chat SDK 的 webhook 处理器
        const fakeRequest = new Request("http://localhost/api/webhooks/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });

        try {
          const resp = await chat.webhooks.telegram(fakeRequest);
          consola.info("[polling] webhook response:", resp.status, await resp.text().catch(() => ""));
        } catch (err) {
          consola.error("[polling] webhook handler error:", err);
        }
      },
      onError: (err) => {
        consola.error("[polling] error:", err);
      },
    });

    // 启动轮询（不阻塞）
    poller.start().catch((err) => {
      consola.error("[polling] fatal error:", err);
      process.exit(1);
    });

    consola.info("[server] polling mode started");
  }

  // 启动 Bun.serve（两种模式都需要，用于 health check）
  const server = Bun.serve({
    port,
    routes: {
      // Health check
      "/health": new Response("ok"),

      // Telegram webhook（仅 webhook 模式使用）
      "/api/webhooks/telegram": {
        POST: async (req) => {
          if (mode === "polling") {
            return new Response("Polling mode active, webhook disabled", { status: 200 });
          }
          try {
            return await chat.webhooks.telegram(req);
          } catch (err) {
            consola.error("[server] webhook error:", err);
            return new Response("Internal Server Error", { status: 500 });
          }
        },
      },

      // Home page
      "/": new Response(`yee88 bot is running (${mode} mode)`),
    },
  });

  consola.info(`[server] listening on http://localhost:${server.port}`);
  if (mode === "webhook") {
    consola.info(`[server] webhook URL: http://localhost:${server.port}/api/webhooks/telegram`);
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    consola.info("[server] shutting down...");
    if (poller) {
      poller.stop();
    }
    await chat.shutdown();
    await stateAdapter.disconnect();
    server.stop();
    process.exit(0);
  });

  return server;
}