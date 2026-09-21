# BRainbow 任务入口（取代 Makefile；构建与部署逻辑都在 xtask/ 里）。
#
# 规矩：每个 recipe 只写**一条命令**，不用重定向 / 管道 / 变量展开 ——
# 这样 Windows / macOS / Linux 上行为一致，不必再维护一层 shell 兼容。
# 需要逻辑的一律走 `cargo xtask <子命令>`。
#
# `*args` 是原样透传给 xtask 的额外参数（拼在命令尾部、不加引号），
# 所以 `just deploy --dry-run`、`just rollback 20260921_193500 --yes` 都能用。
#
# 只读命令（check / status / info / logs / health / list-backups）可以随时
# 对着生产跑；会改动远端的东西请先过 `--dry-run`。

# 列出所有任务
default:
	@just --list

# ── 本地：构建与开发循环 ────────────────────────────────────────────

# 构建前端 + 后端并组装 build/（前端 typecheck+build 与后端 release 并行）
build *args:
	@cargo xtask build {{args}}

# 只构建前端到 web/dist
build-web *args:
	@cargo xtask build-web {{args}}

# 只构建后端，复用现成的 web/dist（省一次 vite）
build-backend *args:
	@cargo xtask build-backend {{args}}

# 开发模式：cargo-watch + vite 并行（Ctrl-C 一起退出）
dev *args:
	@cargo xtask dev {{args}}

# 格式化：cargo fmt + 前端 biome format
fmt *args:
	@cargo xtask fmt {{args}}

# 检查：clippy（workspace，含 xtask）+ 前端 biome/stylelint
lint *args:
	@cargo xtask lint {{args}}

# 后端测试（装了 cargo-nextest 就用它）
test *args:
	@cargo xtask test {{args}}

# 前端测试
test-web *args:
	@cargo xtask test-web {{args}}

# 刷新 .sqlx 离线数据（SQL / schema 变更后必跑，并把 .sqlx 一起提交）
sqlx-prepare *args:
	@cargo xtask sqlx-prepare {{args}}

# 取静态 ffmpeg 到 vendor/ffmpeg/bin（视频海报帧用；版本与哈希见 deploy/ffmpeg.lock）
fetch-ffmpeg *args:
	@cargo xtask fetch-ffmpeg {{args}}

# ── 远端：部署 ──────────────────────────────────────────────────────

# 先看一遍流程用 `just deploy --dry-run`（只打印将要执行的远端命令）
# 全量部署：停服 → 备份 → 同步 → 起服 → 自检 → 同步 Caddy
deploy *args:
	@cargo xtask deploy {{args}}

# 仅部署前端：不停服、不动 unit、不备份数据库
deploy-web *args:
	@cargo xtask deploy-web {{args}}

# 只同步 Caddy 配置并重载（改 deploy/Caddyfile 后用）
caddy *args:
	@cargo xtask caddy {{args}}

# 回滚：just rollback / just rollback 20260921_193500 / just rollback --yes
rollback *args:
	@cargo xtask rollback {{args}}

# ── 远端：数据库与备份 ──────────────────────────────────────────────

# 数据库完整性检查（PRAGMA integrity_check，全库扫描）
db-check *args:
	@cargo xtask db-check {{args}}

# 更新 SQLite 统计信息（PRAGMA optimize）
db-optimize *args:
	@cargo xtask db-optimize {{args}}

# 手动做一次数据库备份（并清理过期备份）
db-backup *args:
	@cargo xtask db-backup {{args}}

# 只清理过期备份
backup-prune *args:
	@cargo xtask backup-prune {{args}}

# 把远端数据库拉到本地 db/
db-pull *args:
	@cargo xtask db-pull {{args}}

# 用本地数据库覆盖远端（会确认；非交互请加 --yes）
db-push *args:
	@cargo xtask db-push {{args}}

# ── 远端：只读 ──────────────────────────────────────────────────────

# 部署前环境检查：SSH / 免密 sudo 白名单 / Caddy / 本地产物
check *args:
	@cargo xtask check {{args}}

# 远端服务状态与最近日志
status *args:
	@cargo xtask status {{args}}

# 部署信息汇总：状态 / 产物 / 数据 / 资源 / 配置 / 端点 / 日志
info *args:
	@cargo xtask info {{args}}

# 远端日志（just logs / just logs 200）
logs *args:
	@cargo xtask logs {{args}}

# 健康检查：4 项打分，任一不过退出码非零
health *args:
	@cargo xtask health {{args}}

# 列出远端备份
list-backups *args:
	@cargo xtask list-backups {{args}}
