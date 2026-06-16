use serde::{Deserialize, Serialize};

fn default_page() -> i64 {
    1
}
fn default_page_size() -> i64 {
    20
}

/// 硬上限
const MAX_PAGE_SIZE: i64 = 100;

#[derive(Debug, Clone, Deserialize)]
pub struct Pagination {
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_page_size")]
    pub page_size: i64,
}

impl Pagination {
    /// 钳制 page ≥ 1, 1 ≤ page_size ≤ MAX_PAGE_SIZE
    pub fn clamp(&self) -> (i64, i64) {
        let page = self.page.max(1);
        let page_size = self.page_size.clamp(1, MAX_PAGE_SIZE);
        (page, page_size)
    }

    pub fn offset(&self) -> i64 {
        let (page, page_size) = self.clamp();
        (page - 1) * page_size
    }

    pub fn limit(&self) -> i64 {
        self.clamp().1
    }
}

#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
}

impl<T: Serialize> PaginatedResponse<T> {
    pub fn new(items: Vec<T>, total: i64, pagination: &Pagination) -> Self {
        let (page, page_size) = pagination.clamp();
        let total_pages = if total == 0 {
            0
        } else {
            ((total + page_size - 1) / page_size).max(1)
        };
        Self {
            items,
            total,
            page,
            page_size,
            total_pages,
        }
    }
}
