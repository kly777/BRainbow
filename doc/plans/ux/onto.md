# Onto 本体模块 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/onto` | 列表 | 需登录 |
| POST | `/api/onto` | 创建 | 需登录 |
| GET | `/api/onto/{id}` | 详情 | 需登录 |
| PATCH | `/api/onto/{id}` | 更新 | 需登录 |
| DELETE | `/api/onto/{id}` | 删除 | 需登录 |

## 前端 API

`web/src/apis/ontoApi.ts`:

- `getOntosE()` → `Onto[]`（缓存 60s，自动提取 `.items`）
- `getOntoE(id)` → `Onto`（缓存 60s）
- `createOntoE(name, description?)` → `Onto`
- `updateOntoE(id, {name?, description?})` → `Onto`
- `deleteOntoE(id)` → `void`

## 前端页面

`web/src/pages/ontology/` — OntologyList

## UX 评估

### ✅ 做得好的

1. **API 简洁** — 标准 CRUD，参数少而清晰
2. **前端自动解包** — `getOntosE` 的 `.then(r => r.items)` 让组件直接拿数组
3. **缓存策略合理** — 本体不常变，60s 缓存合适

### ⚠️ 可改进

| 问题 | 建议 |
|---|---|
| **无搜索** | 没有 `GET /api/onto/search?q=`，本体多时无法过滤 |
| **无分页** | 列表无分页参数，数据多了前端卡顿 |
| **创建/更新返回全部字段** | ✅ 这其实是好的，让前端拿到完整对象 |
| **无本体间关系** | 本体之间无关联/层级，只有 flat 列表 |
| **关联的 sign 不在本体详情中返回** | 查看本体时不知道有哪些 sign 属于它 |
