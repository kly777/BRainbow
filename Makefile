BUILD_DIR := build

-include .env.prod

time := $(shell date +%y%m%d_%H%M%S)
DEPLOY_SCRIPT := ./scripts/deploy.sh

.PHONY: dev fmt build build-check build-web build-backend clean deploy deploy-web deploy-backend check status logs db-pull db-push rollback list-backups

dev:
	trap 'wait; printf "Finished"; exit 0' INT TERM; \
	cargo watch -x run --ignore web --ignore build --ignore $(BUILD_DIR) & \
	cd web && npx vite & \
	wait

fmt:
	cargo fmt
	cd web && npx @biomejs/biome format --write src/

check:
	./$(DEPLOY_SCRIPT) check

build:
	./$(DEPLOY_SCRIPT) build

# 全量部署（构建 → 部署）
deploy: build
	./$(DEPLOY_SCRIPT) deploy

# 仅部署前端（假设 build/ 已存在）
deploy-web: check-env
	@[ -d "$(BUILD_DIR)/dist" ] || (echo "错误: 请先 make build"; exit 1)
	echo "=== 仅部署前端 ==="
	rsync -avz --delete -e "ssh -p $(REMOTE_PORT)" \
		$(BUILD_DIR)/dist/ \
		$(REMOTE_USER)@$(REMOTE_HOST):$(REMOTE_BASE)/$(APP_NAME)/dist/
	ssh -p $(REMOTE_PORT) $(REMOTE_USER)@$(REMOTE_HOST) \
		"sudo systemctl reload caddy 2>/dev/null || true"

# 仅部署后端（假设 build/ 已存在）
deploy-backend: check-env
	@[ -f "$(BUILD_DIR)/brainbow" ] || (echo "错误: 请先 make build"; exit 1)
	./$(DEPLOY_SCRIPT) deploy

# 仅编译（快速迭代）
build-backend:
	cargo build --release
	rm -rf $(BUILD_DIR)
	mkdir -p $(BUILD_DIR)
	cp web/dist/index.html $(BUILD_DIR)/dist/ 2>/dev/null || true
	cp target/release/brainbow $(BUILD_DIR)/brainbow

build-web:
	cd web && npx vite build

clean:
	rm -rf $(BUILD_DIR)/

# ── 快捷命令委托给 scripts/deploy.sh ──

status:
	./$(DEPLOY_SCRIPT) status

logs:
	./$(DEPLOY_SCRIPT) logs $(n)

db-pull:
	./$(DEPLOY_SCRIPT) db-pull

db-push:
	./$(DEPLOY_SCRIPT) db-push

rollback:
	./$(DEPLOY_SCRIPT) rollback $(name)

list-backups:
	./$(DEPLOY_SCRIPT) list-backups

health:
	./$(DEPLOY_SCRIPT) health

db-backup:
	./$(DEPLOY_SCRIPT) db-backup

backup-prune:
	./$(DEPLOY_SCRIPT) backup-prune

check-env:
	@test -n "$(REMOTE_HOST)" || (echo "错误: .env.prod 未设置 REMOTE_HOST"; exit 1)
	@test -n "$(APP_NAME)"   || (echo "错误: .env.prod 未设置 APP_NAME"; exit 1)
