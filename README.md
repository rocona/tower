# Tower · 塔台

一款网页版多客户端代理订阅聚合与配置转换控制台，面向 Docker / Coolify 自托管部署，采用 **PostgreSQL** 持久化与极简黑白瑞士网格视觉体系。

> **致谢与声明**：本项目产品理念与交互灵感致敬 iOS 原生应用 **「塔台 · Tower」**，为独立实现的自托管 Web 版本。本项目采用 **PolyForm Noncommercial License 1.0.0** 协议开源，**仅限个人学习、研究与非商业用途，严禁任何形式的商业化使用、售卖或商业 SaaS 托管**。

---

## 核心特性

- **极简黑白瑞士网格 UI + 单一信号橙主色**：支持浅色/深色主题切换（默认浅色），数值、端口、延迟与配置预览统一使用等宽数字（`tabular-nums`），兼顾桌面端管理与手机端一键唤起客户端导入。
- **多协议解析与自有节点管理**：
  - 自动识别 Base64、分享链接 URI、Clash YAML、Surge `[Proxy]`；
  - 协议覆盖 Shadowsocks（含 SS2022 / ShadowTLS）、VMess、VLESS（含 REALITY / Vision / XHTTP / HTTPUpgrade）、Trojan、Hysteria 2（保留 `pinSHA256` 证书指纹与端口跳跃）、TUIC、WireGuard、Snell（含 ShadowTLS）、AnyTLS；
  - 自动解析 `Subscription-Userinfo` 响应头与公告行的流量配额与到期时间；默认过滤公告/官网/流量提示等无效条目并保留节点原名；支持逐节点屏蔽，刷新订阅后按节点稳定指纹持久保留屏蔽状态。
- **离线地区识别、点阵世界地图与服务端 TCP 测速**：
  - 支持手动覆盖 → 节点名/国旗识别 → 内置离线地区映射，自动标注倍率标签（如 `0.1x`、`2x`、`家宽`）；
  - 内置纯 SVG 离线点阵世界地图，活跃地区以信号橙标点，点击即可联动筛选节点；
  - 支持单节点或批量 TCP 握手延迟探测（界面明确标注基于部署服务器网络视角）。
- **规则方案、策略组与 Tailscale 内网回家**：
  - 内置「标准分流 / 低倍率自动池 / 高倍率与家宽隔离」预设，支持增删自定义规则与策略组正则编排；
  - 支持可选 **Tailscale 内网回家**（导出 Surge 自动生成 `interactive-login = true` 与 `[Tailscale ...]` 段，导出 Clash / Stash / sing-box 自动生成对应网段路由）。
- **九大客户端严格兼容矩阵与独立托管通道**：
  - 支持 **Surge（完整配置 / 仅节点 `#!MANAGED-CONFIG`）、Clash / mihomo、Stash、Shadowrocket、Loon、Quantumult X、sing-box、Egern、V2Box**；
  - 严格过滤目标客户端不支持的协议或传输组合，清晰展示「兼容节点数 / 跳过节点数与原因」，绝不静默输出不可用节点；
  - 每个托管通道生成带客户端标识的独立随机 Token URL（如 `/sub/surge/<token>`、`/sub/clash/<token>`），支持随时轮换/停用、凭据打码/明文在线预览、二维码与移动端 URL Scheme 一键导入。
- **安全与数据隔离**：
  - 管理后台基于签名 HttpOnly Session Cookie + 登录速率限制；支持 `ADMIN_PASSWORD` 环境变量预设或首次访问网页初始化；
  - 订阅链接、节点凭据与托管 Token 使用 `AES-256-GCM` 应用层加密后存入 PostgreSQL，且永不打印到日志；
  - 内置远程拉取 SSRF 防护（默认拦截私网 / 回环 / Fake-IP，可通过 `ALLOW_PRIVATE_FETCH=true` 按需放行）。

---

## 快速部署

### 1. Docker Compose（推荐）

```bash
cp .env.example .env
# 编辑 .env，至少修改 POSTGRES_PASSWORD、ADMIN_PASSWORD、ENCRYPTION_KEY 与 PUBLIC_BASE_URL
docker compose up -d --build
```

启动后访问 `http://<你的服务器>:8080`，健康检查端点为 `GET /healthz`。

### 2. Coolify 部署

- **方式 A（Docker Compose 一体化）**：在 Coolify 中新建资源，选择本仓库并使用 `docker-compose.yml`，配置环境变量即可同时拉起 `tower` 与 `postgres`。
- **方式 B（绑定 Coolify 托管 PostgreSQL）**：直接用本仓库 `Dockerfile` 或 GHCR 镜像部署应用，填入托管数据库的 `DATABASE_URL`（如启用 TLS 可设置 `DATABASE_SSL=no-verify` 或 `require`），并将域名指向容器端口 `8080`。

### 3. 本地开发与测试

需要 Node.js 22+：

```bash
npm install
npm run typecheck
npm test
npm run build
```

本地无独立 PostgreSQL 实例时，单测与开发验证会自动兼容内置 `PGlite`；生产环境请务必配置 `DATABASE_URL` 连接 PostgreSQL。

---

## 环境变量说明

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 服务监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATABASE_URL` | 必填（生产） | PostgreSQL 连接串，例如 `postgresql://tower:pass@postgres:5432/tower` |
| `DATABASE_SSL` | `disable` | PostgreSQL SSL 模式：`disable` / `require` / `no-verify` |
| `ADMIN_PASSWORD` | 空 | 管理员密码（公网部署强烈建议预先配置；留空时首次打开页面设置） |
| `ENCRYPTION_KEY` | 自动生成 | 敏感字段 AES-256-GCM 加密密钥（建议 32 字节 hex） |
| `SESSION_SECRET` | 自动生成 | Session Cookie 签名密钥 |
| `ALLOW_PRIVATE_FETCH` | `false` | 是否允许拉取私网 / 回环 / Fake-IP 订阅（透明代理或内网环境可设为 `true`） |
| `PUBLIC_BASE_URL` | 自动识别 | 对外根地址（如 `https://tower.example.com`），用于生成托管订阅与导入链接 |
| `TRUST_PROXY` | `true` | 位于 Coolify / Traefik / Nginx / Caddy 反代后时启用 |

---

## 开源协议

本项目采用 [PolyForm Noncommercial License 1.0.0](./LICENSE)。

- 允许：个人自托管、学习研究、非商业用途的修改与分发（需保留协议与致谢声明）。
- 禁止：任何形式的商业用途、收费服务、转售或商业化 SaaS 运营。
