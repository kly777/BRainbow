use std::sync::Arc;

use crate::entity::{onto, signifier_signified, user};
use crate::repositories::{onto::OntoRepository, sign::SignRepository, user::UserRepository};

/// HTML展示服务层
pub struct HtmlService {
    onto_repository: OntoRepository,
    sign_repository: SignRepository,
    user_repository: UserRepository,
}

impl HtmlService {
    /// 创建新的HTML展示服务层实例
    pub fn new(db: Arc<sea_orm::DatabaseConnection>) -> Self {
        Self {
            onto_repository: OntoRepository::new(db.clone()),
            sign_repository: SignRepository::new(db.clone()),
            user_repository: UserRepository::new(db),
        }
    }

    /// 获取所有用户用于HTML展示
    pub async fn get_users_for_html(&self) -> Result<Vec<user::Model>, String> {
        self.user_repository
            .find_all()
            .await
            .map_err(|e| format!("获取用户列表失败: {}", e))
    }

    /// 获取所有本体用于HTML展示
    pub async fn get_ontos_for_html(&self) -> Result<Vec<onto::Model>, String> {
        self.onto_repository
            .find_all()
            .await
            .map_err(|e| format!("获取本体列表失败: {}", e))
    }

    /// 获取本体详情用于HTML展示
    pub async fn get_onto_detail_for_html(
        &self,
        id: i32,
    ) -> Result<
        (
            onto::Model,
            Vec<signifier_signified::Model>,
            Vec<signifier_signified::Model>,
        ),
        String,
    > {
        // 获取本体信息
        let onto = self
            .onto_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("获取本体失败: {}", e))?
            .ok_or_else(|| format!("本体 ID {} 不存在", id))?;

        // 获取作为能指的关系
        let signifiers = self
            .sign_repository
            .find_by_signifier_id(id)
            .await
            .map_err(|e| format!("获取能指关系失败: {}", e))?;

        // 获取作为所指的关系
        let signifieds = self
            .sign_repository
            .find_by_signified_id(id)
            .await
            .map_err(|e| format!("获取所指关系失败: {}", e))?;

        Ok((onto, signifiers, signifieds))
    }

    /// 获取所有符号关系用于HTML展示
    pub async fn get_signs_for_html(&self) -> Result<Vec<signifier_signified::Model>, String> {
        self.sign_repository
            .find_all()
            .await
            .map_err(|e| format!("获取符号关系列表失败: {}", e))
    }

    /// 获取符号关系详情用于HTML展示
    pub async fn get_sign_detail_for_html(
        &self,
        id: i32,
    ) -> Result<signifier_signified::Model, String> {
        self.sign_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("获取符号关系失败: {}", e))?
            .ok_or_else(|| format!("符号关系 ID {} 不存在", id))
    }

    /// 获取能指相关的符号关系用于HTML展示
    pub async fn get_signs_by_signifier_for_html(
        &self,
        signifier_id: i32,
    ) -> Result<(onto::Model, Vec<signifier_signified::Model>), String> {
        // 获取本体信息
        let onto = self
            .onto_repository
            .find_by_id(signifier_id)
            .await
            .map_err(|e| format!("获取能指本体失败: {}", e))?
            .ok_or_else(|| format!("能指本体 ID {} 不存在", signifier_id))?;

        // 获取作为能指的关系
        let signs = self
            .sign_repository
            .find_by_signifier_id(signifier_id)
            .await
            .map_err(|e| format!("获取能指关系失败: {}", e))?;

        Ok((onto, signs))
    }

    /// 获取所指相关的符号关系用于HTML展示
    pub async fn get_signs_by_signified_for_html(
        &self,
        signified_id: i32,
    ) -> Result<(onto::Model, Vec<signifier_signified::Model>), String> {
        // 获取本体信息
        let onto = self
            .onto_repository
            .find_by_id(signified_id)
            .await
            .map_err(|e| format!("获取所指本体失败: {}", e))?
            .ok_or_else(|| format!("所指本体 ID {} 不存在", signified_id))?;

        // 获取作为所指的关系
        let signs = self
            .sign_repository
            .find_by_signified_id(signified_id)
            .await
            .map_err(|e| format!("获取所指关系失败: {}", e))?;

        Ok((onto, signs))
    }

    /// 获取用户详情用于HTML展示
    pub async fn get_user_detail_for_html(&self, id: i32) -> Result<user::Model, String> {
        self.user_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("获取用户详情失败: {}", e))?
            .ok_or_else(|| format!("用户 ID {} 不存在", id))
    }

    /// 获取用户数量统计
    pub async fn get_user_stats(&self) -> Result<u64, String> {
        self.user_repository
            .count()
            .await
            .map_err(|e| format!("获取用户统计失败: {}", e))
    }

    /// 获取本体数量统计
    pub async fn get_onto_stats(&self) -> Result<u64, String> {
        let ontos = self
            .onto_repository
            .find_all()
            .await
            .map_err(|e| format!("获取本体统计失败: {}", e))?;

        Ok(ontos.len() as u64)
    }

    /// 获取符号关系数量统计
    pub async fn get_sign_stats(&self) -> Result<u64, String> {
        self.sign_repository
            .count()
            .await
            .map_err(|e| format!("获取符号关系统计失败: {}", e))
    }

    /// 验证本体ID是否存在
    pub async fn validate_onto_id(&self, id: i32) -> Result<bool, String> {
        self.onto_repository
            .find_by_id(id)
            .await
            .map(|opt| opt.is_some())
            .map_err(|e| format!("验证本体ID失败: {}", e))
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
