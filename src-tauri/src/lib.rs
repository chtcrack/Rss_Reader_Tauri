use std::fs;
use std::path::Path;
use tauri::{State, Emitter, Manager, async_runtime::Mutex};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_notification::NotificationExt;
use serde::{Deserialize, Serialize};
use toml::from_str;
use uuid::Uuid;
use std::time::SystemTime;
use std::fs::{read_dir, File};
use std::io::{Read, Write};
use chrono::Utc;

// 导入自定义模块
mod models;
mod db;
mod rss;
mod ai_translator;

use crate::db::DbManager;
use crate::models::{Article, Feed, FeedGroup, AIPlatform};
use crate::rss::RssUpdater;
use crate::ai_translator::AI_TRANSLATOR;

/// 配置文件结构
#[derive(Debug, Deserialize, Serialize, Default, Clone)]
struct Config {
    /// 数据库配置
    db: Option<DbConfig>,
    /// 更新配置
    update: Option<UpdateConfig>,
}

/// 数据库配置
#[derive(Debug, Deserialize, Serialize, Default, Clone)]
struct DbConfig {
    /// 数据库文件路径类型
    /// - "user" (默认): 使用用户AppData目录
    /// - "current": 使用当前执行目录
    /// - "custom": 使用自定义路径
    path_type: Option<String>,
    /// 自定义数据库文件路径（当path_type为"custom"时使用）
    custom_path: Option<String>,
}

/// 更新配置
#[derive(Debug, Deserialize, Serialize, Default, Clone)]
struct UpdateConfig {
    /// 自动更新间隔（秒）
    interval: Option<u64>,
}

// 配置缓存结构体
struct ConfigCache {
    config: Config,
    last_modified: std::time::SystemTime,
}

/// 聊天会话数据结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatSession {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub messages: Vec<crate::ai_translator::ChatMessage>,
}

// 应用状态
struct AppState {
    db_manager: Mutex<DbManager>,
    rss_updater: Mutex<RssUpdater>,
    config_cache: Mutex<Option<ConfigCache>>,
}

/// 安全截取字符串，确保不会在字符中间截断
fn safe_truncate(s: &str, max_len: usize) -> String {
    s.chars()
        .take(max_len)
        .collect()
}

/// 异步发送新文章通知（不阻塞主线程）
fn send_new_article_notification(app: &tauri::AppHandle, feed_name: &str, article_title: &str, translated_title: Option<&str>, notification_enabled: bool) {
    if !notification_enabled {
        return;
    }
    
    let app = app.clone();
    let feed_name = feed_name.to_string();
    
    let display_title = match translated_title {
        Some(translated) if !translated.is_empty() => {
            if translated.len() > 50 {
                safe_truncate(translated, 50)
            } else {
                translated.to_string()
            }
        }
        _ => {
            if article_title.len() > 50 {
                safe_truncate(article_title, 50)
            } else {
                article_title.to_string()
            }
        }
    };
    
    tokio::spawn(async move {
        let result = app.notification()
            .builder()
            .title(format!("RSS: {}", feed_name))
            .body(format!("新文章: {}", display_title))
            .show();
        
        if let Err(e) = result {
            eprintln!("Failed to send notification: {}", e);
        }
    });
}

// Tauri命令：初始化数据库
#[tauri::command(async)]
async fn init_db(app_state: State<'_, AppState>) -> Result<(), String> {
    let _db_manager = app_state.db_manager.lock().await;
    // 数据库已在AppState创建时初始化
    Ok(())
}

// 异步Tauri命令：初始化AI翻译器
#[tauri::command(async)]
async fn init_ai_translator(app_state: State<'_, AppState>) -> Result<(), String> {
    eprintln!("[AI] ===== 开始初始化AI翻译器 =====");
    // 获取默认AI平台
    let default_platform = {
        let db_manager = app_state.db_manager.lock().await;
        eprintln!("[AI] 成功锁定数据库管理器");
        
        // 先获取所有AI平台，查看是否有平台配置
        let all_platforms = db_manager.get_all_ai_platforms().map_err(|e| {
            eprintln!("[AI] 无法获取所有AI平台: {}", e);
            format!("Failed to initialize AI translator: {}", e)
        })?;
        eprintln!("[AI] 所有AI平台数量: {}, 列表: {:?}", all_platforms.len(), all_platforms);
        
        let platform = db_manager.get_default_ai_platform().map_err(|e| {
            eprintln!("[AI] 无法获取默认AI平台: {}", e);
            format!("Failed to initialize AI translator: {}", e)
        })?;
        eprintln!("[AI] 成功获取默认AI平台: {:?}", platform);
        platform
    };
    
    // 创建带有默认AI平台的新翻译器实例
    let translator = AI_TRANSLATOR.get_translator().await.with_default_platform(default_platform.clone());
    eprintln!("[AI] 成功创建翻译器实例并设置默认AI平台: {:?}", default_platform);
    
    // 验证设置是否成功
    let verify_platform = translator.get_default_platform().clone();
    eprintln!("[AI] 验证默认AI平台设置: {:?}", verify_platform);
    eprintln!("[AI] ===== AI翻译器初始化完成 =====");
    
    Ok(())
}

