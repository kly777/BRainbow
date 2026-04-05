SERVER_DIR := server


build: clean
	cd web && pnpm build
	cd ..
	mkdir -p $(SERVER_DIR)
	cp -r dist $(SERVER_DIR)
	cargo build --target x86_64-unknown-linux-gnu --release
	cp target/x86_64-unknown-linux-gnu/release/brainbow $(SERVER_DIR)/

clean:
	rm -rf $(SERVER_DIR)/

deploy:
	bash ./deploy.sh
