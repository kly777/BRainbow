# Sign 能指/所指模块 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/sign` | 列表 | 需登录 |
| POST | `/api/sign` | 创建 | 需登录 |
| GET | `/api/sign/{id}` | 详情 | 需登录 |
| DELETE | `/api/sign/{id}` | 删除 | 需登录 |
| GET | `/api/sign/signifier/{signifier}` | 按能指查询 | 需登录 |
| GET | `/api/sign/signified/{signified}` | 按所指查询 | 需登录 |

## 前端 API

`web/src/apis/signApi.ts`:

- `getSignsE()` → `Sign[]`（缓存 60s，自动解包 `.items`）
- `getSignE(id)` → `Sign`（缓存 60s）
- `createSignE({signifier, signified, onto_id?, weight?, relation_type?})` → `Sign`
- `deleteSignE(id)` → `void`
- `getSignsBySignifierE(signifier)` → `Sign[]`（缓存 60s）
- `getSignsBySignifiedE(signified)` → `Sign[]`（缓存 60s）

## 前端页面

集成在 OntologyList 中（作为子组件/区域）

## UX 评估

### ✅ 做得好的

1. **两个查询端点** — 按能指/所指分别查，覆盖了主要使用场景
2. **创建参数灵活** — 除 signifier/signified 外都是可选，降低使用门槛
3. **前端自动解包** — 同 onto，组件无需关心分页结构

### ⚠️ 可改进

| 问题 | 建议 |
|---|---|
| **无更新 API** | 没有 `PATCH /api/sign/{id}`，创建后无法修改，只能删了重建 |
| **无分页** | 列表无分页，sign 多时可能性能问题 |
| **创建时未返回完整对象** | 需要验证返回是否包含所有字段 |
| **前端无独立管理页** | sign 只能在本体页面中附带管理，没有独立列表/搜索页 |
| **signifier/signified URI 编码** | 路径参数含特殊字符可能有问题（已用 `encodeURIComponent` 处理 ✅） |