// 异步Tauri命令：更新单个RSS源
#[tauri::command(async,rename_all = "camelCase")]
async fn update_single_feed(app: tauri::AppHandle, app_state: State<'_, AppState>, feed_id: i64) -> Result<(), String> {
    // 获取指定RSS源
    let mut feed = {
        let db_manager = app_state.db_manager.lock().await;
        db_manager.get_feed_by_id(feed_id).map_err(|e| {
            eprintln!("Failed to get feed: {}", e);
            format!("Failed to get feed: {}", e)
        })?
    };
    
    // 手动刷新时，重置失败记录，立即尝试更新
    {
        let mut db_manager = app_state.db_manager.lock().await;
        // 重置失败尝试次数和下次重试时间
        if let Err(e) = db_manager.update_feed_success(feed.id, Utc::now()) {
            eprintln!("Failed to reset feed failure status: {}", e);
        }
        // 更新内存中的feed对象，确保使用最新状态
        feed = db_manager.get_feed_by_id(feed_id).map_err(|e| {
            eprintln!("Failed to get updated feed: {}", e);
            format!("Failed to get updated feed: {}", e)
        })?;
    }
    
    // 更新RSS源
    let rss_updater = RssUpdater::new();
    match rss_updater.update_feed(&feed).await {
        Ok(mut articles) => {
            // 检查哪些文章需要翻译
            let mut articles_to_translate = Vec::new();
            let mut articles_to_save = Vec::new();
            
            {
                let db_manager = app_state.db_manager.lock().await;
                
                // 筛选需要翻译的文章
                for article in articles {
                    if feed.translate_enabled {
                        if let Ok(needs_translation) = db_manager.article_needs_translation(article.feed_id, &article.link) {
                            if needs_translation {
                                articles_to_translate.push(article.clone());
                            } else {
                                articles_to_save.push(article);
                            }
                        } else {
                            // 查询失败，默认需要翻译
                            articles_to_translate.push(article.clone());
                        }
                    } else {
                        // 未启用翻译，直接保存
                        articles_to_save.push(article);
                    }
                }
            }
            
            // 保存不需要翻译的文章
            let mut new_article_count = 0;
            for article in articles_to_save {
                let db_manager = app_state.db_manager.lock().await;
                
                if let Ok(true) = db_manager.add_article(&article) {
                    new_article_count += 1;
                    send_new_article_notification(&app, &feed.name, &article.title, article.translated_title.as_deref(), feed.notification_enabled);
                }
            }
            
            // 翻译需要翻译的文章
            if !articles_to_translate.is_empty() && feed.translate_enabled {
                eprintln!("[AI] ===== 开始翻译RSS源 {} 的文章 ======", feed.name);
                eprintln!("[AI] 需要翻译的文章数量: {}", articles_to_translate.len());
                
                // 从数据库获取默认AI平台
                let default_platform = {
                    let db_manager = app_state.db_manager.lock().await;
                    db_manager.get_default_ai_platform().map_err(|e| {
                        eprintln!("Failed to get default AI platform from database: {}", e);
                        format!("Failed to get default AI platform: {}", e)
                    })?
                };
                
                // 获取AI翻译器实例并设置默认平台
                let translator = AI_TRANSLATOR.get_translator().await
                    .with_default_platform(default_platform);
                
                // 遍历需要翻译的文章，进行翻译并实时保存
                for (index, article) in articles_to_translate.iter_mut().enumerate() {
                    eprintln!("[AI] 开始翻译第 {} 篇文章: {}", index + 1, article.title);
                    eprintln!("[AI] 文章内容长度: {}", article.content.len());
                    
                    match translator.translate_rss_content(
                        &article.title,
                        &article.content,
                        "zh-CN",  // 默认翻译为中文
                    ).await {
                        Ok((translated_title, translated_content)) => {
                            // 翻译成功，更新文章字段
                            eprintln!("[AI] 成功翻译文章标题: {}", translated_title);
                            eprintln!("[AI] 翻译后内容长度: {}", translated_content.len());
                            article.translated_title = Some(translated_title);
                            article.translated_content = Some(translated_content);
                        },
                        Err(e) => {
                            // 翻译失败，记录错误但不影响整体更新
                            eprintln!("[AI] 翻译文章 {} 失败: {}", article.title, e);
                            eprintln!("[AI] 错误详情: {:?}", e);
                            // 保持translated_title和translated_content为None
                        }
                    }
                    eprintln!("[AI] 完成第 {} 篇文章翻译", index + 1);
                    
                    // 翻译完成后立即保存到数据库，然后释放锁
                    let db_manager = app_state.db_manager.lock().await;
                    if let Ok(true) = db_manager.add_article(&article) {
                        new_article_count += 1;
                        send_new_article_notification(&app, &feed.name, &article.title, article.translated_title.as_deref(), feed.notification_enabled);
                    }
                }
                eprintln!("[AI] ===== 完成RSS源 {} 的文章翻译 ======", feed.name);
            }
            
            println!("更新完成: {} 新增 {} 篇文章", feed.name, new_article_count);
            
            // 发布feed_updated事件，通知前端更新完成
            if let Err(e) = app.emit("feed_updated", Some(feed.id)) {
                eprintln!("Failed to emit feed_updated event: {}", e);
            }
        },
        Err(e) => {
            eprintln!("Failed to update feed {}: {}", feed.name, e);
            
            // 更新失败状态
            {
                let mut db_manager = app_state.db_manager.lock().await;
                if let Err(err) = db_manager.update_feed_failure(feed.id, &e.to_string()) {
                    eprintln!("Failed to update feed failure status: {}", err);
                }
            }
            
            // 即使更新失败，也通知前端，以便清除加载状态
            if let Err(e) = app.emit("feed_updated", Some(feed.id)) {
                eprintln!("Failed to emit feed_updated event: {}", e);
            }
        }
    }
      
      Ok(())
}

// 异步Tauri命令：添加RSS源
#[tauri::command(async)]
async fn add_feed(app: tauri::AppHandle, app_state: State<'_, AppState>, feed: Feed) -> Result<i64, String> {
    // 将RSS源添加到数据库
    let feed_id = {
        let mut db_manager = app_state.db_manager.lock().await;
        
        db_manager.add_feed(&feed).map_err(|e| {
            eprintln!("Failed to add feed to database: {}", e);
            format!("Failed to add feed: {}", e)
        })?
    };  // 作用域结束，db_manager锁释放
    
    // 创建包含数据库ID的新Feed对象
    let mut new_feed = feed;
    new_feed.id = feed_id;
    
    // 克隆AppHandle，以便在异步任务中使用
    let app_clone = app.clone();
    
    // 启动异步任务更新新添加的RSS源，使用tokio::spawn避免阻塞
    tokio::spawn(async move {
        // 等待一小段时间，确保数据库操作完成
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        
        // 更新RSS源
        let rss_updater = RssUpdater::new();
        let result = rss_updater.update_feed(&new_feed).await;
        
        // 处理更新结果
        if let Ok(mut articles) = result {
            // 获取应用实例和状态
            if let Some(window) = app_clone.get_webview_window("main") {
                let app_handle = window.app_handle();
                let app_state = app_handle.state::<AppState>();
                
                // 检查哪些文章需要翻译
                let mut articles_to_translate = Vec::new();
                let mut articles_to_save = Vec::new();
                
                // 获取数据库锁并筛选需要翻译的文章
                {
                    let db_manager = app_state.db_manager.lock().await;
                    
                    // 筛选需要翻译的文章
                    for article in articles {
                        if new_feed.translate_enabled {
                            // 检查文章是否需要翻译
                            let needs_translation = db_manager.article_needs_translation(article.feed_id, &article.link).unwrap_or(true);
                            
                            if needs_translation {
                                articles_to_translate.push(article.clone());
                            } else {
                                articles_to_save.push(article);
                            }
                        } else {
                            // 未启用翻译，直接保存
                            articles_to_save.push(article);
                        }
                    }
                }
                
                // 保存不需要翻译的文章
                let mut new_article_count = 0;
                for article in articles_to_save {
                    let db_manager = app_state.db_manager.lock().await;
                    
                    if let Ok(true) = db_manager.add_article(&article) {
                        new_article_count += 1;
                        send_new_article_notification(&app, &new_feed.name, &article.title, article.translated_title.as_deref(), new_feed.notification_enabled);
                    }
                }
                
                // 翻译需要翻译的文章
                if !articles_to_translate.is_empty() && new_feed.translate_enabled {
                    eprintln!("[AI] ===== 开始翻译RSS源 {} 的文章 ======", new_feed.name);
                    eprintln!("[AI] 需要翻译的文章数量: {}", articles_to_translate.len());
                    
                    // 从数据库获取默认AI平台
                    let default_platform = {
                        let db_manager = app_state.db_manager.lock().await;
                        match db_manager.get_default_ai_platform() {
                            Ok(platform) => platform,
                            Err(e) => {
                                eprintln!("Failed to get default AI platform from database: {}", e);
                                None
                            }
                        }
                    };
                    
                    // 如果有默认平台，进行翻译
                    if let Some(platform) = default_platform {
                        // 获取AI翻译器实例并设置默认平台
                        let translator = AI_TRANSLATOR.get_translator().await
                            .with_default_platform(Some(platform));
                        
                        // 遍历需要翻译的文章，进行翻译并实时保存
                        for (index, article) in articles_to_translate.iter_mut().enumerate() {
                            eprintln!("[AI] 开始翻译第 {} 篇文章: {}", index + 1, article.title);
                            eprintln!("[AI] 文章内容长度: {}", article.content.len());
                            
                            match translator.translate_rss_content(
                                &article.title,
                                &article.content,
                                "zh-CN",  // 默认翻译为中文
                            ).await {
                                Ok((translated_title, translated_content)) => {
                                    // 翻译成功，更新文章字段
                                    eprintln!("[AI] 成功翻译文章标题: {}", translated_title);
                                    eprintln!("[AI] 翻译后内容长度: {}", translated_content.len());
                                    article.translated_title = Some(translated_title);
                                    article.translated_content = Some(translated_content);
                                },
                                Err(e) => {
                                    // 翻译失败，记录错误但不影响整体更新
                                    eprintln!("[AI] 翻译文章 {} 失败: {}", article.title, e);
                                    eprintln!("[AI] 错误详情: {:?}", e);
                                    // 保持translated_title和translated_content为None
                                }
                            }
                            eprintln!("[AI] 完成第 {} 篇文章翻译", index + 1);
                            
                            // 翻译完成后立即保存到数据库，然后释放锁
                            let db_manager = app_state.db_manager.lock().await;
                            if let Ok(true) = db_manager.add_article(&article) {
                                new_article_count += 1;
                                send_new_article_notification(&app, &new_feed.name, &article.title, article.translated_title.as_deref(), new_feed.notification_enabled);
                            }
                        }
                        eprintln!("[AI] ===== 完成RSS源 {} 的文章翻译 ======", new_feed.name);
                    } else {
                        // 如果没有默认平台，直接保存未翻译的文章
                        eprintln!("[AI] 错误: 没有配置默认AI平台");
                        // 保存未翻译的文章，每篇独立获取和释放锁
                        for article in articles_to_translate {
                            let db_manager = app_state.db_manager.lock().await;
                            if let Ok(true) = db_manager.add_article(&article) {
                                new_article_count += 1;
                                send_new_article_notification(&app, &new_feed.name, &article.title, article.translated_title.as_deref(), new_feed.notification_enabled);
                            }
                        }
                    }
                }
                
                println!("更新完成: {} 新增 {} 篇文章", new_feed.name, new_article_count);
            }
            
            // 发布feed_updated事件，通知前端更新完成
            if let Err(e) = app_clone.emit("feed_updated", Some(new_feed.id)) {
                eprintln!("Failed to emit feed_updated event: {}", e);
            }
        } else if let Err(e) = result {
            // 更新失败的情况
            eprintln!("Failed to update feed {}: {}", new_feed.name, e);
            
            // 即使更新失败，也通知前端，以便清除加载状态
            if let Err(e) = app_clone.emit("feed_updated", Some(new_feed.id)) {
                eprintln!("Failed to emit feed_updated event: {}", e);
            }
        }
    });
    
    Ok(feed_id)
}

