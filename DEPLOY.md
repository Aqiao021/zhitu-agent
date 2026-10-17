# 部署说明（可直接交给 GPT / Codex 执行）

## 当前线上版本：免费的 GitHub Pages

体验地址：<https://aqiao021.github.io/zhitu-agent/>。沿用每位访客自带 Key 的浏览器直连模式，无需充值或购买服务器。用户在右上角模型设置自行填写 Key，验证成功才显示「AI 已连接」；未填写时显示「待连接模型」。默认 DeepSeek 接口为 `https://api.deepseek.com/v1`，模型为 `deepseek-chat`。

工作流 `.github/workflows/pages.yml` 在 `main` 推送后测试、打包、发布。构建命令：`python scripts/build_pages.py --site-url https://aqiao021.github.io/zhitu-agent/`。只公开允许的网页资产、公开岗位库与公开资料；API Key、`config.json`、`data/` 和统计数据库禁止打包。

静态版只保存当前浏览器的结果、计划、进度与记录，不能提供全站统计或公共岗位审核；重载保留本机记录，Key 则清除。使用者应及时导出备份。投稿审核入口只在 Python 服务版显示。静态版已有禁止收录规则，不能据此声称能阻止所有恶意爬虫。

静态版自检：岗位库应显示 19 个专业、45 个岗位；不填 Key 也能搜索筛选、按简历推荐岗位以及组合 2～10 个岗位查看共同要求；用户自行填 Key 验证后，依次诊断、生成简历优化建议和 30 天计划、完成模拟面试和问答；检查手机布局、本机记录导出，以及刷新后进度和统计仍在、密钥已清除。模型接口必须允许浏览器跨域访问。模拟响应测试不能代替真实模型验证。

下面的 Docker、环境变量、管理口令和持久化磁盘要求适用于 Python 服务部署，GitHub Pages 不运行 Python 服务，也不配置公共模型密钥或管理口令。

职途助手只依赖 Python 3.10 及以上的标准库，没有第三方依赖，也没有前端构建步骤。网页文件在 `web/`，由 `server.py` 一并提供。

## 必须遵守

1. **API Key 不能写进代码仓库。** 只用环境变量 `ZHITU_API_KEY` 传入，或写在服务器本地的 `config.json` 里（该文件已被 `.gitignore` 忽略）。
2. **公网部署必须设置 `ZHITU_ADMIN_TOKEN`。** 否则统计页只允许本机访问；放在反向代理后面时，本机访问也会被拒绝。
3. **放在 Nginx 或云平台代理后面时，设置 `ZHITU_TRUST_PROXY=true`。** 这样限流才能按真实用户 IP 计算。
4. **`ZHITU_DATA_DIR` 指向持久化目录。** 这里保存试用统计 `zhitu.db`；目录不持久化的话，重启后数据会丢失。
5. **允许同学填写自己的 API Key 时，网站必须用 HTTPS。** Key 会随每次请求发到服务器，用 http 明文会被截获。云平台默认提供 https；自己的服务器请按下文配置证书。服务器不保存、不记录用户的 Key，只能转发到 `zhitu/userkey.py` 里列出的服务商地址（防止被利用去访问内网）。
6. **在中国大陆用域名对外提供服务，需要先完成 ICP 备案。** 校内试用可以直接用 IP 加端口，或者用校园网地址。

## 环境变量

| 变量 | 作用 | 示例 |
|---|---|---|
| `ZHITU_API_KEY` | 站点自带的模型密钥。可以不填：不填时同学需在网页右上角填写自己的 Key，否则是演示模式 | `sk-...` |
| `ZHITU_PROVIDER` | 接口类型：`openai`（OpenAI 兼容，默认）或 `anthropic` | `openai` |
| `ZHITU_BASE_URL` | 模型接口地址 | `https://api.deepseek.com` |
| `ZHITU_MODEL` | 模型名 | `deepseek-flash` |
| `ZHITU_HOST` / `ZHITU_PORT` | 监听地址和端口。若平台注入了 `PORT`，会自动使用它 | `0.0.0.0` / `8000` |
| `ZHITU_ADMIN_TOKEN` | 统计页口令，访问时用 `/stats?token=口令` | 随机长字符串 |
| `ZHITU_TRUST_PROXY` | 在反向代理后面时设为 `true` | `true` |
| `ZHITU_RATE_LIMIT` | 每个 IP 每 10 分钟最多调用模型的次数，默认 30 | `30` |
| `ZHITU_MAX_CONCURRENCY` | 同时处理的模型请求数上限，默认 4 | `4` |
| `ZHITU_TIMEOUT` | 单次模型请求的超时秒数，默认 120（30 天计划输出较长） | `120` |
| `ZHITU_DATA_DIR` | 统计数据库所在目录 | `/data` |
| `ZHITU_ALLOW_USER_KEY` | 是否允许访客在网页上填写自己的 API Key，默认 `true` | `true` |

## 方式一：Docker（推荐）

```bash
docker build -t zhitu .
docker run -d --name zhitu --restart unless-stopped -p 8000:8000 \
  -e ZHITU_API_KEY=你的密钥 -e ZHITU_BASE_URL=https://api.deepseek.com -e ZHITU_MODEL=deepseek-flash \
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
2. 进入工作台，在“找岗位”里选一个岗位，再到“差距诊断”点“载入示例”和“开始诊断”，应在 60 秒内出结果；接着生成 30 天计划（输出较长，可能需要 1～2 分钟）。
3. 打开 `/stats?token=你的口令`，应能看到刚才那次使用的记录。
4. 在统计页底部的“岗位库管理”里能看到同学提交的招聘信息。
5. 运行 `python -m unittest discover -s tests`，应全部通过。

## 上线前注意

- 网页的内容安全策略（CSP）只允许加载本站资源。页面使用系统字体（苹方、微软雅黑等），不依赖任何外部字体或脚本，国内访问不受影响。
