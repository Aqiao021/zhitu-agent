# 部署说明（可直接交给 GPT / Codex 执行）

职途助手只依赖 Python 3.10 及以上的标准库，没有第三方依赖，也没有前端构建步骤。网页文件在 `web/`，由 `server.py` 一并提供。

## GitHub Pages 自带密钥版

本模式不运行 Python 服务，不购买 Zeabur/Render 服务器。诊断、计划、面试、问答和资料检索改在浏览器执行；每位使用者提供自己的密钥，调用直接发往其选择的模型服务商。下文“必须遵守”中的服务端环境变量、管理口令和持久化磁盘要求适用于 Python 服务部署；本模式不会宣称有服务端数据库或全站统计。

1. 不将任何真实密钥写入源码、构建文件或 GitHub Secrets。本模式不需要 `ZHITU_API_KEY`、`ZHITU_ADMIN_TOKEN` 或付费服务器。
2. 公共仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
3. 推送到 `main` 后，`.github/workflows/pages.yml` 先运行 Python 与浏览器引擎测试，再打包并部署 `dist/pages/`。只复制列出的公开网页资源及公开资料库，绝不上传仓库根目录、`config.json` 或 `data/`。
4. 工作流根据 Pages 正式 URL 生成完整的 `og:image` 地址。发布后把 README 顶部的体验地址换成实际链接。
5. 打开网页点“连接模型”，填写自己的 Key、接口地址、模型名。默认 DeepSeek；验证会消耗少量模型额度。仅验证成功或实际调用成功后显示“AI 已连接”。Key 只在页面内存中，刷新、离开或关闭时清除；不存储、不代理、不自动重试。
6. 本机记录入口为 `stats.html`，无需管理口令，仅展示当前浏览器的记录。使用记录、评分和诊断结果不跨设备同步；浏览器清理数据后会丢失。用于比赛时需由同学主动导出 CSV 供你汇总，不能作为自动收集的全站统计。
7. 不提供共享 Key，抓取公开网页不会获得其他人的密钥。`robots.txt` 和 robots meta 只表达不收录意愿；浏览器的一次一请求限制可减少误点，并不是不可绕过的防刷系统。每人应在服务商控制台控制自己的余额/预算。

本地预览（Python 标准库即可，只有开发测试需要）：

```bash
python scripts/build_pages.py
python -m http.server 8765 --bind 127.0.0.1 --directory dist
# 打开 http://127.0.0.1:8765/pages/，同时验证仓库子路径下的资源是否正常。
```

静态版自检：未填写 Key 时提示连接；用自己的真实 Key 验证并运行四项功能；无效 Key 显示明确错误；手机尺寸下可连接、导航和查看结果；本机记录导出正常且刷新后仍在；刷新后需要重新填写 Key；源码、浏览器存储、导出记录中均不出现 Key。CI 的模型响应替身测试不能代替真实服务验证。

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
| `ZHITU_GLOBAL_RATE_LIMIT` | 全站任意 10 分钟内最多接受的模型请求数，默认 120 | `120` |
| `ZHITU_DAILY_LIMIT` | 全站每天（UTC）最多接受的模型请求数，默认 1000；重启不清零 | `1000` |
| `ZHITU_FEEDBACK_RATE_LIMIT` | 每个 IP 每分钟最多提交反馈的次数，默认 10 | `10` |
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

## 防爬与防刷

- 模型接口同时受每 IP 限流、全站 10 分钟配额、每日配额和并发上限保护。全站配额在调用模型前预占，失败的请求也占额度，避免通过故意制造失败绕过保护；计数保存在 `/data/zhitu.db`，重启不清零。
- 配额统计的是应用请求次数；模型客户端单次请求最多重试 1 次，因此服务商实际收到的请求数可能更多。请在模型服务商控制台另外设置余额或消费上限。
- 反馈接口独立限流：默认每 IP 每分钟 10 次，全站每分钟 120 次，超限不写数据库。超限的模型请求和反馈请求均返回 HTTP 429。
- 配置统计口令后，包括本机在内的统计访问都需要口令；代理模式且未配置口令时禁止访问统计。应用访问日志省略全部查询参数，避免泄露统计口令。平台边缘日志独立于应用，应在平台侧限制访问、开启查询参数脱敏（如支持）。
- `/robots.txt` 和 `X-Robots-Tag` 声明不收录本站，仅对遵守声明的爬虫有效；它们不能阻止恶意程序。需要防范更大规模流量时，使用平台边缘防护或 WAF，必要时增加人机验证。
- 开启 `ZHITU_TRUST_PROXY=true` 的前提是应用只能经由可信平台入口访问，且入口覆盖或清理客户端提供的 `X-Forwarded-For`。上线时必须确认平台行为，不能只凭该开关认定真实 IP 不可伪造。总配额提供独立于 IP 的费用保护。
- 上线自检应另外确认统计页无口令返回 403，并验证超限返回 429、重启后统计和全站配额仍保留。可在隔离环境调低配额进行限流测试，避免消耗线上试用额度。

## 上线前注意

- 网页的内容安全策略（CSP）只允许加载本站脚本和 Google Fonts。
- 中国大陆访问 Google Fonts 可能较慢或失败。页面会自动回退到系统字体，不影响使用。如需统一字体，可以把字体文件下载到 `web/fonts/` 自行托管，再修改 `index.html` 里的字体链接和 `server.py` 里的 CSP。
- 分享预览图：`web/index.html` 里的 `og:image` 现在是相对路径 `og-cover.jpg`。有了正式域名后，改成完整地址（例如 `https://你的域名/og-cover.jpg`），QQ、微博等平台才能抓到预览图。
