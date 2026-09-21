# ── 本地开发目标（构建/检查/测试/清理） ──
#
# **部署与远端操作已经全部搬到 justfile**（`just deploy` / `just check` /
# `just rollback` / `just db-*` …），逻辑在 xtask/ 里（Rust，跨平台、可测）。
# 原先那些转发 deploy/deploy.sh 的目标已随该脚本一并移除。
#
# 这里保留的只是本地开发的手感与几个 just 还没覆盖的清理/分析目标
# （clean / udeps / bloat / build-stats …）。两边同名的目标（dev / fmt / lint /
# test / build-web / build-backend …）效果一致，用哪个都行。

BUILD_DIR := build

-include .env.prod

.PHONY: dev dev-backend dev-backend-fast dev-web fmt lint build-web build-backend bundle-ffmpeg clean clean-all check-backend sqlx-prepare test test-verbose udeps bloat clean-cache build-stats

# 用 make 并行目标跑后端/前端：Ctrl+C 时 make 会给所有并行 job 发信号并等待清理
# （cargo-watch 8.x 收到 SIGINT 会用进程组清理 cargo run/brainbow）
# -s 抑制 make 自身的输出（Entering directory/配方回显），job 的实际输出照常显示
dev:
	@$(MAKE) -s -j2 dev-backend dev-web

# 开发后端：cargo-watch 监听源码变化自动编译+重启服务
# --delay 1.5 防抖：避免 IDE 保存触发的连续多次编译
dev-backend:
	# 忽略 web（前端）、build（构建产物）、uploads（用户文件）、.sqlx（离线数据）：
	# 这些目录的变化不应触发后端重新编译。
	# cargo-watch 8.x 默认会读 .gitignore 过滤 target/ 与 *.db* 等，
	# 此处显式列出不可由 gitignore 覆盖或需额外强调的路径。
	@MAKEFLAGS= cargo-watch -x run --delay 1.5 --ignore web --ignore $(BUILD_DIR) --ignore uploads --ignore .sqlx

# 快速编译验证（不启动服务）：适合多窗口开发时单独验证后端能否编译通过
dev-backend-fast:
	@MAKEFLAGS= cargo-watch -x check --delay 1 --ignore web --ignore $(BUILD_DIR) --ignore uploads --ignore .sqlx

dev-web:
	# -s 抑制 pnpm 的 "Already up to date"/"$ vite ..." 回显噪音
	@cd web && pnpm -s run dev

fmt:
	cargo fmt
	cd web && pnpm run fmt

# 代码质量检查：clippy（后端）+ biome/stylelint（前端）
lint:
	cargo clippy --all-targets
	cd web && pnpm run lint

# SQL 编译期校验：先生成"迁移到最新版"的 fixture 库，再刷新 .sqlx offline data。
# schema/迁移变更后必须重跑并提交 .sqlx。
# 前置：cargo install sqlx-cli --no-default-features --features sqlite
sqlx-prepare:
	rm -f target/sqlx-prepare.db target/sqlx-prepare.db-shm target/sqlx-prepare.db-wal
	cargo test prepare_schema_fixture -- --ignored
	DATABASE_URL=sqlite:target/sqlx-prepare.db cargo sqlx prepare

# 后端只读自检：数据库 schema/完整性 + 上传目录 + 存储一致性。
# 不迁移、不建目录、不删文件；退出码 0 = 一切正常，非 0 = 有需要处理的问题。
# 生产环境用已部署的二进制跑：ssh <host> '<REMOTE_DIR>/brainbow --check'
check-backend:
	cargo run --quiet -- --check

# 仅构建后端产物，复用 web/dist（先检查存在性，避免静默拷贝空目录）。
# 注：`just build-backend` 是同一件事，且额外把 SQLX_OFFLINE=true 与摘掉
# DATABASE_URL 一起显式设上（只 env -u 是没用的，[env] 会把它注回去）。
build-backend:
	@[ -f web/dist/index.html ] || (echo "错误: web/dist 不存在，请先 make build-web"; exit 1)
	env -u DATABASE_URL cargo build --release
	rm -rf $(BUILD_DIR)
	mkdir -p $(BUILD_DIR)/dist
	cp -r web/dist/. $(BUILD_DIR)/dist/
	cp target/release/brainbow $(BUILD_DIR)/brainbow
	@$(MAKE) -s bundle-ffmpeg

