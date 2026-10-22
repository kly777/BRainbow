# 通用文件服务 — 设计方案

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22
>
> 目标（已达成）：取代 `media` 模块，提供统一的文件存储/检索服务，支持所有常见文件类型
> （`media` 模块与表都已删除）。

---

## 1. 核心理念

- 文件 ID 是唯一标识，URL 中的 filename 仅服务人类可读性
- 通过标签和 KV 元信息实现灵活分类与检索
- 安全第一：MIME 校验、nosniff、防 XSS

---

## 1.1 可见性模型（v18 引入，现行）

**默认公开**：所有文件对任何访问者可见（含未登录的 `<img>` 内嵌请求），单个文件可**设为私密**。

| 操作 | 公开文件 | 私密文件 |
|---|---|---|
| 列表 / 搜索 / 标签计数 / 统计 | 所有登录用户（这几条路由在认证组内） | 上传者与 admin |
| 详情 `GET /api/file/{stored_id}` | 所有登录用户 | 上传者与 admin；他人按 404 处理，不暴露存在性 |
| 内容 `GET /api/file/{stored_id}/data/{name}` | **无需凭据** | 需 JWT/API Key 且为上传者（或 admin）：未认证 401、越权 404 |
| 改名 / 改标签 / 切换可见性 / 删除 | 上传者与 admin（越权 404） | 上传者与 admin（越权 404） |
| 缓存指令 | `private, max-age=86400` | `private, max-age=86400` |

- **无主行（`user_id IS NULL`）只有 admin 看得见、改得动**：v20 把历史行认领给了当前 admin，
  "匿名老文件视为公共资源、任何登录用户可整理"那条**已作废**（fail-closed，见
  `query::ownerless_files_are_admin_only`）。无主行仍不能设为私密 —— 没有"对应的人"可授权。
- 未登录（游客）= 只看公开文件（且只走得到内容 / 预览 / 缩略图三条公开路由）
- 标签全局共享（同名只有一个，`user_id` 仅记录创建者），改/删/合并任何登录用户可做
- 规则集中三处，改一处要同步其余：`repository::push_visibility`（SQL）、`query::is_visible`（详情/搜索）、`query::content_access`（内容路由三态）—— 缩略图与预览路由复用 `handler::check_content_access`（内部就是 `content_access`）
- "公开可读 ≠ 谁都能改"：写路径的判据是 `service::ensure_can_mutate`（`Actor::can_write`，越权 404），
  与 `is_private` 无关

## 2. 数据库

### 2.1 表结构

声明在 `crates/db/src/schema/tables.rs`（下面只摘与本文相关的列；改 schema 的流程见
`doc/guides/database.md`）。

```sql
-- 文件主表
CREATE TABLE IF NOT EXISTS file (
    id            INTEGER PRIMARY KEY,
    stored_id     TEXT    NOT NULL UNIQUE,        -- NanoID 12 位（磁盘上的文件名）
    original_name TEXT    NOT NULL,               -- 原始文件名
    mime_type     TEXT    NOT NULL,               -- 真实 MIME（判定见 §3.1）
    category      TEXT    GENERATED ALWAYS AS (… ) VIRTUAL,
                  -- v19 生成列：image/video/audio/document/other，规则 = FileCategory::from_mime
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    content_hash  TEXT,                           -- 内容 SHA-256（全局去重键，可空）
    text_content  TEXT,                           -- 抽出的可搜索正文：NULL=没抽过，''=抽过但没文字
    width         INTEGER,                        -- 图片/视频宽度
    height        INTEGER,                        -- 图片/视频高度
    duration_ms   INTEGER,                        -- 音频/视频时长
    user_id       INTEGER,
    is_private    INTEGER NOT NULL DEFAULT 0,     -- 0 = 公开（默认）；1 = 私密
    created_at    TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
    updated_at    TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
    FOREIGN KEY (user_id) REFERENCES user(id)
);

-- 文件标签表
CREATE TABLE file_tag (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT    NOT NULL,
    user_id INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user(id),
    UNIQUE(name, user_id)
);

-- 文件-标签关联表
CREATE TABLE file_tag_rel (
    file_id INTEGER NOT NULL,
    tag_id  INTEGER NOT NULL,
    PRIMARY KEY (file_id, tag_id),
    FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)  REFERENCES file_tag(id) ON DELETE CASCADE
);

-- 文件元信息（KV 存储，灵活扩展）
CREATE TABLE file_meta (
    file_id INTEGER NOT NULL,
    key     TEXT    NOT NULL,
    value   TEXT    NOT NULL,
    PRIMARY KEY (file_id, key),
    FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_file_created ON file(created_at DESC);
CREATE INDEX idx_file_category ON file(category, created_at DESC);
CREATE INDEX idx_file_visibility ON file(is_private, created_at DESC);  -- 公开列表走它
CREATE UNIQUE INDEX idx_file_content_hash_unique
    ON file(content_hash) WHERE content_hash IS NOT NULL;                -- 内容去重（全局）
CREATE UNIQUE INDEX idx_file_tag_name_unique ON file_tag(name);           -- 标签全局共享
CREATE INDEX idx_file_tag_rel_tag ON file_tag_rel(tag_id);
-- stored_id 的 UNIQUE 约束已隐含索引，不再另建 idx_file_stored_id
```

> 跨列的事实：`category` 是**生成列**（v19 起），所以老库补列时表达式要一起带过去
> （`Decl::generated` 里登记了一份，`consistency.rs` 的
> `generated_category_matches_rust_rules` 钉住它与 `FileCategory::from_mime` 一致）。
> `file_tag` 上的 `UNIQUE(name, user_id)` 还在，但真正生效的是全库唯一的
> `idx_file_tag_name_unique`（同名标签全库只有一条，`user_id` 只记创建者）。

### 2.2 文件路径

扁平目录：`{UPLOAD_DIR}/file/{stored_id}`（默认 `uploads/file/{stored_id}`）。
目录从 `Config::file_upload_dir()` 派生，**不要在任何地方硬编码 `uploads/file`** ——
改了 `UPLOAD_DIR` 而读路径没跟着走，就是"上传成功、下载全 404"。

### 2.3 迁移

- 新建 `file`、`file_tag`、`file_tag_rel`、`file_meta` 四张表
- 删除旧 `media` 表（`legacy.rs` 里登记为 v15 退役的废弃对象）

---

## 3. 文件类别与 MIME 白名单

**"白名单"就是 `kind.rs` 的 KINDS 表里的精确行**（没有单独的 MIME 常量表）：它决定
**上限档与全部能力**（缩略图 / 预览 / 内联 / 正文抽取），**不再决定类别** ——
类别唯一口径是 `FileCategory::from_mime`（见 §3.1 末）。**表外的格式不拒绝**，
一律落到兜底行、归入 `other` 并按兜底上限接收（3D 模型 `.ply`/`.stl`、设计稿 `.psd`、
压缩包 `.zip` 等都要能存，否则模块失去「通用文件服务」的意义）。

| 上限档（`kind::Tier`） | MIME（精确行） | 单文件上限 |
|------|----------|-----------|
| image | image/png, image/jpeg, image/gif, image/webp, image/bmp, image/tiff | 200 MB |
| svg | image/svg+xml（无魔数，见下方等价规则） | 20 MB |
| `fallback`（也是视频档） | video/mp4, video/webm, video/ogg, video/quicktime | 4 GB |
| audio | audio/mpeg, audio/ogg, audio/wav, audio/webm, audio/flac, audio/aac | 1 GB |
| document | application/pdf, text/plain, text/html, text/csv, text/markdown, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.openxmlformats-officedocument.presentationml.presentation | 500 MB |
| `fallback` | application/epub+zip（归"其他"类别，但服务端按书解析） | 4 GB |
| `fallback` | 其余全部（含 `application/octet-stream`、压缩包、3D 模型、设计稿…） | 4 GB |

上限写在 `limits.rs` 的分档常量里（`IMAGE_MAX_SIZE` / `SVG_MAX_SIZE` /
`AUDIO_MAX_SIZE` / `DOCUMENT_MAX_SIZE` / `FALLBACK_MAX_SIZE`，唯一算数的地方是
`limits::tier_bytes`），类型 → 档的映射只在 `kind.rs`；闸门是
`limits::ensure_within_limit`（纯函数，便于单测覆盖边界，不必造 GB 级缓冲区）；
请求体上限 `UPLOAD_BODY_LIMIT_BYTES` = 最大单文件 4 GB + 64 MB 开销，
有测试钉住「body 上限必须大于白名单内最大文件」。

分档只保留**客户端侧有理由**的收紧：上传与下载全程流式（handler 边读边写临时文件、
内容路由走 `ReaderStream`），服务端内存不随文件大小增长，图片档压到 200 MB 是因为
浏览器要整张解码，SVG 压到 20 MB 是因为它是浏览器要解析的 XML 文本。
**注意上传链路上的外部天花板**：站点经 Cloudflare 代理时，请求体上限由 CF 套餐决定
（Free/Pro 100 MB、Business 200 MB、Enterprise 500 MB 起），超限在边缘直接 413，
后端放多宽都到不了 —— 要真传几百 MB 以上，需让该域名的 DNS 记录走 DNS-only（灰云）
直连源站，或改用直连端口上传。

### 3.1 类型识别：先定族，再定种（`mime::resolve_mime`）

魔数只能可靠地回答"这是哪个**容器/家族**"，回答不了"最终是什么格式"：
`PK\x03\x04` 是 zip，但 docx / xlsx / pptx / epub / jar 全是 zip；RIFF 下分
WAV / WEBP / AVI；ISO BMFF 的 `ftyp` 下分 MP4 / MOV / M4A / HEIC / AVIF；
文本族干脆没有魔数。所以判定分两阶段：

