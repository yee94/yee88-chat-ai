// src/cli/index.ts - CLI 主入口
import { consola } from "consola";
import { loadAppConfig, writeConfig, loadOrInitConfig, HOME_CONFIG_PATH } from "../config/index.ts";
import { startServer } from "../chat/server.ts";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case "run":
    case "start": {
      const port = args.includes("--port")
        ? Number(args[args.indexOf("--port") + 1])
        : undefined;
      const configPath = args.includes("--config")
        ? args[args.indexOf("--config") + 1]
        : undefined;
      await startServer({ port, configPath });
      break;
    }

    case "onboard":
    case "setup": {
      const { runOnboarding } = await import("./onboard.ts");
      await runOnboarding();
      break;
    }

    case "init": {
      const projectPath = args[1] ?? process.cwd();
      const alias = args[2] ?? projectPath.split("/").pop()?.toLowerCase() ?? "default";

      const { raw, path: cfgPath } = loadOrInitConfig();

      // Ensure projects table exists
      if (!raw["projects"]) {
        raw["projects"] = {};
      }
      const projects = raw["projects"] as Record<string, unknown>;

      projects[alias] = {
        alias,
        path: resolve(projectPath),
        worktrees_dir: ".worktrees",
      };

      // Set as default if no default exists
      if (!raw["default_project"]) {
        raw["default_project"] = alias;
      }

      // Ensure config directory exists
      const dir = dirname(cfgPath);
      mkdirSync(dir, { recursive: true });

      writeConfig(raw, cfgPath);
      consola.success(`Project "${alias}" registered at ${resolve(projectPath)}`);
      consola.info(`Config saved to ${cfgPath}`);
      break;
    }

    case "config": {
      const subCmd = args[1];
      const { config, path: cfgPath } = loadAppConfig();

      switch (subCmd) {
        case "path":
          console.log(cfgPath);
          break;
        case "show":
          console.log(JSON.stringify(config, null, 2));
          break;
        case "set": {
          const key = args[2];
          const value = args[3];
          if (!key || value === undefined) {
            consola.error("Usage: yee88 config set <key> <value>");
            process.exit(1);
          }
          const { raw, path } = loadOrInitConfig();
          // Simple dot-notation set
          const parts = key.split(".");
          let obj = raw as Record<string, unknown>;
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i]!;
            if (!obj[part] || typeof obj[part] !== "object") {
              obj[part] = {};
            }
            obj = obj[part] as Record<string, unknown>;
          }
          // Try to parse as number/boolean
          let parsed: unknown = value;
          if (value === "true") parsed = true;
          else if (value === "false") parsed = false;
          else if (/^\d+$/.test(value)) parsed = Number(value);

          obj[parts[parts.length - 1]!] = parsed;
          writeConfig(raw, path);
          consola.success(`Set ${key} = ${value}`);
          break;
        }
        default:
          consola.info("Usage: yee88 config [path|show|set <key> <value>]");
      }
      break;
    }

    case "project": {
      const subCmd = args[1];
      const { config } = loadAppConfig();

      switch (subCmd) {
        case "list":
          if (Object.keys(config.projects).length === 0) {
            consola.info("No projects registered. Use `yee88 init <path>` to add one.");
          } else {
            for (const [alias, project] of Object.entries(config.projects)) {
              const isDefault = alias === config.default_project ? " (default)" : "";
              console.log(`  ${alias}${isDefault} → ${project.path}`);
            }
          }
          break;
        default:
          consola.info("Usage: yee88 project [list]");
      }
      break;
    }

    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(`
yee88 - Telegram Bot bridge for OpenCode CLI

Commands:
  run [--port N] [--config path]  Start the bot server
  onboard                         Interactive setup wizard
  init [path] [alias]             Register a project
  config path                     Show config file path
  config show                     Show current config
  config set <key> <value>        Set a config value
  project list                    List registered projects
  help                            Show this help
`);
      break;

    default:
      consola.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  consola.error(err);
  process.exit(1);
});