// Tauri命令：获取所有RSS源
#[tauri::command(async)]
async fn get_all_feeds(app_state: State<'_, AppState>) -> Result<Vec<Feed>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_all_feeds().map_err(|e| {
        eprintln!("Failed to get feeds from database: {}", e);
        format!("Failed to get feeds: {}", e)
    })
}

// Tauri命令：获取未读文章数量
#[tauri::command(async, rename_all = "camelCase")]
async fn get_unread_count(app_state: State<'_, AppState>, feed_id: Option<i64>) -> Result<u32, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_unread_count(feed_id).map_err(|e| {
        eprintln!("Failed to get unread count from database: {}", e);
        format!("Failed to get unread count: {}", e)
    })
}

// Tauri命令：获取所有源的未读计数
#[tauri::command(async, rename_all = "camelCase")]
async fn get_all_unread_counts(app_state: State<'_, AppState>) -> Result<std::collections::HashMap<i64, u32>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_all_unread_counts().map_err(|e| {
        eprintln!("Failed to get all unread counts from database: {}", e);
        format!("Failed to get all unread counts: {}", e)
    })
}

// Tauri命令：搜索文章
#[tauri::command(async, rename_all = "camelCase")]
async fn search_articles(app_state: State<'_, AppState>, query: &str, limit: u32, feed_id: Option<i64>) -> Result<Vec<(Article, String)>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.search_articles(query, limit, feed_id).map_err(|e| {
        eprintln!("Failed to search articles in database: {}", e);
        format!("Failed to search articles: {}", e)
    })
}

// Tauri命令：标记文章为已读
#[tauri::command(async)]
async fn mark_article_as_read(app_state: State<'_, AppState>, articleId: i64, isRead: bool) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.mark_article_as_read(articleId, isRead).map_err(|e| {
        eprintln!("Failed to mark article as read in database: {}", e);
        format!("Failed to mark article as read: {}", e)
    })
}

// Tauri命令：删除RSS源
#[tauri::command(async)]
async fn delete_feed(app_state: State<'_, AppState>, feed_id: i64) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.delete_feed(feed_id).map_err(|e| {
        eprintln!("Failed to delete feed from database: {}", e);
        format!("Failed to delete feed: {}", e)
    })
}

// Tauri命令：更新RSS源
#[tauri::command(async)]
async fn update_feed(app_state: State<'_, AppState>, feed: Feed) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.update_feed(&feed).map_err(|e| {
        eprintln!("Failed to update feed in database: {}", e);
        format!("Failed to update feed: {}", e)
    })
}

// Tauri命令：添加分组
#[tauri::command(async)]
async fn add_group(app_state: State<'_, AppState>, group: FeedGroup) -> Result<i64, String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.add_group(&group).map_err(|e| {
        eprintln!("Failed to add group to database: {}", e);
        format!("Failed to add group: {}", e)
    })
}

// Tauri命令：获取所有分组
#[tauri::command(async)]
async fn get_all_groups(app_state: State<'_, AppState>) -> Result<Vec<FeedGroup>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_all_groups().map_err(|e| {
        eprintln!("Failed to get groups from database: {}", e);
        format!("Failed to get groups: {}", e)
    })
}

// Tauri命令：更新分组
#[tauri::command(async)]
async fn update_group(app_state: State<'_, AppState>, group: FeedGroup) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.update_group(&group).map_err(|e| {
        eprintln!("Failed to update group in database: {}", e);
        format!("Failed to update group: {}", e)
    })
}

// Tauri命令：删除分组
#[tauri::command(async)]
async fn delete_group(app_state: State<'_, AppState>, group_id: i64) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.delete_group(group_id).map_err(|e| {
        eprintln!("Failed to delete group from database: {}", e);
        format!("Failed to delete group: {}", e)
    })
}

// Tauri命令：获取特定分组的RSS源
#[tauri::command(async)]
async fn get_feeds_by_group(app_state: State<'_, AppState>, group_id: i64) -> Result<Vec<Feed>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_feeds_by_group(group_id).map_err(|e| {
        eprintln!("Failed to get feeds by group from database: {}", e);
        format!("Failed to get feeds by group: {}", e)
    })
}

// Tauri命令：获取特定RSS源的文章
#[tauri::command(async)]
async fn get_articles_by_feed(app_state: State<'_, AppState>, feedId: i64, limit: u32, offset: u32) -> Result<Vec<Article>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_articles_by_feed(feedId, limit, offset).map_err(|e| {
        eprintln!("Failed to get articles by feed from database: {}", e);
        format!("Failed to get articles by feed: {}", e)
    })
}

// Tauri命令：获取所有文章
#[tauri::command(async)]
async fn get_all_articles(app_state: State<'_, AppState>, limit: u32, offset: u32) -> Result<Vec<Article>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_all_articles(limit, offset).map_err(|e| {
        eprintln!("Failed to get all articles from database: {}", e);
        format!("Failed to get all articles: {}", e)
    })
}

// Tauri命令：标记文章为收藏
#[tauri::command(async)]
async fn toggle_favorite(app_state: State<'_, AppState>, articleId: i64, isFavorite: bool) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.toggle_favorite(articleId, isFavorite).map_err(|e| {
        eprintln!("Failed to toggle favorite in database: {}", e);
        format!("Failed to toggle favorite: {}", e)
    })
}

// Tauri命令：获取收藏的文章
#[tauri::command(async)]
async fn get_favorite_articles(app_state: State<'_, AppState>, limit: u32, offset: u32) -> Result<Vec<Article>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_favorite_articles(limit, offset).map_err(|e| {
        eprintln!("Failed to get favorite articles from database: {}", e);
        format!("Failed to get favorite articles: {}", e)
    })
}

// Tauri命令：根据feed_id获取收藏文章
#[tauri::command(async)]
async fn get_favorite_articles_by_feed(app_state: State<'_, AppState>, feedId: i64, limit: u32, offset: u32) -> Result<Vec<Article>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_favorite_articles_by_feed(feedId, limit, offset).map_err(|e| {
        eprintln!("Failed to get favorite articles by feed from database: {}", e);
        format!("Failed to get favorite articles by feed: {}", e)
    })
}

