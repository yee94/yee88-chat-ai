# 部署指南

## 本地开发

### Telegram (Polling 模式)

最简单的方式，无需公网 IP：

```bash
cd packages/yee88
bun run dev
```

### DingTalk (Stream 模式)

同样无需公网 IP：

```bash
cd packages/yee88
YEE88_PLATFORM=dingtalk bun run dev
```

## 生产部署

### 使用 PM2

```bash
# 安装 PM2
npm install -g pm2

# 启动 Telegram bot
pm2 start "bun run start" --name yee88-telegram

# 启动 DingTalk bot
pm2 start "YEE88_PLATFORM=dingtalk bun run start" --name yee88-dingtalk

# 查看状态
pm2 status

# 查看日志
pm2 logs yee88-telegram
```

### 使用 Docker

```dockerfile
# Dockerfile
FROM oven/bun:1

WORKDIR /app

# 复制依赖文件
COPY package.json bun.lock* ./
COPY packages/yee88/package.json ./packages/yee88/
COPY packages/adapter-dingtalk/package.json ./packages/adapter-dingtalk/

# 安装依赖
RUN bun install --frozen-lockfile

# 复制源码
COPY . .

# 构建
RUN cd packages/adapter-dingtalk && bun run build

# 运行
WORKDIR /app/packages/yee88
CMD ["bun", "run", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  yee88-telegram:
    build: .
    environment:
      - YEE88_PLATFORM=telegram
      - YEE88_MODE=polling
    volumes:
      - ~/.yee88:/root/.yee88
    restart: unless-stopped

  yee88-dingtalk:
    build: .
    environment:
      - YEE88_PLATFORM=dingtalk
      - YEE88_MODE=stream
    volumes:
      - ~/.yee88:/root/.yee88
    restart: unless-stopped
```

### 使用 systemd

```ini
# /etc/systemd/system/yee88-telegram.service
[Unit]
Description=yee88 Telegram Bot
After=network.target

[Service]
Type=simple
User=yee88
WorkingDirectory=/opt/yee88/packages/yee88
Environment=YEE88_PLATFORM=telegram
Environment=YEE88_MODE=polling
ExecStart=/usr/local/bin/bun run start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# 启用并启动
sudo systemctl enable yee88-telegram
sudo systemctl start yee88-telegram

# 查看状态
sudo systemctl status yee88-telegram

# 查看日志
sudo journalctl -u yee88-telegram -f
```

## Webhook 模式部署

Webhook 模式需要公网可访问的 HTTPS 端点。

### Nginx 反向代理

```nginx
# /etc/nginx/sites-available/yee88
server {
    listen 443 ssl http2;
    server_name bot.example.com;

    ssl_certificate /etc/letsencrypt/live/bot.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bot.example.com/privkey.pem;

    location /api/webhooks/telegram {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/webhooks/dingtalk {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

### 设置 Telegram Webhook

```bash
# 设置 webhook
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://bot.example.com/api/webhooks/telegram"}'

# 验证 webhook
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"

# 删除 webhook (切换回 polling)
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
```

### 设置 DingTalk Webhook

在钉钉开放平台配置机器人回调地址：
- 消息接收地址: `https://bot.example.com/api/webhooks/dingtalk`

## 云平台部署

### Vercel / Cloudflare Workers

由于 yee88 使用 Bun 运行时和长连接，不适合 Serverless 平台。推荐使用：

- **Railway**: 支持 Bun，适合小型部署
- **Fly.io**: 支持 Bun，全球边缘部署
- **Render**: 支持 Bun，简单易用

### Railway 部署

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录
railway login

# 初始化项目
railway init

# 部署
railway up
```

### Fly.io 部署

```toml
# fly.toml
app = "yee88-bot"

[build]
  builder = "paketobuildpacks/builder:base"

[env]
  YEE88_PLATFORM = "telegram"
  YEE88_MODE = "polling"

[[services]]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

```bash
# 部署
fly deploy

# 设置 secrets
fly secrets set TELEGRAM_BOT_TOKEN=xxx
```

## 监控

### Health Check

yee88 提供 `/health` 端点：

```bash
curl http://localhost:3000/health
# 返回: ok
```

### 日志

使用 `consola` 输出结构化日志：

```
[server] loaded config from /home/user/.yee88/yee88.toml
[server] platform: telegram, mode: polling
[server] bot initialized
[polling] started
[bot] message from user123: hello
```

### Prometheus 指标 (TODO)

未来版本将支持 Prometheus 指标导出。

## 安全建议

1. **限制用户访问**: 配置 `allowed_users` 限制谁可以使用 bot
2. **使用 HTTPS**: Webhook 模式必须使用 HTTPS
3. **保护配置文件**: `~/.yee88/yee88.toml` 包含敏感信息
4. **定期轮换 Token**: 定期更新 bot token 和 API 密钥
5. **网络隔离**: 生产环境使用内网部署 + 反向代理