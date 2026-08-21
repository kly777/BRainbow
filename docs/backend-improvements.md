# 后端改进计划（Backend Improvements）

> 本文档记录当前后端在完成多轮重构后仍存在的改进点，按优先级排列。
> 每完成一项应单独提交，并运行 `cargo check / test / clippy / fmt`。

## 1. 进一步拆分 `mem_impl/mem.rs`

- 现状：`src/modules/mem/repository/mem_impl/mem.rs` 约 506 行，集中了 mem CRUD、状态机、FSRS 更新。
- 目标：拆成 `crud.rs`（create/get/get_all/count/delete）与 `fsrs.rs`（set_state/update_mem_fsrs/bury/unbury/recent_retention）等。
- 验收：文件更小，职责更清晰，测试全绿。

## 2. 进一步拆分 `db_viewer/repository/mod.rs`

- 现状：`src/modules/db_viewer/repository/mod.rs` 约 594 行，`get_table_data` 等仍在一个文件。
- 目标：拆成 `table.rs`（表名/表数据/导出）与 `backref.rs`（反向引用）两个子模块。
- 验收：主文件变小，结构清晰。

## 3. 收敛 repository 测试对私有字段的访问

- 现状：`MemConfigRepo.pool`、`MemRepo.pool` 等为了测试暴露为 `pub(crate)`。
- 目标：改为提供 `pool()` 访问器，或把测试放进同模块，避免暴露内部字段。
- 验收：字段保持私有，测试仍可通过访问器/同模块访问。

## 4. 统一 AppState 子状态风格

- 现状：`auth` 是 AppState 平铺字段，其他模块都是 `XxxState` 子状态。
- 目标：新增 `AuthState { auth: AuthService }`，并把 `FromRef` 改为从子状态转发。
- 验收：AppState 结构风格统一，行为不变。

## 5. 评估 `SearchPort` 注册机制

- 现状：`SearchQueryService` 持有 `Vec<Arc<dyn SearchPort>>`，在 `AppState::new` 里手动组装 9 个模块。
- 目标：评估引入 `SearchPortRegistry` 或按模块注册，减少组合根膨胀。
- 说明：如果当前规模可接受，可暂不实施，仅记录评估结论。

## 6. 评估 `TimeWindowService` 的泛型化

- 现状：`TimeWindowService` 持有 `Arc<dyn TaskTimeWindowValidator>`。
- 目标：评估是否改为泛型 `TimeWindowService<V: TaskTimeWindowValidator>` 以去掉内部 dyn。
- 说明：会波及 AppState 和 FromRef，收益有限时可不做。

## 7. 将 `refactor/backend-cleanup` 合并回 `main`

- 现状：大量后端重构停留在分支 `refactor/backend-cleanup`。
- 目标：确认无问题后合并回 `main`（或 push 远端）。

---

## 完成标准

- 每个 item 单独提交；
- 每个 item 提交前运行：
  - `cargo check`
  - `cargo test`
  - `cargo clippy`
  - `cargo fmt`