```
阶段一 detect_family(head) -> FileFamily      内容定族（几乎不会错）
阶段二 refine_*(族, 结构标记, 扩展名, 声明)     族内定种（产出规范 MIME）
```

**这个分层的价值是误差可控**：族判对了，种就算认错也只在同族内错（把 MOV 认成 MP4），
不会把 zip 认成图片。扩展名从"可信来源"降级成"**族内消歧的提示**"，伪造后缀骗不过族检测；
规范化发生在各族 `refine_*` 的输出端，所以别名（`audio/x-wav`、`application/epub`…）
要么在入口被 `normalize_mime` 收敛，要么根本不会从 `refine_*` 吐出来。

| 族（内容判定） | 判定依据 | 族内定种依据 |
|---|---|---|
| Zip | `PK\x03\x04` | 头部阶段：epub 的 `mimetype` 条目 / OOXML 的 `[Content_Types].xml` → 声明 → 扩展名；**落盘后**由中央目录定种：`word/`→docx、`xl/`→xlsx、`ppt/`→pptx、`AndroidManifest.xml`→apk、`META-INF/MANIFEST.MF`→jar、`mimetype`→epub，都不认识才存 `application/zip` |
| Riff | `RIFF` | 偏移 8 的四字符码：`WAVE` / `WEBP` / `AVI ` |
| IsoBmff | 偏移 4 是 `ftyp`/`moov`/`mdat` | `ftyp` 的 brand：`qt  `→MOV、`M4A `→audio/mp4、`heic`/`avif`→图片，其余按 MP4 |
| Ogg | `OggS` | 首个 Ogg 页含 `theora` → video/ogg，否则 audio/ogg |
| Matroska | `1A 45 DF A3` | EBML 头的 DocType：`webm` / `matroska` |
| Ole | `D0 CF 11 E0 A1 B1 1A E1` | 结构分不出 doc/xls/ppt → 声明 > 扩展名 > 容器名 |
| 单签名族 | PNG / JPEG / GIF / BMP / TIFF / PDF / MP3 / FLAC / AAC / SQLite | 一种魔数一种格式，无需精炼 |
| Text | 见 `looks_like_text` | **根元素**是 `<svg` → SVG；否则扩展名给 md/csv/html，其余 `text/plain` |
| Unknown | 都不匹配 | `application/octet-stream`（或保留白名单外的声明） |

**"这种类型能干什么"只在 `kind.rs` 的 KINDS 表里定义一处**（2026-09 从各模块的
`matches!` 收敛过来）：一张声明式表，字段为 `limit`（上限档）、`thumb`（缩略图策略）、
`preview`（预览解析器）、`inline`（内联策略）、`text`（正文抽取策略，2026-10 加的第五列）；
行分三种 —— **精确 MIME**、**家族模式**（`image/*`）、**兜底行**（`*`），`kind_of`
精确优先、永不返回 `None`。**五个消费者**（`limits::limit_of`、
`thumb::{can_generate,source_of}`、`content::can_inline`、`preview::preview_kind_for` /
`preview::kind_for_mime`、`extract::parse_budget`）都只查这张表，不再各自判断。

"已知类型"的口径 = 表里的精确行（`kind::listed_mimes()`，家族模式与兜底行不算）。
压缩包 / 数据库的预览**不在表里**：它们的 MIME 不稳定，只能按内容嗅探
（`preview::sniff_container`），这是表之外唯一一处判据。

两条容易踩的边界：**上限只认精确行** —— 家族模式只补能力，`image/avif` 这类白名单外
的成员仍走 `other` 档（4 GiB），要改这个口径得有意识地改；**类别不在表里** ——
`FileCategory::from_mime` 是唯一口径（DB 生成列照它，`consistency.rs` 钉住），
表里放一份会立刻多出一个真相源。压缩包与数据库的预览也不在表里：它们的 MIME 不稳定，
只能按内容嗅探（`preview_kind_for` 的第二遍）。

**"是不是文本"由字节判定，不由 MIME 注册表判定**（`looks_like_text`）：头部样本无 NUL、
非文本控制字符（除 `\t\n\r\f\v`）占比 ≤5% 就算文本；UTF-16 由 BOM 或"NUL 只在固定一侧"
识别。判据与前端 `web/src/platform/file/model/magic.ts` 的 `looksTextual` 同一套，两侧同步。
早先拿 `mime_guess` 把扩展名映射成 MIME、再按 `text/` 前缀判文本，于是 `.json`
（`application/json`）、`.ts`（`video/vnd.dlna.mpeg-tts`，**TypeScript 与 MPEG-TS 撞名**）、
`.java`（`application/octet-stream`）、`.go` / `.vue` / `Dockerfile`（表里根本没有）
全被判成二进制，掉进十六进制预览。**`mime_guess` 已从依赖里删除**，不再有第二张表。

文本的**具体**类型只由扩展名给（`text_ext_mime`）：`md`/`csv`/`html` 三种有专用渲染，
其余一切文本都是 `text/plain`，高亮语言由前端按扩展名挑（`filename.ts` 的 `codeLang`）。

**声明的两道闸门**（声明不再单独决定类型，只在族内消歧）：

- **闸门一**：声明了白名单里"本有魔数"的类型（`family_of_mime`）却验不出对应族 → 拒绝。
  这是"任意内容冒充图片/视频"的挡板（内容认不出族时报"无法识别"，认出别的族时报"类型不符"）。
- **闸门二**：内容认不出族（Unknown）却声明 `text/*` / `pdf` / `svg` → 归
  `application/octet-stream`（交给十六进制查看器，比按声明渲染一屏乱码诚实）。
  **族认得出来时以字节为准**，不因声明是文本就降级 —— 于是"图片被存成 `.txt`"这种
  真实场景会得到 `image/png`，而不是早先的"文件类型不符"拒收。

客户端**没表态**（空声明或 `application/octet-stream`）时一律以字节为准：浏览器对
`.sqlite` / `.7z` 这类扩展名报的就是这两种（`infer` 认得 `application/vnd.sqlite3`，
按"声明与内容不符"拒收会把这些文件全挡在门外）。

**SVG 的双 MIME 报告**：SVG 是 XML 文本，没有魔数，而"这是 SVG"由**内容**说了算 ——
判据是**根元素**：跳过 BOM、前导空白、XML 声明、DOCTYPE、注释之后，内容必须以 `<svg`
开头（后随空白、`>` 或 `/`）。**不是"出现过 `<svg`"**：老判据是子串匹配、扫的还是上传时
的第一个 multipart 块（几 KB），于是任何带内联 `<svg>` 图标的 HTML（现代网页的常态）
都被判成 `image/svg+xml`，连扩展名给的 `text/html` 一并覆盖 —— 真实事故是一篇 SingleFile
保存的博客文章在库里成了 `image/svg+xml`，缩略图与预览全坏（`html_with_inline_svg_stays_html`
是这条的回归测试）。SVG 归 `image` 类别便于当图片预览/嵌入，但响应始终 `attachment`
（防直接访问时执行脚本），`<img>` 子资源加载不受影响。

**判据一律按字节，不按字符下标切**：头部是 512 字节的窗口，会切在多字节字符中间，
而"跳过 BOM / 空白 / 序言"这段要在任意文本上做定长比较 —— 用 `&str` 的定长下标
切片会在中文内容上 panic（真实事故：`# 二次型考法总结` 的第 9 字节落在"型"里，
`rest[..9]` 当场 panic；后端任务随之把连接丢掉，浏览器只看到代理编的 `502`
Bad Gateway，磁盘上留一个 0 字节 tmp 文件，从报错反查要重走整条上传链路）。
现在比较走 `as_bytes().get(..n)`、切分走 `split_once`，`mime.rs` 顶部还有一道
模块级 `deny(clippy::string_slice)` 挡着这类写法回来；`looks_like_svg_survives_multibyte_and_truncated_heads`
把每个字节切点都扫一遍。

**类型判定改了之后，旧记录怎么跟上**：`service::reconcile_mime` —— 上传命中去重
（内容 SHA-256 相同）时按**当前**判定纠正已有记录的 `mime_type`（`repository::update_mime`
只改这一列、**不动 `updated_at`**；`category` 是生成列，跟着走）。所以修了判据不必写迁移
脚本：把那份文件重传一遍即可。去重本来会让"重传"变成只回旧记录、类型错着不动，这条把
它接上了（`duplicate_upload_reconciles_a_stale_mime` 钉住）。

**类别与上限**：类别**只看 MIME 族**，唯一来源是 `FileCategory::from_mime`（`model.rs`，
与 `db/schema/tables.rs` 里生成列的 CASE 表达式逐条对应，由 `consistency.rs` 的
`generated_category_matches_rust_rules` 钉住）；上限查 `limits::limit_of`，白名单外的行
一律走兜底档（4 GiB）。**KINDS 表里没有类别列**（放一份就会多出一个真相源）：
`known_types_have_the_expected_category` 反过来要求每个精确行的类别都由 `from_mime`
算得出来（唯一例外是 epub，它归"其他"但服务端按书解析）。早先类别读的是白名单自己的
类别列，于是白名单外的同族类型（`image/avif` 之类）被判成 `other`，图片尺寸提取被跳过 ——
同一个问题有三套答案。

MIME 别名：`audio/x-wav`/`audio/wave` → `audio/wav`，`audio/x-flac` → `audio/flac`，
`audio/opus` → `audio/ogg`，`image/jpg`/`image/pjpeg` → `image/jpeg`，
`image/x-png` → `image/png`，`image/x-ms-bmp` → `image/bmp`，`video/x-m4v` → `video/mp4`，
`application/epub` → `application/epub+zip`，`application/x-gzip` → `application/gzip`。
不做归一会导致「格式正确却传不上去」（`infer` 报 `audio/x-wav`、白名单收 `audio/wav`）。

