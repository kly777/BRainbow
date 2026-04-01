use std::sync::Arc;

use crate::entity::SignifierSignified;
use crate::repos::sign::SignRepository;

/// 符号关系服务层
pub struct SignService {
    sign_repository: SignRepository,
}

impl SignService {
    /// 创建新的符号关系服务层实例
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            sign_repository: SignRepository::new(db),
        }
    }

    /// 获取所有符号关系
    pub async fn get_all_signs(&self) -> Result<Vec<SignifierSignified>, String> {
        self.sign_repository
            .find_all()
            .await
            .map_err(|e| format!("获取符号关系列表失败: {}", e))
    }

    /// 根据ID获取符号关系
    pub async fn get_sign_by_id(&self, id: i32) -> Result<Option<SignifierSignified>, String> {
        self.sign_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("获取符号关系失败: {}", e))
    }

    /// 创建符号关系
    pub async fn create_sign(
        &self,
        signifier: String,
        signified: String,
        onto_id: Option<i32>,
        weight: Option<f64>,
        relation_type: Option<String>,
    ) -> Result<SignifierSignified, String> {
        // 验证能指是否为空
        if signifier.trim().is_empty() {
            return Err("能指不能为空".to_string());
        }

        // 验证所指是否为空
        if signified.trim().is_empty() {
            return Err("所指不能为空".to_string());
        }

        // 创建符号关系
        self.sign_repository
            .create(signifier, signified, onto_id, weight, relation_type)
            .await
            .map_err(|e| format!("创建符号关系失败: {}", e))
    }

    /// 删除符号关系
    pub async fn delete_sign(&self, id: i32) -> Result<u64, String> {
        self.sign_repository
            .delete(id)
            .await
            .map_err(|e| format!("删除符号关系失败: {}", e))
    }

    /// 根据能指获取符号关系
    pub async fn get_signs_by_signifier(
        &self,
        signifier: &str,
    ) -> Result<Vec<SignifierSignified>, String> {
        self.sign_repository
            .find_by_signifier(signifier)
            .await
            .map_err(|e| format!("根据能指获取符号关系失败: {}", e))
    }

    /// 根据所指获取符号关系
    pub async fn get_signs_by_signified(
        &self,
        signified: &str,
    ) -> Result<Vec<SignifierSignified>, String> {
        self.sign_repository
            .find_by_signified(signified)
            .await
            .map_err(|e| format!("根据所指获取符号关系失败: {}", e))
    }

    // /// 根据本体ID获取符号关系
    // pub async fn get_signs_by_onto_id(&self, onto_id: i32) -> Result<Vec<SignifierSignified>, String> {
    //     self.sign_repository
    //         .find_by_onto_id(onto_id)
    //         .await
    //         .map_err(|e| format!("根据本体ID获取符号关系失败: {}", e))
    // }

    // /// 获取符号关系数量
    // pub async fn get_sign_count(&self) -> Result<i64, String> {
    //     self.sign_repository
    //         .count()
    //         .await
    //         .map_err(|e| format!("获取符号关系数量失败: {}", e))
    // }

    // /// 检查符号关系是否存在
    // pub async fn sign_exists(&self, id: i32) -> Result<bool, String> {
    //     self.sign_repository
    //         .exists(id)
    //         .await
    //         .map_err(|e| format!("检查符号关系存在失败: {}", e))
    // }

    // /// 更新符号关系
    // pub async fn update_sign(
    //     &self,
    //     id: i32,
    //     signifier: Option<String>,
    //     signified: Option<String>,
    //     onto_id: Option<i32>,
    //     weight: Option<f64>,
    //     relation_type: Option<String>,
    // ) -> Result<SignifierSignified, String> {
    //     // 验证能指是否为空（如果提供了能指）
    //     if let Some(ref signifier) = signifier {
    //         if signifier.trim().is_empty() {
    //             return Err("能指不能为空".to_string());
    //         }
    //     }

    //     // 验证所指是否为空（如果提供了所指）
    //     if let Some(ref signified) = signified {
    //         if signified.trim().is_empty() {
    //             return Err("所指不能为空".to_string());
    //         }
    //     }

    //     // 更新符号关系
    //     self.sign_repository
    //         .update(id, signifier, signified, onto_id, weight, relation_type)
    //         .await
    //         .map_err(|e| format!("更新符号关系失败: {}", e))
    // }
}
