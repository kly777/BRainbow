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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    // ── Pagination::clamp ──

    #[test]
    fn clamp_defaults() {
        let p = Pagination { page: 0, page_size: 0 };
        assert_eq!(p.clamp(), (1, 1));
    }

    #[test]
    fn clamp_valid_values() {
        let p = Pagination { page: 3, page_size: 25 };
        assert_eq!(p.clamp(), (3, 25));
    }

    #[test]
    fn clamp_negative_page() {
        let p = Pagination { page: -5, page_size: 20 };
        assert_eq!(p.clamp(), (1, 20));
    }

    #[test]
    fn clamp_exceeds_max_page_size() {
        let p = Pagination { page: 1, page_size: 999 };
        assert_eq!(p.clamp(), (1, 100));
    }

    #[test]
    fn clamp_page_size_zero_clamps_to_one() {
        let p = Pagination { page: 2, page_size: 0 };
        assert_eq!(p.clamp(), (2, 1));
    }

    // ── Pagination::offset ──

    #[test]
    fn offset_page_1() {
        let p = Pagination { page: 1, page_size: 20 };
        assert_eq!(p.offset(), 0);
    }

    #[test]
    fn offset_page_3() {
        let p = Pagination { page: 3, page_size: 10 };
        assert_eq!(p.offset(), 20);
    }

    #[test]
    fn offset_clamped_page_0_acts_as_1() {
        let p = Pagination { page: 0, page_size: 20 };
        assert_eq!(p.offset(), 0);
    }

    #[test]
    fn offset_with_max_page_size() {
        let p = Pagination { page: 5, page_size: 100 };
        assert_eq!(p.offset(), 400);
    }

    // ── Pagination::limit ──

    #[test]
    fn limit_normal() {
        let p = Pagination { page: 1, page_size: 15 };
        assert_eq!(p.limit(), 15);
    }

    #[test]
    fn limit_clamps_to_max() {
        let p = Pagination { page: 1, page_size: 200 };
        assert_eq!(p.limit(), 100);
    }

    #[test]
    fn limit_clamps_min_to_1() {
        let p = Pagination { page: 1, page_size: 0 };
        assert_eq!(p.limit(), 1);
    }

    #[test]
    fn limit_negative_clamps_to_1() {
        let p = Pagination { page: 1, page_size: -10 };
        assert_eq!(p.limit(), 1);
    }

    // ── PaginatedResponse ──

    #[test]
    fn paginated_response_exact_pages() {
        let items: Vec<i32> = vec![1, 2, 3, 4, 5];
        let p = Pagination { page: 1, page_size: 5 };
        let r = PaginatedResponse::new(items, 20, &p);
        assert_eq!(r.total_pages, 4);
        assert_eq!(r.page, 1);
        assert_eq!(r.page_size, 5);
    }

    #[test]
    fn paginated_response_partial_last_page() {
        let items: Vec<i32> = vec![1, 2, 3];
        let p = Pagination { page: 2, page_size: 10 };
        let r = PaginatedResponse::new(items, 13, &p);
        assert_eq!(r.total_pages, 2);
        assert_eq!(r.total, 13);
    }

    #[test]
    fn paginated_response_zero_total() {
        let items: Vec<i32> = vec![];
        let p = Pagination { page: 1, page_size: 20 };
        let r = PaginatedResponse::new(items, 0, &p);
        assert_eq!(r.total_pages, 0);
        assert_eq!(r.items.len(), 0);
    }

    #[test]
    fn paginated_response_single_page() {
        let items: Vec<i32> = vec![1];
        let p = Pagination { page: 1, page_size: 20 };
        let r = PaginatedResponse::new(items, 1, &p);
        assert_eq!(r.total_pages, 1);
    }

    #[test]
    fn paginated_response_clamps_page_size() {
        let items: Vec<i32> = vec![];
        let p = Pagination { page: 1, page_size: 999 };
        let r = PaginatedResponse::new(items, 50, &p);
        // page_size should be clamped to 100
        assert_eq!(r.page_size, 100);
        assert_eq!(r.total_pages, 1);
    }

    #[test]
    fn paginated_response_field_values() {
        let items = vec!["a", "b", "c"];
        let p = Pagination { page: 2, page_size: 3 };
        let r = PaginatedResponse::new(items, 7, &p);
        assert_eq!(r.items, vec!["a", "b", "c"]);
        assert_eq!(r.total, 7);
        assert_eq!(r.page, 2);
        assert_eq!(r.page_size, 3);
        assert_eq!(r.total_pages, 3);
    }

    #[test]
    fn paginated_response_total_less_than_page_size() {
        let items: Vec<i32> = vec![1, 2, 3];
        let p = Pagination { page: 1, page_size: 50 };
        let r = PaginatedResponse::new(items, 3, &p);
        assert_eq!(r.total_pages, 1);
    }

    #[test]
    fn paginated_response_large_total() {
        let items: Vec<i32> = (0..20).collect();
        let p = Pagination { page: 3, page_size: 20 };
        let r = PaginatedResponse::new(items, 105, &p);
        assert_eq!(r.total_pages, 6); // ceil(105/20) = 6
        assert_eq!(r.page, 3);
    }
}
