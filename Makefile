SERVER_DIR := server
TARGET_ARCH := x86_64-unknown-linux-gnu

-include .env.prod

SSH_TARGET := $(REMOTE_USER)@$(REMOTE_HOST)

.PHONY: clean deploy status

build: clean
	cd web && pnpm build
	cd ..
	mkdir -p $(SERVER_DIR)
	cp -r web/dist $(SERVER_DIR)/
	cargo build --target $(TARGET_ARCH) --release
	cp target/$(TARGET_ARCH)/release/brainbow $(SERVER_DIR)/

clean:
	rm -rf $(SERVER_DIR)/

deploy: build
	bash ./deploy.sh

status:
	ssh -p $(REMOTE_PORT) $(SSH_TARGET) "sudo systemctl status $(APP_NAME) --no-pager"
