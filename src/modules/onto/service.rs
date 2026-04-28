use std::sync::Arc;

use super::model::Onto;
use super::repository::OntoRepository;

/// 本体服务层
pub struct OntoService {
    onto_repository: OntoRepository,
}

impl OntoService {
    /// 创建新的本体服务层实例
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            onto_repository: OntoRepository::new(db),
        }
    }

    /// 获取所有本体
    pub async fn get_all_ontos(&self) -> Result<Vec<Onto>, String> {
        self.onto_repository
            .find_all()
            .await
            .map_err(|e| format!("获取本体列表失败: {}", e))
    }

    /// 根据ID获取本体
    pub async fn get_onto_by_id(&self, id: i32) -> Result<Option<Onto>, String> {
        self.onto_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("获取本体失败: {}", e))
    }

    /// 创建本体
    pub async fn create_onto(
        &self,
        name: String,
        description: Option<String>,
    ) -> Result<Onto, String> {
        // 验证名称是否为空
        if name.trim().is_empty() {
            return Err("本体名称不能为空".to_string());
        }

        // 创建本体
        self.onto_repository
            .create(name, description)
            .await
            .map_err(|e| format!("创建本体失败: {}", e))
    }

    /// 更新本体
    pub async fn update_onto(
        &self,
        id: i32,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<Onto, String> {
        // 验证名称是否为空（如果提供了名称）
        if let Some(ref name) = name {
            if name.trim().is_empty() {
                return Err("本体名称不能为空".to_string());
            }
        }

        // 更新本体
        self.onto_repository
            .update(id, name, description)
            .await
            .map_err(|e| format!("更新本体失败: {}", e))
    }

    /// 删除本体
    pub async fn delete_onto(&self, id: i32) -> Result<u64, String> {
        self.onto_repository
            .delete(id)
            .await
            .map_err(|e| format!("删除本体失败: {}", e))
    }

    // /// 根据名称查找本体
    // pub async fn get_onto_by_name(&self, name: &str) -> Result<Option<Onto>, String> {
    //     self.onto_repository
    //         .find_by_name(name)
    //         .await
    //         .map_err(|e| format!("根据名称查找本体失败: {}", e))
    // }

    // /// 获取本体数量
    // pub async fn get_onto_count(&self) -> Result<i64, String> {
    //     self.onto_repository
    //         .count()
    //         .await
    //         .map_err(|e| format!("获取本体数量失败: {}", e))
    // }

    // /// 检查本体是否存在
    // pub async fn onto_exists(&self, id: i32) -> Result<bool, String> {
    //     self.onto_repository
    //         .exists(id)
    //         .await
    //         .map_err(|e| format!("检查本体存在失败: {}", e))
    // }
}