// Tauri命令：获取未读文章
#[tauri::command(async)]
async fn get_unread_articles(app_state: State<'_, AppState>, limit: u32, offset: u32) -> Result<Vec<Article>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_unread_articles(limit, offset).map_err(|e| {
        eprintln!("Failed to get unread articles from database: {}", e);
        format!("Failed to get unread articles: {}", e)
    })
}

// Tauri命令：根据feed_id获取未读文章
#[tauri::command(async)]
async fn get_unread_articles_by_feed(app_state: State<'_, AppState>, feedId: i64, limit: u32, offset: u32) -> Result<Vec<Article>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_unread_articles_by_feed(feedId, limit, offset).map_err(|e| {
        eprintln!("Failed to get unread articles by feed from database: {}", e);
        format!("Failed to get unread articles by feed: {}", e)
    })
}

// Tauri命令：获取文章总数
#[tauri::command(async)]
async fn get_article_count(app_state: State<'_, AppState>, feed_id: Option<i64>) -> Result<u32, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_article_count(feed_id).map_err(|e| {
        eprintln!("Failed to get article count from database: {}", e);
        format!("Failed to get article count: {}", e)
    })
}

// Tauri命令：获取过滤条件下的文章总数
#[tauri::command(async)]
async fn get_filtered_article_count(app_state: State<'_, AppState>, filter: &str, feed_id: Option<i64>) -> Result<u32, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_filtered_article_count(filter, feed_id).map_err(|e| {
        eprintln!("Failed to get filtered article count from database: {}", e);
        format!("Failed to get filtered article count: {}", e)
    })
}

// Tauri命令：导出OPML文件
#[tauri::command(async, rename_all = "camelCase")]
async fn export_opml(app_state: State<'_, AppState>) -> Result<String, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.export_opml().map_err(|e| {
        eprintln!("Failed to export OPML from database: {}", e);
        format!("Failed to export OPML: {}", e)
    })
}

// Tauri命令：导入OPML文件
#[tauri::command(async, rename_all = "camelCase")]
async fn import_opml(app_state: State<'_, AppState>, opml_content: String) -> Result<usize, String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.import_opml(&opml_content).map_err(|e| {
        eprintln!("Failed to import OPML to database: {}", e);
        format!("Failed to import OPML: {}", e)
    })
}

// Tauri命令：添加AI平台
#[tauri::command(async)]
async fn add_ai_platform(app_state: State<'_, AppState>, platform: AIPlatform) -> Result<i64, String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.add_ai_platform(&platform).map_err(|e| {
        eprintln!("Failed to add AI platform to database: {}", e);
        format!("Failed to add AI platform: {}", e)
    })
}

// Tauri命令：获取所有AI平台
#[tauri::command(async)]
async fn get_all_ai_platforms(app_state: State<'_, AppState>) -> Result<Vec<AIPlatform>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_all_ai_platforms().map_err(|e| {
        eprintln!("Failed to get AI platforms from database: {}", e);
        format!("Failed to get AI platforms: {}", e)
    })
}

// Tauri命令：获取默认AI平台
#[tauri::command(async)]
async fn get_default_ai_platform(app_state: State<'_, AppState>) -> Result<Option<AIPlatform>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_default_ai_platform().map_err(|e| {
        eprintln!("Failed to get default AI platform from database: {}", e);
        format!("Failed to get default AI platform: {}", e)
    })
}

// Tauri命令：更新AI平台
#[tauri::command(async)]
async fn update_ai_platform(app_state: State<'_, AppState>, platform: AIPlatform) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.update_ai_platform(&platform).map_err(|e| {
        eprintln!("Failed to update AI platform in database: {}", e);
        format!("Failed to update AI platform: {}", e)
    })
}

// Tauri命令：删除AI平台
#[tauri::command(async)]
async fn delete_ai_platform(app_state: State<'_, AppState>, platform_id: i64) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.delete_ai_platform(platform_id).map_err(|e| {
        eprintln!("Failed to delete AI platform from database: {}", e);
        format!("Failed to delete AI platform: {}", e)
    })
}

// Tauri命令：删除文章
#[tauri::command(async, rename_all = "camelCase")]
async fn delete_articles(app_state: State<'_, AppState>, feed_id: Option<i64>) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.delete_articles(feed_id).map_err(|e| {
        eprintln!("Failed to delete articles from database: {}", e);
        format!("Failed to delete articles: {}", e)
    })
}

// Tauri命令：删除单篇文章
#[tauri::command(async, rename_all = "camelCase")]
async fn delete_article(app_state: State<'_, AppState>, article_id: i64) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.delete_article(article_id).map_err(|e| {
        eprintln!("Failed to delete article from database: {}", e);
        format!("Failed to delete article: {}", e)
    })
}

// Tauri命令：标记所有文章为已读
#[tauri::command(async, rename_all = "camelCase")]
async fn mark_all_articles_as_read(app_state: State<'_, AppState>, feed_id: Option<i64>) -> Result<(), String> {
    let mut db_manager = app_state.db_manager.lock().await;
    db_manager.mark_all_articles_as_read(feed_id).map_err(|e| {
        eprintln!("Failed to mark all articles as read from database: {}", e);
        format!("Failed to mark all articles as read: {}", e)
    })
}

// Tauri命令：打开链接
#[tauri::command]
fn open_link(app_handle: tauri::AppHandle, url: String) -> Result<(), String> {
    // 使用Tauri插件打开链接
    app_handle.opener().open_url(url, None::<String>).map_err(|e| {
        eprintln!("Failed to open link: {}", e);
        format!("Failed to open link: {}", e)
    })
}

// Tauri命令：设置默认AI平台
#[tauri::command(async)]
async fn set_default_ai_platform(app_state: State<'_, AppState>, platform_id: i64) -> Result<(), String> {
    // 更新数据库中的默认平台
    {
        let mut db_manager = app_state.db_manager.lock().await;
        db_manager.set_default_ai_platform(platform_id).map_err(|e| {
            eprintln!("Failed to set default AI platform in database: {}", e);
            format!("Failed to set default AI platform: {}", e)
        })?;
    }
    
    // 获取新的默认平台
    let new_default_platform = {
        let db_manager = app_state.db_manager.lock().await;
        db_manager.get_default_ai_platform().map_err(|e| {
            eprintln!("Failed to get new default AI platform from database: {}", e);
            format!("Failed to get new default AI platform: {}", e)
        })?
    };
    
    // 创建新的翻译器实例并设置默认平台（不影响正在进行的其他操作）
    let _translator = AI_TRANSLATOR.get_translator().await.with_default_platform(new_default_platform);
    
    Ok(())
}

// Tauri命令：更新自动更新间隔
#[tauri::command(async)]
async fn update_update_interval(app_state: State<'_, AppState>, interval: u64) -> Result<(), String> {
    use std::fs::write;
    
    // 读取当前配置
    let mut config = read_config_file();
    
    // 更新自动更新间隔
    if config.update.is_none() {
        config.update = Some(UpdateConfig { interval: Some(interval) });
    } else {
        if let Some(update_config) = &mut config.update {
            update_config.interval = Some(interval);
        }
    }
    
    // 获取配置文件路径
    let config_path = get_config_path();
    
    // 序列化配置为TOML格式
    let toml_content = toml::to_string_pretty(&config).map_err(|e| {
        eprintln!("Failed to serialize config: {}", e);
        format!("Failed to save update interval: {}", e)
    })?;
    
    // 写入配置文件
    write(&config_path, toml_content).map_err(|e| {
        eprintln!("Failed to write config file: {}", e);
        format!("Failed to save update interval: {}", e)
    })?;
    
    // 更新配置缓存
    let current_modified = match std::fs::metadata(&config_path) {
        Ok(metadata) => metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH),
        Err(_) => std::time::SystemTime::UNIX_EPOCH,
    };
    
    let mut config_cache_guard = app_state.config_cache.lock().await;
    *config_cache_guard = Some(ConfigCache {
        config,
        last_modified: current_modified,
    });
    
    Ok(())
}

