use std::fs;
use std::path::PathBuf;
use tauri::{State, Emitter, Manager, async_runtime::Mutex};
use tauri_plugin_opener::OpenerExt;
use serde::{Deserialize, Serialize};
use toml::from_str;

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
#[derive(Debug, Deserialize, Serialize, Default)]
struct Config {
    /// 数据库配置
    db: Option<DbConfig>,
    /// 更新配置
    update: Option<UpdateConfig>,
}

/// 数据库配置
#[derive(Debug, Deserialize, Serialize, Default)]
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
#[derive(Debug, Deserialize, Serialize, Default)]
struct UpdateConfig {
    /// 自动更新间隔（秒）
    interval: Option<u64>,
}

// 应用状态
struct AppState {
    db_manager: Mutex<DbManager>,
    rss_updater: Mutex<RssUpdater>,
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
    
    // 设置默认AI平台到全局翻译器
    let translator = AI_TRANSLATOR.get_translator().await;
    eprintln!("[AI] 成功获取全局翻译器实例");
    translator.set_default_platform(default_platform.clone()).await;
    eprintln!("[AI] 成功设置默认AI平台到全局翻译器: {:?}", default_platform);
    
    // 验证设置是否成功
    let verify_platform = translator.get_default_platform().await;
    eprintln!("[AI] 验证默认AI平台设置: {:?}", verify_platform);
    eprintln!("[AI] ===== AI翻译器初始化完成 =====");
    
    Ok(())
}

