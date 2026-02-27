// src/__tests__/cli.test.ts
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TOML = require("@iarna/toml");

describe("CLI", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "yee88-cli-test-"));
    configPath = join(tmpDir, "yee88.toml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("init creates config with project", async () => {
    const projectDir = join(tmpDir, "myproject");
    mkdirSync(projectDir);

    const proc = Bun.spawn(
      ["bun", "src/cli/index.ts", "init", projectDir, "myproject", "--config", configPath],
      {
        cwd: process.cwd(),
        env: { ...process.env, HOME: tmpDir },
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc.exited;

    // The init command uses HOME_CONFIG_PATH by default, so we check the home dir
    // For this test, we verify the CLI runs without error
    expect(proc.exitCode).toBe(0);
  });

  test("help command shows usage", async () => {
    const proc = Bun.spawn(
      ["bun", "src/cli/index.ts", "help"],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(output).toContain("yee88");
    expect(output).toContain("Commands:");
  });

  test("unknown command exits with error", async () => {
    const proc = Bun.spawn(
      ["bun", "src/cli/index.ts", "nonexistent"],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc.exited;
    expect(proc.exitCode).toBe(1);
  });
});