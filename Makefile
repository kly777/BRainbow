BUILD_DIR := build

# 与 deploy.sh load_config 保持一致的后备值（.env.prod 可覆盖）
REMOTE_BASE ?= /opt
REMOTE_PORT ?= 22

-include .env.prod

time := $(shell date +%y%m%d_%H%M%S)
DEPLOY_SCRIPT := deploy/deploy.sh

.PHONY: dev dev-backend dev-web fmt build build-check build-web build-backend clean deploy deploy-web deploy-backend check status info logs db-pull db-push rollback list-backups sqlx-prepare db-check db-optimize db-backup backup-prune

# 用 make 并行目标跑后端/前端：Ctrl+C 时 make 会给所有并行 job 发信号并等待清理
# （cargo-watch 8.x 收到 SIGINT 会用进程组清理 cargo run/brainbow）
# -s 抑制 make 自身的输出（Entering directory/配方回显），job 的实际输出照常显示
dev:
	@$(MAKE) -s -j2 dev-backend dev-web

dev-backend:
	@MAKEFLAGS= cargo-watch -x run --ignore web --ignore build --ignore $(BUILD_DIR)

dev-web:
	# -s 抑制 pnpm 的 "Already up to date"/"$ vite ..." 回显噪音
	@cd web && pnpm -s run dev

fmt:
	cargo fmt
	cd web && pnpm run fmt

# SQL 编译期校验：先生成"迁移到最新版"的 fixture 库，再刷新 .sqlx offline data。
# schema/迁移变更后必须重跑并提交 .sqlx。
# 前置：cargo install sqlx-cli --no-default-features --features sqlite
sqlx-prepare:
	rm -f target/sqlx-prepare.db target/sqlx-prepare.db-shm target/sqlx-prepare.db-wal
	cargo test prepare_schema_fixture -- --ignored
	DATABASE_URL=sqlite:target/sqlx-prepare.db cargo sqlx prepare

check:
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

# 仅编译（快速迭代）
# 仅构建后端产物（与 deploy.sh build 同口径：env -u DATABASE_URL 强制走 .sqlx 离线快照；
# dist 缺失直接报错而非吞掉——deploy-backend 链路必须要有 build/dist）
build-backend:
	env -u DATABASE_URL cargo build --release
	rm -rf $(BUILD_DIR)
	mkdir -p $(BUILD_DIR)/dist
	cp -r web/dist/. $(BUILD_DIR)/dist/
	cp target/release/brainbow $(BUILD_DIR)/brainbow

build-web:
	cd web && pnpm run build

clean:
	rm -rf $(BUILD_DIR)/

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
	@test -n "$(APP_NAME)"   || (echo "错误: .env.prod 未设置 APP_NAME"; exit 1)
