# DbViewer 数据库查看器 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/db` | 表名列表 | 管理员 |
| GET | `/api/db/{table_name}` | 表数据（分页） | 管理员 |

## 前端 API

`web/src/apis/dbApi.ts`：

- `getTablesE()` → `string[]`（缓存）
- `getTableDataE(name, {page?, page_size?})` → `{ header, rows }`

## 前端页面

`web/src/pages/DbViewer.tsx` — 管理员数据库浏览

## UX 评估

### ✅ 做得好的

1. **安全性** — 双层认证：auth + require_admin
2. **表名白名单** — `sanitize_table_name()` 防止 SQL 注入
3. **分页支持** — 前端可控制 page/page_size
4. **动态列名** — 接口返回 `header + rows`，前端渲染任何表

### ⚠️ 可改进

| 问题 | 建议 |
|---|---|
| **无行详情** | 点击行无弹出详情/编辑界面 |
| **无排序** | 不能按列排序，默认按主键 |
| **无搜索/过滤** | 不能按条件过滤行 |
| **无写操作** | 只能查看，无法编辑/删除数据（设计如此，对管理员安全） |
| **表名列表无元信息** | `GET /db` 只返回名字数组，无行数/描述 |
| **前端缓存无失效** | 修改数据后表数据不会刷新 |
| **大表性能** | 没有行数限制提示，点开大表可能很慢 |
