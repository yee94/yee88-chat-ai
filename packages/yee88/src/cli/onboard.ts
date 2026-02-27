// src/cli/onboard.ts - CLI 交互式 Onboarding
import { consola } from "consola";
import { writeConfig, loadOrInitConfig, HOME_CONFIG_PATH } from "../config/index.ts";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import * as readline from "node:readline";

type Platform = "telegram" | "dingtalk";

/** 创建 readline interface */
function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/** 从 stdin 读取一行 */
async function readLine(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

// ─── Telegram ────────────────────────────────────────────────────────────────

/** 验证 bot token 格式 */
function isValidBotToken(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]+$/.test(token);
}

/** 验证 bot token 是否有效（调用 Telegram API） */
async function validateBotToken(token: string): Promise<{ valid: boolean; botName?: string }> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await resp.json()) as { ok: boolean; result?: { username: string; first_name: string } };
    if (data.ok && data.result) {
      return { valid: true, botName: `@${data.result.username} (${data.result.first_name})` };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

/** 等待用户发送消息到 bot，捕获 chat_id */
async function captureChatId(token: string): Promise<number | null> {
  consola.info("Waiting for a message from you...");
  consola.info("Send any message to your bot in Telegram.\n");

  const startTime = Date.now();
  const timeout = 120_000; // 2 minutes
  let lastUpdateId = 0;

  while (Date.now() - startTime < timeout) {
    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
      const resp = await fetch(url);
      const data = (await resp.json()) as {
        ok: boolean;
        result: Array<{
          update_id: number;
          message?: { chat: { id: number; type: string; title?: string }; from?: { id: number; first_name: string } };
        }>;
      };

      if (!data.ok) continue;

      for (const update of data.result) {
        lastUpdateId = update.update_id;
        if (update.message?.chat) {
          const chat = update.message.chat;
          const from = update.message.from;
          const chatInfo = chat.title ?? chat.type;
          const fromInfo = from ? ` from ${from.first_name} (ID: ${from.id})` : "";
          consola.success(`Captured chat: ${chatInfo} (ID: ${chat.id})${fromInfo}`);
          return chat.id;
        }
      }
    } catch {
      await Bun.sleep(1000);
    }
  }

  consola.error("Timeout waiting for message. Please try again.");
  return null;
}

/** Telegram onboarding */
async function onboardTelegram(rl: readline.Interface): Promise<Record<string, unknown> | null> {
  // Step: Bot Token
  consola.info("Telegram Bot Token");
  consola.info("Get one from @BotFather: https://t.me/BotFather\n");

  const token = await readLine(rl, "Bot token: ");
  if (!token) {
    consola.error("No token provided. Aborting.");
    return null;
  }

  if (!isValidBotToken(token)) {
    consola.error("Invalid token format. Expected: 123456789:ABCdef...");
    return null;
  }

  consola.start("Validating token...");
  const { valid, botName } = await validateBotToken(token);
  if (!valid) {
    consola.error("Token is invalid or expired. Please check and try again.");
    return null;
  }
  consola.success(`Bot verified: ${botName}`);
  console.log("");

  // Step: Capture Chat ID
  consola.info("Connect Chat");
  consola.info("Send a message to your bot to capture the chat ID.");
  consola.info("For group chats: add the bot to the group first.\n");

  const chatId = await captureChatId(token);
  if (chatId == null) return null;
  console.log("");

  return {
    telegram: {
      bot_token: token,
      allowed_users: [],
    },
  };
}

// ─── DingTalk ────────────────────────────────────────────────────────────────

/** 验证 DingTalk 凭证 */
async function validateDingTalkCredentials(
  clientId: string,
  clientSecret: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const resp = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
    });
    const data = (await resp.json()) as { accessToken?: string; expireIn?: number; code?: string; message?: string };
    if (data.accessToken) {
      return { valid: true };
    }
    return { valid: false, error: data.message ?? "Unknown error" };
  } catch (e) {
    return { valid: false, error: String(e) };
  }
}