// 辅助函数：获取聊天会话目录路径
fn get_chat_sessions_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // 获取应用数据目录
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let chat_dir = app_dir.join("chat_sessions");
    
    // 创建目录如果不存在
    if let Err(e) = fs::create_dir_all(&chat_dir) {
        return Err(format!("Failed to create chat sessions directory: {}", e));
    }
    
    Ok(chat_dir)
}

// Tauri命令：创建新的聊天会话
#[tauri::command(async)]
async fn create_chat_session(app: tauri::AppHandle, name: Option<String>) -> Result<ChatSession, String> {
    let chat_dir = get_chat_sessions_dir(&app)?;
    let session_id = Uuid::new_v4().to_string();
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| format!("Failed to get current time: {}", e))?
        .as_secs();
    
    let session = ChatSession {
        id: session_id.clone(),
        name: name.unwrap_or_else(|| format!("新会话 {}", now)),
        created_at: now,
        updated_at: now,
        messages: Vec::new(),
    };
    
    // 保存会话到文件
    let session_path = chat_dir.join(format!("{}.json", session_id));
    let session_json = serde_json::to_string_pretty(&session).map_err(|e| format!("Failed to serialize session: {}", e))?;
    
    fs::write(session_path, session_json).map_err(|e| format!("Failed to write session file: {}", e))?;
    
    Ok(session)
}

// Tauri命令：获取所有聊天会话列表
#[tauri::command(async)]
async fn get_chat_sessions(app: tauri::AppHandle) -> Result<Vec<ChatSession>, String> {
    let chat_dir = get_chat_sessions_dir(&app)?;
    let mut sessions = Vec::new();
    
    // 读取目录中的所有会话文件
    let entries = read_dir(chat_dir).map_err(|e| format!("Failed to read chat sessions directory: {}", e))?;
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();
        
        // 只处理.json文件
        if let Some(extension) = path.extension() {
            if extension == "json" {
                // 读取文件内容
                let mut file = File::open(&path).map_err(|e| format!("Failed to open session file: {}", e))?;
                let mut contents = String::new();
                file.read_to_string(&mut contents).map_err(|e| format!("Failed to read session file: {}", e))?;
                
                // 解析JSON
                let session: ChatSession = serde_json::from_str(&contents).map_err(|e| format!("Failed to parse session file: {}", e))?;
                sessions.push(session);
            }
        }
    }
    
    // 按更新时间排序，最新的在前
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    
    Ok(sessions)
}

// Tauri命令：获取指定会话的详细内容
#[tauri::command(async,rename_all = "camelCase")]
async fn get_chat_session(app: tauri::AppHandle, session_id: String) -> Result<ChatSession, String> {
    let chat_dir = get_chat_sessions_dir(&app)?;
    let session_path = chat_dir.join(format!("{}.json", session_id));
    
    // 检查文件是否存在
    if !session_path.exists() {
        return Err(format!("Session not found: {}", session_id));
    }
    
    // 读取文件内容
    let mut file = File::open(&session_path).map_err(|e| format!("Failed to open session file: {}", e))?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|e| format!("Failed to read session file: {}", e))?;
    
    // 解析JSON
    let session: ChatSession = serde_json::from_str(&contents).map_err(|e| format!("Failed to parse session file: {}", e))?;
    
    Ok(session)
}

// Tauri命令：保存聊天会话内容
#[tauri::command(async,rename_all = "camelCase")]
async fn save_chat_session(app: tauri::AppHandle, session: ChatSession) -> Result<(), String> {
    let chat_dir = get_chat_sessions_dir(&app)?;
    let session_path = chat_dir.join(format!("{}.json", session.id));
    
    // 更新会话的更新时间
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| format!("Failed to get current time: {}", e))?
        .as_secs();
    
    let mut updated_session = session;
    updated_session.updated_at = now;
    
    // 保存会话到文件
    let session_json = serde_json::to_string_pretty(&updated_session).map_err(|e| format!("Failed to serialize session: {}", e))?;
    
    fs::write(session_path, session_json).map_err(|e| format!("Failed to write session file: {}", e))?;
    
    Ok(())
}

// Tauri命令：删除聊天会话
#[tauri::command(async,rename_all = "camelCase")]
async fn delete_chat_session(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let chat_dir = get_chat_sessions_dir(&app)?;
    let session_path = chat_dir.join(format!("{}.json", session_id));
    
    // 删除文件
    fs::remove_file(session_path).map_err(|e| format!("Failed to delete session file: {}", e))?;
    
    Ok(())
}

// Tauri命令：更新聊天会话信息
#[tauri::command(async,rename_all = "camelCase")]
async fn update_chat_session(app: tauri::AppHandle, session_id: String, name: String) -> Result<ChatSession, String> {
    // 获取当前会话
    let mut session = get_chat_session(app.clone(), session_id.clone()).await?;
    
    // 更新会话信息
    session.name = name;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| format!("Failed to get current time: {}", e))?
        .as_secs();
    session.updated_at = now;
    
    // 保存更新后的会话
    save_chat_session(app, session.clone()).await?;
    
    Ok(session)
}

// Tauri命令：获取最新的聊天会话
#[tauri::command(async)]
async fn get_latest_chat_session(app: tauri::AppHandle) -> Result<Option<ChatSession>, String> {
    let sessions = get_chat_sessions(app).await?;
    Ok(sessions.into_iter().next())
}

// Tauri命令：AI聊天（流式）
#[tauri::command(async)]
async fn ai_chat(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    messages: Vec<crate::ai_translator::ChatMessage>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    platform_id: Option<i64>,
) -> Result<(), String> {
    // 获取AI翻译器实例
    let mut translator = AI_TRANSLATOR.get_translator().await;
    
    // 根据platform_id获取AI平台，优先级：指定平台 > 默认平台
    let selected_platform = if let Some(platform_id) = platform_id {
        // 使用指定的平台
        let db_manager = app_state.db_manager.lock().await;
        db_manager.get_ai_platform_by_id(platform_id).map_err(|e| {
            eprintln!("Failed to get AI platform by id: {}", e);
            format!("Failed to get AI platform: {}", e)
        })?
    } else {
        // 使用默认平台
        let db_manager = app_state.db_manager.lock().await;
        db_manager.get_default_ai_platform().map_err(|e| {
            eprintln!("Failed to get default AI platform from database: {}", e);
            format!("Failed to get default AI platform: {}", e)
        })?
    };
    
    // 设置指定的AI平台到翻译器实例（仅用于当前聊天会话，不修改全局默认设置）
    translator = translator.with_default_platform(selected_platform);
    
    // 创建通道用于接收流式响应
    let (tx, mut rx) = tokio::sync::mpsc::channel(100);
    
    // 克隆app_handle用于事件发送
    let app_handle = app.clone();
    
    // 启动异步任务处理聊天响应
    tokio::spawn(async move {
        // 处理流式响应
        while let Some(content) = rx.recv().await {
            // 发送事件给前端
            if let Err(e) = app_handle.emit("ai_chat_response", content) {
                eprintln!("Failed to emit ai_chat_response event: {}", e);
            }
        }
        // 发送结束事件
        let _ = app_handle.emit("ai_chat_end", ());
    });
    
    // 调用AI翻译器的聊天函数
    match translator.chat_completion_stream(messages, max_tokens, temperature, tx).await {
        Ok(_) => Ok(()),
        Err(e) => {
            eprintln!("Failed to call chat_completion_stream: {}", e);
            // 将错误转换为字符串返回给前端
            Err(e.to_string())
        }
    }
}

