use sqlx::Row;
use std::pin::Pin;

use super::TaskRepository;

impl TaskRepository {
    pub async fn add_dependency(&self, task_id: i32, depends_on_task_id: i32) -> Result<(), sqlx::Error> {
        // 检查是否依赖自己
        if task_id == depends_on_task_id {
            return Err(sqlx::Error::Protocol("Cannot depend on self".into()));
        }

        // 检查依赖循环
        let mut visited = std::collections::HashSet::new();
        if self.check_circular_dependency(depends_on_task_id, task_id, &mut visited).await? {
            return Err(sqlx::Error::Protocol("Circular dependency detected".into()));
        }

        sqlx::query(
            "INSERT INTO task_dependency (task_id, depends_on_task_id) VALUES (?, ?)"
        )
        .bind(task_id)
        .bind(depends_on_task_id)
        .execute(&*self.db)
        .await?;

        Ok(())
    }

    pub async fn remove_dependency(&self, task_id: i32, depends_on_task_id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            "DELETE FROM task_dependency WHERE task_id = ? AND depends_on_task_id = ?"
        )
        .bind(task_id)
        .bind(depends_on_task_id)
        .execute(&*self.db)
        .await?;

        Ok(result.rows_affected())
    }

    pub async fn get_dependencies(&self, task_id: i32) -> Result<Vec<i32>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT depends_on_task_id FROM task_dependency WHERE task_id = ?"
        )
        .bind(task_id)
        .fetch_all(&*self.db)
        .await?;

        let dependencies = rows
            .into_iter()
            .map(|row| row.try_get::<i32, _>("depends_on_task_id"))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(dependencies)
    }

    /// 一次查询返回所有任务的依赖关系 → Map<task_id, Vec<dep_id>>
    pub async fn get_all_dependencies(&self) -> Result<std::collections::HashMap<i32, Vec<i32>>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT task_id, depends_on_task_id FROM task_dependency"
        )
        .fetch_all(&*self.db)
        .await?;

        let mut map: std::collections::HashMap<i32, Vec<i32>> = std::collections::HashMap::new();
        for row in rows {
            let task_id: i32 = row.try_get("task_id")?;
            let dep_id: i32 = row.try_get("depends_on_task_id")?;
            map.entry(task_id).or_default().push(dep_id);
        }
        Ok(map)
    }

    fn check_circular_dependency<'a>(
        &'a self,
        start_id: i32,
        target_id: i32,
        visited: &'a mut std::collections::HashSet<i32>
    ) -> Pin<Box<dyn std::future::Future<Output = Result<bool, sqlx::Error>> + Send + 'a>> {
        Box::pin(async move {
            if start_id == target_id {
                return Ok(true);
            }

            if visited.contains(&start_id) {
                return Ok(false);
            }

            visited.insert(start_id);

            // 获取当前任务依赖的所有任务
            let dependencies = self.get_dependencies(start_id).await?;

            // 递归检查每个依赖
            for dep_id in dependencies {
                let mut new_visited = visited.clone();
                if self.check_circular_dependency(dep_id, target_id, &mut new_visited).await? {
                    return Ok(true);
                }
            }

            Ok(false)
        })
    }

    pub async fn check_circular_parent(&self, task_id: i32, parent_id: i32) -> Result<bool, sqlx::Error> {
        let mut current_id = Some(parent_id);
        let mut visited = std::collections::HashSet::new();

        while let Some(id) = current_id {
            if id == task_id {
                return Ok(true);
            }

            if visited.contains(&id) {
                break;
            }

            visited.insert(id);

            // 获取当前任务的父任务
            current_id = sqlx::query_scalar("SELECT parent_task_id FROM task WHERE id = ?")
                .bind(id)
                .fetch_optional(&*self.db)
                .await?;
        }

        Ok(false)
    }
}