**前端必须表态的地方**：`viewers/registry.test.ts` 直接解析后端的 `kind.rs`（KINDS 表的
精确行）并要求每个已知 MIME 在 `EXPECTED` 里有归属（查看器 id 或显式 `null`）；
`uploadLimits.test.ts` 解析 `limits.rs` 的分档常量做镜像。**加一个白名单格式 = 这两处都要改**，
漏改即挂测试。

---

## 4. 安全策略

### 4.1 文件服务防 XSS

- 所有响应强制 `X-Content-Type-Options: nosniff`
- 内联仅限 `image/*` `video/*` `audio/*` `application/pdf`；**其余一律 `attachment`**
  （含 HTML/SVG 与所有白名单外类型，浏览器只下载不解析）
- `Content-Disposition` 按 RFC 5987 输出：ASCII 回退名 + `filename*=UTF-8''…`，
  保证头值全 ASCII（中文名不会乱码也不会让响应头构造失败）

### 4.2 上传校验

**后端**（权威判定）：

- 类型判定 `mime::resolve_mime`（读头 **512 字节**定族 + 族内定种，见 §3.1；落盘后再由
  `refine_zip_by_structure` 按中央目录覆盖一次）。**不再走 `infer` crate** —— `infer`
  只剩书签 favicon 在用，"是不是文本"这类判断一律按字节自己做（§3.1 的那几条教训）
- 声明的两道闸门（§3.1）：声明了"本有魔数"的类型却验不出对应族 → 拒；
  认不出族却声明 `text/*` / pdf / svg → 归 `octet-stream`
- 大小限制（`limits::ensure_within_limit`，分档见 §3）

**前端**（上传前预校验，`web/src/platform/file/model/uploadLimits.ts`）：
空文件与超出该档上限的文件在本地就被拦下（拖入/粘贴/选择三个入口共用
`handleUploadFiles`），不占并发位也不发请求 —— 大文件传到一半才收 400 意味着
用户白等一次完整上传。被拦下的文件进上传面板、状态标「未上传」并给出具体原因。

前端那套数字是后端分档的**镜像**，两处必须同步：`uploadLimits.test.ts` 会直接读
`limits.rs` 比对档位数值与白名单 MIME（双向，漏改会挂测试）。判断原则是
**只拦明确超限的**，判不出类型按 `other` 档放行 —— 前端误判会直接挡住用户，
漏放最多让后端再拒一次。

### 4.3 上传写入竞态

1. 保存到 `{UPLOAD_DIR}/file/tmp_{random}.tmp`（`FileService::tmp_path`，handler 只流式写盘 + 算 SHA-256）
2. 结构精炼 → 内容去重（同哈希默认复用旧记录，`force` 跳过）→ INSERT INTO file
3. 原子 rename 到 `{UPLOAD_DIR}/file/{stored_id}`

### 4.4 删除顺序

1. 引用检查：`count_content_references`（4 张内容表 LIKE 扫 `stored_id`）；有引用回 409
   `RESOURCE_IN_USE`，客户端带 `?force=true` 二次确认才继续
2. DELETE FROM file（级联删除 tag_rel / meta）
3. 删除文件（失败仅 WARN）

可见性/归属检查在 1 之前（`ensure_can_mutate`，越权 404）。

---

## 5. API

### `POST /api/file/upload`

请求：`multipart/form-data`，字段名 `file`；query 参数 `tags`（JSON 数组字符串）、
`force=true`（跳过内容去重，强制新建副本）、`duration_ms`（客户端读到的媒体时长）。
请求体上限 `UPLOAD_BODY_LIMIT_BYTES`（4 GB + 64 MB）。

响应 `201`（`FileResponse` + `duplicate`，命中内容去重时 `duplicate=true` 且复用旧记录）：

```json
{
  "id": 1,
  "stored_id": "x7f4p2a9k3m",
  "url": "/api/file/x7f4p2a9k3m/data/%E6%8A%A5%E5%91%8A.pdf",
  "thumb_url": "/api/file/x7f4p2a9k3m/thumb",
  "original_name": "报告.pdf",
  "mime_type": "application/pdf",
  "file_category": "document",
  "size_bytes": 524288,
  "width": null,
  "height": null,
  "duration_ms": null,
  "content_hash": "…",
  "tags": ["项目文档"],
  "meta": {},
  "created_at": "2026-09-03T10:00:00+00:00",
  "updated_at": "2026-09-03T10:00:00+00:00",
  "missing": false,
  "is_private": false,
  "can_edit": true,
  "duplicate": false
}
```

`url` 里的文件名按 RFC 3986 百分号编码；`thumb_url` 只在"能出缩略图且内容还在"时给。

### `GET /api/file`

Query：`page`, `page_size`, `category`, `tag`, `q`（文件名**或正文**搜索）、
`sort`（created_at / name 的升降序）。**列表不带 `meta`**（只有详情带），
所以每条记录的 `meta` 字段缺省。

响应 `200`：分页列表。每条记录带 `missing` 字段（实时 stat 磁盘得出，不落库）：
`true` 表示记录还在、磁盘文件已丢失 —— 前端据此显示"文件缺失"标记而非破图；
文件放回上传目录后无需重扫即自动恢复为 `false`。

### `GET /api/file/{stored_id}`

响应 `200`：文件元信息（含标签、KV `meta`、`missing`、`is_private`、`can_edit`）。
路由参数是 `stored_id`（12 位 NanoID），不是自增 `id` —— 全模块一致。

### `GET /api/file/{stored_id}/data/{filename}`

文件内容，Content-Type 由真实 MIME 决定，filename 仅美化 URL。公开路由（不带凭据也服务
公开文件）；私密文件未认证 401、越权 404。支持单段 `Range`（见 §8.6），响应固定
`Cache-Control: private, max-age=86400` + `Accept-Ranges: bytes`。

### `GET /api/file/{stored_id}/thumb?w=320`

列表缩略图（派生文件，与内容路由同一套可见性：公开文件无需凭据，私密文件走
`content_access` 的三态）。`w` 走固定阶梯
**160 / 320 / 640 / 1280**（就近吸附，缺省 320；非法值退回 320 而不是 400 ——
`<img>` 破图比"给个近似宽度"糟）。缓存键用 `content_hash`（无哈希的存量记录退回
`stored_id`），产物落在 `{UPLOAD_DIR}/file/thumbs/{键}-{宽}.{jpg|png}`。

| 输入 | 出图方式 | 编码 |
|---|---|---|
| `image/png|jpeg|gif|webp|bmp` | 同进程 `image` crate（`thumb/image.rs`），`imageops::thumbnail` 下采样 | 有**真透明** → PNG，否则 JPEG q=82（判据扫描的是缩放后的小图） |
| `video/*` | **子进程** ffmpeg 抽一帧（`thumb/video.rs`），`-ss 1` 在 `-i` 之前、单帧、`-threads 1`、8s 超时、并发 1 | JPEG |
| 其余（SVG / TIFF / AVIF / HEIC / 音频 / 文档） | 不出（415） | — |

**PDF 首页不走这个端点**：PDF 只能靠真渲染器（ffmpeg 实测解不了 —— 静态构建里没有
PDF 解码器；poppler/mupdf/pdfium 都没有"随产物走"的静态发行渠道），所以改用前端
pdf.js 渲染（`web/src/platform/file/model/pdfThumb.ts`，动态 import + `?url` worker，
pdf.js 与 worker 不进首屏；卡片进入视口才开始渲染，见下面的 IntersectionObserver）。

几条硬约束（改这条链路前先读）：
- **像素数 > 60MP 直接回原图**，不是报错也不是硬解：解不动的是大图，报错会让一张
  正常照片在列表里变成后缀徽章，而"尽力解码"会把 systemd 的 `MemoryMax=1G` 吃穿。
  像素数取自 DB 里已有的 `width/height`（没有就不判，交给解码限额：
  `thumb/image.rs` 的 `Limits` = 单次分配 256MB、单边 30000px）。
- **视频走子进程是隔离，不是省事**：视频解码器的历史 CVE 比位图多得多，
  别为了少一个二进制把 libav* 链进主进程。
- **ffmpeg 缺席即永久降级**：进程内只探一次 `-version`，不可用回 415
  （`THUMB_TOOL_MISSING`），前端退回后缀徽章。二进制随部署产物走
  （`just fetch-ffmpeg` → `vendor/ffmpeg/bin` → `build/bin`），路径解析顺序是
  `FFMPEG_PATH` > 应用同目录 `bin/ffmpeg` > PATH。
- **`thumbs/` 不是 12 位 `stored_id`**，所以一致性扫描（`is_stored_id`）与孤儿清理
  天然忽略它：安全（不会被误删），但也不会被回收 —— 回收责任在
  `service::maintenance::prune_thumb_cache()`（200MB / 5000 个上限，按 mtime 删最旧）。
- 响应头与内容路由一致：`Cache-Control: private, max-age=86400`。**要上 `immutable`
  必须先在 URL 里加内容哈希版本段**，否则内容变了客户端一年都不会回来问
  （内容路由那条踩过的坑，见 `handler.rs` 的注释）。

### `GET /api/file/{stored_id}/preview`

Office 文档的**服务端解析结果**（JSON，带判别字段 `kind`）。与内容路由同一套可见性
（公开文件无需凭据，私密文件要求凭据且为上传者）：

