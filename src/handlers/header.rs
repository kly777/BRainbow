use axum::{
    http::header::HeaderMap,
    response::Json,
};
use std::collections::HashMap;

pub async fn header_handler(headers: HeaderMap) -> Json<HashMap<String, String>> {
    let header_map: HashMap<String, String> = headers
        .into_iter()
        .filter_map(|(k, v)| {
            // 处理可能的匿名header（k为None的情况）
            let key = match k {
                Some(header_name) => header_name.to_string(),
                None => return None, // 跳过匿名header
            };

            match v.to_str() {
                Ok(value) => Some((key, value.to_owned())),
                Err(_) => None, // 忽略非法 UTF-8 的 header 值
            }
        })
        .collect();

    Json(header_map)
}