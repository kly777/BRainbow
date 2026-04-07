SERVER_DIR := server
TARGET_ARCH := x86_64-unknown-linux-gnu

build: clean
	cd web && pnpm build
	cd ..
	mkdir -p $(SERVER_DIR)
	cp -r dist $(SERVER_DIR)
	cargo build --target $(TARGET_ARCH) --release
	cp target/$(TARGET_ARCH)/release/brainbow $(SERVER_DIR)/

clean:
	rm -rf $(SERVER_DIR)/

deploy: build
	bash ./deploy.sh