// 异步Tauri命令：更新单个RSS源
#[tauri::command(async,rename_all = "camelCase")]
async fn update_single_feed(app: tauri::AppHandle, app_state: State<'_, AppState>, feed_id: i64) -> Result<(), String> {
    // 获取指定RSS源
    let feed = {
        let db_manager = app_state.db_manager.lock().await;
        db_manager.get_feed_by_id(feed_id).map_err(|e| {
            eprintln!("Failed to get feed: {}", e);
            format!("Failed to get feed: {}", e)
        })?
    };
    
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
            
            // 翻译需要翻译的文章
            if !articles_to_translate.is_empty() && feed.translate_enabled {
                eprintln!("[AI] ===== 开始翻译RSS源 {} 的文章 ======", feed.name);
                eprintln!("[AI] 需要翻译的文章数量: {}", articles_to_translate.len());
                
                // 获取AI翻译器实例
                let translator = AI_TRANSLATOR.get_translator().await;
                
                // 遍历需要翻译的文章，进行翻译
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
                }
                eprintln!("[AI] ===== 完成RSS源 {} 的文章翻译 ======", feed.name);
                
                // 将翻译后的文章添加到保存列表
                articles_to_save.extend(articles_to_translate);
            }
            
            // 保存所有文章到数据库，每篇文章独立获取和释放锁
            let mut new_article_count = 0;
            for article in articles_to_save {
                let db_manager = app_state.db_manager.lock().await;
                
                if let Ok(true) = db_manager.add_article(&article) {
                    new_article_count += 1;
                }
            }
            
            println!("更新完成: {} 新增 {} 篇文章", feed.name, new_article_count);
            
            // 发布feed_updated事件，通知前端更新完成
            if let Err(e) = app.emit("feed_updated", Some(feed.id)) {
                eprintln!("Failed to emit feed_updated event: {}", e);
            }
        },
        Err(e) => {
            eprintln!("Failed to update feed {}: {}", feed.name, e);
            
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
        match rss_updater.update_feed(&new_feed).await {
            Ok(mut articles) => {
                // 获取应用实例和状态
                if let Some(window) = app_clone.get_webview_window("main") {
                    let app_handle = window.app_handle();
                    let app_state = app_handle.state::<AppState>();
                    
                    // 检查哪些文章需要翻译
                    let mut articles_to_translate = Vec::new();
                    let mut articles_to_save = Vec::new();
                    
                    {
                        let db_manager = app_state.db_manager.lock().await;
                        
                        // 筛选需要翻译的文章
                        for article in articles {
                            if new_feed.translate_enabled {
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
                    
                    // 翻译需要翻译的文章
                    if !articles_to_translate.is_empty() && new_feed.translate_enabled {
                        eprintln!("[AI] ===== 开始翻译RSS源 {} 的文章 ======", new_feed.name);
                        eprintln!("[AI] 需要翻译的文章数量: {}", articles_to_translate.len());
                        
                        // 获取AI翻译器实例
                        let translator = AI_TRANSLATOR.get_translator().await;
                        
                        // 遍历需要翻译的文章，进行翻译
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
                        }
                        eprintln!("[AI] ===== 完成RSS源 {} 的文章翻译 ======", new_feed.name);
                        
                        // 将翻译后的文章添加到保存列表
                        articles_to_save.extend(articles_to_translate);
                    }
                    
                    // 保存新文章到数据库，每篇文章独立获取和释放锁
                    let mut new_article_count = 0;
                    for article in articles_to_save {
                        let db_manager = app_state.db_manager.lock().await;
                        
                        if let Ok(true) = db_manager.add_article(&article) {
                            new_article_count += 1;
                        }
                    }
                    
                    println!("更新完成: {} 新增 {} 篇文章", new_feed.name, new_article_count);
                }
                
                // 发布feed_updated事件，通知前端更新完成
                if let Err(e) = app_clone.emit("feed_updated", Some(new_feed.id)) {
                    eprintln!("Failed to emit feed_updated event: {}", e);
                }
            },
            Err(e) => {
                eprintln!("Failed to update feed {}: {}", new_feed.name, e);
                
                // 即使更新失败，也通知前端，以便清除加载状态
                if let Err(e) = app_clone.emit("feed_updated", Some(new_feed.id)) {
                    eprintln!("Failed to emit feed_updated event: {}", e);
                }
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

// Tauri命令：搜索文章
#[tauri::command(async)]
async fn search_articles(app_state: State<'_, AppState>, query: &str, limit: u32) -> Result<Vec<(Article, String)>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.search_articles(query, limit).map_err(|e| {
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

// Tauri命令：获取未读文章
#[tauri::command(async)]
async fn get_unread_articles(app_state: State<'_, AppState>, limit: u32, offset: u32) -> Result<Vec<Article>, String> {
    let db_manager = app_state.db_manager.lock().await;
    db_manager.get_unread_articles(limit, offset).map_err(|e| {
        eprintln!("Failed to get unread articles from database: {}", e);
        format!("Failed to get unread articles: {}", e)
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
    
    // 更新全局AI翻译器的默认平台
    let translator = AI_TRANSLATOR.get_translator().await;
    translator.set_default_platform(new_default_platform).await;
    
    Ok(())
}

// Tauri命令：更新自动更新间隔
#[tauri::command(async)]
async fn update_update_interval(interval: u64) -> Result<(), String> {
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
    write(config_path, toml_content).map_err(|e| {
        eprintln!("Failed to write config file: {}", e);
        format!("Failed to save update interval: {}", e)
    })?;
    
    Ok(())
}

// 异步Tauri命令：更新所有RSS源
#[tauri::command(async)]
async fn update_all_feeds(_app: tauri::AppHandle, app_state: State<'_, AppState>) -> Result<(), String> {
    // 获取RSS源列表
        let feeds = {
            let db_manager = app_state.db_manager.lock().await;
            db_manager.get_all_feeds().map_err(|e| {
                eprintln!("Failed to get feeds from database: {}", e);
                format!("Failed to update feeds: {}", e)
            })?
        };

    // 克隆RSS更新器并更新所有源
    let rss_updater = {
        let rss_updater = app_state.rss_updater.lock().await;
        rss_updater.clone()
    };
    let results = rss_updater.update_feeds(&feeds).await;

    // 保存新文章到数据库，每个RSS源独立处理，每次操作后释放锁
    for result in results {
        match result {
            Ok((feed, articles)) => {
                println!("开始保存来自 {} 的文章，共 {} 篇", feed.name, articles.len());
                
                // 保存当前RSS源的所有文章
                for article in articles {
                    // 为每篇文章独立获取和释放锁，减少锁持有时间
                let mut db_manager = app_state.db_manager.lock().await;
                // 尝试添加文章，如果成功则说明是新文章
                match db_manager.add_article(&article) {
                    Ok(true) => {
                        // 简单的打印通知，后续可以升级为系统通知
                        println!("New article from {}: {}", feed.name, article.title);
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
            }
            Err(e) => {
                eprintln!("Failed to update feed: {}", e);
            }
        }
    }

    Ok(())
}

// 自动更新任务函数
async fn auto_update_feeds_task(app_handle: tauri::AppHandle) {
    use tokio::time::{sleep, Duration};
    use chrono::{Utc};
    
    println!("启动自动更新任务");
    
    loop {
        // 读取配置文件，获取更新间隔
        let config = read_config_file();
        let update_interval = match &config.update {
            Some(update_config) => update_config.interval.unwrap_or(5 * 60), // 默认5分钟
            None => 5 * 60, // 默认5分钟
        };
        
        // 获取应用状态
        let app_state = app_handle.state::<AppState>();
        
        // 获取所有RSS源
        let feeds = {
            let db_manager = app_state.db_manager.lock().await;
            match db_manager.get_all_feeds() {
                Ok(feeds) => feeds,
                Err(e) => {
                    eprintln!("Failed to get feeds for auto-update: {}", e);
                    sleep(Duration::from_secs(60)).await;
                    continue;
                }
            }
        };
        
        // 获取所有RSS源，统一更新
        let feeds_to_update = feeds;
        
        if !feeds_to_update.is_empty() {
            // 获取RSS更新器
            let rss_updater = {
                let rss_updater = app_state.rss_updater.lock().await;
                rss_updater.clone()
            };
            
            // 更新所有启用的RSS源
            let results = rss_updater.update_feeds(&feeds_to_update).await;
            
            for result in results {
                match result {
                    Ok((feed, articles)) => {
                        // 更新feed的last_updated时间
                        let mut updated_feed = feed.clone();
                        updated_feed.last_updated = Some(Utc::now());
                        
                        // 更新数据库中的feed信息
                        {
                            let mut db_manager = app_state.db_manager.lock().await;
                            if let Err(e) = db_manager.update_feed(&updated_feed) {
                                eprintln!("Failed to update feed last_updated time: {}", e);
                            }
                        }
                        
                        // 检查哪些文章需要翻译
                        let mut articles_to_translate = Vec::new();
                        let mut articles_to_save = Vec::new();
                        
                        // 筛选需要翻译的文章
                        {
                            let db_manager = app_state.db_manager.lock().await;
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
                        
                        // 翻译需要翻译的文章
                        if !articles_to_translate.is_empty() && feed.translate_enabled {
                            eprintln!("[AI] ===== 开始翻译RSS源 {} 的文章 ======", feed.name);
                            eprintln!("[AI] 需要翻译的文章数量: {}", articles_to_translate.len());
                            
                            // 获取AI翻译器实例
                            let translator = AI_TRANSLATOR.get_translator().await;
                            
                            // 遍历需要翻译的文章，进行翻译
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
                            }
                            eprintln!("[AI] ===== 完成RSS源 {} 的文章翻译 ======", feed.name);
                            
                            // 将翻译后的文章添加到保存列表
                            articles_to_save.extend(articles_to_translate);
                        }
                        
                        // 保存新文章，每篇文章独立获取和释放锁
                        for article in articles_to_save {
                            let db_manager = app_state.db_manager.lock().await;
                            match db_manager.add_article(&article) {
                                Ok(true) => {
                                    println!("New article from {}: {}", feed.name, article.title);
                                }
                                Ok(false) => {
                                    // 文章已存在，忽略
                                }
                                Err(e) => {
                                    eprintln!("Failed to add article: {}", e);
                                }
                            }
                        }
                    },
                    Err(e) => {
                        eprintln!("Failed to update feed in auto-update: {}", e);
                    }
                }
            }
        }
        
        // 使用配置的更新间隔
        println!("下次自动更新将在 {} 秒后进行", update_interval);
        sleep(Duration::from_secs(update_interval)).await;
    }
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
        .manage(AppState {
            db_manager: Mutex::new(db_manager),
            rss_updater: Mutex::new(rss_updater),
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
            get_unread_articles,
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
            update_update_interval
        ))
        .run(tauri::generate_context!())
        .expect("Error running app");
}