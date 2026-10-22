# 部署

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

## 部署模型

- 本地构建，通过 **ssh 通道**把产物传到远端（进程内打 tar.gz 灌进 `ssh` 的 stdin，
  本机不需要 rsync / scp / sftp）
- systemd 管理后端进程
- Caddy 托管前端静态文件并反代 `/api`（配置先校验候选文件、通过才覆盖现网）
- 远端目录默认 `/opt/<APP_NAME>/`

工具链：`justfile`（任务入口）+ `xtask/`（Rust 实现，跨平台、可单测）。
`deploy/deploy.sh`、`deploy/fetch-ffmpeg.sh`、`Makefile` 都已移除 —— 命令全在
`just --list` 里（本地开发循环如 `clean` / `udeps` / `bloat` / `stats` 也在其中）。

## 远端目录结构

一条边界：**`service/` 是随时可整体替换的代码，`data/` 是绝不能丢的数据**。

```
/opt/<APP_NAME>/
├── service/            运行文件（部署只动 brainbow + dist/ + bin/）
│   ├── brainbow        后端可执行
│   ├── dist/           前端产物（Caddy 的 root）
│   ├── bin/ffmpeg      第三方可执行（可选，缺了视频缩略图降级）
│   ├── REVISION        部署时是哪个 git 版本（构建时写进产物，`just info` 显示）
│   └── uploads/        ← 不该出现在这里；有就说明配置没指到 data/
├── config/             应用配置（部署时随产物上传，权限 700）
│   ├── app.toml        运行时配置（server/cors/security/...）
│   └── secret.toml     JWT 密钥（600）
├── data/               数据
│   ├── brainbow.db     数据库（+ -wal / -shm）
│   └── uploads/        用户上传（UPLOAD_DIR 指向它）
│       ├── file/       文件服务的内容（+ file/thumbs/ 缩略图缓存）
│       └── favicons/   书签 favicon 缓存
├── backup/             备份（db_<用途>_<UTC>.db + code_<UTC>.tar.gz，每类按 30 天 / 20 份清理）
└── tmp/                部署暂存（打包落点、Caddy 候选配置；两次部署之间是空的，
                        超过一天的 deploy_*/web_*/rollback_* 残骸下次部署时自动清掉）
```

维持这条边界的是 **`UPLOAD_DIR`**（由 `BRAINBOW_ROOT` 或 `app.toml` 的 `[uploads].dir` 派生/覆盖）。
不配它会退回默认的相对路径 `uploads`，而 `WorkingDirectory` 是 `service/` —— 用户数据
就住进了代码目录，任何"重建 service"的操作（老回滚的 `rm -rf $SERVICE_DIR`）都会删掉它。

应用启动时会自己 `create_dir_all` 上传目录与缩略图目录（在自检之前），所以新服务器
首次部署不需要手工建这两类目录。**但数据库文件不会自动创建**（生产刻意不开
`create_if_missing`：路径打错时要响亮失败，而不是静默建一个空库）—— 全新部署需要先有
一个空的 `.db` 文件，`migrate()` 会负责建表。**`service/dist/` 也要先建好**：就位那步
会先把现网 `dist` 改名成 `.old`，第一次没有旧 `dist` 时这一步会失败。

## 路径怎么决定（三层级联）

每一处按路径取值的地方都走同一条级联，从高到低：

| 优先级 | 来源 | 例 |
|---|---|---|
| 1 | 单项显式配置 | `app.toml` 的 `[uploads].dir` / `[database].url` / `[backup].dir` |
| 2 | 根目录约定 | `{根}/data/<DATABASE_FILE>`、`{根}/data/uploads`、`{根}/backup`；根 = `{REMOTE_BASE}/{APP_NAME}` |
| 3 | 开发默认 | `uploads`、`sqlite:brainbow.db`（相对 cwd，只在本地开发时用）；**备份目录没有开发默认** |

**部署时你只需要写根**（`REMOTE_BASE` + `APP_NAME`），其余按约定派生。应用侧也有同一个
根的概念（`BRAINBOW_ROOT`），所以手动跑一条命令时同样只要一个变量：

```bash
ssh <host> "cd <SERVICE_DIR> && BRAINBOW_ROOT=<根> ./brainbow --check"
```

为什么不做成"编译期写死"：那样同一个产物就不能发给不同机器了，而部署的第一性要求是
"同一个二进制在哪台机器上都一样"。

