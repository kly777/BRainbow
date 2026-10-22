# `/api/media` 统一媒体管理 — 设计方案

> 状态：已取代（归档） · 取代者：[`file-service.md`](../file-service.md)（media 模块与 `media` 表在 v15 删除，由通用文件服务接管） · 归档日期：2026-10-22
>
> 本文留作"当初为什么这么做"的记录：其中的端点、表名、模块路径都不再存在，
> **不要当现状读，也别照它写代码**。
> 当时状态：已定稿（当时） · 目标：用统一接口替换 `/api/images`，支持图片、视频、音频

---

## 1. 安全与可靠性（硬约束）

### 1.1 文件服务防 XSS

`/uploads/` 不走 `ServeDir`，改为 `GET /api/media/{stored_id}/file` handler。

**安全**：所有文件响应强制 `X-Content-Type-Options: nosniff`。

**体验**：返回正确 `Content-Type`（`video/mp4` 而非 `application/octet-stream`），让 `<video>` / `<audio>` 标签能原生播放。

SVG 仍设 `Content-Disposition: attachment` 阻止浏览器解析执行（`nosniff` 对 SVG 无效）。

**缓存**：`Cache-Control: public, max-age=31536000, immutable`。

### 1.2 上传写入竞态

先写临时文件，DB 插入成功后原子重命名：

```
1. 保存到 `uploads/{media_type}/tmp_{random}.tmp`
2. INSERT INTO media                    ← 写数据库
3. rename 到 `uploads/{media_type}/{stored_id}`
```

回滚：第 1 步失败直接返回错误；第 2 步失败则删除临时文件；第 3 步失败记录 ERROR 日志。

**启动清理**：扫描 `uploads/*/tmp_*.tmp` 并删除。

### 1.3 删除顺序

```
1. DELETE FROM media WHERE stored_id = ?  → 先删记录
2. std::fs::remove_file(path)             → 再删文件（失败仅 WARN）
```

### 1.4 original_name 长度限制

截断到 255 字符，全是不可见字符时回退 `"unnamed"`。

### 1.5 MIME 真实校验

不信任客户端声明的 `Content-Type`。上传时用 `infer` crate 读取文件头魔数，获取真实 MIME 后与白名单比对。MIME 不匹配或不在白名单 → 拒绝上传。

### 1.6 流式上传

大文件（视频 200MB）不能用 `multipart.bytes()` 全读入内存。使用 axum `Body::into_data_stream()` 边读边写磁盘，避免 OOM。

---

## 2. 数据库

### 2.1 新表 `media`

```sql
CREATE TABLE media (
    id              INTEGER PRIMARY KEY,
    stored_id       TEXT    NOT NULL UNIQUE,   -- NanoID 12位, e.g. "x7f4p2a9k3m"
    original_name   TEXT    NOT NULL,
    media_type      TEXT    NOT NULL CHECK(media_type IN ('image', 'video', 'audio')),
    mime_type       TEXT    NOT NULL,
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    width           INTEGER,
    height          INTEGER,
    duration_ms     INTEGER,
    user_id         INTEGER,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES user(id)
);

CREATE INDEX idx_media_type_created ON media(media_type, created_at DESC);
CREATE INDEX idx_media_stored_id ON media(stored_id);
```

### 2.2 文件路径

按 `media_type` 分目录：

```
uploads/image/x7f4p2a9k3m
uploads/video/m3n8b1v5c2q
```

Handler 拼接：`uploads/{media_type}/{stored_id}`。临时文件同目录，rename 原子。

### 2.3 迁移

```sql
DROP TABLE image;
```

---

## 3. 允许的媒体类型

| 类别 | MIME | 大小上限 |
|------|------|----------|
| image | `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `image/bmp`, `image/tiff` | 10 MB |
| video | `video/mp4`, `video/webm`, `video/ogg`, `video/quicktime` | 200 MB |
| audio | `audio/mpeg`, `audio/ogg`, `audio/wav`, `audio/webm`, `audio/flac`, `audio/aac` | 50 MB |

---

## 4. 元数据提取

解析失败不阻塞上传——字段留 NULL，仅 WARN 日志。

| 类型 | 提取内容 | 工具 |
|------|---------|------|
| image | width, height | `image` crate `image_dimensions()` — 纯 Rust，只读头 |
| video | width, height, duration_ms | 首版留 NULL |
| audio | duration_ms | 首版留 NULL |

---

## 5. API

所有端点挂载在 `/api/media`，需登录。

### `POST /api/media/upload`

请求：`multipart/form-data`，字段名 `file`

响应 `201`：

```json
{
  "stored_id": "x7f4p2a9k3m",
  "url": "/api/media/x7f4p2a9k3m/file",
  "original_name": "我的演示视频.mp4",
  "media_type": "video",
  "mime_type": "video/mp4",
  "size_bytes": 5242880,
  "width": null,
  "height": null,
  "duration_ms": null,
  "created_at": "2026-06-19T10:00:00Z"
}
```

### `GET /api/media`

Query：`page`, `page_size`, `media_type`

响应 `200`：分页列表。

### `GET /api/media/{stored_id}`

响应 `200`：单条。

### `GET /api/media/{stored_id}/file`

Handler 读取文件返回，设置 `Content-Type`、`Content-Disposition`、`Cache-Control`。

### `PATCH /api/media/{stored_id}`

```json
{ "original_name": "new-name.mp4" }
```

### `DELETE /api/media/{stored_id}`

先删库，后删文件。

---

## 6. 后端模块

```
src/modules/media/
├── mod.rs          # routes() + file serving handler
├── model.rs        # Media struct, MediaType enum
├── handler.rs      # upload / list / get / rename / delete / serve_file
├── repository.rs   # SQL
└── service.rs      # 业务流程 + 元数据解析
```

路由：

```rust
// src/routes/api.rs — authed 组内
.nest("/media", media::routes())
```

移除 `/uploads/` 的 `ServeDir`。

---

## 7. 前端变更

### 7.1 新增

```
web/src/apis/mediaApi.ts
web/src/pages/media/MediaList.tsx
```

### 7.2 删除

```
web/src/apis/imageApi.ts
web/src/pages/image/ImagesList.tsx
web/src/pages/image/ImagesList.module.css
```

### 7.3 修改

| 文件 | 变更 |
|------|------|
| `CardEdit.tsx` | `uploadImage` → `uploadMedia` |
| `routes.ts` | `/i` → `pages/media/MediaList.tsx` |

### 7.4 类型

```ts
type MediaType = "image" | "video" | "audio";

interface MediaItem {
  stored_id: string;      // "x7f4p2a9k3m"
  url: string;            // "/api/media/x7f4p2a9k3m/file"
  original_name: string;
  media_type: MediaType;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: string;
}
```

---

## 8. 实施顺序

1. 删 `image` 表 + 建 `media` 表
2. 实现 `modules/media/` 模块
3. 路由注册 + 移除 `/uploads/` ServeDir
4. `mediaApi.ts` + `MediaList.tsx`
5. 更新 `CardEdit.tsx`
6. 删除旧文件
