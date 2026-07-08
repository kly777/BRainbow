//! 搜索评分——纯函数，不依赖 I/O。
//!
//! 所有函数接受已获取的数据（hits + idf），返回排序后的结果。
//! 可通过构造 Vec 直接测试评分逻辑，无需 SQLite。

use std::collections::HashMap;

use super::model::ConvHit;

use super::service::RawHit;

/// TF 分数：出现次数 / 文本长度（+100 平滑避免短文本过度占优）
fn tf_score(count: usize, text_len: usize) -> f64 {
    count as f64 / (text_len.max(1) as f64 + 100.0)
}

/// 对关键词在所有文档中的命中进行 TF × IDF 聚合，返回按分数降序排列的结果。
///
/// # Arguments
/// * `hits` - 所有关键词在各表中的原始命中
/// * `idfs` - 每个关键词的 IDF 值，按 `keyword_index` 索引
/// * `limit` - 返回最大条数
pub fn score_and_rank(hits: Vec<RawHit>, idfs: &[f64], limit: usize) -> Vec<ConvHit> {
    // 按 conv_id 聚合分数 = TF * IDF，多关键词累加
    let mut scored: HashMap<i64, (f64, RawHit)> = HashMap::new();
    for hit in hits {
        if hit.keyword_index >= idfs.len() {
            continue;
        }
        let tf = tf_score(hit.ocurrences, hit.source_len);
        let idf = idfs[hit.keyword_index];
        let score = tf * idf;
        if score <= 0.0 {
            continue;
        }

        let entry = scored.entry(hit.conv_id).or_insert((0.0, hit.clone()));
        entry.0 += score;
    }

    // 排序取 top N
    let mut results: Vec<(f64, RawHit)> = scored.into_values().collect();
    results.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);

    results
        .into_iter()
        .map(|(score, hit)| ConvHit {
            conv_id: hit.conv_id,
            title: hit.title,
            conv_type: hit.conv_type,
            snippet: hit.snippet,
            match_field: hit.match_field,
            created_at: hit.created_at,
            score: (score * 1000.0) as i64,
            article_title: hit.article_title,
        })
        .collect()
}

/// 计算关键词在文本中的出现次数（大小写不敏感）
pub fn count_occurrences(text: &str, keyword: &str) -> usize {
    let s = text.to_lowercase();
    let kw = keyword.to_lowercase();
    let mut count = 0;
    let mut pos = 0;
    while let Some(idx) = s[pos..].find(&kw) {
        count += 1;
        pos += idx + kw.len();
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_hit(conv_id: i64, ki: usize, occ: usize, len: usize) -> RawHit {
        RawHit {
            conv_id,
            title: "test".into(),
            conv_type: "concept".into(),
            match_field: "title".into(),
            snippet: "test".into(),
            created_at: "2026-01-01".into(),
            source_len: len,
            keyword_index: ki,
            ocurrences: occ,
            article_title: None,
        }
    }

    #[test]
    fn single_keyword_ranks_by_tf() {
        let hits = vec![
            make_hit(1, 0, 3, 100), // 3/200 = 0.015
            make_hit(2, 0, 1, 100), // 1/200 = 0.005
        ];
        let idfs = vec![1.0];
        let result = score_and_rank(hits, &idfs, 5);
        assert_eq!(result.len(), 2);
        assert!(result[0].score > result[1].score);
        assert_eq!(result[0].conv_id, 1);
    }

    #[test]
    fn multi_keyword_accumulates() {
        let hits = vec![
            make_hit(1, 0, 1, 100), // kw0: idf=1.0
            make_hit(1, 1, 1, 100), // kw1: idf=2.0 → total higher
            make_hit(2, 0, 2, 100), // kw0: 2 hits × idf=1.0
        ];
        let idfs = vec![1.0, 2.0];
        let result = score_and_rank(hits, &idfs, 5);
        assert_eq!(result[0].conv_id, 1); // 1*1 + 1*2 = 3 → wins
    }

    #[test]
    fn short_text_boost() {
        let hits = vec![
            make_hit(1, 0, 1, 10),  // short doc
            make_hit(2, 0, 1, 1000), // long doc
        ];
        let idfs = vec![1.0];
        let result = score_and_rank(hits, &idfs, 5);
        assert!(result[0].score > result[1].score);
    }

    #[test]
    fn count_occurrences_case_insensitive() {
        assert_eq!(count_occurrences("Go is great, go use it", "Go"), 2);
        assert_eq!(count_occurrences("GO GO GO", "go"), 3);
    }

    #[test]
    fn count_occurrences_chinese() {
        assert_eq!(count_occurrences("编程编程测试", "编程"), 2);
        assert_eq!(count_occurrences("测试", "编程"), 0);
    }

    #[test]
    fn empty_idfs_handled() {
        let hits = vec![make_hit(1, 0, 1, 100)];
        let result = score_and_rank(hits, &[], 5);
        assert!(result.is_empty());
    }

    #[test]
    fn keyword_index_out_of_bounds_skipped() {
        let hits = vec![make_hit(1, 99, 5, 100)];
        let idfs = vec![1.0];
        let result = score_and_rank(hits, &idfs, 5);
        assert!(result.is_empty());
    }
}
