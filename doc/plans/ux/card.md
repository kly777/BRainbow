# Card 模块 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/cards` | 分页列表 | 需登录 |
| POST | `/api/cards` | 创建 | 需登录 |
| GET | `/api/cards/{id}` | 单张详情 | 需登录 |
| PATCH | `/api/cards/{id}` | 更新 | 需登录 |
| DELETE | `/api/cards/{id}` | 删除 | 需登录 |
| GET | `/api/cards/search?q=` | 搜索 | 需登录 |

## 前端 API

`web/src/apis/cardApi.ts`:

- `getCardsE()` → `PaginatedCards`
- `getCardE(id)` → `Card`（缓存 60s）
- `createCardE(CreateCardRequest)` → `Card`
- `updateCardE(id, UpdateCardRequest)` → `Card`
- `deleteCardE(id)` → `void`
- `searchCardsE(query)` → `PaginatedCards`

## 前端页面

`web/src/pages/card/` — CardsList + CardDetail + CardEdit

## UX 评估

### ✅ 做得好的

1. **明确的类型体系** — `Card`、`CreateCardRequest`、`UpdateCardRequest`、`PaginatedCards` 都定义在 `types/` 中
2. **搜素专用端点** — `/cards/search?q=` 而不是客户端过滤
3. **缓存策略合理** — 列表 30s，详情 60s，搜索不缓存
4. **`tapInvalidate` 模式** — 增删改后自动失效缓存

### ⚠️ 可改进

| 问题 | 建议 |
|---|---|
| **分页参数不可调** | `getCardsE()` 无 `page`/`page_size` 参数，前端拿不到控制权 |
| **搜索参数单薄** | 只有 `q`，不支持按 user_id / created_at 范围/状态过滤 |
| **无批量操作** | 没有批量删除/移动的端点 |
| **列表默认大小未暴露** | 后端硬编码默认值，前端无法自定义 |
| **卡片无标签/分类** | content 是纯文本，无结构化元数据 |
