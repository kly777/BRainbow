use sqlx::SqlitePool;
use std::sync::Arc;

use super::model::Image;

const UPLOAD_DIR: &str = "uploads";

pub struct ImageService {
    db: Arc<SqlitePool>,
}

impl ImageService {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        std::fs::create_dir_all(UPLOAD_DIR).ok();
        Self { db }
    }

    /// 上传图片：保存文件 + 写数据库
    pub async fn upload(
        &self,
        data: &[u8],
        original_name: &str,
        content_type: &str,
    ) -> Result<Image, String> {
        let ext = std::path::Path::new(original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");
        let filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
        let filepath = std::path::Path::new(UPLOAD_DIR).join(&filename);

        tokio::fs::write(&filepath, data)
            .await
            .map_err(|e| format!("保存文件失败: {}", e))?;

        let result = sqlx::query_as::<_, Image>(
            r#"INSERT INTO image (filename, original_name, content_type)
               VALUES (?, ?, ?)
               RETURNING id, filename, original_name, content_type, created_at"#,
        )
        .bind(&filename)
        .bind(original_name)
        .bind(content_type)
        .fetch_one(&*self.db)
        .await;

        match result {
            Ok(image) => Ok(image),
            Err(e) => {
                let _ = tokio::fs::remove_file(&filepath).await;
                Err(format!("数据库写入失败: {}", e))
            }
        }
    }

    /// 获取所有图片
    pub async fn list(&self) -> Result<Vec<Image>, String> {
        sqlx::query_as::<_, Image>(
            "SELECT id, filename, original_name, content_type, created_at FROM image ORDER BY created_at DESC",
        )
        .fetch_all(&*self.db)
        .await
        .map_err(|e| format!("查询失败: {}", e))
    }

    /// 重命名图片（修改 original_name）
    pub async fn rename(&self, id: i32, new_name: &str) -> Result<Image, String> {
        let result = sqlx::query_as::<_, Image>(
            r#"UPDATE image SET original_name = ? WHERE id = ?
               RETURNING id, filename, original_name, content_type, created_at"#,
        )
        .bind(new_name)
        .bind(id)
        .fetch_optional(&*self.db)
        .await
        .map_err(|e| format!("更新失败: {}", e))?;

        result.ok_or_else(|| "图片不存在".to_string())
    }

    /// 删除图片（文件 + 数据库记录）
    pub async fn delete(&self, id: i32) -> Result<(), String> {
        let image = sqlx::query_as::<_, Image>(
            "SELECT id, filename, original_name, content_type, created_at FROM image WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&*self.db)
        .await
        .map_err(|e| format!("查询失败: {}", e))?
        .ok_or_else(|| "图片不存在".to_string())?;

        let filepath = std::path::Path::new(UPLOAD_DIR).join(&image.filename);
        tokio::fs::remove_file(&filepath).await.ok();

        sqlx::query("DELETE FROM image WHERE id = ?")
            .bind(id)
            .execute(&*self.db)
            .await
            .map_err(|e| format!("删除失败: {}", e))?;

        Ok(())
    }
}
