use std::sync::Arc;

use crate::entity::card;
use crate::repositories::card::CardRepository;

/// 卡片服务层
pub struct CardService {
    card_repository: CardRepository,
}

impl CardService {
    /// 创建新的卡片服务层实例
    pub fn new(db: Arc<sea_orm::DatabaseConnection>) -> Self {
        Self {
            card_repository: CardRepository::new(db),
        }
    }

    /// 获取所有卡片
    pub async fn get_all_cards(&self) -> Result<Vec<card::Model>, String> {
        self.card_repository
            .find_all()
            .await
            .map_err(|e| format!("获取卡片列表失败: {}", e))
    }

    /// 根据ID获取卡片
    pub async fn get_card_by_id(&self, id: i32) -> Result<Option<card::Model>, String> {
        self.card_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("获取卡片失败: {}", e))
    }

    /// 创建卡片
    pub async fn create_card(&self, title: String, content: String) -> Result<card::Model, String> {
        // 验证标题是否为空
        if title.trim().is_empty() {
            return Err("卡片标题不能为空".to_string());
        }

        // 验证内容是否为空
        if content.trim().is_empty() {
            return Err("卡片内容不能为空".to_string());
        }

        // 创建卡片
        self.card_repository
            .create(title, content)
            .await
            .map_err(|e| format!("创建卡片失败: {}", e))
    }

    /// 更新卡片
    pub async fn update_card(
        &self,
        id: i32,
        title: Option<String>,
        content: Option<String>,
    ) -> Result<Option<card::Model>, String> {
        // 验证标题是否为空（如果提供了标题）
        if let Some(ref title) = title {
            if title.trim().is_empty() {
                return Err("卡片标题不能为空".to_string());
            }
        }

        // 验证内容是否为空（如果提供了内容）
        if let Some(ref content) = content {
            if content.trim().is_empty() {
                return Err("卡片内容不能为空".to_string());
            }
        }

        // 检查卡片是否存在
        if self
            .card_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("检查卡片存在性失败: {}", e))?
            .is_none()
        {
            return Ok(None);
        }

        // 更新卡片
        self.card_repository
            .update(id, title, content)
            .await
            .map(|card| Some(card))
            .map_err(|e| format!("更新卡片失败: {}", e))
    }

    /// 删除卡片
    pub async fn delete_card(&self, id: i32) -> Result<bool, String> {
        // 检查卡片是否存在
        if self
            .card_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("检查卡片存在性失败: {}", e))?
            .is_none()
        {
            return Ok(false);
        }

        // 删除卡片
        self.card_repository
            .delete(id)
            .await
            .map_err(|e| format!("删除卡片失败: {}", e))?;

        Ok(true)
    }

    // /// 验证卡片ID是否存在
    // pub async fn validate_card_id(&self, id: i32) -> Result<bool, String> {
    //     self.card_repository
    //         .find_by_id(id)
    //         .await
    //         .map(|opt| opt.is_some())
    //         .map_err(|e| format!("验证卡片ID失败: {}", e))
    // }
}
