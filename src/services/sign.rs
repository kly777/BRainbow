use std::sync::Arc;

use crate::entity::signifier_signified;
use crate::repositories::onto::OntoRepository;
use crate::repositories::sign::SignRepository;

/// 符号关系服务层
pub struct SignService {
    sign_repository: SignRepository,
    onto_repository: OntoRepository,
}

impl SignService {
    /// 创建新的符号关系服务层实例
    pub fn new(db: Arc<sea_orm::DatabaseConnection>) -> Self {
        Self {
            sign_repository: SignRepository::new(db.clone()),
            onto_repository: OntoRepository::new(db),
        }
    }

    /// 获取所有符号关系
    pub async fn get_all_signs(&self) -> Result<Vec<signifier_signified::Model>, String> {
        self.sign_repository
            .find_all()
            .await
            .map_err(|e| format!("获取符号关系列表失败: {}", e))
    }

    /// 根据ID获取符号关系
    pub async fn get_sign_by_id(
        &self,
        id: i32,
    ) -> Result<Option<signifier_signified::Model>, String> {
        self.sign_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("获取符号关系失败: {}", e))
    }

    /// 创建符号关系
    pub async fn create_sign(
        &self,
        signifier_id: i32,
        signified_id: i32,
        weight: Option<f64>,
        relation_type: Option<String>,
    ) -> Result<signifier_signified::Model, String> {
        // 验证能指和所指是否存在
        if !self
            .onto_repository
            .find_by_id(signifier_id)
            .await
            .map_err(|e| format!("验证能指本体失败: {}", e))?
            .is_some()
        {
            return Err(format!("能指本体 ID {} 不存在", signifier_id));
        }

        if !self
            .onto_repository
            .find_by_id(signified_id)
            .await
            .map_err(|e| format!("验证所指本体失败: {}", e))?
            .is_some()
        {
            return Err(format!("所指本体 ID {} 不存在", signified_id));
        }

        // 检查能指和所指是否相同
        if signifier_id == signified_id {
            return Err("能指和所指不能是同一个本体".to_string());
        }

        // 检查关系是否已存在
        if self
            .sign_repository
            .exists(signifier_id, signified_id)
            .await
            .map_err(|e| format!("检查符号关系存在性失败: {}", e))?
        {
            return Err(format!(
                "能指 {} 到所指 {} 的关系已存在",
                signifier_id, signified_id
            ));
        }

        // 验证权重范围（如果提供了权重）
        if let Some(weight) = weight {
            if weight < 0.0 || weight > 1.0 {
                return Err("权重必须在 0.0 到 1.0 之间".to_string());
            }
        }

        // 创建符号关系
        self.sign_repository
            .create(signifier_id, signified_id, weight, relation_type)
            .await
            .map_err(|e| format!("创建符号关系失败: {}", e))
    }

    /// 删除符号关系
    pub async fn delete_sign(&self, id: i32) -> Result<(), String> {
        // 检查符号关系是否存在
        if self
            .sign_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("检查符号关系存在性失败: {}", e))?
            .is_none()
        {
            return Err(format!("符号关系 ID {} 不存在", id));
        }

        // 删除符号关系
        self.sign_repository
            .delete(id)
            .await
            .map_err(|e| format!("删除符号关系失败: {}", e))?;

        Ok(())
    }

    /// 根据能指ID获取符号关系
    pub async fn get_signs_by_signifier(
        &self,
        signifier_id: i32,
    ) -> Result<Vec<signifier_signified::Model>, String> {
        // 验证能指是否存在
        if !self
            .onto_repository
            .find_by_id(signifier_id)
            .await
            .map_err(|e| format!("验证能指本体失败: {}", e))?
            .is_some()
        {
            return Err(format!("能指本体 ID {} 不存在", signifier_id));
        }

        self.sign_repository
            .find_by_signifier_id(signifier_id)
            .await
            .map_err(|e| format!("获取能指相关关系失败: {}", e))
    }

    /// 根据所指ID获取符号关系
    pub async fn get_signs_by_signified(
        &self,
        signified_id: i32,
    ) -> Result<Vec<signifier_signified::Model>, String> {
        // 验证所指是否存在
        if !self
            .onto_repository
            .find_by_id(signified_id)
            .await
            .map_err(|e| format!("验证所指本体失败: {}", e))?
            .is_some()
        {
            return Err(format!("所指本体 ID {} 不存在", signified_id));
        }

        self.sign_repository
            .find_by_signified_id(signified_id)
            .await
            .map_err(|e| format!("获取所指相关关系失败: {}", e))
    }

    /// 获取符号关系数量
    pub async fn count_signs(&self) -> Result<u64, String> {
        self.sign_repository
            .count()
            .await
            .map_err(|e| format!("获取符号关系数量失败: {}", e))
    }

    /// 获取能指相关的符号关系数量
    pub async fn count_signs_by_signifier(&self, signifier_id: i32) -> Result<u64, String> {
        let signs = self.get_signs_by_signifier(signifier_id).await?;
        Ok(signs.len() as u64)
    }

    /// 获取所指相关的符号关系数量
    pub async fn count_signs_by_signified(&self, signified_id: i32) -> Result<u64, String> {
        let signs = self.get_signs_by_signified(signified_id).await?;
        Ok(signs.len() as u64)
    }

    /// 验证符号关系ID是否存在
    pub async fn validate_sign_id(&self, id: i32) -> Result<bool, String> {
        self.sign_repository
            .find_by_id(id)
            .await
            .map(|opt| opt.is_some())
            .map_err(|e| format!("验证符号关系ID失败: {}", e))
    }
}