| 输入 | `kind` | 内容 |
|---|---|---|
| `.docx` | `docx` | `html`（受限 HTML：只含 `p / h1..h6 / strong / em / br / table / tr / td`，文本已转义）、`truncated` |
| `.xlsx` / `.xls` | `sheet` | `sheets[]`（每张表 `name` + 前 200 行 × 40 列 + 实际 `total_rows/total_cols`）、`truncated` |
| `.sqlite` / `.db` | `database` | `tables[]`（表名 + 列名 + 前 100 行，单元格已转文本）——**只读**打开（`read_only` + `immutable`）、不接受客户端 SQL、行/列/单元格都有上限、整体 5 秒超时 |
| `.zip` / `.tar` / `.tar.gz` | `archive` | `format` + `entries[]`（名字 / 大小 / 压缩后大小 / 是否目录）+ `total_bytes`——**只列条目不解压**；zip 读中央目录、tar 只读块头、gzip 限制解压上限（防 bomb）。类型判定看**内容**（压缩包的 MIME 不稳定） |
| `.pptx` | `slides` | `slides[]`（每页 `title` / `lines` / `notes`，**按放映顺序**——顺序取自 `presentation.xml` 的 `sldIdLst`，不是文件名数字）、`truncated` |

其它类型返回 400 `INVALID_INPUT`；超过 32MB 不解析（同样 400，让用户下载后本地看）。
**类型判定分两步**：Office 看 MIME（白名单里类型确定），压缩包这类看**内容魔数**
（`sniff_container`：zip / gzip / tar / sqlite）。
解析在 `spawn_blocking` 里做（几十 MB 的表格要几百毫秒，别占 async 工作线程）。

### `PATCH /api/file/{stored_id}`

```json
{
  "original_name": "新名字.pdf",
  "tags": ["新标签1", "新标签2"],
  "meta": {"pages": "10", "author": "张三"},
  "is_private": true
}
```

**上传者与 admin 可改，越权返回 404**（`ensure_can_mutate`，按"不存在"处理，不是 403）。
无主的历史行只有 admin 能动，且**不能设为私密**（`INVALID_INPUT`：没有"对应的人"可授权）。
响应与列表项都带 `is_private`（当前可见性）与 `can_edit`（当前请求者能否改动）。

### `DELETE /api/file/{stored_id}?force=true`

上传者与 admin。有内容引用（4 张内容表里出现该 `stored_id`）时先回 409
`RESOURCE_IN_USE`，`force=true` 跳过检查；随后先删库（级联），后删文件。

### `GET /api/file/tags` / `GET /api/file/stats`

标签是**全局共享**的，所以 `/tags` 列的是全库标签（带文件计数），不是"当前用户创建的"；
`/stats` 是文件库占用与类别分布（按 `push_visibility` 的口径：普通用户只见公开 + 自己的，admin 全量）。

### 标签管理

`PATCH /api/file/tags/{tag_id}`（改名）、`DELETE /api/file/tags/{tag_id}`（只解除关联，
文件保留）、`POST /api/file/tags/{tag_id}/merge`（合并进另一标签）。任何登录用户可做 ——
这是刻意的授权例外，**别给它加归属过滤**。

---

## 6. 全局搜索接入

文件模块实现 `shared/search` 的 `SearchPort`（`query.rs` 的 `impl SearchPort for FileQueryService`），
进入 `/api/search` 的并行聚合（`file` kind）。

**匹配维度**（四项；多词 = AND，每个词都要在**某个**字段里命中，口径同 `shared/search`）：

| 维度 | 说明 |
|---|---|
| 文件名 | `original_name LIKE %kw%`（大小写不敏感，`%`/`_`/`\` 已转义） |
| 正文 | `file.text_content`（上传后后台抽取 + 启动回填，见 §6.1；上限 1 MiB） |
| 标签名 | 该文件任一标签命中即算命中 |
| 元信息值 | `file_meta.value` 命中（片段展示命中的键名，如 `元信息 author`） |

- **可见性过滤**：标准形状 `(? IS NULL OR is_private = 0 OR user_id = ?)` 绑 `owner_scope()` ——
  admin 全量、普通用户 = 公开文件 + 自己的私密文件（与列表页同一语义）
- **排序与打分**：文件名 > 正文 > 标签 / 元信息（SQL `rank` 0/1/2，`score` 对应
  `1.0` / `0.6` / `0.5`）
- **片段**：正文命中 → 正文里围着"最早出现的命中词"切上下文（`anchor_term`）；文件名命中且
  标签/元信息命中 → `#标签` / `元信息 key`；都没有 → `分类 · 大小`
- **导航**：`SearchTarget::File { stored_id }` → 前端按 `PATHS.fileDetail` 拼 `/file/:id`（参数值是 stored_id）

文件名通常带扩展名，所以搜 `pdf` / `md` 一类后缀仍能按类型筛选；正文命中让 PDF/Office 里的
文字也能搜到（扫描件抽不出，见 §6.1）。

### 6.1 正文抽取（`file.text_content`）

`extract.rs` 是这一列的唯一生产者：**纯函数，不碰 DB、不碰磁盘**（读文件与写库由调用方做）。

- **能抽哪些由 `kind.rs` 的 `text` 列声明**（第五列）：文本族（HTML 只留可见文字）+
  docx / xlsx / xls / pptx / epub / pdf；图片 / 音视频 / 压缩包 / 老 `.doc` 留 NULL
- **上传后是后台抽**（`service::spawn_text_capture` 起 tokio 任务，不进响应链；解析在
  `capture_text_content` 里丢给 `spawn_blocking`）：
  大部头很贵（1312 页教材抽 1 MiB 约 94 秒），进程中途退出由启动回填自愈
- **启动回填只挑 `text_content IS NULL`**：`''` = 抽过但没文字（扫描件、空文件），不再重试；
  `Err` 时故意不写库（留 NULL，下次再试）
- **两条体积闸门**：通用解析预算 = `preview::MAX_PREVIEW_BYTES`（32 MB），PDF 单独一档
  `MAX_PDF_BYTES`（16 MB，扫描件多、不值当整份解）；抽出的文本截到 `MAX_TEXT_BYTES`（1 MiB）
- **PDF 用 `pdf_oxide`**（纯 Rust，MIT/Apache-2.0），**逐页抽、每页 `catch_unwind`**：
  坏页只丢自己；能区分"扫描件"（`Ok("")`）与"整篇失败"（`Err` → NULL 待重试）
- **换抽取器要连带一次重抽**：v23 的 `reset_pdf_text_content` 把 PDF 行的 `text_content`
  置空，让回填用新库重跑 —— 否则"非 NULL 就不再抽"的策略不会更新旧正文
- 抽出的正文**不进任何响应 DTO**、不参与预览渲染；接口里只有搜索结果的 `match_snippet` 片段

---

## 7. 后端模块

```
src/modules/file/
├── mod.rs          # 路由定义：认证组（upload/list/tags/stats/详情）+ 公开组（data/preview/thumb）
├── model.rs        # 领域模型/DTO（含 FileCategory::from_mime：类别的唯一来源）
├── handler.rs      # HTTP handler（响应 DTO 与 can_edit、缩略图方案、内容响应与 Range）
├── mime.rs         # 类型识别：定族 + 族内定种 + 字节判文本性（纯函数，不碰 DB）
├── kind.rs         # 类型 → 能力（上限档/缩略图/预览/内联/正文抽取）的唯一定义处
├── limits.rs       # 上限档 → 字节数 + 单文件闸门（前端镜像测试读这个文件）
├── content.rs      # 响应侧文本处理：名称清理/编码/Content-Disposition/内联策略
├── preview.rs      # 服务端预览解析（docx/xlsx/pptx/epub/zip/sqlite）+ 不透明游标
├── extract.rs      # 从可解析文档抽正文，写 file.text_content（搜索用）
├── consistency.rs  # 存储一致性扫描（缺失/孤儿/大小不符/类别不符）
├── service.rs      # 写侧业务逻辑（上传/去重/删除/标签/可见性）
│   └── maintenance.rs  # 上传目录体检 / 哈希回填 / 孤儿回收 / 缩略图缓存清理（service 的子模块）
├── query.rs        # 只读查询聚合 + SearchPort 实现
├── repository.rs   # SQL 数据访问（含 push_visibility）
├── thumb/
│   ├── mod.rs      # 宽度阶梯 / 缓存键 / 像素闸门 / can_generate
│   ├── image.rs    # 位图缩略（同进程 image crate）
│   └── video.rs    # 视频海报帧（ffmpeg 子进程）+ ffprobe 时长回填
└── test_support.rs # 测试夹具（仅测试构建，#[cfg(test)]）
```

---

## 8. 前端

### 8.1 页面

- 文件列表页 `/file`：网格/列表视图，按标签/类别筛选
- 文件详情页 `/file/:id`：预览 + 元信息编辑

### 8.2 API 层

`web/src/platform/file/api.ts`（模块公共入口是 `index.ts`）

### 8.3 Markdown 集成

编辑器中通过 `/api/file/{stored_id}/data/{filename}` 引用文件 —— 公开文件的内容路由
不需要凭据，所以 `<img src>` 直接可用；私密文件由前端换 blob（见 §8.4 的 `usePreviewUrl`）。

### 8.4 预览：查看器注册表（扩展点）

**加一个文件类型的预览 = 写一个查看器组件 + 往 `viewers/registry.ts` 的 `VIEWERS`
里加一条**，不需要改宿主。

模块的物理位置是 **`web/src/platform/file/`**（页面/状态/纯规则的通用分层：`model/` 纯规则、
`view/` 页面状态、`components/` 本模块组件）；旧的 `web/src/modules/file/` + `lib/` + `hooks/`
已经迁走，看到旧路径按新路径理解。

