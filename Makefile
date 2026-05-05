SERVER_DIR := server
TARGET_ARCH := x86_64-unknown-linux-gnu

-include .env.prod

SSH_TARGET := $(REMOTE_USER)@$(REMOTE_HOST)
time := $(shell date +%y%m%d_%H%M%S)

.PHONY: clean deploy status db-pull db-push

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

db-pull:
	mkdir -p db
	scp -P $(REMOTE_PORT) $(SSH_TARGET):$(REMOTE_BASE)/$(APP_NAME)/brainbow.db ./db/brainbow_$(time).db

db-push:
	scp -P $(REMOTE_PORT) ./brainbow.db $(SSH_TARGET):$(REMOTE_BASE)/$(APP_NAME)/brainbow.db
	ssh -p $(REMOTE_PORT) $(SSH_TARGET) "sudo systemctl restart $(APP_NAME)"
