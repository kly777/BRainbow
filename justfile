# BRainbow 任务入口（取代 Makefile；构建与部署逻辑在 xtask/ 里）。
#
# 规矩：每个 recipe 只写**一条命令**，不用重定向 / 管道 / 变量展开 ——
# 这样 Windows / macOS / Linux 上行为一致，不必再维护一层 shell 兼容。
# 需要逻辑的一律走 `cargo xtask <子命令>`。
#
# `*args` 是原样透传给 xtask 的额外参数（拼在命令尾部、不加引号），
# 所以 `just check --dry-run` / `just deploy --dry-run` 都能用。
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

# ── 部署 ────────────────────────────────────────────────────────────

# 全量部署：停服 → 备份 → 同步 → 起服 → 自检 → 同步 Caddy
# 先看一遍流程用 `just deploy --dry-run`（只打印将要执行的远端命令）
deploy *args:
	@cargo xtask deploy {{args}}

# ── 只读：查环境与状态 ──────────────────────────────────────────────

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
logs lines="50" *args:
	@cargo xtask logs -n {{lines}} {{args}}

# 健康检查：4 项打分，任一不过退出码非零
health *args:
	@cargo xtask health {{args}}

# 列出远端备份
list-backups *args:
	@cargo xtask list-backups {{args}}
