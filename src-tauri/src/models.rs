use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// RSS源数据模型
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Feed {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub group_id: Option<i64>,
    pub last_updated: Option<DateTime<Utc>>,
    pub translate_enabled: bool,
    pub notification_enabled: bool,
    pub last_update_status: Option<String>,
    pub update_attempts: i32,
    pub next_retry_time: Option<DateTime<Utc>>,
}

/// 文章数据模型
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Article {
    pub id: i64,
    pub feed_id: i64,
    pub title: String,
    pub content: String,
    pub pub_date: DateTime<Utc>,
    pub link: String,
    pub is_read: bool,
    pub is_favorite: bool,
    pub thumbnail: Option<String>,
    pub author: Option<String>,
    pub categories: Vec<String>,
    pub translated_title: Option<String>,
    pub translated_content: Option<String>,
}

/// 分组数据模型
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FeedGroup {
    pub id: i64,
    pub name: String,
    pub order_index: u32,
}

/// OPML导入/导出模型
#[derive(Debug, Serialize, Deserialize)]
pub struct OpmlFeed {
    pub title: String,
    pub url: String,
    pub category: Option<String>,
}

/// 搜索结果模型
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub article: Article,
    pub feed_name: String,
    pub score: f32,
}

/// AI平台数据模型
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AIPlatform {
    pub id: i64,
    pub name: String,
    pub api_url: String,
    pub api_key: String,
    pub api_model: String,
    pub is_default: bool,
}
