use sqlx::SqlitePool;
use std::sync::Arc;

use super::model::Article;
use super::repository::ReadingRepo;
use crate::shared::error_types::ServiceError;

fn extract_words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphabetic() && c != '\'' && c != '-')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect()
}

fn unique_words(words: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    words
        .into_iter()
        .filter(|w| seen.insert(w.clone()))
        .collect()
}

/// 命令侧服务——上传/标记单词/笔记等写操作。
///
/// CQRS 分离：纯读方法在 `ReadingQueryService` 中。
#[derive(Clone)]
pub struct ReadingService {
    repo: ReadingRepo,
}

impl ReadingService {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self {
            repo: ReadingRepo::new(pool),
        }
    }

    pub async fn upload_article(
        &self,
        title: &str,
        content: &str,
    ) -> Result<Article, ServiceError> {
        if title.trim().is_empty() {
            return Err(ServiceError::InvalidInput("文章标题不能为空".into()));
        }
        if content.trim().is_empty() {
            return Err(ServiceError::InvalidInput("文章内容不能为空".into()));
        }
        let title = title.trim();
        let content = content.trim();
        let repo = &self.repo;

        // 切词
        let all_words = extract_words(content);
        let word_count = all_words.len() as i64;
        let unique = unique_words(all_words);

        // 插入文章
        let article_id = repo
            .insert_article(title, content, word_count)
            .await
            .map_err(ServiceError::Db)?;

        // 插入文章词
        repo.insert_article_words(article_id, &unique)
            .await
            .map_err(ServiceError::Db)?;

        // 返回（刚插入必须存在；缺失视为数据异常，走 RowNotFound 错误）
        repo.get_article(article_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::Internal("文章写入后读取失败".into()))
    }

    /// 标记单词
    pub async fn mark_word(&self, word: &str, status: &str) -> Result<(), ServiceError> {
        if word.trim().is_empty() {
            return Err(ServiceError::InvalidInput("单词不能为空".into()));
        }
        if !matches!(status, "known" | "unknown" | "ignored") {
            return Err(ServiceError::InvalidInput("无效的单词状态".into()));
        }
        let word = word.trim();
        let repo = &self.repo;
        repo.upsert_user_word(word, status)
            .await
            .map_err(ServiceError::Db)
    }

    /// 更新文章笔记
    pub async fn update_notes(&self, id: i64, notes: &str) -> Result<(), ServiceError> {
        let repo = &self.repo;
        repo.update_article_notes(id, notes)
            .await
            .map_err(ServiceError::Db)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    // ── extract_words ──

    #[test]
    fn test_extract_words_basic() {
        let text = "Hello, world! This is a test. Don't stop learning.";
        let words = extract_words(text);
        assert_eq!(
            words,
            vec![
                "hello", "world", "this", "is", "a", "test", "don't", "stop", "learning"
            ]
        );
    }

    #[test]
    fn test_extract_words_empty_string() {
        assert!(extract_words("").is_empty());
    }

    #[test]
    fn test_extract_words_only_punctuation() {
        assert!(extract_words("... !!! ??? ,,,").is_empty());
    }

    #[test]
    fn test_extract_words_preserves_contractions() {
        let words = extract_words("I can't, you'll, we're, it's.");
        assert!(words.iter().any(|w| w == "can't"));
        assert!(words.iter().any(|w| w == "you'll"));
        assert!(words.iter().any(|w| w == "we're"));
        assert!(words.iter().any(|w| w == "it's"));
    }

    #[test]
    fn test_extract_words_numbers_and_hyphens() {
        let words = extract_words("Page 2 of 3 — well-known");
        assert!(!words.iter().any(|w| w == "2"));
        assert!(words.iter().any(|w| w == "of"));
        assert!(
            words.iter().any(|w| w == "well-known"),
            "hyphenated word should be one token: {:?}",
            words
        );
    }

    #[test]
    fn test_extract_words_case_insensitive() {
        let words = extract_words("Hello HELLO hello");
        assert_eq!(words, vec!["hello", "hello", "hello"]);
    }

    #[test]
    fn test_extract_words_single_letter() {
        let words = extract_words("I am a student");
        assert!(words.iter().any(|w| w == "i"));
        assert!(words.iter().any(|w| w == "a"));
    }

    #[test]
    fn test_extract_words_newlines_and_tabs() {
        let words = extract_words("line one\nline two\tend");
        assert_eq!(words, vec!["line", "one", "line", "two", "end"]);
    }

    #[test]
    fn test_extract_words_unicode_ignored() {
        let words = extract_words("café naïve über");
        // accented chars are non-ASCII, so they act as delimiters
        assert!(words.iter().any(|w| w == "caf"));
        assert!(words.iter().any(|w| w == "na"));
        assert!(words.iter().any(|w| w == "ve"));
        assert!(words.iter().any(|w| w == "ber"));
    }

    // ── unique_words ──

    #[test]
    fn test_unique_words_deduplicates() {
        let words = vec!["the".into(), "hello".into(), "the".into(), "world".into()];
        let unique = unique_words(words);
        let mut sorted = unique.clone();
        sorted.sort();
        assert_eq!(sorted, vec!["hello", "the", "world"]);
    }

    #[test]
    fn test_unique_words_empty() {
        assert!(unique_words(vec![]).is_empty());
    }

    #[test]
    fn test_unique_words_all_same() {
        let words = vec!["a".into(), "a".into(), "a".into()];
        assert_eq!(unique_words(words), vec!["a"]);
    }

    // ── Integration: extract + unique on real text ──

    #[test]
    fn test_extract_and_unique_pipeline() {
        let text = "The quick brown fox jumps over the lazy dog. The dog barks.";
        let words = extract_words(text);
        let unique = unique_words(words);
        let mut sorted = unique.clone();
        sorted.sort();
        assert_eq!(
            sorted,
            vec![
                "barks", "brown", "dog", "fox", "jumps", "lazy", "over", "quick", "the"
            ]
        );
        assert_eq!(unique.iter().filter(|w| *w == "the").count(), 1);
    }
}
