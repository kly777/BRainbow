//! MemRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::super::MemRepo` 的一个方法组。

impl super::super::MemRepo {
    pub(super) fn tag_filter_sql(qb: &mut sqlx::QueryBuilder<sqlx::Sqlite>, tag_ids: &[i32]) {
        if tag_ids.is_empty() {
            return;
        }
        qb.push(" AND EXISTS (SELECT 1 FROM mem_tag WHERE mem_id = m.id AND tag_id IN (");
        let mut sep = qb.separated(", ");
        for &tid in tag_ids {
            sep.push_bind(tid);
        }
        qb.push("))");
    }

    pub(super) fn exclude_tag_filter_sql(
        qb: &mut sqlx::QueryBuilder<sqlx::Sqlite>,
        tag_ids: &[i32],
    ) {
        if tag_ids.is_empty() {
            return;
        }
        qb.push(" AND NOT EXISTS (SELECT 1 FROM mem_tag WHERE mem_id = m.id AND tag_id IN (");
        let mut sep = qb.separated(", ");
        for &tid in tag_ids {
            sep.push_bind(tid);
        }
        qb.push("))");
    }
}
