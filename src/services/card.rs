use std::sync::Arc;

use crate::entity::Card;
use crate::repos::card::CardRepository;

/// 卡片服务层
pub struct CardService {
    card_repository: CardRepository,
}

impl CardService {
    /// 创建新的卡片服务层实例
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            card_repository: CardRepository::new(db),
        }
    }

    /// 获取所有卡片
    pub async fn get_all_cards(&self) -> Result<Vec<Card>, String> {
        self.card_repository
            .find_all()
            .await
            .map_err(|e| format!("获取卡片列表失败: {}", e))
    }

    /// 根据ID获取卡片
    pub async fn get_card_by_id(&self, id: i32) -> Result<Option<Card>, String> {
        self.card_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("获取卡片失败: {}", e))
    }

    /// 创建卡片
    pub async fn create_card(&self, title: String, content: String) -> Result<Card, String> {
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
    ) -> Result<Card, String> {
        self.card_repository
            .update(id, title, content)
            .await
            .map_err(|e| format!("更新卡片失败: {}", e))
    }

    /// 删除卡片
    pub async fn delete_card(&self, id: i32) -> Result<u64, String> {
        self.card_repository
            .delete(id)
            .await
            .map_err(|e| format!("删除卡片失败: {}", e))
    }

    // /// 根据用户ID获取卡片
    // pub async fn get_cards_by_user_id(&self, user_id: i32) -> Result<Vec<Card>, String> {
    //     self.card_repository
    //         .find_by_user_id(user_id)
    //         .await
    //         .map_err(|e| format!("获取用户卡片失败: {}", e))
    // }

    // /// 获取卡片数量
    // pub async fn get_card_count(&self) -> Result<i64, String> {
    //     self.card_repository
    //         .count()
    //         .await
    //         .map_err(|e| format!("获取卡片数量失败: {}", e))
    // }

    // /// 检查卡片是否存在
    // pub async fn card_exists(&self, id: i32) -> Result<bool, String> {
    //     self.card_repository
    //         .exists(id)
    //         .await
    //         .map_err(|e| format!("检查卡片存在失败: {}", e))
    // }
}