/** DingTalk onboarding */
async function onboardDingTalk(rl: readline.Interface): Promise<Record<string, unknown> | null> {
  consola.info("DingTalk Robot Configuration");
  consola.info("Create a robot in DingTalk Open Platform:");
  consola.info("  → https://open.dingtalk.com/\n");

  // Client ID (AppKey)
  const clientId = await readLine(rl, "Client ID (AppKey): ");
  if (!clientId) {
    consola.error("No Client ID provided. Aborting.");
    return null;
  }

  // Client Secret (AppSecret)
  const clientSecret = await readLine(rl, "Client Secret (AppSecret): ");
  if (!clientSecret) {
    consola.error("No Client Secret provided. Aborting.");
    return null;
  }

  // Validate
  consola.start("Validating credentials...");
  const { valid, error } = await validateDingTalkCredentials(clientId, clientSecret);
  if (!valid) {
    consola.error(`Credentials invalid: ${error}`);
    return null;
  }
  consola.success("Credentials verified!");
  console.log("");

  // Optional: Robot Code
  consola.info("Robot Code (optional, defaults to Client ID)");
  const robotCode = await readLine(rl, "Robot Code (press Enter to skip): ");
  console.log("");

  return {
    dingtalk: {
      client_id: clientId,
      client_secret: clientSecret,
      robot_code: robotCode || undefined,
      allowed_users: [],
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

/** 运行交互式 onboarding */
export async function runOnboarding(): Promise<void> {
  const rl = createRL();

  try {
    consola.box("yee88 Onboarding");
    console.log("");

    // Step 1: Choose Platform
    consola.info("Step 1/3: Choose Platform\n");
    consola.info("  1. Telegram");
    consola.info("  2. DingTalk (钉钉)\n");

    const platformChoice = await readLine(rl, "Select platform [1/2]: ");
    const platform: Platform = platformChoice === "2" ? "dingtalk" : "telegram";
    consola.success(`Selected: ${platform}`);
    console.log("");

    // Step 2: Platform-specific setup
    consola.info(`Step 2/3: ${platform === "telegram" ? "Telegram" : "DingTalk"} Setup\n`);

    let platformConfig: Record<string, unknown> | null;
    if (platform === "telegram") {
      platformConfig = await onboardTelegram(rl);
    } else {
      platformConfig = await onboardDingTalk(rl);
    }

    if (!platformConfig) {
      rl.close();
      return;
    }

    // Step 3: Default Engine
    consola.info("Step 3/3: Default Engine\n");
    const engines = ["opencode", "claude", "codex"];
    const available: string[] = [];

    for (const engine of engines) {
      try {
        const proc = Bun.spawn(["which", engine], { stdout: "ignore", stderr: "ignore" });
        const code = await proc.exited;
        if (code === 0) {
          available.push(engine);
          consola.success(`  ${engine} ✅`);
        } else {
          consola.info(`  ${engine} ❌ not installed`);
        }
      } catch {
        consola.info(`  ${engine} ❌ not installed`);
      }
    }

    let defaultEngine = "opencode";
    if (available.length > 0) {
      defaultEngine = available[0] ?? "opencode";
      consola.info(`\nUsing "${defaultEngine}" as default engine.`);
    } else {
      consola.warn("\nNo engines found. Please install opencode first.");
      consola.info("  → https://opencode.ai");
    }
    console.log("");

    // Save Config
    consola.info("Saving Configuration...\n");

    const { raw, path: cfgPath } = loadOrInitConfig();

    // Merge platform config
    Object.assign(raw, platformConfig);
    raw.default_platform = platform;
    raw.default_engine = defaultEngine;

    // Save
    const dir = dirname(cfgPath);
    mkdirSync(dir, { recursive: true });
    writeConfig(raw, cfgPath);

    consola.success(`Config saved to ${cfgPath}`);
    console.log("");

    // Final instructions (no need for env var since default_platform is set)
    const startCmd = "yee88 start";

    consola.box(`Done! Run \`${startCmd}\` to start the bot.`);
  } finally {
    rl.close();
  }
}