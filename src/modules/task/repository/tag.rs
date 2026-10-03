//! 任务标签的数据访问：复用 `tag` 表（`UNIQUE(name, user_id)`，按用户隔离），
//! 关联走 `task_tag_rel`（复合主键 + 两个级联）。
//!
//! 语义是**整体替换**（PUT 而非 PATCH-on-collection）：前端从 `GET /tasks/{id}` 拿到
//! 该任务的完整标签集，改完整体发回来 —— 增量增删要多一次往返，还容易与服务端不一致。

use std::collections::HashMap;

use super::super::response::Tag;
use super::TaskRepository;

impl TaskRepository {
    /// 把任务的标签**整体替换**成 `names`，返回替换后的标签（含各自的 id）。
    ///
    /// 标签归**任务的持有者**（不是编辑者）：admin 改别人的任务时，加上的标签也记在
    /// 任务主人名下 —— 否则同一个任务会被两套标签名劈开。
    ///
    /// 名字先 trim、去空、去重（大小写不同算两个标签，与 `UNIQUE(name, user_id)` 口径一致）；
    /// 按 `(name, owner)` upsert —— 已存在的复用，新的建一条。
    pub async fn set_tags(
        &self,
        task_id: i32,
        owner: i32,
        names: &[String],
    ) -> Result<Vec<Tag>, sqlx::Error> {
        let mut wanted: Vec<String> = Vec::new();
        for name in names {
            let name = name.trim();
            if name.is_empty() || wanted.iter().any(|existing| existing == name) {
                continue;
            }
            wanted.push(name.to_string());
        }

        let mut tx = self.db.begin().await?;

        let mut tags = Vec::new();
        for name in &wanted {
            // upsert：同名同用户唯一，冲突时拿回既有 id
            let tag_id: i64 = sqlx::query_scalar(
                "INSERT INTO tag (name, user_id) VALUES (?1, ?2)
                 ON CONFLICT(name, user_id) DO UPDATE SET name = excluded.name
                 RETURNING id",
            )
            .bind(name)
            .bind(owner)
            .fetch_one(&mut *tx)
            .await?;

            sqlx::query("INSERT OR IGNORE INTO task_tag_rel (task_id, tag_id) VALUES (?1, ?2)")
                .bind(task_id)
                .bind(tag_id)
                .execute(&mut *tx)
                .await?;

            tags.push(Tag {
                id: tag_id as i32,
                name: name.clone(),
            });
        }

        // 整体替换：清掉这次没提到的关联（放在最后，中途失败不会留下半个集合）。
        // 只删这个**任务**的关联，标签本身留着 —— 别的任务可能还在用
        if wanted.is_empty() {
            sqlx::query("DELETE FROM task_tag_rel WHERE task_id = ?1")
                .bind(task_id)
                .execute(&mut *tx)
                .await?;
        } else {
            let mut qb =
                sqlx::QueryBuilder::new("DELETE FROM task_tag_rel WHERE task_id = ");
            qb.push_bind(task_id);
            qb.push(" AND tag_id NOT IN (");
            let mut separated = qb.separated(", ");
            for tag in &tags {
                separated.push_bind(tag.id);
            }
            qb.push(")");
            qb.build().execute(&mut *tx).await?;
        }

        tx.commit().await?;
        Ok(tags)
    }

    /// 一批任务的标签（列表用一次查询挂上，避免 N+1）。没有标签的任务不在返回值里。
    pub async fn tags_for_tasks(
        &self,
        task_ids: &[i32],
    ) -> Result<HashMap<i32, Vec<Tag>>, sqlx::Error> {
        if task_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut qb = sqlx::QueryBuilder::new(
            "SELECT r.task_id, t.id, t.name FROM task_tag_rel r
             JOIN tag t ON t.id = r.tag_id WHERE r.task_id IN (",
        );
        let mut separated = qb.separated(", ");
        for id in task_ids {
            separated.push_bind(id);
        }
        qb.push(") ORDER BY t.name");

        let rows: Vec<(i32, i32, String)> = qb.build_query_as().fetch_all(&*self.db).await?;
        let mut map: HashMap<i32, Vec<Tag>> = HashMap::new();
        for (task_id, id, name) in rows {
            map.entry(task_id).or_default().push(Tag { id, name });
        }
        Ok(map)
    }
}
