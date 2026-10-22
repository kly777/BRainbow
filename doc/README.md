# Brainbow 项目文档

Brainbow 是一个个人知识管理工具集：任务管理、卡片笔记、间隔重复记忆、本体/符号、英语阅读、书签、媒体与 AI 对话。

- 后端：Rust 2024 + Axum + SQLx（SQLite）
- 前端：SolidJS + Vite+（Oxlint / Oxfmt / Vitest）+ CSS Modules + stylelint
- 部署：ssh 通道传产物 + systemd + Caddy（工具链：justfile + xtask/）

> 代码基准：`main@48996cd7`（2026-10-22） · schema 26 · 文档最后核对：2026-10-22
> 文档随代码入库。现行文档以 main 为准；`plans/` 是冻结快照；`notes/` 不承诺准确。
> 项目工作守则见 [AGENTS.md](../AGENTS.md)（已随文档入库）。

## 组织方式：按“读者意图”分四类，按“生命周期”标状态

| 目录 | 回答的问题 | 与代码不一致时 |
|------|------------|----------------|
| [`guides/`](./guides/) | 现在该怎么做？ | **以代码为准，并改文档** |
| [`design/`](./design/) | 为什么这样设计？ | 现行设计以代码为准；提案/草稿/归档只看设计意图 |
| [`plans/`](./plans/) | 当时怎么计划的？ | **冻结快照，刻意不追代码**——改它等于抹掉当时的判断 |
| [`notes/`](./notes/) | 随手记了什么？ | 不承担准确性承诺 |

`guides/` 与 `design/` 的每篇文档在 H1 后有一个状态块（`plans/` 整体按目录约定为快照，`notes/` 为随记）：

| 状态 | 含义 | 能否当实现依据 |
|------|------|----------------|
| **现行** | 已实现/已接受，并与 main 核对过 | 可以 |
| **提案** | 未合入 main 的设计方案 | 不可以 |
| **草稿** | 未实现、未定稿 | 不可以 |
| **调研** | 备选方案或外部研究 | 不可以 |
| **已取代** | 被新设计取代，仅存档 | 不可以 |
| **快照** | `plans/` 的时间切片 | 只代表当时 |

> 没有按教程 / How-to / Reference / Explanation 再拆一层：本仓的 `guides/` 已经同时承担 how-to 与速查，
> 真正的问题是“现行 / 提案 / 历史”混读。物理大搬家还会破坏 `plans/` 里冻结的相对链接、代码注释与
> `AGENTS.md` 的路径引用；所以用**状态索引 + 每篇状态块 + `design/archive/`** 解决，而不是再拆目录。

## guides/ — 现行操作指南（12）

| 文档 | 内容 |
|------|------|
| [architecture.md](./guides/architecture.md) | 整体架构、依赖方向、后端分层契约 |
| [backend.md](./guides/backend.md) | Rust 后端开发、入口装配、SQL 宏、认证、错误 |
| [frontend.md](./guides/frontend.md) | SolidJS 前端结构、路由单一来源、共享组件与令牌 |
| [component-design.md](./guides/component-design.md) | 组件设计与拆分判据、分层归属 |
| [component-sizing.md](./guides/component-sizing.md) | 组件尺寸契约（CSS 盒模型弹性，不是代码行数） |
| [error-handling.md](./guides/error-handling.md) | 错误处理与提示：三层结构、谁负责提示 |
| [database.md](./guides/database.md) | schema 声明、reconcile、自检、sqlx offline |
| [deployment.md](./guides/deployment.md) | 构建、部署、备份、回滚、健康检查、远端边界 |
| [testing.md](./guides/testing.md) | 后端/前端测试与质量检查、提交前清单 |
| [modules.md](./guides/modules.md) | 模块 × API 前缀、前端物理层与新增步骤 |
| [design-tokens.md](./guides/design-tokens.md) | 现行令牌（Hallmark 编辑风）、硬规则、映射 |
| [e2e-smoke.md](./guides/e2e-smoke.md) | 页面级 e2e 冒烟（Playwright，`just e2e`） |

## design/ — 域设计

完整索引见 [`design/README.md`](./design/README.md)。摘要：

