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

    /// 会话计数通用骨架：用户可见范围 + 标签过滤 + 指定 where 条件。
    pub(super) async fn count_session_sql(
        &self,
        user_id: i32,
        where_clause: &str,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<i64, sqlx::Error> {
        let mut qb =
            sqlx::QueryBuilder::<sqlx::Sqlite>::new("SELECT COUNT(*) FROM mem m WHERE (m.user_id = ");
        qb.push_bind(user_id);
        qb.push(format!(" OR m.user_id IS NULL) AND {where_clause}"));
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.build_query_scalar().fetch_one(&*self.pool).await
    }
}
