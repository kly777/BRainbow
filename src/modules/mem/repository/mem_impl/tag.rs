//! MemRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::super::MemRepo` 的一个方法组。
//! `new` 与模块声明保留在 `mod.rs`。

use super::super::super::dto::*;
use super::super::super::model::*;
use super::super::*;
impl super::super::MemRepo {
    pub async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, sqlx::Error> {
        let row = sqlx::query_as!(
            TagRow,
            r#"INSERT INTO tag (name, user_id) VALUES (?1, ?2)
               RETURNING id AS "id!: i32", name,
                         COALESCE(created_at, '') AS "created_at!: String""#,
            name,
            user_id
        )
        .fetch_one(&*self.pool)
        .await?;
        Ok(TagInfo {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
        })
    }

    pub async fn delete_tag(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!("DELETE FROM tag WHERE id = ?1", id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TagRow,
            r#"SELECT t.id AS "id: i32", t.name,
                      COALESCE(t.created_at, '') AS "created_at!: String"
               FROM tag t
               WHERE t.user_id = ?1
                 AND EXISTS (SELECT 1 FROM mem_tag WHERE tag_id = t.id)
               ORDER BY t.name"#,
            user_id
        )
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| TagInfo {
                id: r.id,
                name: r.name,
                created_at: r.created_at,
            })
            .collect())
    }

    pub async fn search_tags(&self, user_id: i32, q: &str) -> Result<Vec<TagInfo>, sqlx::Error> {
        if q.is_empty() {
            return Ok(vec![]);
        }
        let rows = sqlx::query_as!(
            TagRow,
            r#"SELECT id AS "id: i32", name,
                      COALESCE(created_at, '') AS "created_at!: String"
               FROM tag WHERE user_id = ?1 AND name LIKE ?2 ESCAPE '\'
               ORDER BY name LIMIT 20"#,
            user_id,
            like_contains(q)
        )
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| TagInfo {
                id: r.id,
                name: r.name,
                created_at: r.created_at,
            })
            .collect())
    }

    pub async fn get_mem_tags(&self, mem_id: i32) -> Result<Vec<TagInfo>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TagRow,
            r#"SELECT t.id AS "id: i32", t.name,
                      COALESCE(t.created_at, '') AS "created_at!: String"
               FROM tag t
               JOIN mem_tag mt ON mt.tag_id = t.id
               WHERE mt.mem_id = ?1
               ORDER BY t.name"#,
            mem_id
        )
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| TagInfo {
                id: r.id,
                name: r.name,
                created_at: r.created_at,
            })
            .collect())
    }

    pub async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "INSERT OR IGNORE INTO mem_tag (mem_id, tag_id) VALUES (?1, ?2)",
            mem_id,
            tag_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    /// 删除无任何 mem 关联的孤儿标签
    async fn delete_orphan_tag(&self, tag_id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "DELETE FROM tag WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM mem_tag WHERE tag_id = ?2)",
            tag_id,
            tag_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "DELETE FROM mem_tag WHERE mem_id = ?1 AND tag_id = ?2",
            mem_id,
            tag_id
        )
        .execute(&*self.pool)
        .await?;
        self.delete_orphan_tag(tag_id).await?;
        Ok(())
    }

    pub async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        // 记录移除前的旧标签
        let old_tag_ids: Vec<i32> = sqlx::query_scalar!(
            r#"SELECT tag_id AS "tag_id: i32" FROM mem_tag WHERE mem_id = ?1"#,
            mem_id
        )
        .fetch_all(&mut *tx)
        .await?;
        // 删除旧的关联
        sqlx::query!("DELETE FROM mem_tag WHERE mem_id = ?1", mem_id)
            .execute(&mut *tx)
            .await?;
        // 插入新的
        for &tag_id in tag_ids {
            sqlx::query!(
                "INSERT OR IGNORE INTO mem_tag (mem_id, tag_id) VALUES (?1, ?2)",
                mem_id,
                tag_id
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        // 清理孤儿标签
        for &tid in &old_tag_ids {
            if !tag_ids.contains(&tid) {
                self.delete_orphan_tag(tid).await?;
            }
        }
        Ok(())
    }

    pub async fn get_mems_tags_batch(
        &self,
        mem_ids: &[i32],
    ) -> Result<Vec<MemTagRow>, sqlx::Error> {
        if mem_ids.is_empty() {
            return Ok(vec![]);
        }
        let mut qb = sqlx::QueryBuilder::new(
            "SELECT mt.mem_id, t.id, t.name, t.created_at
             FROM mem_tag mt
             JOIN tag t ON t.id = mt.tag_id
             WHERE mt.mem_id IN (",
        );
        let mut separated = qb.separated(", ");
        for &id in mem_ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");
        // 与 get_mem_tags 保持一致：按名称排序，保证表格与详情顺序稳定一致
        qb.push(" ORDER BY mt.mem_id, t.name");
        let rows: Vec<MemTagDbRow> = qb.build_query_as().fetch_all(&*self.pool).await?;
        Ok(rows.into_iter().map(MemTagDbRow::into_domain).collect())
    }

    pub async fn export_all_mems(
        &self,
        tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "SELECT cc.content AS cue, ct.content AS target,
                COALESCE((SELECT GROUP_CONCAT(t.name, '; ') FROM mem_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.mem_id = m.id), '') AS tags
             FROM mem m
             JOIN chunk cc ON cc.id = m.cue_chunk_id
             JOIN chunk ct ON ct.id = m.target_chunk_id"
        );

        if !tag_ids.is_empty() {
            qb.push(" WHERE m.id IN (SELECT mem_id FROM mem_tag WHERE tag_id IN (");
            let mut sep = qb.separated(", ");
            for &tid in tag_ids {
                sep.push_bind(tid);
            }
            qb.push("))");
        }

        qb.push(" ORDER BY m.id");
        qb.build_query_as::<(String, String, String)>()
            .fetch_all(&*self.pool)
            .await
    }
}
