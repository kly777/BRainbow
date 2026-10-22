# Text 文本编辑器模块 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/text` | 读取所有标签 | 公开 |
| PUT | `/api/text` | 保存所有标签 | 公开 |

## 前端 API

`web/src/apis/textApi.ts`：

- `loadTextE()` → `{ tabs: { name, content }[] }`（缓存）
- `saveTextE(tabs)` → `{ ok: boolean }`

## 前端页面

`web/src/pages/TextEditor.tsx` — 多标签纯文本编辑器

## UX 评估

### ✅ 做得好的

1. **极简设计** — GET/PUT 两个端点，读写清晰
2. **多标签支持** — 一次返回/保存所有 tab，减少请求次数
3. **公开访问** — 无需登录，打开即用

### ⚠️ 可改进

| 问题 | 建议 |
|---|---|
| **无单标签操作** | 编辑一个标签必须全部保存，并发冲突风险 |
| **无版本历史** | 每次保存覆盖，无法回滚 |
| **无标签管理** | 无法创建/删除/重命名标签（只能通过 content 带）|
| **公开无认证** | 任何人都可以读写，数据安全性低 |
| **缓存策略无失效** | `loadTextE` 用 `cachedRequest` 但 `saveTextE` 返回后没有调 `tapInvalidate` |
| **数据模型简单** | 只有 `name` + `content`，无 `created_at` / `updated_at` |