```
web/src/platform/file/
├── api.ts              # 与后端 /api/file/* 的适配（含上传的 FormData 构造）
├── index.ts            # 模块公共入口（跨模块只从这里 import）
├── FileList.tsx        # 列表页（路由与 loader 在 app/routes.ts）
├── FileDetail.tsx      # 详情页
├── markdown-editor-support.tsx  # Markdown 编辑器里插入文件的入口
├── components/         # 卡片 / 行 / 标签 / 上传面板 / 灯箱 / 批量操作条 / 右键菜单
├── viewers/
│   ├── registry.ts     # 唯一的"哪个文件用哪个组件看"判定表（顺序即优先级）
│   ├── types.ts        # Viewer 契约：{ id, match, component }
│   ├── PreviewStage.tsx# 宿主：命中就给查看器，未命中渲染下载兜底，缺失另有提示
│   ├── TextContent.tsx # 文本查看器外壳（取内容 + 加载中/失败/截断与出口）
│   ├── PreviewState.tsx# 状态块原语：tone(色调) + icon + actions，含读屏角色
│   ├── PreviewError.tsx# 失败块：PreviewState 的薄包装（重试 + 下载）
│   ├── PreBlock.tsx    # 等宽文本块：行号 + 换行开关 + 复制全文
│   ├── DataTable.tsx   # 数据表格（CSV / XLSX / SQLite 共用）：粘顶表头 + 点格复制
│   ├── MediaBar.tsx    # 音视频播放条：倍速 + "已跳到上次位置"
│   ├── FindOverlay.tsx # 预览内查找（Ctrl/⌘+F）：查 DOM 文本节点，原生选区高亮
│   ├── DownloadPanel.tsx
│   ├── DocContent.tsx / SanitizedHtml.tsx  # 服务端预览结果的渲染壳与二次清洗
│   ├── viewLink.ts     # 深链 ?view=<查看器id>:<状态串>（纯函数）
│   ├── splat/          # 3DGS 高斯泼溅：engine（解析+排序）+ shaders + renderer + worker
│   └── <各查看器>.tsx
├── view/               # 页面状态与取数（原 hooks/，文件名仍以 use 开头）
│   ├── usePreviewUrl.ts   # 媒体：公开文件直通 URL，私密文件换 blob（失败给错误+重试）
│   ├── usePreviewText.ts  # 文本：Range 分段（首屏 4MB / 载入更多 / 看结尾 bytes=-N）
│   ├── usePreviewBytes.ts # 二进制：带凭据 fetch + Range 按段取（每段 4KB，可翻页）
│   ├── usePreviewPly.ts   # 3D/点云：先 Range 探头部与总大小，再决定要不要整包下载
│   ├── usePreviewDoc.ts   # /preview 的服务端解析结果（含游标分页）
│   ├── useFileList.ts / useFileUploads.ts / useFileBatch.ts / useFileItemOps.ts
│   └── useFileDetail.ts / useImageLightbox.ts / useListScroll.ts / ...
└── model/              # 纯规则（原 lib/），不碰 DOM/请求；测试与实现同目录
    ├── previewError.ts # 失败分类：重试有没有意义（网络/5xx 有，4xx 没有）
    ├── findInText.ts  # 查找的核心判定（正则转义 + 命中上限，纯函数）
    ├── bookProgress.ts# epub 阅读位置与字号档位（纯函数 + localStorage 键）
    ├── lightboxZoom.ts# 灯箱缩放：乘法步进 + 以指针为中心的滚动补偿（纯函数）
    ├── mediaPlayback.ts # 倍速档位与播放进度（含"片尾不续播"两条护栏）
    ├── modelView.ts   # 3D 预设机位方向与退化处理（俯视的上方向、零向量）
    ├── previewPaging.ts # 分页游标的客户端合并（只追加到游标指定的容器）
    ├── splitPane.ts   # 详情页两栏宽度：夹取、拖拽、存档（存像素不存比例）
    ├── viewLink.ts    # 深链 ?view=<查看器id>:<状态串>（纯函数，viewers/ 里也有实现入口）
    ├── filename.ts    # 扩展名 → 高亮语言、已知纯文本扩展名
    ├── ply.ts         # .ply 头部与 3DGS 字段、.splat 定长字节 → 渲染用紧凑数组（纯函数）
    ├── pointcloud.ts  # .pcd / .xyz / .pts → 同一份紧凑数组的"普通点云"分支（纯函数）
    ├── magic.ts       # 文件头签名识别与十六进制排版（纯函数）
    ├── uploadLimits.ts# 上传分档的镜像（与 limits.rs / kind.rs 比对，见 §4.2）
    ├── pdfThumb.ts    # PDF 首页缩略（pdf.js，动态 import + IntersectionObserver）
    ├── thumbPreview.ts# 列表卡的 HTML 正文片段（按 Range 窗口截断处理）
    └── thumbnail.ts   # 列表侧可预览性判定（isRenderableImage / canThumb / canZoom）
```

现有查看器：image / video / audio / pdf（浏览器内置）/ markdown / html（沙箱）/
csv / code / text / **splat（高斯泼溅与点云：`.ply` / `.splat` / `.pcd` / `.xyz` / `.pts`）** /
**docx、xlsx/xls、pptx、epub、zip/tar.gz、sqlite（服务端解析）** / **glb/gltf/stl/obj（three.js）** / hex。

规则与踩过的坑：

- **`match` 基本只看 mime 与文件名**（只有 image/video/audio 三条与末位的 hex 兜底按
  `file_category` 分）：类别只有 5 个值，区分不了同属 `document` 的 pdf/csv/docx，
  也表达不了"TIFF 归 image 但 Chrome 渲染不了"
- **顺序即优先级，取第一个命中**。两条硬性排序：
  1. **按扩展名认领的格式必须排在泛化的文本规则之前**。ASCII 的 `.ply` / `.stl` / `.obj` /
     `.gltf` / `.xyz` / PCD 的 ascii 形态，内容确实是文本，后端会如实存 `text/plain`
     （见 §3）—— 但"这是点云 / 网格 / 数据库"只有扩展名说得出口。让 `code`/`text`
     先命中，它们就会被渲染成一屏纯文本。回归测试里专门有几条 text/plain + `.ply`/`.stl`
     /`.gltf`/`.sqlite` 的用例钉住这件事
  2. 泛化规则（`text/*`、`other` → hex）排在所有具体规则之后
- 兜底由 `pickViewer` 返回 `undefined` **派生**，不要手写"不是以上任何一种"的负向条件
- 查看器只接收 `{ item }`，内容获取自己挑 hook，于是"私密文件怎么办、多大算太大、
  失败显示什么"各只解决一次
- **详情页不做跨文件导航**（曾经的「上一个/下一个」按钮 + 方向键、以及图片灯箱的
  翻页都已移除）：`/file/:id` 是**文件汇集**里的一条，相邻文件之间没有语义关系
  （不是相册、不是书），给"下一个"只会让人误以为它们相关。浏览一组文件回列表页 ——
  那里灯箱的翻页按当前筛选结果来，语义成立。查看器因此也不必知道"自己是从哪儿打开的"
- 文本类查看器推荐走 `TextContent` 外壳，子渲染函数只拿到 `text`，即 `text => JSX` 的纯函数。
  等宽内容（纯文本、太大没高亮的代码）用 `PreBlock`：行号 + 换行开关 + 复制全文。
  **行号是一个文本节点而不是 `<ol>`** —— 一行一个 DOM 节点的话，十万行的日志就是十万个
  节点，而大文件恰好是这条路径最常见的输入
- **查找挂在外壳上**（`FindOverlay`，Ctrl/⌘+F）：查的是**已渲染的 DOM 文本节点**，
  所以一套实现覆盖文本/代码/Markdown/CSV/docx/epub，不必改任何查看器的渲染逻辑。
  高亮用浏览器原生选区（零 DOM 改写，不与 Markdown 标记、代码高亮 span 打架）；
  代价是同时只突出一个命中，用计数补上"一共多少处"。已知限制：跨节点的命中找不到
  （查询串跨越标签边界，如 Markdown 里 `**粗**体` 的"粗体"）
- **前端不再维护"哪些扩展名其实是文本"的清单**：`PLAIN_TEXT_EXTS` / `isPlainTextName`
  已随 §3 的字节判定退休（后端判得出就是判得出，`.srt` 这类上传后 mime 就是 `text/*`）。
  别再往前端加这类表
- 新查看器优先选"前端取字节"路线：后端只对 `image/*`、`video/*`、`audio/*`、
  `application/pdf` 内联响应（见 4.1），自己 fetch 的查看器不受这条限制，也就不必动安全策略。
  **例外是列表缩略图**（§5 的 `/thumb`）：它属于文件服务的派生文件，不是查看器 ——
  列表要的是"240px 的格子"，把原图下给它不成立（相机照片 12MB/张）
- 后端**新增已知 mime 时前端必须表态**：`viewers/registry.test.ts` 直接解析
  `kind.rs` 的 KINDS 表，未在 `EXPECTED` 里给出归属（查看器 id 或显式 `null`）
  就会测试失败（原来的 `ALLOWED_MIMES` 常量已随能力表收进 `kind.rs`）

### 8.5 3D 预览：高斯泼溅与点云（.ply / .splat / .pcd / .xyz / .pts）

这些文件都落在后端白名单外，所以**按扩展名认领**（`isSplatLikeName` / `isPointCloudName`）；
MIME 可能是 `application/octet-stream`（二进制 PLY / .splat）也可能是 `text/plain`
（ASCII 的 `.ply` / `.xyz` / ascii 形态的 `.pcd` —— §3 的字节判定如实反映了内容），
所以注册表里这几条按扩展名的规则**必须排在文本规则之前**（见 §8.4）。
**究竟是哪种按内容分辨**
（`ply\n` 魔数 → PLY、`# .PCD` 头 → PCD、整行数字 → 文本点云、都不是 → 定长 .splat），
这样改了扩展名、或后端把 MIME 报成 `application/octet-stream` 也照样能看。
内容解析与渲染全在前端：

