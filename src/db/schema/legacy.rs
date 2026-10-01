//! 废弃对象：老库上要清掉的东西（表 / 索引 / 列）。
//!
//! 每条都对应一次历史变更（注释标出版本）。应用顺序由 `apply::reconcile` 定：
//! 表与索引在第 ① 阶段、废弃列在第 ⑦ 阶段（**必须在第 ④ 阶段把引用它的索引换掉之后**，
//! SQLite 不许删被索引引用的列）。
//!
//! **声明之外的列只有登记在这里的才删**：不认识的列一律留着并告警 —— 那是漂移，
//! 该由 `--check` 报出来，而不是默默删掉别人的数据。

/// 废弃索引
pub(crate) const INDEXES: &[&str] = &[
    // v15：media 表退役
    "idx_media_stored_id",
    "idx_media_type_created",
    // v18：被 stored_id 的 UNIQUE 隐含索引覆盖，冗余
    "idx_file_stored_id",
    // v17：旧的 (user_id, content_hash) 复合索引，全局去重用不上
    "idx_file_content_hash",
];

/// 废弃表
pub(crate) const TABLES: &[&str] = &[
    "conv",  // v2：并入 chat_tree / chat_node
    "media", // v15：由 file 家族接管
];

/// 废弃列：(表, 列)
pub(crate) const COLUMNS: &[(&str, &str)] = &[
    // v19：`file_category` 普通列 → `category` 虚拟生成列。
    // 值由 mime 推导，没有要搬的数据；引用它的旧索引在第 ④ 阶段被换成新形态
    // （`idx_file_category` 的 DDL 文本变了，会被"文本不符则替换"收敛）
    ("file", "file_category"),
];