**unit 以路径为主，另保留 legacy env 供回滚**：`BRAINBOW_CONFIG` 指向
`config/app.toml`，`BRAINBOW_SECRETS` 指向 `config/secret.toml`，`BRAINBOW_ROOT` 指向
`/opt/<APP_NAME>`。应用自己按根派生 DB/uploads/backup；`xtask` 为了备份/Caddy 仍读同一份
`app.prod.toml`。unit 不再保留旧字段——只认这三条路径。

**别让进程环境参与部署配置**：`cargo xtask` 是 `cargo run`，而 `.cargo/config.toml`
的 `[env]` 会把 `DATABASE_URL=sqlite:brainbow.db` 注进 xtask 进程。曾经配置会回落读
进程环境，于是"开发机的构建配置"悄悄改掉了"部署配置"（部署把库指到开发库的相对路径，
而配置文件里根本没写它）。现在部署配置**只认 `config/*.toml`**。

## 配置文件

按"谁读"拆成四份 TOML（真实文件 gitignored，模板在 `config/*.example.toml`）：

| 文件 | 谁读 | 必填/说明 |
|---|---|---|
| `config/deploy.toml` | `xtask` | `remote.host`、`remote.user`、`remote.app` 必填；`port`/`base`/`backup.*` 有缺省 |
| `config/app.prod.toml` | 后端 + `xtask` + Vite | `server`、`security`、`site`、`cors`；`[database]`/`[uploads]`/`[backup]` 一般不用写 |
| `config/build.toml` | `xtask build` | `target` 缺省本机；部署产物应为 `x86_64-unknown-linux-musl` |
| `config/secret.toml` | 后端 + `xtask` | `[jwt].secret`；缺失时部署时生成并写回，权限 600 |

`app.prod.toml` 里 `[server].port` 同时供 unit 路径与 Caddy 反代；`[site].url` 同时
供 Caddy 域名、CORS 与 Vite 的 sitemap；`[database].file`（或 `url`）供备份路径。
这些值不再通过旧的 `.env.prod` 或 unit 的 `Environment=` 传递。

可选覆盖（**一般不用写**）：`[database].url/file`、`[uploads].dir`、`[backup].dir`、
`[ffmpeg].path`、`[frontend]`、`[security].jwt_ttl_secs`、`[cors].allow_origins`。
`BRAINBOW_ROOT` 由 unit 注入，用于派生 `{根}/data`、`{根}/data/uploads`、`{根}/backup`。

**配置只来自 TOML**（加约定派生），不读进程环境 —— 原因见上面那节。

## 常用命令

```bash
just check          # 部署前环境检查：SSH / 免密 sudo 白名单 / Caddy / 本地产物 / libc 兼容
just build          # 前端 typecheck+vite 与后端 release 并行，组装 build/
just deploy         # 上传（不停服）→ 停服 → 备份 → 就位 → 起服 → 自检（失败自动恢复）
just deploy --dry-run   # 只打印将要执行的远端命令，不做任何改动
just deploy-web     # 仅前端：不停服、不动 unit、不备份数据库
just deploy-config  # 仅配置：不传二进制、不备份数据库，重启服务并同步 unit/Caddy
just health         # 健康检查（4 项打分，任一不过退出码非零）
just caddy          # 仅同步 Caddy 配置并重载（不停服）
just rollback       # 回滚（just rollback / just rollback 20260921_193500 / --yes）
just status|info|logs
just db-pull|db-push|db-backup|db-check|db-optimize|backup-prune
just list-backups
just render unit|caddy   # 打印渲染结果，可与现网逐字节 diff
```

只读命令（`check` / `status` / `info` / `logs` / `health` / `list-backups`）可以随时
对着生产跑；会改动远端的东西先过 `--dry-run`。

Unix / WSL 上部署默认复用一条 SSH 连接（`ControlMaster`，60s），减少 20+ 次
TCP/认证往返和偶发 `Connection closed`；排障时可设 `BRAINBOW_SSH_NO_MULTIPLEX=1` 关闭。

`just deploy` **不构建**（老 `make deploy` 是 build + deploy 一步）：产物比源码旧时
它会提示一句（比的是产物里的 `REVISION` 与当前 HEAD，拿不准再看 mtime），但不会
替你重新构建。顺序是 `just build && just deploy`。

按改动类型选命令，避免每次都走全量：

- 只改前端：`just deploy-web`（不停服、不传二进制、不备份数据库）。
- 只改 `config/app.prod.toml` / `secret.toml`：`just deploy-config`（只传几 KB 配置，
  重启服务并同步 unit/Caddy；**没有自动回滚**，配置改错时看 `just logs`）。
