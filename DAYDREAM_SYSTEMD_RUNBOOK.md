# DayDream Systemd 部署与二次更新手册

这份文档用于服务器正式部署。目标是让 SillyTavern/DayDream 在后台常驻运行，并在服务器重启后自动恢复。

公网入口仍然交给 Nginx，Node 服务只监听本机：

```text
Nginx 443/80 -> 127.0.0.1:8000 -> SillyTavern DayDream
```

## 1. 约定路径

下面示例假设项目放在：

```text
/opt/SillyTavern
```

如果你的项目路径不同，把文档里的 `/opt/SillyTavern` 全部替换成实际路径。

## 2. 准备代码

首次部署：

```bash
git clone 你的仓库地址 /opt/SillyTavern
cd /opt/SillyTavern
npm install
```

二次部署：

```bash
cd /opt/SillyTavern
git pull
npm install
```


## 3. 配置模型环境变量

创建环境变量文件：

```bash
nano /etc/daydream.env
```

写入：

```bash
DAYDREAM_API_KEY=sk-9ccd22fbd64d429daef1327e6824ebe3
DAYDREAM_BASE_URL=https://api.deepseek.com/v1
DAYDREAM_MODEL=deepseek-chat
DAYDREAM_RESPONSE_TOKENS=1200
NODE_ENV=production
```

如果你使用 OpenRouter，可以这样：

```bash
DAYDREAM_API_KEY=你的OpenRouterKey
DAYDREAM_BASE_URL=https://openrouter.ai/api/v1
DAYDREAM_MODEL=openai/gpt-4o-mini
DAYDREAM_RESPONSE_TOKENS=1200
NODE_ENV=production
```

保护密钥文件：

```bash
chmod 600 /etc/daydream.env
```

## 4. 创建 systemd 服务

创建服务文件：

```bash
nano /etc/systemd/system/daydream-sillytavern.service
```

写入：

```ini
[Unit]
Description=DayDream SillyTavern Public Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/SillyTavern
EnvironmentFile=/etc/daydream.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGINT
SyslogIdentifier=daydream-sillytavern

[Install]
WantedBy=multi-user.target
```

确认 Node 路径：

```bash
which node
```

如果输出不是 `/usr/bin/node`，把 service 文件里的 `ExecStart=/usr/bin/node server.js` 改成实际路径。

## 5. 启动并设置开机自启

```bash
systemctl daemon-reload
systemctl enable daydream-sillytavern
systemctl start daydream-sillytavern
```

查看状态：

```bash
systemctl status daydream-sillytavern --no-pager
```

看实时日志：

```bash
journalctl -u daydream-sillytavern -f
```

## 6. 本机验收

先在服务器内部确认 Node 服务跑通：

```bash
curl -I http://127.0.0.1:8000/daydream
curl -s http://127.0.0.1:8000/api/daydream/bootstrap | head
```

`/daydream` 应该返回 `200`。

如果这里不通，不要先动 Nginx，先查：

```bash
journalctl -u daydream-sillytavern -n 100 --no-pager
```

## 7. Nginx 配置

使用仓库里的配置模板：

```text
deploy/nginx/bkgf-daydream.conf
```

部署到服务器：

```bash
cp -a /etc/nginx/conf.d /root/nginx-conf-backup-$(date +%F-%H%M%S)
rm -f /etc/nginx/conf.d/*.conf
cp /opt/SillyTavern/deploy/nginx/bkgf-daydream.conf /etc/nginx/conf.d/bkgf-daydream.conf
nginx -t
systemctl reload nginx
```

公网验收：

```bash
curl -I https://bkgf.net/
curl -I https://bkgf.net/daydream
curl -I https://bkgf.net/api/settings/get
```

预期：

```text
https://bkgf.net/                 200
https://bkgf.net/daydream         200
https://bkgf.net/api/settings/get 404
```

## 8. 二次更新流程

以后每次更新代码，按这个顺序：

```bash
cd /opt/SillyTavern
git pull
npm install
node --check src/endpoints/daydream.js
node --check public/scripts/daydream-public.js
node --check src/server-main.js
systemctl restart daydream-sillytavern
systemctl status daydream-sillytavern --no-pager
```

如果 Nginx 配置也改了：

```bash
cp /opt/SillyTavern/deploy/nginx/bkgf-daydream.conf /etc/nginx/conf.d/bkgf-daydream.conf
nginx -t
systemctl reload nginx
```

再验收：

```bash
curl -I https://bkgf.net/
curl -I https://bkgf.net/api/settings/get
```

## 9. 常用维护命令

重启：

```bash
systemctl restart daydream-sillytavern
```

停止：

```bash
systemctl stop daydream-sillytavern
```

启动：

```bash
systemctl start daydream-sillytavern
```

查看最近日志：

```bash
journalctl -u daydream-sillytavern -n 100 --no-pager
```

实时日志：

```bash
journalctl -u daydream-sillytavern -f
```

查看端口：

```bash
ss -lntp | grep 8000
```

修改模型配置后重启：

```bash
nano /etc/daydream.env
systemctl restart daydream-sillytavern
```

## 10. 回滚

如果更新后异常：

```bash
cd /opt/SillyTavern
git log --oneline -5
git checkout 上一个可用commit
npm install
systemctl restart daydream-sillytavern
```

如果 Nginx 异常，恢复备份：

```bash
ls /root/nginx-conf-backup-*
rm -f /etc/nginx/conf.d/*.conf
cp /root/nginx-conf-backup-你的备份目录/*.conf /etc/nginx/conf.d/
nginx -t
systemctl reload nginx
```

## 11. 安全检查

确认 SillyTavern 管理接口没有暴露：

```bash
curl -I https://bkgf.net/api/settings/get
curl -I https://bkgf.net/login
curl -I https://bkgf.net/characters
```

这些都不应该进入 SillyTavern 管理页面。

确认浏览器拿不到模型密钥：

```bash
curl -s https://bkgf.net/api/daydream/bootstrap
```

返回里只能看到模型是否已配置和模型名，不应该出现 `DAYDREAM_API_KEY`。