// 异步Tauri命令：更新所有RSS源
#[tauri::command(async)]
async fn update_all_feeds(_app: tauri::AppHandle, app_state: State<'_, AppState>) -> Result<(), String> {
    // 获取RSS源列表
    let all_feeds = {
        let db_manager = app_state.db_manager.lock().await;
        db_manager.get_all_feeds().map_err(|e| {
            eprintln!("Failed to get feeds from database: {}", e);
            format!("Failed to update feeds: {}", e)
        })?
    };

    // 保存总源数量，避免后续使用被移动的all_feeds
    let total_feeds_count = all_feeds.len();
    
    // 筛选需要更新的RSS源：
    // 1. 没有失败记录的源
    // 2. 有失败记录但下次重试时间已到的源
    let now = Utc::now();
    let feeds_to_update: Vec<Feed> = all_feeds.into_iter()
        .filter(|feed| {
            match &feed.next_retry_time {
                None => true, // 没有失败记录，正常更新
                Some(retry_time) => *retry_time <= now, // 下次重试时间已到
            }
        })
        .collect();

    // 如果没有需要更新的源，直接返回
    if feeds_to_update.is_empty() {
        println!("没有需要更新的RSS源");
        return Ok(());
    }

    // 克隆RSS更新器并更新所有需要更新的源
    let rss_updater = {
        let rss_updater = app_state.rss_updater.lock().await;
        rss_updater.clone()
    };
    let results = rss_updater.update_feeds(&feeds_to_update).await;

    // 保存新文章到数据库，每个RSS源独立处理，每次操作后释放锁
    for (index, result) in results.iter().enumerate() {
        let feed = &feeds_to_update[index];
        match result {
            Ok((_, articles)) => {
                println!("开始保存来自 {} 的文章，共 {} 篇", feed.name, articles.len());
                
                // 保存当前RSS源的所有文章
                for article in articles {
                    // 为每篇文章独立获取和释放锁，减少锁持有时间
                    let mut db_manager = app_state.db_manager.lock().await;
                    // 尝试添加文章，如果成功则说明是新文章
                    match db_manager.add_article(&article) {
                        Ok(true) => {
                            // 发送新文章通知
                            send_new_article_notification(&_app, &feed.name, &article.title, article.translated_title.as_deref(), feed.notification_enabled);
                        }
                        Ok(false) => {
                            // 文章已存在，忽略
                        }
                        Err(e) => {
                            eprintln!("Failed to add article: {}", e);
                        }
                    }
                }
                
                println!("完成保存来自 {} 的文章", feed.name);
                
                // 更新feed的成功状态
                let last_updated = Utc::now();
                if let Err(e) = {
                    let mut db_manager = app_state.db_manager.lock().await;
                    db_manager.update_feed_success(feed.id, last_updated)
                } {
                    eprintln!("Failed to update feed success status: {}", e);
                }
            }
            Err(e) => {
                eprintln!("Failed to update feed {}: {}", feed.name, e);
                
                // 更新feed的失败状态
                if let Err(err) = {
                    let mut db_manager = app_state.db_manager.lock().await;
                    db_manager.update_feed_failure(feed.id, &e.to_string())
                } {
                    eprintln!("Failed to update feed failure status: {}", err);
                }
            }
        }
    }

    Ok(())
}

// 自动更新任务函数
async fn auto_update_feeds_task(app: tauri::AppHandle) {
    use tokio::time::{sleep, Duration};
    use chrono::{Utc};
    
    println!("启动自动更新任务");
    
    loop {
        // 从应用直接获取状态，确保它具有'static生命周期
        let app_state = app.state::<AppState>();
        
        // 从缓存获取配置，或重新读取
        let config = {
            let mut config_cache_guard = app_state.config_cache.lock().await;
            let config_path = get_config_path();
            
            // 检查配置文件是否存在
            if !config_path.exists() {
                println!("配置文件不存在，使用默认配置");
                Config::default()
            } else {
                // 获取文件修改时间
                let current_modified = match std::fs::metadata(&config_path) {
                    Ok(metadata) => metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH),
                    Err(_) => std::time::SystemTime::UNIX_EPOCH,
                };
                
                // 检查缓存是否有效
                let is_cache_valid = if let Some(cache) = &*config_cache_guard {
                    cache.last_modified == current_modified
                } else {
                    false
                };
                
                if is_cache_valid {
                    // 使用缓存的配置
                    println!("使用缓存的配置");
                    config_cache_guard.as_ref().unwrap().config.clone()
                } else {
                    // 重新读取配置文件
                    println!("配置文件已修改，重新读取");
                    let config = read_config_file();
                    
                    // 更新缓存
                    *config_cache_guard = Some(ConfigCache {
                        config: config.clone(),
                        last_modified: current_modified,
                    });
                    
                    config
                }
            }
        };
        
        let update_interval = match &config.update {
            Some(update_config) => update_config.interval.unwrap_or(5 * 60), // 默认5分钟
            None => 5 * 60, // 默认5分钟
        };
        
        // 获取所有RSS源 - 缩短锁持有时间
        let all_feeds = match {
            let db_manager = app_state.db_manager.lock().await;
            db_manager.get_all_feeds()
        } {
            Ok(feeds) => feeds,
            Err(e) => {
                eprintln!("Failed to get feeds for auto-update: {}", e);
                sleep(Duration::from_secs(60)).await;
                continue;
            }
        };
        
        // 保存总源数量，避免后续使用被移动的all_feeds
        let total_feeds_count = all_feeds.len();
        
        // 筛选需要更新的RSS源：
        // 1. 没有失败记录的源
        // 2. 有失败记录但下次重试时间已到的源
        let now = Utc::now();
        let feeds_to_update: Vec<Feed> = all_feeds.into_iter()
            .filter(|feed| {
                match &feed.next_retry_time {
                    None => true, // 没有失败记录，正常更新
                    Some(retry_time) => *retry_time <= now, // 下次重试时间已到
                }
            })
            .collect();
        
        if !feeds_to_update.is_empty() {
            // 获取RSS更新器 - 缩短锁持有时间
            let rss_updater = {
                let rss_updater = app_state.rss_updater.lock().await;
                rss_updater.clone()
            };
            
            // 更新需要更新的RSS源
            println!("开始自动更新 {} 个RSS源（共 {} 个源）", feeds_to_update.len(), total_feeds_count);
            let results = rss_updater.update_feeds(&feeds_to_update).await;
            
            // 处理更新结果
            for (index, result) in results.iter().enumerate() {
                let feed = &feeds_to_update[index];
                match result {
                    Ok((_, articles)) => {
                        println!("成功获取来自 {} 的 {} 篇文章", feed.name, articles.len());
                        
                        // 更新feed的成功状态 - 立即释放锁
                        let last_updated = Utc::now();
                        if let Err(e) = {
                            let mut db_manager = app_state.db_manager.lock().await;
                            db_manager.update_feed_success(feed.id, last_updated)
                        } {
                            eprintln!("Failed to update feed success status for {}: {}", feed.name, e);
                        }
                        
                        // 异步处理文章保存和翻译，避免阻塞主循环
                        let app_clone = app.clone();
                        let feed_clone = feed.clone();
                        let articles_clone = articles.clone();
                        
                        tauri::async_runtime::spawn(async move {
                            process_articles_sync(app_clone, feed_clone, articles_clone).await;
                        });
                    },
                    Err(e) => {
                        let error_msg = format!("{}", e);
                        eprintln!("Failed to update feed {} ({}): {}", feed.name, feed.url, error_msg);
                        
                        // 更新feed的失败状态 - 立即释放锁
                        if let Err(update_e) = {
                            let mut db_manager = app_state.db_manager.lock().await;
                            db_manager.update_feed_failure(feed.id, &error_msg)
                        } {
                            eprintln!("Failed to update feed failure status for {}: {}", feed.name, update_e);
                        }
                    }
                }
            }
        } else {
            println!("当前没有需要更新的RSS源，等待下次检查");
        }
        
        // 使用配置的更新间隔
        println!("下次自动更新检查将在 {} 秒后进行", update_interval);
        sleep(Duration::from_secs(update_interval)).await;
    }
}

