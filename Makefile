BUILD_DIR := build

# 与 deploy.sh load_config 保持一致的后备值（.env.prod 可覆盖）
REMOTE_BASE ?= /opt
REMOTE_PORT ?= 22

-include .env.prod

time := $(shell date +%y%m%d_%H%M%S)
DEPLOY_SCRIPT := deploy/deploy.sh

.PHONY: dev dev-backend dev-backend-fast dev-web fmt lint build build-web build-backend clean clean-all deploy deploy-web deploy-backend check-deploy status info logs db-pull db-push health rollback list-backups sqlx-prepare test test-verbose udeps bloat clean-cache build-stats db-check db-optimize db-backup backup-prune check-env

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

# 部署环境检查：SSH/Caddy/构建产物（原名 check，改名避免与 Rust check 惯例冲突）
check-deploy:
	$(DEPLOY_SCRIPT) check

build:
	$(DEPLOY_SCRIPT) build

# 全量部署（构建 → 部署）
deploy: build
	$(DEPLOY_SCRIPT) deploy

# 仅部署前端（假设 build/ 已存在）
# 目标必须是 SERVICE_DIR/dist（Caddy DIST_DIR 同源），否则同步到不服务的目录造成静默失败
deploy-web: check-env
	@[ -d "$(BUILD_DIR)/dist" ] || (echo "错误: 请先 make build"; exit 1)
	@if [ "$(BUILD_DIR)/dist/index.html" -ot web/dist/index.html ]; then \
		echo "错误: build/dist 落后于 web/dist，请先 make build-web"; exit 1; fi
	echo "=== 仅部署前端 -> $(REMOTE_BASE)/$(APP_NAME)/service/dist ==="
	rsync -avz --delete -e "ssh -p $(REMOTE_PORT)" \
		$(BUILD_DIR)/dist/ \
		$(REMOTE_USER)@$(REMOTE_HOST):$(REMOTE_BASE)/$(APP_NAME)/service/dist/
	@echo "=== 校验远端与本地 index.html 一致 ==="
	@remote_md5=$$(ssh -p $(REMOTE_PORT) $(REMOTE_USER)@$(REMOTE_HOST) \
		"md5sum $(REMOTE_BASE)/$(APP_NAME)/service/dist/index.html" | awk '{print $$1}'); \
	local_md5=$$(md5sum $(BUILD_DIR)/dist/index.html | awk '{print $$1}'); \
	if [ "$$remote_md5" = "$$local_md5" ] && [ -n "$$remote_md5" ]; then \
		echo "校验通过：远端与本地一致"; \
	else \
		echo "错误: 远端前端与本地不一致，部署疑似失败"; exit 1; fi

# 仅部署后端（假设 build/ 已存在）
deploy-backend: check-env
	@[ -f "$(BUILD_DIR)/brainbow" ] || (echo "错误: 请先 make build"; exit 1)
	$(DEPLOY_SCRIPT) deploy

# 仅构建后端产物（与 deploy.sh build 同口径：env -u DATABASE_URL 强制走 .sqlx 离线快照；
# 复用 web/dist，因此先检查其存在性，避免静默拷贝空目录——deploy-backend 链路必须有 build/dist）
build-backend:
	@[ -f web/dist/index.html ] || (echo "错误: web/dist 不存在，请先 make build-web"; exit 1)
	env -u DATABASE_URL cargo build --release
	rm -rf $(BUILD_DIR)
	mkdir -p $(BUILD_DIR)/dist
	cp -r web/dist/. $(BUILD_DIR)/dist/
	cp target/release/brainbow $(BUILD_DIR)/brainbow

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


# ── 快捷命令委托给 deploy/deploy.sh ──

status:
	$(DEPLOY_SCRIPT) status

# 部署服务信息
info:
	$(DEPLOY_SCRIPT) info

logs:
	$(DEPLOY_SCRIPT) logs $(n)

db-pull:
	$(DEPLOY_SCRIPT) db-pull

db-push:
	$(DEPLOY_SCRIPT) db-push

rollback:
	$(DEPLOY_SCRIPT) rollback $(name)

list-backups:
	$(DEPLOY_SCRIPT) list-backups

health:
	$(DEPLOY_SCRIPT) health

db-backup:
	$(DEPLOY_SCRIPT) db-backup

db-check:
	$(DEPLOY_SCRIPT) db-check

db-optimize:
	$(DEPLOY_SCRIPT) db-optimize

backup-prune:
	$(DEPLOY_SCRIPT) backup-prune

check-env:
	@test -n "$(REMOTE_HOST)" || (echo "错误: .env.prod 未设置 REMOTE_HOST"; exit 1)
	@test -n "$(REMOTE_USER)" || (echo "错误: .env.prod 未设置 REMOTE_USER"; exit 1)
	@test -n "$(REMOTE_BASE)" || (echo "错误: .env.prod 未设置 REMOTE_BASE"; exit 1)
	@test -n "$(APP_NAME)"   || (echo "错误: .env.prod 未设置 APP_NAME"; exit 1)
