# DayDream Public Server Deployment

## 目标

公网只给用户展示 DayDream 独立页面，不暴露 SillyTavern 管理页面。

公共入口：

```text
/daydream
```

公共 API：

```text
/api/daydream/bootstrap
/api/daydream/generate
/csrf-token
```

SillyTavern 原始页面和管理 API 不应该直接暴露给公网用户。

## 当前实现

新增文件：

```text
public/daydream.html
public/scripts/daydream-public.js
public/scripts/daydream-public.css
src/endpoints/daydream.js
```

公共页还依赖这组 DayDream 资源：

```text
public/scripts/extensions/third-party/daydream/data/stories.json
public/scripts/extensions/third-party/daydream/data/ui-profiles.json
public/scripts/extensions/third-party/daydream/prompts/engine-core.md
public/scripts/extensions/third-party/daydream/prompts/turn-injection.md
public/scripts/extensions/third-party/daydream/prompts/ending.md
```

注意：如果你的部署仓库或同步脚本忽略了 `public/scripts/extensions/third-party/`，部署到服务器时要确保这个 `daydream` 目录也一起上传；如果被 `.gitignore` 挡住，可以用 `git add -f public/scripts/extensions/third-party/daydream` 纳入你的私有部署仓库。

修改文件：

```text
src/server-main.js
```

`/daydream` 是独立入口页，不加载 SillyTavern 主界面脚本。

`/api/daydream/generate` 是专用生成接口，使用服务器环境变量配置的 OpenAI-compatible 模型。浏览器不会拿到模型密钥。

## 模型配置

在服务器环境变量里配置：

```bash
export DAYDREAM_API_KEY="你的模型 API Key"
export DAYDREAM_BASE_URL="https://api.openai.com/v1"
export DAYDREAM_MODEL="gpt-4o-mini"
export DAYDREAM_RESPONSE_TOKENS="1200"
```

OpenAI-compatible 服务也可以这样配：

```bash
export DAYDREAM_API_KEY="你的 Key"
export DAYDREAM_BASE_URL="https://openrouter.ai/api/v1"
export DAYDREAM_MODEL="openai/gpt-4o-mini"
```

Windows PowerShell 示例：

```powershell
$env:DAYDREAM_API_KEY="你的模型 API Key"
$env:DAYDREAM_BASE_URL="https://api.openai.com/v1"
$env:DAYDREAM_MODEL="gpt-4o-mini"
$env:DAYDREAM_RESPONSE_TOKENS="1200"
node server.js
```

## 启动方式

推荐让 SillyTavern 只监听本机：

```bash
node server.js
```

不要在公网服务器上直接使用：

```bash
node server.js --listen
```

公网入口交给 Nginx 反代。

## Nginx：只暴露 DayDream

用户域名示例：

```text
play.example.com
```

Nginx 配置：

```nginx
# 可放在 nginx.conf 的 http {} 里，用于限制模型接口调用频率。
limit_req_zone $binary_remote_addr zone=daydream_api:10m rate=12r/m;

server {
    listen 80;
    server_name play.example.com;

    client_max_body_size 2m;

    location = /daydream {
        proxy_pass http://127.0.0.1:8000/daydream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /daydream/ {
        return 301 /daydream;
    }

    location = /csrf-token {
        proxy_pass http://127.0.0.1:8000/csrf-token;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /api/daydream/ {
        limit_req zone=daydream_api burst=6 nodelay;

        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /scripts/daydream-public.js {
        proxy_pass http://127.0.0.1:8000/scripts/daydream-public.js;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    location = /scripts/daydream-public.css {
        proxy_pass http://127.0.0.1:8000/scripts/daydream-public.css;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    location / {
        return 404;
    }
}
```

这样公网用户只能访问 DayDream 页面和 DayDream 专用 API。

这里刻意没有给公网 `play.example.com` 转发 `X-Real-IP` / `X-Forwarded-For`。原因是 SillyTavern 默认有白名单机制，应用层看到 Nginx 本机地址时更稳；公网用户真实 IP 由 Nginx access log 记录。如果你已经关闭 SillyTavern 白名单，或明确配置好了代理 IP 策略，再按自己的运维习惯调整。

如果你启用了 SillyTavern 的 `hostWhitelist.enabled`，需要把 `play.example.com` 和 `admin.example.com` 加进去，否则反代域名可能被拒绝。

## 管理后台单独隔离

如果你还想远程管理 SillyTavern，建议用另一个域名：

```text
admin.example.com
```

并加 Basic Auth 或 IP 白名单：

```nginx
server {
    listen 80;
    server_name admin.example.com;

    auth_basic "Admin Only";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

也可以只允许你的 IP：

```nginx
location / {
    allow 你的公网IP;
    deny all;
    proxy_pass http://127.0.0.1:8000;
}
```

## 验收清单

1. `http://play.example.com/daydream` 能打开 DayDream UI。
2. `http://play.example.com/` 返回 404。
3. `http://play.example.com/api/settings/get` 返回 404 或无法访问。
4. 浏览器开发者工具里看不到 `DAYDREAM_API_KEY`。
5. 未配置模型时，页面提示服务器未配置模型。
6. 配置模型后，选故事并开始，能生成第一幕。

## 注意事项

- `/api/daydream/generate` 会消耗服务器模型额度，需要在 Nginx 或上游网关加限流。
- 当前公共页面的故事状态保存在用户浏览器 `localStorage`，不是 SillyTavern 聊天存档。
- 如果后续要多端同步、账号、付费、额度控制，需要增加 DayDream 自己的用户系统或接入现有账号体系。