- 只改 Caddyfile：`just caddy`。
- 改后端/数据库/迁移：`just build && just deploy`。

## 线上跑的是哪个提交

`just build` 会把当时的 git 短 sha（工作区脏则带 `-dirty`）写进 `build/REVISION`，
部署时随产物落到 `service/REVISION`，`just info` 的「构建产物」段显示它：

```
版本: 9399e605-dirty 2026-09-21T16:00:13Z
```

`just deploy` 开头也会打一行"版本"。没有这个文件就是老产物 —— 不影响部署，
`info` 显示"未记录（产物里没有 REVISION）"。

## 部署流程（八步，只有"上传"挪到了停服之前）

1. **同步**（停服前，服务照常对外）：打 tar.gz 灌进 `ssh` 的 stdin，先落到
   `$REMOTE_DIR/tmp/deploy_<ts>/`，校验（`brainbow` 非空、`dist/index.html` 在）
   之后先不动运行目录；`bin/` 与远端 sha256 一致时跳过（省 76MB 那次传输）；
   `REVISION`（构建时的 git 版本）与 `config/app.toml` + `config/secret.toml`
   一起传
2. 停服（首次部署时服务不存在，`stop` 失败是正常的）
3. 备份：`PRAGMA quick_check` 体检 → 数据库一致性备份 → 代码归档 → 清理过期备份
4. 就位：`brainbow` / `dist` / `bin` / `REVISION` / `config/` 从暂存目录 `mv` 过去；
   `dist` 用 `.old` 过渡；`dist` 的目录 755 / 文件 644 也在这步设好（**只扫 dist**，
   不碰 `uploads/`）；`config/` 目录 700、app 644、secret 600
5. 权限：`brainbow` 与 `bin/*` 可执行
6. 渲染并安装 systemd unit（`sudo tee` + `chmod 600`；unit 里只有路径与迁移兼容 env，不含 JWT）
7. `daemon-reload` + `enable` + `start`
8. 等 `/api/health` 就绪（30 次 × 1 秒）

服务就绪之后的收尾都是**失败只告警**：后端只读自检 → 校验刚拍的备份
（`quick_check`）→ `PRAGMA optimize` → 同步 Caddy 并重载。

**为什么上传在停服之前**：上传跟服务在不在没关系（传的是暂存目录），而它是停机
时间里的大头（4MB 的 `dist`，带 ffmpeg 时还有 76MB）。所以停服窗口里只剩"与数据库
有关的那几步"和"就位 + 起服"。注意"改了什么就停多久"仍有一项无法避免：如果停服
时有活跃的 SSE 连接（AI 对话正在流），应用要等满 10 秒宽限才会退出。

关键区（1→8）里任何一步失败都会走**自动恢复**：先尝试用现有产物拉起（给足 30 秒），
不行就回滚到本次部署前的 `code_<ts>.tar.gz`，再不行交给人。

**代码回滚可能连数据库一起回**：部署前后各读一次 `PRAGMA user_version`，变了
（这次部署跑过迁移）就一并还原 `db_deploy_<ts>.db`。因为"库版本高于程序支持版本"
是拒绝启动的，只回代码会得到"旧代码 + 新库"这个必然起不来的组合。没动过 schema
就只回代码，不去覆盖用户数据；读不到版本（远端没有 sqlite3）时按"动过"处理。
手动回滚同理：`just rollback`（不带时间戳）会按同一个时间戳自动配对数据库与代码
（配不上时退回最新一份数据库备份）；只找到代码时会警告"旧代码 + 新库"这个陷阱。

## Caddy 配置

`just caddy` 与 `just deploy` 的收尾走同一条路（`xtask/src/caddy.rs`）：

1. 渲染结果写到「远端根」下的 `tmp/Caddyfile.<ts>.new`（不用 `/tmp` 的可预测路径）
2. 在**候选文件**上跑 `caddy validate --config <候选>`；不通过就删掉候选、现网不动
3. 校验通过才 `sudo tee /etc/caddy/Caddyfile` 覆盖现网，然后 `systemctl reload caddy`
   （reload 失败再 restart）

坏配置不会落盘：运行中的 Caddy 还用着内存里的旧配置，下次重启才会炸，所以不能
"先覆盖再校验"。想先看渲染结果用 `just render caddy`，可与现网逐字节 diff：

