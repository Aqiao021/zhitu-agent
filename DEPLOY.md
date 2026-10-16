# 部署说明（可直接交给 GPT / Codex 执行）

职途助手只依赖 Python 3.10 及以上的标准库，没有第三方依赖，也没有前端构建步骤。网页文件在 `web/`，由 `server.py` 一并提供。

## 必须遵守

1. **API Key 不能写进代码仓库。** 只用环境变量 `ZHITU_API_KEY` 传入，或写在服务器本地的 `config.json` 里（该文件已被 `.gitignore` 忽略）。
2. **公网部署必须设置 `ZHITU_ADMIN_TOKEN`。** 否则统计页只允许本机访问；放在反向代理后面时，本机访问也会被拒绝。
3. **放在 Nginx 或云平台代理后面时，设置 `ZHITU_TRUST_PROXY=true`。** 这样限流才能按真实用户 IP 计算。
4. **`ZHITU_DATA_DIR` 指向持久化目录。** 这里保存试用统计 `zhitu.db`；目录不持久化的话，重启后数据会丢失。
5. **在中国大陆用域名对外提供服务，需要先完成 ICP 备案。** 校内试用可以直接用 IP 加端口，或者用校园网地址。

## 环境变量

| 变量 | 作用 | 示例 |
|---|---|---|
| `ZHITU_API_KEY` | 模型密钥。不填则以演示模式运行 | `sk-...` |
| `ZHITU_PROVIDER` | 接口类型：`openai`（OpenAI 兼容，默认）或 `anthropic` | `openai` |
| `ZHITU_BASE_URL` | 模型接口地址 | `https://api.deepseek.com/v1` |
| `ZHITU_MODEL` | 模型名 | `deepseek-chat` |
| `ZHITU_HOST` / `ZHITU_PORT` | 监听地址和端口。若平台注入了 `PORT`，会自动使用它 | `0.0.0.0` / `8000` |
| `ZHITU_ADMIN_TOKEN` | 统计页口令，访问时用 `/stats?token=口令` | 随机长字符串 |
| `ZHITU_TRUST_PROXY` | 在反向代理后面时设为 `true` | `true` |
| `ZHITU_RATE_LIMIT` | 每个 IP 每 10 分钟最多调用模型的次数，默认 30 | `30` |
| `ZHITU_MAX_CONCURRENCY` | 同时处理的模型请求数上限，默认 4 | `4` |
| `ZHITU_TIMEOUT` | 单次模型请求的超时秒数，默认 60 | `60` |
| `ZHITU_DATA_DIR` | 统计数据库所在目录 | `/data` |

## 方式一：Docker（推荐）

```bash
docker build -t zhitu .
docker run -d --name zhitu --restart unless-stopped -p 8000:8000 \
  -e ZHITU_API_KEY=你的密钥 -e ZHITU_BASE_URL=https://api.deepseek.com/v1 -e ZHITU_MODEL=deepseek-chat \
  -e ZHITU_ADMIN_TOKEN=换成随机口令 -e ZHITU_TRUST_PROXY=true \
  -v zhitu-data:/data zhitu
curl http://127.0.0.1:8000/api/ready   # 返回 {"ok": true} 即启动成功
```

## 方式二：Linux 服务器 + systemd

```bash
sudo mkdir -p /opt/zhitu && sudo cp -r . /opt/zhitu && cd /opt/zhitu
sudo tee /etc/systemd/system/zhitu.service >/dev/null <<'UNIT'
[Unit]
Description=Zhitu career assistant
After=network.target
[Service]
WorkingDirectory=/opt/zhitu
Environment=ZHITU_API_KEY=你的密钥
Environment=ZHITU_ADMIN_TOKEN=换成随机口令
Environment=ZHITU_TRUST_PROXY=true
Environment=ZHITU_HOST=127.0.0.1
Environment=ZHITU_DATA_DIR=/var/lib/zhitu
ExecStart=/usr/bin/python3 server.py
Restart=always
User=www-data
StateDirectory=zhitu
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now zhitu
```

## Nginx 反向代理 + HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name zhitu.example.com;
    ssl_certificate     /etc/ssl/zhitu/fullchain.pem;
    ssl_certificate_key /etc/ssl/zhitu/privkey.pem;
    client_max_body_size 256k;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 180s;   # 诊断和面试评价可能需要几十秒
    }
}
```

证书可以用 certbot 申请。注意 `X-Forwarded-For` 要设为 `$remote_addr`，不能简单追加，否则用户可以伪造 IP 绕过限流。

## 方式三：云平台（Render / Railway / Zeabur 等）

- 启动命令：`python server.py`
- 平台注入的 `PORT` 会被自动读取。
- 在平台的“环境变量 / Secrets”里填写上表中的变量，并把 `ZHITU_TRUST_PROXY` 设为 `true`。
- 挂载持久化磁盘，并把 `ZHITU_DATA_DIR` 指向挂载路径。
- 健康检查路径：`/api/ready`

## 部署后自检

1. 打开首页，右上角应显示“AI 已连接”（只显示“演示模式”说明密钥没有生效）。
2. 进入工作台，点“载入示例”，再点“开始诊断”，应在 60 秒内出结果。
3. 打开 `/stats?token=你的口令`，应能看到刚才那次使用的记录。
4. 运行 `python -m unittest discover -s tests`，应全部通过。

## 上线前注意

- 网页的内容安全策略（CSP）只允许加载本站脚本和 Google Fonts。
- 中国大陆访问 Google Fonts 可能较慢或失败。页面会自动回退到系统字体，不影响使用。如需统一字体，可以把字体文件下载到 `web/fonts/` 自行托管，再修改 `index.html` 里的字体链接和 `server.py` 里的 CSP。
- 分享预览图：`web/index.html` 里的 `og:image` 现在是相对路径 `og-cover.jpg`。有了正式域名后，改成完整地址（例如 `https://你的域名/og-cover.jpg`），QQ、微博等平台才能抓到预览图。