// 异步处理文章保存和翻译 - 内部使用同步获取状态的版本
async fn process_articles_sync(
    app_handle: tauri::AppHandle,
    feed: Feed,
    articles: Vec<Article>
) {
    use chrono::{Utc};
    
    println!("开始处理来自 {} 的 {} 篇文章", feed.name, articles.len());
    
    // 分离需要翻译和不需要翻译的文章
    let mut articles_to_translate = Vec::new();
    let mut articles_to_save_directly = Vec::new();
    
    // 筛选需要翻译的文章 - 每次操作后释放锁
    {   
        // 获取应用状态
        let app_state = app_handle.state::<AppState>();
        
        for article in articles {
            if feed.translate_enabled {
                let needs_translation = match {
                    let db_manager = app_state.db_manager.lock().await;
                    db_manager.article_needs_translation(article.feed_id, &article.link)
                } {
                    Ok(needs) => needs,
                    Err(e) => {
                        eprintln!("Failed to check if article needs translation: {}", e);
                        // 查询失败，默认需要翻译
                        true
                    }
                };
                
                if needs_translation {
                    articles_to_translate.push(article.clone());
                } else {
                    articles_to_save_directly.push(article.clone());
                }
            } else {
                articles_to_save_directly.push(article.clone());
            }
        }
    }
    
    // 保存不需要翻译的文章 - 缩短锁持有时间
    {   
        // 获取应用状态
        let app_state = app_handle.state::<AppState>();
        
        for article in articles_to_save_directly {
            match {
                let mut db_manager = app_state.db_manager.lock().await;
                db_manager.add_article(&article)
            } {
                Ok(true) => {
                    // 发送新文章通知
                    send_new_article_notification(&app_handle, &feed.name, &article.title, article.translated_title.as_deref(), feed.notification_enabled);
                },
                Ok(false) => {
                    // 文章已存在，忽略
                },
                Err(e) => {
                    eprintln!("Failed to add article from {}: {}", feed.name, e);
                }
            }
        }
    }
    
    // 处理需要翻译的文章
    if !articles_to_translate.is_empty() && feed.translate_enabled {
        // 调用翻译处理函数，重新获取应用状态
        handle_article_translation(app_handle, articles_to_translate, &feed).await;
    }
    
    println!("完成处理来自 {} 的文章", feed.name);
}

// 异步处理文章保存和翻译
async fn process_articles(
    app_handle: tauri::AppHandle,
    app_state: tauri::State<'static, AppState>,
    feed: Feed,
    articles: Vec<Article>
) {
    use chrono::{Utc};
    
    println!("开始处理来自 {} 的 {} 篇文章", feed.name, articles.len());
    
    // 分离需要翻译和不需要翻译的文章
    let mut articles_to_translate = Vec::new();
    let mut articles_to_save_directly = Vec::new();
    
    // 筛选需要翻译的文章 - 每次操作后释放锁
    for article in articles {
        if feed.translate_enabled {
            let needs_translation = match {
                let db_manager = app_state.db_manager.lock().await;
                db_manager.article_needs_translation(article.feed_id, &article.link)
            } {
                Ok(needs) => needs,
                Err(e) => {
                    eprintln!("Failed to check if article needs translation: {}", e);
                    // 查询失败，默认需要翻译
                    true
                }
            };
            
            if needs_translation {
                articles_to_translate.push(article.clone());
            } else {
                articles_to_save_directly.push(article.clone());
            }
        } else {
            articles_to_save_directly.push(article.clone());
        }
    }
    
    // 保存不需要翻译的文章 - 缩短锁持有时间
    for article in articles_to_save_directly {
        match {
            let mut db_manager = app_state.db_manager.lock().await;
            db_manager.add_article(&article)
        } {
            Ok(true) => {
                // 发送新文章通知
                send_new_article_notification(&app_handle, &feed.name, &article.title, article.translated_title.as_deref(), feed.notification_enabled);
            },
            Ok(false) => {
                // 文章已存在，忽略
            },
            Err(e) => {
                eprintln!("Failed to add article from {}: {}", feed.name, e);
            }
        }
    }
    
    // 处理需要翻译的文章
    if !articles_to_translate.is_empty() && feed.translate_enabled {
        handle_article_translation(app_handle, articles_to_translate, &feed).await;
    }
    
    println!("完成处理来自 {} 的文章", feed.name);
}



// 异步处理文章翻译
async fn handle_article_translation(
    app_handle: tauri::AppHandle,
    articles: Vec<Article>,
    feed: &Feed
) {
    println!("[AI] 开始翻译来自 {} 的 {} 篇文章", feed.name, articles.len());
    
    // 获取应用状态
    let app_state = app_handle.state::<AppState>();
    
    // 获取默认AI平台 - 缩短锁持有时间
    let default_platform = match {
        let db_manager = app_state.db_manager.lock().await;
        db_manager.get_default_ai_platform()
    } {
        Ok(platform) => platform,
        Err(e) => {
            eprintln!("[AI] Failed to get default AI platform: {}", e);
            None
        }
    };
    
    if let Some(platform) = default_platform {
        // 获取AI翻译器实例
        let translator = AI_TRANSLATOR.get_translator().await
            .with_default_platform(Some(platform));
        
        // 逐个翻译文章并保存
        for (index, mut article) in articles.into_iter().enumerate() {
            println!("[AI] 翻译第 {} 篇文章: {}", index + 1, article.title);
            
            // 执行翻译
            let translation_result = translator.translate_rss_content(
                &article.title,
                &article.content,
                "zh-CN",
            ).await;
            
            // 完全处理翻译结果，确保没有实现Send的错误对象不跨越await边界
            match translation_result {
                Ok((translated_title, translated_content)) => {
                    // 更新文章翻译内容
                    article.translated_title = Some(translated_title);
                    article.translated_content = Some(translated_content);
                    
                    // 保存翻译后的文章 - 立即保存，不跨越await边界
                    let article_clone = article.clone();
                    let app_handle_clone = app_handle.clone();
                    let feed_clone = feed.clone();
                    
                    // 异步保存翻译后的文章
                    tauri::async_runtime::spawn(async move {
                        let app_state = app_handle_clone.state::<AppState>();
                        match {
                            let mut db_manager = app_state.db_manager.lock().await;
                            db_manager.add_article(&article_clone)
                        } {
                            Ok(true) => {
                                send_new_article_notification(&app_handle_clone, &feed_clone.name, &article_clone.title, article_clone.translated_title.as_deref(), feed_clone.notification_enabled);
                                println!("[AI] 成功翻译并保存文章: {}", article_clone.title);
                            },
                            Ok(false) => {
                                println!("[AI] 文章已存在，跳过保存: {}", article_clone.title);
                            },
                            Err(e) => {
                                eprintln!("[AI] Failed to save translated article: {}", e);
                            }
                        }
                    });
                },
                Err(e) => {
                    // 翻译失败，记录错误
                    let error_msg = format!("{}", e);
                    eprintln!("[AI] 翻译文章 {} 失败: {}", article.title, error_msg);
                    
                    // 保存原文 - 立即保存，不跨越await边界
                    let article_clone = article.clone();
                    let app_handle_clone = app_handle.clone();
                    let feed_clone = feed.clone();
                    
                    // 异步保存原文
                    tauri::async_runtime::spawn(async move {
                        let app_state = app_handle_clone.state::<AppState>();
                        match {
                            let db_manager = app_state.db_manager.lock().await;
                            db_manager.add_article(&article_clone)
                        } {
                            Ok(true) => {
                                send_new_article_notification(&app_handle_clone, &feed_clone.name, &article_clone.title, article_clone.translated_title.as_deref(), feed_clone.notification_enabled);
                                println!("[AI] 翻译失败，保存原文: {}", article_clone.title);
                            },
                            _ => {
                                // 忽略已存在或保存失败的情况
                            }
                        }
                    });
                }
            }
        }
    } else {
        // 没有默认AI平台，保存原文
        eprintln!("[AI] 没有配置默认AI平台，保存原文");
        for article in articles {
            match {
                let mut db_manager = app_state.db_manager.lock().await;
                db_manager.add_article(&article)
            } {
                Ok(true) => {
                    send_new_article_notification(&app_handle, &feed.name, &article.title, article.translated_title.as_deref(), feed.notification_enabled);
                },
                _ => {
                    // 忽略已存在或保存失败的情况
                }
            }
        }
    }
    
    println!("[AI] 完成翻译来自 {} 的文章", feed.name);
}