- `model/ply.ts`：解析头部（ascii / 小端 / 大端）、按属性偏移读 3DGS 字段，产出每顶点
  32 字节的紧凑数组（位置 + `exp(scale)` + SH 基色与 `sigmoid(opacity)` + 归一化四元数），
  并按 importance（体积 × 不透明度）降序排 —— 球谐高阶项（`f_rest_*`，一条 45 个浮点）
  只参与行宽计算、不读取
- `.splat`（参考实现的格式）走同一个文件里的 `buildSplatDataFromSplat`：**它的字节布局
  就是上面那份紧凑数组**（定长 32 字节/顶点，位置 / 缩放 / 颜色 / 四元数的顺序也一致，
  参考实现的 `convert.py` 写的正是它），所以那条路径**零重排** —— 只校验长度
  （必须是 32 的整数倍，否则给"不是 PLY，也不是 .splat"的可读错误）、算取景范围、抽位置样本。
  代价是判据只看长度：命名成 `.ply`/`.splat` 的任意 32 倍数字节都会按泼溅渲染
  （参考实现同样如此）
- 没有 `scale_0` 的 PLY 按普通点云渲染（固定小尺度 + 单位四元数 + 直取 RGB）；
  `.splat` 必带高斯参数，没有这个分支
- `model/pointcloud.ts` 走的就是上面那条点云分支，多认三种输入：`.pcd`（PCL，支持
  ascii / binary；`binary_compressed` 是 LZF 压缩，给可读提示让你转换）、
  `.xyz` / `.pts`（纯文本，至少 x y z，可选 rgb；PTS 首行是点数）。文本点云按行解析很慢，
  超过 `MAX_TEXT_POINTS` 截断。
  **`.las` / `.laz` 故意没做**：LAS 有十种点位格式（还有压缩的 laz），而这里没有真实样本
  可校验，宁可让它落到 hex 查看器回答"这是什么文件"，也不冒险按规范猜字段偏移
- `viewers/splat/`：WebGL2 实例化绘制 + 每帧 16 位计数排序（放 worker，避免卡交互）。
  着色器与排序数学取自 [antimatter15/splat]（MIT）—— 见各文件头的归属注释
- 交互：与参考实现逐条对齐（映射与常量都在 `viewers/splat/controls.ts`，27 例表驱动测试）。
  **键盘有两套移动模式**（画布右上角按钮切换，`MoveMode`），差别只在"移动"这一半 ——
  环绕、翻滚、环绕定点两套一致。

  视角相对（`view`，默认，即参考实现的操作表）：

  | 输入 | 行为 |
  |---|---|
  | 左键拖拽 | 环绕（绕相机前方定点） |
  | 右键 / Ctrl(⌘)+左键 拖拽 | 前后移动 + 平移 |
  | 裸滚轮 | 环绕（**不是缩放**，同参考实现） |
  | Shift+滚轮 | 上下左右平移 |
  | Ctrl/⌘+滚轮 | 前后移动（相当于缩放） |
  | 方向键 ↑↓←→ | 前进/后退、左右平移（按帧持续） |
  | Shift+方向键 ↑↓ | 升/降 |
  | A/D | 左右转（原地转向） |
  | W/S | 仰俯 |
  | Q/E | 翻滚（绕视线轴） |
  | I/J/K/L | 绕前方定点环绕 |
  | 空格 | 跳（渐变抬升，松开落回） |

  水平锁定（`horizontal`）：像 MC 那样**有一块"地面"**，视角只决定往哪个方向走：

  | 输入 | 行为 |
  |---|---|
  | WASD / 方向键 ↑↓←→ | 在"地面"上走（前后按视线的平面投影，左右为平面内测移），**高度不变** |
  | 空格 / Shift | 升 / 降，沿"地面"的法线 |
  | Q/E | 翻滚（绕视线轴）——**地面跟着一起转**（地平线歪了，地面也歪） |
  | 拖拽 / 滚轮 / IJKL | 与视角相对模式一致（"看"不受移动模式限制） |

  "地面"的定义在 `controls.ts` 的 `planeFrame`：默认就是世界水平面，**俯仰不参与**
  （平地走路低头看脚下不会往地里钻，按前进仍贴地走），只有 `QE` 的**翻滚**会把
  世界朝上绕视线轴转过去，平面法线于是偏离世界垂直、升降跟着倾斜。所以空格/Shift
  写的是"沿平面法线"（`planeMove` 的 `up` 分量）而不是写死的世界坐标轴 —— 这叫
  "像 MC 的空格，只不过地面能被 QE 转"。平面内的前向 = 视线在平面里的投影，
  正对上下看时退化，退回相机的"上"轴 / "右"轴。
  升降位移用 `translateWorld`（直接改 camToWorld 的平移列），所以相机姿态不会
  把位移方向再拧一道。两套模式的空格语义不同：视角相对是"跳"（渐变到位），
  水平锁定是持续上升（由 `keyOps` 产出，`SplatViewer` 按模式分流）。

  键盘**只在画布获得焦点时生效**（点击画面即获得，有可见焦点框）：方向键与空格会
  `preventDefault` 防页面滚动并 `stopPropagation`，避免与页面级快捷键打架。
  **详情页的 ←/→ 切文件已移除**（会和方向键移动相机冲突；后来连"上一个/下一个"按钮
  与灯箱翻页一起移除了 —— 详情页不做跨文件导航，理由见 §8.4）。
  回归测试：`FileDetail.render.test.tsx` 里断言方向键不切文件、工具条上没有那两个按钮。
  相机是自由视角（状态就是视图矩阵），所以翻滚、原地转向都成立；帧循环只在按住相机键或
  "跳"未落回时运行，空闲不烧 GPU。
- 自动取景（踩过两次坑，见 `viewers/splat/fit.ts`）：**按点的投影分布**求距离，
  视口宽高比参与计算，取景中心取**各轴 1%/99% 分位的中点**、范围取分位半宽。
  两代旧做法都不行：
  1. 第一代用"到中心的距离 P90 × 2.5"当距离。那个量与"内容在屏幕上占多大"无关 ——
     实测 8MB 场景（点分布在壳上：径向距离小、屏幕伸展大）偏近、溢出画面被裁；
     106MB 场景（y 只有 ±14 而 x/z 是 ±56/±70）偏偏远，点在屏幕上的 90 分位只有 0.26。
  2. 第二代把中心改成中位数、半径改成 P90，仍与屏幕伸展无关，且中心偏了 8 个单位
     （中位数被密集核心拽向一侧），模型看着又小又偏。
  现在是闭式解：相机只做俯仰（绕 x 轴），于是 `cam.x`/`cam.y` **与距离无关**、
  只有沿视线的分量随距离线性增长，所以每个点都有一个"刚好装下它"的距离，
  取这些距离的某个分位就是答案 —— 一遍 O(N) 加一次分位，不用二分搜索，
  也不受"包围盒空角"（坐标组合上没有点的角）影响。
  **分位与画面占用是一对**（`FIT_MASS = 0.9` / `FIT_FILL = 0.85`，改一个必看另一个）：
  `d = 0.9 分位` 的几何含义就是"屏幕伸展的 90 分位落在 85% 画幅处"。这两个数是照
  **参考实现自己 demo 的实测**定的 —— 把 train.splat（它默认机位瞄准的场景）用它自己的
  `defaultViewMatrix` + 内参（fx=fy=1160）投出来，点的 `max|ndc|` 的 90 分位 = 0.83、
  出画 8.5%，这就是"作者眼里的好构图"。
  **别再回到 0.99**：那个分位被 1% 的离群高斯拽着走，长尾场景（3DGS 几乎都是）的实体
  部分因此只占画面的 30~57%，看着又小又远 —— 而 0.99 分位确实贴着画框，从数字上看不出
  问题。实测四份数据（1280×558 视口，点的 90 分位）：`train.splat` 0.30 → 0.84、
  `nike.splat` 0.70 → 0.85、用户 `ss.ply` 0.57 → 0.85、`1895改进3.ply` 0.38 → 0.78；
  取景距离同步收紧 1.5~2.4 倍，出画 1.7~6.5%（都是离群高斯，原实现对自己 demo 也有 8.5%）。
  没有样本点时退回包围盒 8 个角（等价于要求整个盒子装进画面，`mass = 1`）。
  分位数用 1024 桶直方图算（不排序、不额外开等长数组），桶宽 = 取值范围的 1/1024。
  **视口比例变了会重新取景**（拖窗口/换设备方向），但**用户动过相机之后就不再抢镜头**。
  参考实现那份写死的 `defaultViewMatrix`（6.55 机位）**不能照抄**：实测用户那两个场景
  （包围盒半宽 10×5×8 与 28×7×35）在它的机位下有 40~55% 的点出画 —— 相机落在模型内部
- **视口底色固定用暗色，与主题无关**（踩过的坑）：高斯以预乘 alpha 输出、画布本身透明，
  累积不透明度不满的地方由页面底色补上 —— 预览区是 `--t-color-bg`（paper 主题近乎白色），
  画面就整体发灰发飘。参考实现整页就是 `background: black`，观感靠的正是这个。
  因此 `.splat-pane` 自带暗底与浅色文字（覆盖层文案在暗底上也要读得清），
  它是"视口"不是"界面"
