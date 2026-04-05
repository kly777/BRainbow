use std::fs;
use std::path::Path;

fn main() {
    // 读取 .env 文件
    let env_file = {
        if cfg!(debug_assertions) {
            Path::new(".env.dev")
        } else {
            Path::new(".env.prod")
        }
    };
    if env_file.exists() {
        let content = fs::read_to_string(env_file).unwrap();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim().trim_matches('"');
                // 设置编译时环境变量
                println!("cargo:rustc-env={}={}", key, value);
            }
        }
    }

    // 当 .env 改变时重新编译
    println!("cargo:rerun-if-changed=.env");
}