# 把 vendor/ffmpeg/bin（just fetch-ffmpeg 取来的静态二进制）拷进产物。
# 没有它也照常构建：视频缩略图会永久降级为后缀徽章，其他功能不受影响
# （降级路径见 src/modules/file/thumb/video.rs 的 available()）
#
# **ffprobe 默认不发**：它两个用途都没有 —— 出图只需要 ffmpeg，而 ffprobe 只负责
# 给"浏览器读不出容器"的视频回填时长（mkv/avi 那批）。静态构建两个各 ~77MB，
# 一起发等于把产物体积翻几倍。要它就 WITH_FFPROBE=1 just build。
bundle-ffmpeg:
	@if [ -x vendor/ffmpeg/bin/ffmpeg ]; then \
		mkdir -p $(BUILD_DIR)/bin; \
		cp vendor/ffmpeg/bin/ffmpeg $(BUILD_DIR)/bin/ffmpeg; \
		note=""; \
		if [ "$(WITH_FFPROBE)" = "1" ] && [ -x vendor/ffmpeg/bin/ffprobe ]; then \
			cp vendor/ffmpeg/bin/ffprobe $(BUILD_DIR)/bin/ffprobe; \
			note="+ffprobe"; \
		fi; \
		echo "已带上 ffmpeg$$note: $$(du -sh $(BUILD_DIR)/bin | cut -f1)"; \
	else \
		echo "提示: 未取 ffmpeg（just fetch-ffmpeg），视频缩略图将降级为后缀徽章"; \
	fi

build-web:
	cd web && pnpm run build

# 清理构建产物：build/（组装产物）+ target/（Rust 编译缓存）
# 保留 node_modules 以便后续构建更快
clean:
	rm -rf $(BUILD_DIR)/
	cargo clean

# 完全清理（clean + 前端依赖/产物）
clean-all: clean
	cd web && rm -rf node_modules dist

# 使用 cargo-nextest 运行测试（比 cargo test 快 2-3 倍）；未安装时自动降级 cargo test
# 安装: cargo install cargo-nextest
test:
	@if command -v cargo-nextest >/dev/null 2>&1; then \
		cargo nextest run; \
	else \
		echo "cargo-nextest 未安装，降级使用 cargo test"; \
		cargo test; \
	fi

# 使用 cargo-nextest 运行测试（带输出）
test-verbose:
	@if command -v cargo-nextest >/dev/null 2>&1; then \
		cargo nextest run --no-capture; \
	else \
		echo "cargo-nextest 未安装，降级使用 cargo test"; \
		cargo test -- --no-capture; \
	fi

# 检查未使用的依赖
# 安装: cargo install cargo-udeps
udeps:
	cargo +nightly udeps --all-targets

# 检查二进制大小
bloat:
	cargo bloat --release -n 20

# 清理旧的编译缓存
clean-cache:
	rm -rf target/release/.fingerprint/brainbow-*
	rm -rf target/debug/.fingerprint/brainbow-*

# 显示构建统计
build-stats:
	@echo "=== 构建统计 ==="
	@echo "后端二进制大小: $$(du -h target/release/brainbow 2>/dev/null | cut -f1 || echo 'N/A')"
	@echo "前端 dist 大小: $$(du -sh web/dist 2>/dev/null | cut -f1 || echo 'N/A')"
	@echo "target/ 目录大小: $$(du -sh target/ 2>/dev/null | cut -f1 || echo 'N/A')"
	@echo "node_modules 大小: $$(du -sh web/node_modules 2>/dev/null | cut -f1 || echo 'N/A')"

# ── 远端/部署 ──
# 全部在 justfile + xtask 里。下面这些名字留成"指路牌"：不加会得到
# `make: Nothing to be done for 'deploy'`（因为 deploy/ 目录同名），
# 比报错更让人困惑。
.PHONY: deploy deploy-web deploy-backend check-deploy caddy status info logs \
	db-pull db-push rollback list-backups health db-backup db-check db-optimize \
	backup-prune fetch-ffmpeg

deploy deploy-web deploy-backend check-deploy caddy status info logs \
db-pull db-push rollback list-backups health db-backup db-check db-optimize \
backup-prune fetch-ffmpeg:
	@echo "这些已搬到 just / xtask：请用 \`just $@\`（\`just --list\` 看全部）"
	@exit 1
