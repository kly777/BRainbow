# 设计文档索引

> 状态：索引 · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22
> **只有「现行」可以当实现依据。** 「提案」未合入 main，「草稿」未实现，「调研」不承诺落地，「已取代」只看历史。

本目录不按状态再分子目录：`plans/` 里冻结的相对链接、代码注释和 `AGENTS.md` 都引用这些路径；
用每篇状态块 + 本索引 + `archive/`，比物理搬家更不容易断链。

## 现行（已实现 / 已接受）

| 文档 | 内容 | 核对 |
|------|------|------|
| [authorization.md](./authorization.md) | 授权与归属：admin / 普通用户两档、`Actor` 判据、越权按不存在 | 已实现 |
| [file-service.md](./file-service.md) | 通用文件服务：可见性、白名单、类型识别两阶段、预览与缩略图 | 已实现 |
| [markdown-editor.md](./markdown-editor.md) | 统一 Markdown 编辑与预览组件 | 已实现 |
| [memory-system.md](./memory-system.md) | 记忆模块：FSRS 调度、复习与统计 | 已实现 |
| [anki-fsrs-scheduling.md](./anki-fsrs-scheduling.md) | FSRS 调度算法细节 | 已实现 |
| [task-ux/](./task-ux/) | 任务模块 UX 重设计（01–10）；已合入 main `60a3b224` | 已实现 |

> `task-ux/01-现状与问题.md` 记录的是重做前的现状，状态块标为“已取代（归档）”，保留作背景；02–10 为现行，现行实现看 `src/modules/task` 与 `web/src/domains/task`。

## 提案（未合入 main）

| 文档 | 内容 | 说明 |
|------|------|------|
| [frontend-architecture.md](./frontend-architecture.md) | 前端整体架构决策（10 条 ADR） | Proposed；部分目录结构已落地，ADR 未全部执行 |
| [memory-v2.md](./memory-v2.md) | 幂律遗忘曲线记忆模型 | 未实现；当前仍是 FSRS |
| [swiss-design-language.md](./swiss-design-language.md) | 瑞士风格视觉规格 | `design/swiss` 分支；main 仍是 Hallmark 编辑风 |

## 草稿（未实现）

| 文档 | 内容 |
|------|------|
| [record-design.md](./record-design.md) | 记录模块（task→plan→record 三层数据模型） |
| [life.md](./life.md) | 记录生活的数据模型推演 |

## 调研

| 文档 | 内容 |
|------|------|
| [kumo-design-language.md](./kumo-design-language.md) | Kumo 设计语言研究；组件曾在 31ffdb3d 收编，7c0b8d54（2026-10-18）已从 main 移除，只作研究保留 |

## 已取代 / 归档

| 文档 | 取代者 |
|------|--------|
| [archive/media-design.md](./archive/media-design.md) | [file-service.md](./file-service.md)（v15 删表） |
| [archive/task.md](./archive/task.md) | [task-ux/](./task-ux/)（旧 time_window/多时间窗模型） |
| [archive/task-system.md](./archive/task-system.md) | [task-ux/](./task-ux/)（旧 task_time_allocation 模型） |
| [archive/time-management.md](./archive/time-management.md) | [task-ux/](./task-ux/)（task_block / calendar_event） |
| [archive/swiss-design-language-2026-10-02.md](./archive/swiss-design-language-2026-10-02.md) | [swiss-design-language.md](./swiss-design-language.md)（历史快照） |
