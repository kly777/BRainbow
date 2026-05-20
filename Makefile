SERVER_DIR := server
TARGET_ARCH := x86_64-unknown-linux-gnu

-include .env.prod

SSH_TARGET := $(REMOTE_USER)@$(REMOTE_HOST)
time := $(shell date +%y%m%d_%H%M%S)

.PHONY: clean deploy status db-pull db-push logs rollback fmt check-env

check-env:
	@test -n "$(REMOTE_HOST)" || (echo "错误: .env.prod 未设置 REMOTE_HOST"; exit 1)
	@test -n "$(APP_NAME)"   || (echo "错误: .env.prod 未设置 APP_NAME"; exit 1)

dev:
	cargo watch -x run --ignore web & \
	cd web && deno task dev & \
	wait

fmt:
	cargo fmt
	cd web && deno task fmt

build: clean
	cd web && deno task build
	mkdir -p $(SERVER_DIR)
	cp -r web/dist $(SERVER_DIR)/
	cargo build --target $(TARGET_ARCH) --release
	cp target/$(TARGET_ARCH)/release/brainbow $(SERVER_DIR)/

clean:
	rm -rf $(SERVER_DIR)/

deploy: build check-env
	bash ./deploy.sh

# 覆盖远端数据库
deploy-force-db: build check-env
	FORCE_DB_OVERWRITE=true bash ./deploy.sh

status: check-env
	ssh -p $(REMOTE_PORT) $(SSH_TARGET) "sudo systemctl status $(APP_NAME) --no-pager"

db-pull: check-env
	mkdir -p db
	scp -P $(REMOTE_PORT) $(SSH_TARGET):$(REMOTE_BASE)/$(APP_NAME)/brainbow.db ./db/brainbow_$(time).db

db-push: check-env
	ssh -p $(REMOTE_PORT) $(SSH_TARGET) "sudo systemctl stop $(APP_NAME)"
	scp -P $(REMOTE_PORT) ./brainbow.db $(SSH_TARGET):$(REMOTE_BASE)/$(APP_NAME)/brainbow.db
	ssh -p $(REMOTE_PORT) $(SSH_TARGET) "sudo systemctl start $(APP_NAME)"

logs: check-env
	ssh -p $(REMOTE_PORT) $(SSH_TARGET) "journalctl -u $(APP_NAME) -n 50 --no-pager"

rollback: check-env
	@latest=$$(ssh -p $(REMOTE_PORT) $(SSH_TARGET) "ls -1t $(REMOTE_BASE)/$(APP_NAME)_backups/*.tar.gz 2>/dev/null | head -1 | xargs -r basename | sed 's/.tar.gz//'"); \
	if [ -z "$$latest" ]; then \
		echo "未找到可用备份"; exit 1; \
	fi; \
	echo "回滚到: $$latest"; \
	ssh -p $(REMOTE_PORT) $(SSH_TARGET) "set -euo pipefail; \
		sudo systemctl stop $(APP_NAME) || true; \
		sudo rm -rf $(REMOTE_BASE)/$(APP_NAME)/*; \
		sudo tar -xzf $(REMOTE_BASE)/$(APP_NAME)_backups/$${latest}.tar.gz -C $(REMOTE_BASE); \
		sudo chown -R $(REMOTE_USER):$(REMOTE_USER) $(REMOTE_BASE)/$(APP_NAME); \
		if [ -f $(REMOTE_BASE)/$(APP_NAME)/brainbow ]; then \
			sudo chmod +x $(REMOTE_BASE)/$(APP_NAME)/brainbow; \
			sudo systemctl start $(APP_NAME); \
		else \
			echo '错误: 备份未包含 brainbow 二进制'; exit 1; \
		fi"