- **排序必须"有请求就有回答"**（踩过的坑）：主线程用 `sortPending` 标记"排序在飞"，
  靠 worker 的回包清掉。早期实现在"视角几乎没变"时**直接不回复**，于是标记永远清不掉，
  **之后所有相机移动都不再触发排序** —— 表现为转到模型背面仍显示正面的遮挡关系、
  远看合成顺序错乱。现在"没变"也要回一条 `sort-skipped`（`worker.ts`）：**答复永远有，
  但那时不带索引** —— 那份索引在几十万顶点的场景里是几 MB，每次回包都要 `slice()` 拷贝、
  transfer、主线程再 `bufferData` 传上 GPU，而拖拽时大多数请求都属于这一类
  （参考实现在这种情况下干脆什么都不回，代价为零）。主线程收到后只清标记，
  跳过索引上传与重绘；另用 `sortDirty` 做"在飞期间又移动过"的合并补发
- "视角几乎没变"的阈值与参考实现同一量级（`engine.ts` 的 `SORT_SKIP_EPS = 0.01`，
  约 **8.1°**；参考实现比的是投影后的 z 行，多一个 ≈1.002 的系数，等效约 8.9°）。
  曾用 0.001（约 2.6°），比参考实现紧 3.5 倍：快速拖拽时几乎每一步都真的重排
  **（几十万顶点一次就是几毫秒）**，当时的注释还写着"阈值同参考实现"，是错的
- **绘制一律走 rAF 合并**（`SplatViewer` 的 `requestFrame`）：pointermove / wheel 的
  触发率是设备采样率（高回报率鼠标、触控板每秒可达数百次），而一帧只呈现一次 ——
  在事件里直接 `draw()` 等于同一帧画很多次，GPU 填充率白烧、主线程还要堵在驱动提交上。
  排序回包同理（回包频率可以远高于帧率）。参考实现也是"事件只改相机、绘制只在 rAF 里
  做一次"；帧回调同时负责按住的相机键增量，空闲时不排帧、不烧 GPU
- 深度量化按**实际范围**做（float 深度 → 65536 桶）。参考实现用 `depth × 4096 | 0`
  存 int32，翻折点在 2^31/4096 ≈ 524288，而地理配准点云的 UTM 东坐标正好落在这段 ——
  跨过翻折点会被排成乱序（画面同样表现为"严重错乱/变形"）。回归测试用
  "同一场景平移后排序结果不变"来钉住，与实现无关
- 降级：无 WebGL2 / 解析失败 / 超过 256MB 都给可读提示 + 下载入口，不白屏
- **数据管线与 GL 生命周期必须解耦**（踩过的坑，见 §8.5.1）：
  `viewers/splat/runner.ts` 与画布无关、组件挂载即创建；`SplatViewer` 把解析结果
  与排序索引先缓存在变量里，渲染器建好后用 `syncRenderer()` 补齐
- runner 还负责把环境问题变成可恢复的降级：worker 构造抛错、8 秒无响应都切主线程
  重做一遍（同一份 engine），只有内容本身不可解析才报错

#### 8.5.1 为什么不能把"发数据"写在依赖画布的 effect 里

线上表现：`.ply` 详情页永远停在"正在解析高斯泼溅…"，没有任何报错。

原因是 Solid 在一次更新里**先跑渲染计算、再 flush effect 队列**。资源解析完成时：

1. JSX 重算 → 画布挂载（`ref` 写信号）→ 把"建渲染器与 worker"的 effect 入队；
2. 刷新 effect 队列 → **"内容到达"的 effect 先执行**（它排在前面），此时 worker 还不存在，
   `if (!worker) return` 把这一份字节静默丢掉；
3. 之后 worker 建好，却再也不会收到 load 消息。

回归测试 `viewers/SplatViewer.test.tsx` 用一个假 worker 断言"发 load 的那一刻，
GL 调用数还是 0"，把这个时序钉住。教训：**跨"数据到达"与"DOM 就绪"两条时间线的代码，
不要用某一侧的 ready 状态做前置判断**，而是两边各自缓存、就绪时补齐。
- 坐标系是 COLMAP 约定（+x 右、+y 下、+z 前，可见点相机空间 z > 0）。
  **视图矩阵的三行依次是 右 / 屏幕向下 / 前** —— 第二行是"向下"而不是"向上"：
  投影矩阵在 y 上取了一次负（`clip.y = -(2fy/height)·cam.y`，相机空间 **-y** 才画在上半屏），
  所以要让"世界的上方"（数据 y 朝下，即 -y）落在上半屏，第二行就必须等于世界 +y。
  放成"向上"的话画面整体上下颠倒（镜头在上方俯视，看着却像在下方仰视），基也变成左手系。
  `viewers/splat/matrix.test.ts` 拿参考实现自己的 `defaultViewMatrix` 数字交叉验证
  （它的第二行 ≈ 世界 +y —— 参考实现没有任何翻转代码，却把同一份数据渲染正立，
  这就是"数据 y 轴朝下"的原始依据），并有一条"世界朝上的方向必须落在上半屏"的
  端到端断言。**取景那批断言全是 `max(|ndc.x|, |ndc.y|)`，上下颠倒也照样通过** ——
  方向必须单独钉住，否则改了没人发现
- 环绕定点的距离 = **初始取景距离的固定比例**（`fit.ts` 的 `ORBIT_PIVOT_RATIO = 4 / 6.55 ≈ 0.61`，
  拖拽/滚轮/IJKL 三处共用）：参考实现把它写死在相机前方 4 个单位，而它默认机位在 6.55 处，
  于是定点落在"相机 → 内容中心"的 61% 处。**那个 4 只对它有意义的场景尺度成立**，
  照搬会让小场景转得没边、大场景转不动；取比例则任何尺度都是同一手感（定点略微进入内容，
  而不是正好落在内容中心上）。定点越远，同样拖拽幅度下相机平移得越多、越不像"原地转"
- 提醒：`other` 类别的后端上限是 4GB（见 §3），但**预览**另有一道 256 MB 的客户端线
  （`view/usePreviewPly.ts` 的 `MAX_PLY_BYTES`）：超过就只给下载入口，不在浏览器里解析。
  两道线的职责不同 —— 后端决定"能不能存"，客户端决定"浏览器扛不扛得住整包加载 + 高斯排序"，
  所以调大后端上限不等于预览能打开更大的场景

[antimatter15/splat]: https://github.com/antimatter15/splat
[three.js]: https://threejs.org/

### 8.6 Range 分段取内容（后端）

内容路由 `GET /api/file/{stored_id}/data/{name}` 支持**单段** `Range`：

| 情况 | 响应 |
|---|---|
| 无 `Range` / 多段 / 语法错误 | 200 整文件（规范允许忽略），带 `Accept-Ranges: bytes` |
| `bytes=0-1023`、`bytes=2048-`、`bytes=-100` | 206 + `Content-Range` + 本次 `Content-Length` |
| `end` 超出文件尾 | 按文件尾收敛（206） |
| `start` 超出文件尾、`bytes=-0`、`start > end` | 416 + `Content-Range: bytes */total` |

- 长度取**磁盘实况**而不是 DB 的 `size_bytes`：记录与内容不一致时以文件为准，
  否则分段会切出错位的内容
- 只做单段：多段（`multipart/byteranges`）是给浏览器断点续传用的，这里没有收益却要引入边界拼接
- 前端用处：`.ply` 先用 64KB 分段读出总大小，超大就不下载（见 `usePreviewPly.ts`）；
  文本预览按段取（`usePreviewText.ts`）——首屏 4MB，「载入更多」从已取长度续取，
  「看结尾」用**后缀请求** `bytes=-N` 一次到尾部（大日志看末尾是最常见需求）；
  早先它是"整包下载后按字符截断"，一个 200MB 的 `.log` 会真的被拉下来并解成一屏字符串。
  十六进制预览按段取、可翻页（`usePreviewBytes.ts`，每段 4KB，不再有"超过 2MB 就不给看"的闸门）
- 三个用 Range 的 hook 都要吃得下 **200（服务端忽略 Range）** 的情况：老后端或中间缓存可能
  回整包，那时自己切出需要的段（文本的"追加"会退化成重新装载，避免把整份内容拼两遍）
- 顺带收益：下载续传、`<video>` 拖动进度条

### 8.6.2 深链到查看器内部状态（`?view=`）

`/file/:id?view=<查看器id>:<状态串>` —— 让"读到第 12 章""在看偏移 4096"进 URL，
于是**刷新不丢位置、能加书签、能把这一页发给别人**。

| 参数值 | 含义 |
|---|---|
| `epub:12` | 电子书第 13 章（0 基）；**URL 优先于本地进度**（别人发来的"这一页"该落在他说的那一页） |
| `xlsx:1` | 电子表格的第 2 张表 |
| `database:0` | 数据库的第 1 张表 |
| `hex:4096` | 十六进制从 4096 字节起（再配合 §8.6 的 Range 取段） |

- **一个参数 + id 前缀**，而不是 `?chapter=12&sheet=1`：一页只可能有一个查看器；
  id 决定归属，不匹配的查看器直接忽略（`Viewer.id` 在 types.ts 里本就为此预留）
- **只认十进制数字**（`1e3` / `0x10` 当没给）、**越界当没给**（链接可能来自上一版文件：
  那时 30 章、现在 12 章）
- 状态串的含义由各查看器自己定义；详情页经 `viewers/viewLink.ts` 的 context 提供读写
- 未覆盖：pptx / archive（位置是滚动量）、3D（相机姿态）—— 要加时按同一格式扩一个 id

### 8.6.1 预览分页（不透明游标）

