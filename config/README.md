# TOML 配置

按“谁读”拆分，一个键只有一个家。真实文件全部被 gitignore，仓库只保留 `*.example.toml`。

| 文件 | 谁读 | 内容 |
|---|---|---|
| `app.dev.toml` | 后端 debug + Vite dev | 开发 server/security/site/cors/frontend |
| `app.prod.toml` | 后端 prod + Vite prod build | 生产 server/security/site/cors |
| `deploy.toml` | `xtask` | 远程主机、路径、备份保留 |
| `build.toml` | `xtask build` | 构建目标、是否带 ffprobe |
| `secret.toml` | 后端 + `xtask` | JWT 密钥；0600，Vite 不读 |

## 读取顺序

- 后端：`BRAINBOW_CONFIG` 指向 app 文件；debug 缺省 `config/app.dev.toml`。
- 密钥：`BRAINBOW_SECRETS` 指向 secret 文件；生产缺省 `/opt/brb/config/secret.toml`。
- `xtask`：默认读本目录的 `deploy.toml` + `app.prod.toml` + `build.toml` + `secret.toml`。
- Vite：按 `--mode` 读 `app.dev.toml` / `app.prod.toml` 的 `[frontend]` / `[site]`。
- `BRAINBOW_ROOT` 仍由 systemd 注入，用于派生 `data/`、`uploads/`、`backup/`。
- `RUST_LOG` 仍是普通环境变量；其余逐字段环境变量不再作为配置来源。

## 安全

- `secret.toml` 本地与远端都必须 `chmod 600`。
- `app.prod.toml` 不放密钥，因为 Vite 构建也会读它。
- 配置与二进制一起备份/回滚，避免“旧代码 + 新配置”。