| 状态 | 文档 |
|------|------|
| **现行** | [authorization](./design/authorization.md) · [file-service](./design/file-service.md) · [markdown-editor](./design/markdown-editor.md) · [memory-system](./design/memory-system.md) · [anki-fsrs-scheduling](./design/anki-fsrs-scheduling.md) · [task-ux/](./design/task-ux/) |
| **提案** | [frontend-architecture](./design/frontend-architecture.md) · [memory-v2](./design/memory-v2.md) · [swiss-design-language](./design/swiss-design-language.md) |
| **草稿** | [record-design](./design/record-design.md) · [life](./design/life.md) |
| **调研** | [kumo-design-language](./design/kumo-design-language.md) |
| **已取代** | [media-design](./design/archive/media-design.md) · [task](./design/archive/task.md) · [task-system](./design/archive/task-system.md) · [time-management](./design/archive/time-management.md) · [swiss 2026-10-02 快照](./design/archive/swiss-design-language-2026-10-02.md) |

## plans/ — 计划、评估与审计（5 + ux/ 12）

> 状态：**快照（冻结）**。这些文档记录当时的判断，不追当前代码；不要为了“对齐”改它们。
> 入口与阅读约定见 [`plans/README.md`](./plans/README.md)。

| 文档 | 内容 |
|------|------|
| [frontend-ui-architecture.md](./plans/frontend-ui-architecture.md) | 前端 UI 架构评估与改造计划（原语 / 页面外壳 / 数据范式，最权威的“为什么”） |
| [frontend-migration-manual.md](./plans/frontend-migration-manual.md) | 前端迁移手册（S1–S5 标准、T1–T3 手术单、Hook ≤100 行契约） |
| [frontend-dao-plan.md](./plans/frontend-dao-plan.md) | 前端适应性 / 无障碍改进计划（以《A Dao of Web Design》为镜） |
| [architecture-debt.md](./plans/architecture-debt.md) | 后端架构债务与改造计划 |
| [project-audit-260822.md](./plans/project-audit-260822.md) | 全栈缺陷审计报告（部署 / 安全 / 前端 / 文档 / 测试） |
| [ux/](./plans/ux/) | 单页面 UX 审计（12 份：auth card conv db_viewer file-preview-plan media mem onto sign task text time_window） |

## notes/ — 随记（2）

[entity.md](./notes/entity.md)（符号与概念的思考）· [sum.md](./notes/sum.md)（项目缘起与随记）

## 架构地图

[architecture-map.html](./architecture-map.html) —— 单文件可交互的全栈架构地图（浏览器打开；快照日期 2026-10-17）。

## 快速开始

```bash
# 开发环境（同时启动后端 + 前端）
just dev

# 后端测试 / lint
cargo test
cargo clippy --workspace --all-targets

# 前端检查 + 测试
cd web && pnpm run check && pnpm run test

# 生成 sqlx 离线数据（SQL 变更后必跑）
just sqlx-prepare
```

默认后端端口 `3000`，前端开发端口 `3001`（由 `.env.dev` 配置）。

## 目录结构

```
BRainbow/
├── src/                 # Rust 后端
│   ├── main.rs          # 入口：日志、CORS、路由、启动迁移
│   ├── app/             # 组合层：HTTP 路由、认证、限速
│   ├── db/              # brainbow-db 的 facade（connect/migrate/verify）
│   ├── modules/         # 业务模块（每个域一个目录）
│   └── shared/          # 无依赖纯工具、错误类型、配置
├── crates/db/           # schema 声明、迁移、自检（brainbow-db）
├── web/                 # SolidJS 前端
│   ├── src/app/         # Layout、路由、全局样式
│   ├── src/capabilities/ # 跨域组合（home/search/chat/quick-capture）
│   ├── src/domains/     # 业务域（task/card/mem/...）
│   ├── src/platform/    # 平台能力（auth/admin/file/db/...）
│   ├── src/tools/       # 工具页（color/rainbow）
│   ├── src/components/  # 共享 UI
│   ├── src/config/      # 路径/导航单一来源
│   └── src/shared/      # API、工具、样式、错误处理
├── deploy/              # 部署模板：systemd unit / Caddyfile / ffmpeg.lock
├── xtask/               # 构建与部署 CLI（Rust，justfile 的后端）
├── doc/                 # 项目文档（本目录，随代码入库）
└── justfile             # 命令入口（构建/部署/运维/开发循环；逻辑在 xtask/）
```

## 维护约定

- 新文档先选目录，再在 H1 后写状态块；状态与目录的对应关系见上表。
- 改代码时若发现 `guides/` 与实现不一致：**以代码为准改文档**。
- 提案合入 main 后：把状态块改为“现行”，必要时从 `design/README.md` 的提案区移到现行区。
- `plans/` 不要动；`notes/` 不承诺准确。
- 文档随代码入库；新增/修改文档与代码同批提交。
