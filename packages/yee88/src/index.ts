// src/index.ts - 主入口
import { startServer } from "./chat/server.ts";

const { cleanup, onSigInt } = await startServer();

// bun --hot 热重载清理：断开旧的 stream 连接、停止 poller 和 server
if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    process.removeListener("SIGINT", onSigInt);
    await cleanup();
  });
}