SERVER_DIR := server
TARGET_ARCH := x86_64-unknown-linux-gnu

-include .env.prod

SSH_TARGET := $(REMOTE_USER)@$(REMOTE_HOST)
time := $(shell date +%y%m%d_%H%M%S)

.PHONY: clean deploy status db-pull db-push logs rollback fmt

dev:
	cargo watch -x run --ignore web & cd web && deno task dev & wait
	cd ..


fmt:
	cargo fmt
	cd web && deno task fmt
	cd ..

build: clean
	cd web && deno task build
	cd ..
	mkdir -p $(SERVER_DIR)
	cp -r web/dist $(SERVER_DIR)/
	cargo build --target $(TARGET_ARCH) --release
	cp target/$(TARGET_ARCH)/release/brainbow $(SERVER_DIR)/

clean:
	rm -rf $(SERVER_DIR)/

deploy: build
	bash ./deploy.sh

# 强制覆盖远端数据库（首次部署 / 数据迁移用）
deploy-force-db: build
	FORCE_DB_OVERWRITE=true bash ./deploy.sh

status:
	ssh -p $(REMOTE_PORT) $(SSH_TARGET) "sudo systemctl status $(APP_NAME) --no-pager"

db-pull:
	mkdir -p db
	scp -P $(REMOTE_PORT) $(SSH_TARGET):$(REMOTE_BASE)/$(APP_NAME)/brainbow.db ./db/brainbow_$(time).db

db-push:
	scp -P $(REMOTE_PORT) ./brainbow.db $(SSH_TARGET):$(REMOTE_BASE)/$(APP_NAME)/brainbow.db
	ssh -p $(REMOTE_PORT) $(SSH_TARGET) "sudo systemctl restart $(APP_NAME)"

logs:
	ssh -p $(REMOTE_PORT) $(SSH_TARGET) "journalctl -u $(APP_NAME) -n 50 --no-pager"

rollback:
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
		sudo test -f $(REMOTE_BASE)/$(APP_NAME)/brainbow && sudo chmod +x $(REMOTE_BASE)/$(APP_NAME)/brainbow; \
		sudo systemctl start $(APP_NAME)"
