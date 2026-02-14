use std::sync::Arc;

use crate::entity::onto;
use crate::repositories::onto::OntoRepository;

/// 本体服务层
pub struct OntoService {
    onto_repository: OntoRepository,
}

impl OntoService {
    /// 创建新的本体服务层实例
    pub fn new(db: Arc<sea_orm::DatabaseConnection>) -> Self {
        Self {
            onto_repository: OntoRepository::new(db),
        }
    }

    /// 获取所有本体
    pub async fn get_all_ontos(&self) -> Result<Vec<onto::Model>, String> {
        self.onto_repository
            .find_all()
            .await
            .map_err(|e| format!("获取本体列表失败: {}", e))
    }

    /// 根据ID获取本体
    pub async fn get_onto_by_id(&self, id: i32) -> Result<Option<onto::Model>, String> {
        self.onto_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("获取本体失败: {}", e))
    }

    /// 创建本体
    pub async fn create_onto(&self, name: String) -> Result<onto::Model, String> {
        // 验证名称是否为空
        if name.trim().is_empty() {
            return Err("本体名称不能为空".to_string());
        }

        // 检查名称是否已存在
        if let Ok(Some(_)) = self.onto_repository.find_by_name(&name).await {
            return Err(format!("本体名称 '{}' 已存在", name));
        }

        // 创建本体
        self.onto_repository
            .create(name)
            .await
            .map_err(|e| format!("创建本体失败: {}", e))
    }

    /// 更新本体
    pub async fn update_onto(
        &self,
        id: i32,
        name: Option<String>,
    ) -> Result<Option<onto::Model>, String> {
        // 验证名称是否为空（如果提供了名称）
        if let Some(ref name) = name {
            if name.trim().is_empty() {
                return Err("本体名称不能为空".to_string());
            }

            // 检查名称是否已被其他本体使用
            if let Ok(Some(existing_onto)) = self.onto_repository.find_by_name(name).await
                && existing_onto.id != id {
                    return Err(format!("本体名称 '{}' 已被其他本体使用", name));
                }
        }

        // 更新本体
        self.onto_repository
            .update(id, name)
            .await
            .map_err(|e| format!("更新本体失败: {}", e))
    }

    /// 删除本体
    pub async fn delete_onto(&self, id: i32) -> Result<(), String> {
        // 检查本体是否存在
        if self
            .onto_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("检查本体存在性失败: {}", e))?
            .is_none()
        {
            return Err(format!("本体 ID {} 不存在", id));
        }

        // 删除本体
        self.onto_repository
            .delete(id)
            .await
            .map_err(|e| format!("删除本体失败: {}", e))?;

        Ok(())
    }

    // /// 获取本体数量
    // pub async fn count_ontos(&self) -> Result<u64, String> {
    //     let ontos = self
    //         .onto_repository
    //         .find_all()
    //         .await
    //         .map_err(|e| format!("获取本体数量失败: {}", e))?;

    //     Ok(ontos.len() as u64)
    // }

    // /// 验证本体ID是否存在
    // pub async fn validate_onto_id(&self, id: i32) -> Result<bool, String> {
    //     self.onto_repository
    //         .find_by_id(id)
    //         .await
    //         .map(|opt| opt.is_some())
    //         .map_err(|e| format!("验证本体ID失败: {}", e))
    // }
}
