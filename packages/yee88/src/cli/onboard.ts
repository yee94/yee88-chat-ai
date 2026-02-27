// src/cli/onboard.ts - CLI 交互式 Onboarding
import { consola } from "consola";
import { writeConfig, loadOrInitConfig, HOME_CONFIG_PATH } from "../config/index.ts";
import { dirname, resolve } from "path";
import { mkdirSync, existsSync } from "fs";

/** 从 stdin 读取一行 */
async function readLine(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
    if (result.includes("\n")) break;
  }
  reader.releaseLock();
  return result.trim();
}

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
          consola.success(
            `Captured chat: ${chat.title ?? chat.type} (ID: ${chat.id})` +
            (from ? ` from ${from.first_name} (ID: ${from.id})` : "")
          );
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

/** 运行交互式 onboarding */
export async function runOnboarding(): Promise<void> {
  consola.box("yee88 Onboarding");
  console.log("");

  // Step 1: Bot Token
  consola.info("Step 1/4: Telegram Bot Token");
  consola.info("Get one from @BotFather: https://t.me/BotFather\n");

  const token = await readLine("Bot token: ");
  if (!token) {
    consola.error("No token provided. Aborting.");
    return;
  }

  if (!isValidBotToken(token)) {
    consola.error("Invalid token format. Expected: 123456789:ABCdef...");
    return;
  }

  consola.start("Validating token...");
  const { valid, botName } = await validateBotToken(token);
  if (!valid) {
    consola.error("Token is invalid or expired. Please check and try again.");
    return;
  }
  consola.success(`Bot verified: ${botName}`);
  console.log("");

  // Step 2: Capture Chat ID
  consola.info("Step 2/4: Connect Chat");
  consola.info("Send a message to your bot to capture the chat ID.");
  consola.info("For group chats: add the bot to the group first.\n");

  const chatId = await captureChatId(token);
  if (chatId == null) return;
  console.log("");

  // Step 3: Default Engine
  consola.info("Step 3/4: Default Engine");
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
    defaultEngine = available[0]!;
    consola.info(`\nUsing "${defaultEngine}" as default engine.`);
  } else {
    consola.warn("\nNo engines found. Please install opencode first.");
    consola.info("  → https://opencode.ai");
  }
  console.log("");

  // Step 4: Save Config
  consola.info("Step 4/4: Save Configuration");

  const { raw, path: cfgPath } = loadOrInitConfig();

  // Merge config
  if (!raw["telegram"]) raw["telegram"] = {};
  const tg = raw["telegram"] as Record<string, unknown>;
  tg["bot_token"] = token;
  tg["allowed_users"] = chatId > 0 ? [] : []; // Will be empty by default

  raw["default_engine"] = defaultEngine;

  // Save
  const dir = dirname(cfgPath);
  mkdirSync(dir, { recursive: true });
  writeConfig(raw, cfgPath);

  consola.success(`Config saved to ${cfgPath}`);
  console.log("");
  consola.box(`Done! Run \`bun src/index.ts\` to start the bot.`);
}