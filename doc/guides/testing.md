# 测试与质量

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

## 后端

```bash
cargo test                # 应用本体 + crates/db（根 Cargo.toml 的 default-members）
cargo test --workspace    # 连 xtask 一起（`just test` 用这条；装了 nextest 则换成 nextest run --workspace）
cargo test <module>       # 只跑某个模块，例如 cargo test modules::reading
cargo clippy --workspace --all-targets   # lint 门禁（含 xtask），提交前必过
```

也走 justfile 入口：`just test`（xtask 优先用 cargo-nextest，没有就退回
`cargo test --workspace`）与 `just test-web`（`pnpm run test`）。

- 测试覆盖：数据库迁移、repository、service、handler、共享工具
- SQL 相关测试使用内存 SQLite + `crate::db::migrate`
- 生产代码 lint 门禁：禁止 unwrap/expect/panic/dbg/println 等（只作用于应用本体；
  `xtask/` 与 `crates/db/` 是独立 crate，不继承）

## 前端

```bash
cd web
pnpm run check            # vp check（Oxfmt 格式 + Oxlint + 类型检查）+ stylelint
pnpm run lint             # vp lint --fix + stylelint --fix
pnpm run test             # vp test run（Vitest 5）
pnpm run build            # vp build --mode prod
```

- 测试文件约定：`src/**/*.test.ts(x)`
- **测试环境按文件分**（`vite.config.ts`）：`.test.ts` → node、`.test.tsx` → jsdom。
  需要 DOM 的 `.ts`（hook / 键盘 / 剪贴板 / 媒体时长…）在文件头写
  `// @vitest-environment jsdom`。jsdom 是**每文件**一笔启动开销，纯逻辑测试别跟着
  吃这份开销。写错环境不会静默 ——
  会直接报 `window is not defined`
- 修改逻辑尽量补测试；涉及 UI 状态用 Vitest + jsdom
- **别每次都跑全量**：`pnpm run test src/platform/file`、`cargo test modules::file`
  这种单模块跑法便宜得多，全量留到提交前。两套全量**不要并行跑**
  （本机内存 7.6GB，jsdom 与 cargo 测试会互相抢核换页，串行反而更快）
- 渲染测试若挂载了含**懒加载 Markdown** 的页面（卡片正文、实时预览等），用例结束前
  `await vi.dynamicImportSettled()`：工具链是动态 import 的 chunk，不等它落地，全量并行
  跑时环境会先拆掉，飞在路上的 import 会以 `EnvironmentTeardownError` 让整轮退出码非零
  （用例全绿但 exit=1，`pnpm run check` 之后才发现的坑）

页面级冒烟（Playwright，真浏览器）见 [e2e-smoke.md](./e2e-smoke.md)，入口 `just e2e`。

## SQL 变更后

```bash
just sqlx-prepare
```

会生成 fixture 库并刷新 `.sqlx/` 离线数据，随后把变更一起提交。

## 提交前清单

- [ ] `just test`（或 `cargo test --workspace`）通过
- [ ] `cargo clippy --workspace --all-targets` 通过
- [ ] 若改前端：`pnpm run check && pnpm run test` 通过
- [ ] 若改 SQL：`just sqlx-prepare` 已执行且 `.sqlx/` 已更新
- [ ] 未 push（除非用户明确要求）