/// 获取配置文件路径
fn get_config_path() -> std::path::PathBuf {
    // 使用当前执行目录作为配置文件目录
    match std::env::current_dir() {
        Ok(dir) => {
            println!("当前执行目录: {:?}", dir);
            dir.join("config.toml")
        },
        Err(e) => {
            eprintln!("警告: 获取当前目录失败: {}, 将使用当前目录下的config.toml", e);
            std::path::PathBuf::from("config.toml")
        }
    }
}

/// 检查配置文件是否存在
fn config_file_exists() -> bool {
    let config_path = get_config_path();
    println!("检查配置文件是否存在: {:?}", config_path);
    config_path.exists()
}

/// 读取配置文件
fn read_config_file() -> Config {
    let config_path = get_config_path();
    
    // 检查配置文件是否存在
    if config_path.exists() {
        match fs::read_to_string(&config_path) {
            Ok(content) => {
                // 尝试解析配置文件
                match from_str(&content) {
                    Ok(config) => {
                        println!("配置文件读取成功: {:?}", config_path);
                        config
                    },
                    Err(e) => {
                        eprintln!("警告: 配置文件解析失败: {}, 将使用默认配置", e);
                        Config::default()
                    }
                }
            },
            Err(e) => {
                eprintln!("警告: 配置文件读取失败: {}, 将使用默认配置", e);
                Config::default()
            }
        }
    } else {
        // 配置文件不存在，使用默认配置
        println!("配置文件不存在: {:?}, 将使用默认配置", config_path);
        Config::default()
    }
}

/// 生成默认配置文件
fn generate_default_config(config: &Config) {
    let config_path = get_config_path();
    
    // 使用默认配置生成配置文件
    let default_config = Config {
        db: Some(DbConfig {
            path_type: Some("user".to_string()),
            custom_path: None,
        }),
        update: Some(UpdateConfig {
            interval: Some(5 * 60), // 默认5分钟
        }),
    };
    
    // 序列化配置为TOML格式
    match toml::to_string_pretty(&default_config) {
        Ok(toml_content) => {
            // 写入配置文件
            if let Err(e) = fs::write(&config_path, toml_content) {
                eprintln!("警告: 生成默认配置文件失败: {}", e);
                eprintln!("配置文件路径: {:?}", config_path);
            } else {
                println!("默认配置文件已生成: {:?}", config_path);
            }
        },
        Err(e) => {
            eprintln!("警告: 序列化默认配置失败: {}", e);
        }
    }
}

/// 根据配置确定数据库路径
fn determine_db_path(config: &Config) -> String {
    // 获取当前目录作为回退选项
    let current_dir = match std::env::current_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("警告: 获取当前目录失败: {}, 将使用相对路径", e);
            std::path::PathBuf::new()
        }
    };
    
    // 确定路径类型
    let path_type = match &config.db {
        Some(db_config) => {
            db_config.path_type.as_deref().unwrap_or("user")
        },
        None => {
            "user" // 默认值
        }
    };
    
    // 确定自定义路径
    let custom_path = match &config.db {
        Some(db_config) => {
            db_config.custom_path.clone()
        },
        None => {
            None
        }
    };
    
    match path_type {
        "current" => {
            // 使用当前目录
            current_dir.join("rss_reader.db").to_str().unwrap_or("rss_reader.db").to_string()
        },
        "custom" => {
            // 使用自定义路径
            if let Some(path) = custom_path {
                path
            } else {
                eprintln!("警告: 配置了custom路径类型但未提供custom_path, 将使用默认用户目录");
                // 回退到用户目录
                default_user_db_path(&current_dir)
            }
        },
        _ => {
            // 默认使用用户目录
            default_user_db_path(&current_dir)
        }
    }
}

/// 获取默认用户目录数据库路径
fn default_user_db_path(current_dir: &std::path::Path) -> String {
    // 对于Windows系统，使用AppData/Roaming目录
    if let Ok(app_data) = std::env::var("APPDATA") {
        let mut app_data_dir = std::path::PathBuf::from(app_data);
        app_data_dir.push("rss_reader");
        
        // 确保用户数据目录存在
        if let Err(e) = std::fs::create_dir_all(&app_data_dir) {
            eprintln!("警告: 创建用户数据目录失败: {}, 将使用当前目录", e);
            current_dir.join("rss_reader.db").to_str().unwrap_or("rss_reader.db").to_string()
        } else {
            app_data_dir.push("rss_reader.db");
            app_data_dir.to_str().unwrap_or("rss_reader.db").to_string()
        }
    } else {
        // 如果无法获取APPDATA环境变量，使用当前目录
        current_dir.join("rss_reader.db").to_str().unwrap_or("rss_reader.db").to_string()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 测量启动时间
    let start_time = std::time::Instant::now();
    
    // 读取配置文件
    let config = read_config_file();
    
    // 初始化数据库管理器
    let db_path = determine_db_path(&config);
    
    // 如果配置文件不存在，生成默认配置文件
    if !config_file_exists() {
        generate_default_config(&config);
    }
    
    println!("正在初始化数据库，路径: {}", db_path);
    let db_manager = match DbManager::new(&db_path) {
        Ok(manager) => manager,
        Err(e) => {
            eprintln!("初始化数据库失败: {}", e);
            eprintln!("应用将退出...");
            std::process::exit(1);
        }
    };
    
    // 初始化RSS更新器
    let rss_updater = RssUpdater::new();
    
    // 计算初始化时间
    let init_time = start_time.elapsed();
    println!("Application initialized in {:.2?}", init_time);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            db_manager: Mutex::new(db_manager),
            rss_updater: Mutex::new(rss_updater),
            config_cache: Mutex::new(None),
        })
        // 添加应用启动事件处理，在应用启动后启动自动更新任务
        .setup(|app| {
            // 启动自动更新任务
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                auto_update_feeds_task(app_handle).await;
            });
            Ok(())
        })
        // 添加应用退出事件处理
        .on_window_event(|_app_handle, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // 窗口销毁时，确保有足够时间处理数据库清理
                // DbManager的Drop trait会自动执行CHECKPOINT和连接关闭
                println!("应用正在关闭，数据库正在清理...");
                // 给数据库一点时间完成清理
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        })
        .invoke_handler(tauri::generate_handler!(
            init_db,
            init_ai_translator,
            add_feed,
            get_all_feeds,
            get_unread_count,
            get_all_unread_counts,
            get_article_count,
            get_filtered_article_count,
            search_articles,
            mark_article_as_read,
            update_all_feeds,
            update_single_feed,
            delete_feed,
            update_feed,
            add_group,
            update_group,
            delete_group,
            get_all_groups,
            get_feeds_by_group,
            get_articles_by_feed,
            get_all_articles,
            toggle_favorite,
            get_favorite_articles,
            get_favorite_articles_by_feed,
            get_unread_articles,
            get_unread_articles_by_feed,
            mark_all_articles_as_read,
            export_opml,
            import_opml,
            add_ai_platform,
            get_all_ai_platforms,
            get_default_ai_platform,
            update_ai_platform,
            delete_ai_platform,
            set_default_ai_platform,
            delete_articles,
            delete_article,
            open_link,
            update_update_interval,
            ai_chat,
            create_chat_session,
            get_chat_sessions,
            get_chat_session,
            save_chat_session,
            delete_chat_session,
            update_chat_session,
            get_latest_chat_session
        ))
        .run(tauri::generate_context!())
        .expect("Error running app");
}