```bash
just render caddy | diff - <(ssh <host> 'cat /etc/caddy/Caddyfile')
```

## 部署后自检

服务就绪后自动跑一次只读自检：

```
cd <SERVICE_DIR> && RUST_LOG=info \
  BRAINBOW_CONFIG=<根>/config/app.toml \
  BRAINBOW_SECRETS=<根>/config/secret.toml \
  BRAINBOW_ROOT=<根> ./brainbow --check
```

- 环境对齐 systemd：`cd` 到 unit 的 `WorkingDirectory`，并传入 unit 里的四个变量。
  少传 `BRAINBOW_ROOT` 会让 DB/uploads/backup 退回相对开发默认，检查的是一个跟服务
  无关的目录
- 检查项（6 项）：schema 漂移（含外键）、`PRAGMA quick_check` 全库扫描、上传目录、
  存储一致性、缩略图缓存、时间戳格式扫描
- **只读**：不迁移、不建目录、不删文件
- 失败**只告警不阻断部署** —— 它报告的是数据层问题（缺文件、孤儿、schema 漂移、
  时间戳格式），回滚代码解决不了，而服务本身是好的
- 手动复跑：`ssh <host> "cd <SERVICE_DIR> && BRAINBOW_CONFIG=... BRAINBOW_SECRETS=... BRAINBOW_ROOT=... ./brainbow --check"`；本地则是 `just check-backend`

## 构建注意

### 必须用 musl 静态构建（否则服务器加载即失败）

**构建机与服务器不是同一个发行版，而 glibc 的符号版本只会随构建机走。**

实测（2026-09-21）：WSL 是 Ubuntu 24.04（glibc **2.39**），服务器是 Ubuntu 22.04
（glibc **2.35**）。Rust 的 `std::process::Command` 在 glibc ≥ 2.39 上链接时会绑定
新增的 `pidfd_spawnp@GLIBC_2.39` / `pidfd_getpid@GLIBC_2.39`，产物在服务器上
**加载即失败**：

```
/opt/brb/service/brainbow: /lib/x86_64-linux-gnu/libc.so.6:
  version `GLIBC_2.39' not found (required by /opt/brb/service/brainbow)
