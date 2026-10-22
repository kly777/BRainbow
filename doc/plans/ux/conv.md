# Conv 对话搜索模块 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/conv/search` | 搜索对话 | 公开 |
| GET | `/api/conv/{id}` | 对话详情 | 公开 |
| GET | `/api/conv/qa/{id}` | QA 详情 | 公开 |
| GET | `/api/conv/concept/{id}` | 概念详情 | 公开 |

## 前端 API

**不存在**。前端页面直接导入 handler/页面组件，没有经过 API 抽象层。

## 前端页面

- `ConvSearch.tsx` — 对话搜索
- `ConvDetail.tsx` — 对话详情
- `ConvQa.tsx` — QA 详情
- `ConvConcept.tsx` — 概念详情

## UX 评估

### ✅ 做得好的

1. **公开访问** — 所有路由无需登录
2. **三个详情视图** — 根据内容类型提供不同展示

### ⚠️ 可改进

| 问题 | 严重程度 | 建议 |
|---|---|---|
| **无前端 API 层** | 🔴 **严重** | 页面直接与后端交互，没有 `convApi.ts`，无法享受缓存、错误统一处理、`tapInvalidate` |
| **搜索参数不清晰** | 🟡 | `GET /api/conv/search` 的查询参数（q? type?）需要检查 handler |
| **无分页** | 🟡 | 搜索没有分页参数，结果多时可能截断 |
| **路由在公开层且无认证** | 🟡 | 对话数据可能包含敏感信息 |
| **前端页面不在 router nav 中？** | 🟡 | ConvSearch 在导航中，但详情页面通过路由参数跳转 |
