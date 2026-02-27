// src/chat/server.ts - Webhook/Polling/Stream 服务器
import { consola } from "consola";
import { createBot } from "./bot.ts";
import { createDingTalkBot } from "./bot-dingtalk.ts";
import { loadAppConfig, type Platform } from "../config/index.ts";
import { generateStartupMessage } from "./startup.ts";
import { TelegramPoller, type TelegramUpdate } from "./polling.ts";
import { DingTalkStreamClient, TOPIC_ROBOT } from "@chat-adapter/dingtalk";

export type ServerMode = "webhook" | "polling" | "stream";

export interface ServerOptions {
  port?: number;
  configPath?: string;
  platform?: Platform;
  mode?: ServerMode;
}

/** 自动检测可用平台 */
function detectPlatform(config: { telegram?: { bot_token?: string }; dingtalk?: { client_id?: string } }): Platform {
  if (config.telegram?.bot_token) return "telegram";
  if (config.dingtalk?.client_id) return "dingtalk";
  return "telegram"; // fallback
}

export async function startServer(options: ServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT) ?? 3000;

  // 加载配置
  const { config, path: cfgPath } = loadAppConfig(options.configPath);
  consola.info(`[server] loaded config from ${cfgPath}`);

  // 平台优先级：命令行参数 > 环境变量 > 配置文件 > 自动检测
  const platform: Platform = options.platform
    ?? (process.env.YEE88_PLATFORM as Platform)
    ?? config.default_platform
    ?? detectPlatform(config);

  // 默认模式：telegram 用 polling，dingtalk 用 stream
  const defaultMode: ServerMode = platform === "dingtalk" ? "stream" : "polling";
  const mode: ServerMode = options.mode ?? (process.env.YEE88_MODE as ServerMode) ?? defaultMode;

  consola.info(`[server] platform: ${platform}, mode: ${mode}`);

  // 根据平台创建 bot
  let chat: any;
  let stateAdapter: any;

  if (platform === "dingtalk") {
    const bot = createDingTalkBot(config);
    chat = bot.chat;
    stateAdapter = bot.stateAdapter;
  } else {
    const bot = createBot(config);
    chat = bot.chat;
    stateAdapter = bot.stateAdapter;
  }

  // 初始化
  await stateAdapter.connect();
  await chat.initialize();
  consola.info("[server] bot initialized");

  // 生成启动消息（仅日志输出，不发送到 chat）
  const startupMsg = await generateStartupMessage(config);
  consola.info(`\n${startupMsg.replace(/\*\*/g, "").replace(/_/g, "")}\n`);

  let poller: TelegramPoller | null = null;
  let streamClient: DingTalkStreamClient | null = null;

  if (platform === "telegram" && mode === "polling") {
    // Telegram Polling 模式
    const botToken = config.telegram?.bot_token;
    if (!botToken) {
      throw new Error("Missing telegram.bot_token in config");
    }

    poller = new TelegramPoller({
      botToken,
      onUpdate: async (update: TelegramUpdate) => {
        consola.info("[polling] raw update:", JSON.stringify(update).slice(0, 500));

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

    poller.start().catch((err) => {
      consola.error("[polling] fatal error:", err);
      process.exit(1);
    });

    consola.info("[server] telegram polling mode started");
  } else if (platform === "dingtalk" && mode === "stream") {
    // DingTalk Stream 模式
    const dingtalkConfig = config.dingtalk;
    if (!dingtalkConfig?.client_id || !dingtalkConfig?.client_secret) {
      throw new Error("Missing dingtalk.client_id or dingtalk.client_secret in config");
    }

    streamClient = new DingTalkStreamClient({
      clientId: dingtalkConfig.client_id,
      clientSecret: dingtalkConfig.client_secret,
      robotCode: dingtalkConfig.robot_code,
      corpId: dingtalkConfig.corp_id,
      agentId: dingtalkConfig.agent_id,
      subscriptions: [{ type: "CALLBACK", topic: TOPIC_ROBOT }],
    });

    streamClient.onStateChange((state, error) => {
      consola.info(`[stream] state: ${state}${error ? ` (${error})` : ""}`);
    });

    streamClient.onMessage(async (message, ack) => {
      consola.info("[stream] raw message:", JSON.stringify(message).slice(0, 500));

      const fakeRequest = new Request("http://localhost/api/webhooks/dingtalk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });

      try {
        const resp = await chat.webhooks.dingtalk(fakeRequest);
        consola.info("[stream] webhook response:", resp.status, await resp.text().catch(() => ""));
        ack();
      } catch (err) {
        consola.error("[stream] webhook handler error:", err);
        ack(); // 仍然 ack，避免重复投递
      }
    });

    await streamClient.connect();
    consola.info("[server] dingtalk stream mode started");
  }

  // 启动 Bun.serve（所有模式都需要，用于 health check）
  const server = Bun.serve({
    port,
    routes: {
      // Health check
      "/health": new Response("ok"),

      // Telegram webhook（仅 webhook 模式使用）
      "/api/webhooks/telegram": {
        POST: async (req) => {
          if (platform !== "telegram" || mode === "polling") {
            return new Response("Telegram webhook disabled", { status: 200 });
          }
          try {
            return await chat.webhooks.telegram(req);
          } catch (err) {
            consola.error("[server] telegram webhook error:", err);
            return new Response("Internal Server Error", { status: 500 });
          }
        },
      },

      // DingTalk webhook（仅 webhook 模式使用）
      "/api/webhooks/dingtalk": {
        POST: async (req) => {
          if (platform !== "dingtalk" || mode === "stream") {
            return new Response("DingTalk webhook disabled", { status: 200 });
          }
          try {
            return await chat.webhooks.dingtalk(req);
          } catch (err) {
            consola.error("[server] dingtalk webhook error:", err);
            return new Response("Internal Server Error", { status: 500 });
          }
        },
      },

      // Home page
      "/": new Response(`yee88 bot is running (${platform} ${mode} mode)`),
    },
  });

  consola.info(`[server] listening on http://localhost:${server.port}`);
  if (mode === "webhook") {
    consola.info(`[server] webhook URL: http://localhost:${server.port}/api/webhooks/${platform}`);
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    consola.info("[server] shutting down...");
    if (poller) {
      poller.stop();
    }
    if (streamClient) {
      await streamClient.disconnect();
    }
    await chat.shutdown();
    await stateAdapter.disconnect();
    server.stop();
    process.exit(0);
  });

  return server;
}