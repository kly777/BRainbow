# Media 媒体模块 UX 审计

## 后端路由

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/media` | 分页列表 | 需登录 |
| POST | `/api/media/upload` | 上传文件 | 需登录 |
| GET | `/api/media/{stored_id}` | 详情 | 需登录 |
| PATCH | `/api/media/{stored_id}` | 重命名 | 需登录 |
| DELETE | `/api/media/{stored_id}` | 删除 | 需登录 |
| GET | `/api/media/{stored_id}/file` | 文件下载 | 公开 |

## 前端 API

`web/src/apis/mediaApi.ts`：

- `uploadMedia(file)` — 用 FormData 上传，手动处理 token
- `listMediaE({media_type?, page?, page_size?})` → `PaginatedMedia`（缓存 30s）
- `getMediaE(stored_id)` → `MediaItem`（缓存 60s）
- `renameMediaE(stored_id, original_name)` → `MediaItem`
- `deleteMediaE(stored_id)` → `void`

## 前端页面

`web/src/pages/media/` — MediaList

## UX 评估

### ✅ 做得好的

1. **分页支持** — `listMediaE` 接受完整的分页参数
2. **类型筛选** — 可按 `media_type` 过滤（image/video/audio）
3. **文件路由公开** — `/api/media/{id}/file` 无需登录，方便嵌入 Markdown/HTML
4. **错误处理完善** — `uploadMedia` 有专门的 `extractError` 和 `HttpError`/`NetworkError`

### ⚠️ 可改进

| 问题 | 建议 |
|---|---|
| **上传 API 未走统一 request 函数** | `uploadMedia` 自己拼 fetch，没有用 `request.ts`，重复了 token/错误处理逻辑 |
| **上传 API 路径硬编码** | `fetch("/api/media/upload")` 而非用 `API_BASE_URL` 变量 |
| **FormData 时手动设 Content-Type** | fetch 自动处理 multipart boundary，但 `buildHeaders` 会覆盖为 `application/json`，所以要手动处理 headers — 逻辑分散 |
| **无批量操作** | 无法批量删除/移动 |
| **无上传进度** | 大文件上传没有进度指示 |
| **重命名端点路径参数用 stored_id** | ✅ 合理，但 URL 中含 UUID 较长 |
| **前端接口命名不统一** | `listMediaE` vs `uploadMedia`（没有 `E` 后缀）|