`GET /api/file/{stored_id}/preview` 支持 `?cursor=`：**同一套响应 schema**，只多一个可选字段
`next_cursor`（有它 = 还有更多，客户端原样回传取下一页）。设计取舍见
`doc/ux/file-preview-plan.md` 的 P3-1，这里只记实现要点：

- 游标是 **hex(JSON)**（`{"v":1,"kind":"sheet","sheet":0,"row":200}`）：不引 base64 依赖，
  可读可测。客户端不必知道每种类型怎么寻址 —— 加类型时客户端一行不用改
- **服务端校验**：kind/版本对不上就当没有游标（从头发，不报错）；容器索引 clamp
- **"还有更多"靠多取一行**（`LIMIT n+1`）—— 顺手绕开 `COUNT(*)`（大表上全表扫描，
  与 5 秒超时的取舍不值当），所以数据库表格报不出总行数、只说"还能载入"；
  xlsx 的总行数是 calamine 免费给的，照旧如实显示
- **省的是首屏，不是服务端解析**：xlsx 每次都要整本读（calamine 无法按行打开），
  别把它当服务端性能优化
- 已接通：sheet（每页 `MAX_ROWS` 200 行）、database（每页 `MAX_DB_ROWS` 100 行）。
  docx / pptx / epub / archive 仍是"截断 + 下载"，加游标时只需在各自解析里接上
  `Cursor` 并回报 `next_cursor`

前端侧的合并规则在 `web/src/platform/file/model/previewPaging.ts`：**只追加到游标指定的
那个容器**，其余沿用已有内容。`DocContent` 把分页能力作为 children 的第二个参数
（`PreviewPager`）透给查看器。

### 8.7 电子书预览（.epub）

epub 也是 zip（规范要求**首个条目是未压缩的 `mimetype`**，内容是 `application/epub+zip`），
所以类型判定靠这条规范在前 256 字节里认出来，比"解包看结构"便宜得多；认出来之后
走 `META-INF/container.xml` → OPF（`manifest` + `spine`）→ 按**阅读顺序**抽章节。

- 章节正文走与 docx 同一条**受限 HTML** 链路：`xhtml_to_html` 只重建白名单标签
  （`p / h1..h6 / strong / em / blockquote / ul / ol / li / br / hr / pre`），属性全丢、
  文本转义；`script / style / head / title / svg / iframe` **连内容一起丢**（只丢标签会把
  CSS/JS 当正文吐出来）；`b`/`i` 归一成 `strong`/`em`
- 前端 `EpubViewer` 一章一屏（不堆页签：书有几十上百章），正文经共享的 `SanitizedHtml`
  再清洗一次。三件让"读下去"成立的事：
  - **目录**：书名位置是章列表下拉（原生 `<select>`，键盘可达、不必自造弹层）
  - **阅读位置**：章号 + **章内滚动比例**存 localStorage（`model/bookProgress.ts`）。
    只存比例不存像素 —— 换字号/窗口后同一像素落在别处。恢复要有界重试：正文经
    DOMPurify 异步注入，容器先是没有高度的。**越界的存档从头读**，而不是夹到最后一章
    （书被替换过时，夹到末尾会让人以为"读完了"，实际是另一本书的尾部）
  - **字号**：四档，作用在正文容器的 `font-size`（正文是 em 排版，外层一改就整体缩放）。
    滚动容器因此是外层 `.book-body`（后代选择器关掉内层 `.markdown` 的 overflow）
- 取舍：图片与链接**不显示**（图片要另做资源子路由，链接在预览里点了会离开阅读态），
  纯图片版的书会得到"没抽出可显示的正文"；章数上限 200、正文总量上限 4MB

### 8.8 3D 模型预览（.glb / .gltf / .stl / .obj）

网格渲染交给 **[three.js]**（社区标准、维护活跃）—— 材质/光照/法线/相机交互自己写
既没收益也修不动。与泼溅查看器（`.ply` / `.splat` / 点云）是**两条不同的管线**：
那个是自定义 WebGL + 点/四边形，这个是 three + 网格。

- **整块懒加载**：注册表虽然静态引入 `ModelViewer.tsx`，但 three、三个 loader 与
  OrbitControls 都在画布挂载后才 `await import` —— 构建产物里 `three.module` 是独立的
  懒 chunk（736KB，gzip 187KB），首屏同步链一点都不沾。**别把 three 改成静态引入**
- 文件字节用 `usePreviewPly` 那条带凭据的取字节流程，再交给 `loader.parse()`；
  不用 `loader.load(url)`：那会绕开私密文件的鉴权头
- 取景按包围球算，交互用 OrbitControls；**关掉阻尼 = 静止时不重绘**（与泼溅查看器的
  "空闲不烧 GPU"同一取向）
- 已知取舍：`.gltf` 引用外部 `.bin`/贴图时单文件加载不了（提前判断并给出"请导出为
  自包含的 .glb"）；DRACO 压缩需要额外解码器，暂不支持（把错误翻成人话）；
  STL 多来自 CAD（z 轴朝上），按惯例绕 x 轴转 -90° 才是"立着"的观感；
  `.obj` 没有配套 `.mtl` 时给一个中性材质
- `.ply` 留在泼溅查看器那边（上传的 `.ply` 更可能是高斯/点云，不是网格）

### 8.9 打开"用户上传的文件"这件事

`GET /api/file/{stored_id}/preview` 里只有 SQLite 那一支是**真的把上传的文件交给一个解析器/库去打开**
（docx/xlsx/pptx 是 zip+XML 纯解析，压缩包只读目录，3D/点云在前端）。它的安全姿态：

- **只读 + immutable**：不写日志、不做 WAL 恢复，坏文件也改不动它；
- **不接受任何客户端 SQL**：表名取自 `sqlite_master` 的实际清单，双引号转义后拼进
  `SELECT * FROM "…" LIMIT n`（拼动态 SQL 的地方用 `AssertSqlSafe` 显式声明已审过，
  sqlx 0.9 会强制这一步）；
- 行 / 列 / 单元格 / 表数量都有上限，整体 5 秒超时；
- **残余风险要认账**：SQLite 是 C 库，畸形文件理论上可能让它崩掉进程 ——
  这是"在本进程里打开不可信库"的固有代价，彻底隔离得靠子进程，不在预览这一层做。

### 8.10 已知缺口

- 老 `.doc` / `.ppt` / `.xls` 里的 OLE 二进制：`refine_ole` 分不出 doc/xls/ppt（复合文档
  结构一致，靠声明或扩展名），`.ppt` 没有解析器 → 前端下载兜底（`.xls` 由 calamine 解析）。
  族检测会把它们如实判成 `application/x-ole-storage`，不会误当成别的东西
- `.las` / `.laz` 点云未支持（见 §8.5；没有真实样本可校验，先不进注册表）
- **zip 族的定种分两次**：判定发生在流式落盘**之前**，那时只有头部 512 字节、读不到
  中央目录，所以先按头部证据 + 声明/扩展名给个种；文件落盘后
  `refine_zip_by_structure` 打开 zip 读条目名再覆盖一次（**结构 > 声明 > 扩展名**，
  把 .xlsx 改名成 .docx 也认得出）。读不出目录或条目都不认识时如实存
  `application/zip` —— 早先这种（以及 ODT 这类白名单外的 Office 变体）会报
  "文件类型不符"拒收，与 §3"白名单外的格式不拒绝"矛盾
- 文本的**具体**类型只认 md/csv/html 三种（有专用查看器）；`.json` / `.yaml` / `.go`
  等一律 `text/plain`，靠前端按扩展名给高亮。要加新查看器时再往 `text_ext_mime` 加
- epub 里的图片与链接不显示（正文只有文字与结构）；纯图片版的书会提示"没抽出可显示的正文"
- 3D 模型：DRACO 压缩、`.gltf` 引用外部 `.bin`/贴图的，都只给可读提示（要自包含的 `.glb`）
- 数据库预览不做"行数统计"（`COUNT(*)` 在大表上是全表扫描，与 5 秒超时的取舍不值当）
- 3DGS 预览不支持球谐高阶项（视点相关颜色），只用 `f_dc` 基色：预览够用，
  与训练时的观感会有差异
- 没有实机（真实浏览器 + 真机显卡）的视觉回归测试：解析、排序、矩阵约定、假 worker +
  假 GL 上下文的完整链路都有测试，着色器取自参考实现且只做了格式化，但"画出来对不对"
  仍依赖人工抽查
- 缩略图：TIFF/AVIF/HEIC 出不了（`image` crate 解不了）、音频没有波形图、
  **私密文件在列表里没有缩略图**（列表的 `<img>` 不带凭据，仍只显示锁徽章）；
  PDF 首页**在前端**用 pdf.js 渲染（见 §5 `/thumb` 一节），所以它没有服务端缓存 ——
  每次会话每个 PDF 都要按 Range 取一次首页对象（浏览器缓存与模块缓存兜住重复）

---

## 9. 实施顺序（历史记录）

（当时按 v15 的迁移模型写的；`db/schema.rs` 现已拆成 `db/schema/tables.rs`，
"迁移"退成"声明 + 废弃清单" —— 见 `doc/guides/database.md`。下面七步**已全部完成**，
留在这里是为了说明"先声明表、再写后端、最后接前端"的次序不是偶然。）

1. 设计文档 ✅
2. 新建 `file` 模块目录结构 ✅
3. 建表 + 迁移（删 media 表）✅ —— 现在走声明 + `legacy.rs`，不再改 `db/schema.rs`
4. 实现后端代码 ✅
5. 注册路由 + 删除 media 模块 ✅
6. 前端页面与 API ✅（物理层见 §8：`web/src/platform/file/`）
7. 测试验证 ✅（`cargo test modules::file` / `pnpm run test src/platform/file`）