```

怎么确认是它：一个 3 行的 `Command::new("true").spawn()` 程序在这台机器上编译
就会引用这两个 2.39 符号，不 spawn 的程序一个都没有。后端唯一的 spawn 点是
file-thumbs 加的 ffmpeg（`src/modules/file/thumb/video.rs`），所以 Sep 12 那版
还能跑、带缩略图的那版就跑不了 —— 与构建/部署工具无关。

**对策**：`config/build.toml` 里 `target = "x86_64-unknown-linux-musl"`，产物完全静态、
不再依赖服务器 libc（顺带以后升级服务器 OS 也不会再撞这类问题）。前置：

```bash
sudo apt install musl-tools          # 提供 musl-gcc（C 依赖要用它编）
rustup target add x86_64-unknown-linux-musl
```

`just check` / `just deploy` 会**在动任何远端东西之前**比一次：扫本地产物里出现
的最高 `GLIBC_2.NNN`（`xtask/src/compat.rs`，等价 `strings | grep`，不依赖 binutils）
与远端 `getconf GNU_LIBC_VERSION`，不匹配就直接拒绝 —— 而不是等服务停了、备份做完
才发现。静态产物没有 glibc 符号，这项自然通过。同一项检查会**先认产物格式**：
不是 ELF（例如 Windows 上本机构建的 PE）直接拒绝，不会再被"没有 glibc 符号"误判成
静态兼容。

要换成"钉住 glibc 版本"的路子也可以：`cargo zigbuild --target
x86_64-unknown-linux-gnu.2.35`（需要 zig），运行时语义与动态链接完全一致。

### sqlx 与前端

- `just build` 的后端 release 构建**必须显式设 `SQLX_OFFLINE=true`**，否则 sqlx 编译期宏走在线模式
  - `.cargo/config.toml` 的 `[env]` 为编辑器注入了 `DATABASE_URL=sqlite:brainbow.db`。
    cargo 的 `[env]` 在未设 `force` 时只填**未设置**的变量，所以 `env -u DATABASE_URL`
    反而会被它注回去 —— 老写法并没有让构建走离线快照，而是在线连仓库根那个
    178MB 且被 gitignore 的 `brainbow.db`
  - 实测（2026-09-21）：`DATABASE_URL` 指向不存在的库 + `SQLX_OFFLINE=false`
    → **265 个编译错误、构建失败，不会回落到 `.sqlx/`**；同一条件下改
    `SQLX_OFFLINE=true` → 2.5s 构建成功，全程不需要任何数据库
  - 代价是"改了 SQL 忘跑 `just sqlx-prepare`"会变成 release 构建直接报
    "没有该查询的缓存"，而不是被本机的 dev 库悄悄掩盖 —— 这是好事
- 前端构建先 `pnpm run typecheck` 再 `pnpm run build`（`xtask/src/build.rs`）；产物里的
  `_md/`、`sitemap.xml`、`robots.txt`、`llms.txt`、`openapi.json`、`.well-known/api-catalog`
  是 Caddy 真在服务的东西，`just build` 会断言它们都在
- 随产物走的 ffmpeg 是**真静态**（`ldd` 报 "not a dynamic executable"），
  已在服务器上实测可运行，不受 glibc 代差影响
- `just build` 与 `just deploy` 是两步（老 `make deploy` 是 build + deploy 一步）；
  产物比源码旧时部署会提示一句

## 备份

每次部署自动：

- 数据库备份：`db_deploy_YYYYMMDD_HHMMSS.db`（与代码备份**共用同一个时间戳**，回滚据此配对）
- 代码备份：`code_YYYYMMDD_HHMMSS.tar.gz`（含 `brainbow` + `dist/` + `config/`）
- 自动清理：**每类各**按"超过 30 天或超出最新 20 份"删除；数据库备份连
  `-wal`/`-shm` 兄弟文件一起清（`db_*.db` 这个 glob 匹配不到它们）
- 部署收尾会 `PRAGMA quick_check` 验一遍**刚拍的那份备份**（失败只告警）：
  以前只在恢复时才检查备份，等于把"备份是坏的"留到换掉现网库的那一刻才发现。
  dry-run 或远端没有 `sqlite3` 时是"未执行"（`Check::Skipped`），别当成"通过"

**备份和原件在同一块盘上**（`$REMOTE_DIR/backup`），异地副本要靠手动
`just db-pull`（拉到本地 `db/`）。磁盘坏掉时它们会一起没 —— 想更稳就得让
`db-pull` 有节律（开发机的计划任务），这是目前流程里唯一的单点。

## 回滚

```bash
just rollback                     # 用最新一份代码备份 + 配对的数据库备份
just rollback 20260921_193500     # 指定时间戳，精确配对
just rollback --yes               # 非交互环境（覆盖数据库不可逆，默认要确认）
```

回滚只替换 `brainbow` 与 `dist`，**不碰** `uploads/`、`bin/`、`REVISION`。
恢复前先把代码备份解到「远端根」下的 `tmp/rollback_<ts>/` 校验，再 `mv` 就位；
数据库那部分会先 `PRAGMA quick_check` 备份文件，覆盖前清掉目标的 `-wal`/`-shm`，
备份自己的兄弟文件也一并带回去。

只找到代码备份（没有配对的数据库）时，`rollback` 会警告一句：如果对应的部署跑过
迁移，旧二进制会因为"库版本比程序新"而拒绝启动（见上面的部署流程）。

## 健康检查

`just health` 检查：

- 后端 API 直连 200
- 后端 API 经 Caddy 200
- 前端 SPA 200
- systemd 运行中

任一不过 → 退出码非零（可以当门禁用）。

## 远端 sudo 是按命令白名单授权的

不是全量 NOPASSWD：`sudo -n true` 会报要密码，但白名单里的命令可以免密跑。
部署实际用到四条（`xtask/src/cmd/check.rs` 的 `REQUIRED_SUDO`）：

- `systemctl`（stop / start / restart / enable / daemon-reload）
- `tee /etc/systemd/system`（安装 unit）
- `chmod 600 /etc/systemd/system`（unit 里有 JWT 密钥）
- `tee /etc/caddy/Caddyfile`（安装 Caddy 配置）

**改任何 sudo 调用形式都要同步确认 sudoers 仍放行**，否则 sudo 会退回要密码，而
部署是无人值守的、只会失败。`just check` 用 `sudo -n -l` 逐条比对这些片段（不需要
密码，也不会被 `sudo -n true` 那种"探全量权限"的假象骗到），授权不全会以非零退出
码报出来。

## 注意

- 项目约定**不 push**；部署通过 SSH 进行
- 若本地 git 历史需要同步到远端，需用户明确要求后再 push
