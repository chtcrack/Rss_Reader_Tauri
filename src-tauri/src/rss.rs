use crate::models::{Article, Feed};
use async_trait::async_trait;
use atom_syndication::{Entry as AtomEntry, Feed as AtomFeed};
use chrono::{DateTime, Utc};
use html_escape::decode_html_entities;
use reqwest::{Client, StatusCode};
use rss::{Channel, Item};
use tokio::time::Duration;

// 仅在非 Android/iOS 平台上使用 headless_chrome
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use headless_chrome::{Browser, LaunchOptionsBuilder};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::ffi::OsStr;

/// RSS获取器特质
#[async_trait]
pub trait RssFetcher: Send + Sync {
    /// 获取RSS源内容
    async fn fetch(&self, url: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>>;
}

/// Reqwest RSS获取器
pub struct ReqwestFetcher {
    client: Client,
}

impl ReqwestFetcher {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36")
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { client }
    }
}

impl ReqwestFetcher {
    /// 使用Headless Chrome获取RSS源内容（仅在非Android/iOS平台可用）
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    async fn fetch_with_headless_chrome(
        &self,
        url: &str,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        println!("尝试使用Headless Chrome获取RSS源: {}", url);

        // 构建浏览器启动选项，使用非无头模式以避免403错误
        // 并添加命令行参数，尽量隐藏浏览器窗口
        let chrome_path = if let Ok(program_files) = std::env::var("ProgramFiles") {
            std::path::PathBuf::from(program_files).join(r"Google\Chrome\Application\chrome.exe")
        } else {
            // 如果获取环境变量失败，默认使用C盘路径
            std::path::PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
        };

        let launch_options = LaunchOptionsBuilder::default()
            .headless(false) // 禁用无头模式，因为很多网站会阻止无头浏览器
            .path(Some(chrome_path)) // 设置Chrome路径
            .window_size(Some((800, 600)))
            // 添加命令行参数，将窗口定位到屏幕外
            .args(vec![
                OsStr::new("--window-position=-32000,-32000"), // 将窗口定位到屏幕外
                OsStr::new("--no-startup-window"),             // 不显示启动窗口
                OsStr::new("--silent-launch"),                 // 静默启动
                OsStr::new("--disable-extensions"),            // 禁用扩展
                OsStr::new("--disable-popup-blocking"),        // 禁用弹窗阻止
                OsStr::new("--disable-default-apps"),          // 禁用默认应用
            ])
            .build()?;

        // 启动浏览器
        let browser = Browser::new(launch_options)?;

        // 创建新标签页
        let tab = browser.new_tab()?;

        // 导航到RSS源URL
        tab.navigate_to(url)?;

        // 等待页面加载完成
        tab.wait_until_navigated()?;

        // 获取页面内容
        let page_content = tab.get_content()?;

        println!(
            "使用Headless Chrome获取到页面内容，长度: {} bytes",
            page_content.len()
        );
        println!(
            "内容预览: {:?}",
            &page_content[..std::cmp::min(page_content.len(), 200)]
        );
        // 尝试从HTML中提取RSS内容
        let rss_content = if page_content.starts_with("<?xml") {
            // 如果直接是XML内容，直接使用
            page_content
        } else {
            // 否则尝试从HTML中提取RSS内容
            println!("从HTML页面中提取RSS内容");

            // 查找pre标签中的内容，这通常包含RSS XML
            if let Some(start) = page_content.find("<pre") {
                if let Some(end_start) = page_content[start..].find(">").map(|i| start + i + 1) {
                    if let Some(end) = page_content[end_start..]
                        .find("</pre>")
                        .map(|i| end_start + i)
                    {
                        let extracted_content = &page_content[end_start..end];
                        // 对提取的内容进行HTML实体解码
                        let decoded_content = decode_html_entities(extracted_content).to_string();
                        println!(
                            "HTML实体解码前: {:?}",
                            &extracted_content[..std::cmp::min(extracted_content.len(), 100)]
                        );
                        println!(
                            "HTML实体解码后: {:?}",
                            &decoded_content[..std::cmp::min(decoded_content.len(), 100)]
                        );
                        decoded_content
                    } else {
                        return Err("从HTML中提取RSS内容失败: 未找到完整的pre标签".into());
                    }
                } else {
                    return Err("从HTML中提取RSS内容失败: 未找到pre标签结束符".into());
                }
            } else {
                return Err("从HTML中提取RSS内容失败: 未找到pre标签".into());
            }
        };

        Ok(rss_content)
    }
    
    /// Android/iOS平台的403错误处理
    #[cfg(any(target_os = "android", target_os = "ios"))]
    async fn fetch_with_headless_chrome(
        &self,
        url: &str,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        // 在Android/iOS平台上，直接返回403错误，不尝试使用Headless Chrome
        // 因为Headless Chrome在移动平台上不可用
        Err("在Android/iOS平台上不支持Headless Chrome获取RSS内容".into())
    }
}

#[async_trait]
impl RssFetcher for ReqwestFetcher {
    async fn fetch(&self, url: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        // 首先尝试使用reqwest获取内容
        let response = self.client.get(url).send().await?;

        // 检查响应状态码
        if response.status() == StatusCode::FORBIDDEN {
            // 遇到403错误
            println!("遇到403错误: {}", url);
            
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                // 在非Android/iOS平台上，尝试使用Headless Chrome获取
                println!("尝试使用Headless Chrome获取RSS源");
                return self.fetch_with_headless_chrome(url).await;
            }
            
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                // 在Android/iOS平台上，直接返回错误
                // 因为Headless Chrome在移动平台上不可用
                return Err(format!("获取RSS源失败: 遇到403 Forbidden错误，在移动平台上不支持Headless Chrome获取 ({})", url).into());
            }
        }

        // 正常响应，返回内容
        let content = response.text().await?;
        Ok(content)
    }
}

/// RSS解析器
pub struct RssParser;

impl RssParser {
    pub fn new() -> Self {
        Self
    }

    /// 解析RSS或Atom内容
    pub fn parse(
        &self,
        content: &str,
        base_url: &str,
    ) -> Result<Vec<Article>, Box<dyn std::error::Error + Send + Sync>> {
        // 尝试解析为RSS格式
        if let Ok(channel) = Channel::read_from(content.as_bytes()) {
            // 转换RSS项为文章
            let articles: Vec<Article> = channel
                .items()
                .iter()
                .map(|item| self.rss_item_to_article(item, 0, base_url))
                .collect();
            Ok(articles)
        }
        // 尝试解析为Atom格式
        else if let Ok(atom_feed) = AtomFeed::read_from(content.as_bytes()) {
            // 转换Atom条目为文章
            let articles: Vec<Article> = atom_feed
                .entries()
                .iter()
                .map(|entry| self.atom_item_to_article(entry, 0, base_url))
                .collect();
            Ok(articles)
        }
        // 解析失败
        else {
            Err("Failed to parse feed: not a valid RSS or Atom format".into())
        }
    }

    /// 标准化链接，去除#fragment部分
    fn normalize_link(&self, link: &str) -> String {
        if let Some(hash_pos) = link.find('#') {
            link[..hash_pos].to_string()
        } else {
            link.to_string()
        }
    }

    /// 检查文章标题和内容是否包含黑名单关键字
    pub fn check_blacklist(
        &self,
        title: &str,
        content: &str,
        blacklist: &[String],
    ) -> (String, String) {
        // 检查标题或内容是否包含任何黑名单关键字
        let contains_blacklist = blacklist
            .iter()
            .any(|keyword| title.contains(keyword) || content.contains(keyword));

        if contains_blacklist {
            // 如果包含黑名单关键字，替换标题和内容为"已被屏蔽"
            ("已被屏蔽".to_string(), "已被屏蔽".to_string())
        } else {
            // 否则返回原始标题和内容
            (title.to_string(), content.to_string())
        }
    }

    /// 将RSS项转换为文章模型
    pub fn rss_item_to_article(&self, item: &Item, feed_id: i64, base_url: &str) -> Article {
        let pub_date = item
            .pub_date()
            .and_then(|d| {
                chrono::DateTime::parse_from_rfc2822(d)
                    .ok()
                    .map(|dt| dt.into())
            })
            .or_else(|| {
                if let Some(dc) = item.dublin_core_ext() {
                    let dates = dc.dates();
                    if let Some(date_str) = dates.first() {
                        return DateTime::parse_from_rfc3339(date_str)
                            .or_else(|_| DateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%z"))
                            .ok()
                            .map(|dt| dt.into());
                    }
                }
                None
            })
            .unwrap_or_else(Utc::now);

        let categories = item
            .categories()
            .iter()
            .map(|c| c.name().to_string())
            .collect();

        // 获取文章内容，优先使用content:encoded，其次使用description
        let content = item
            .content()
            .unwrap_or_else(|| item.description().unwrap_or(""))
            .to_string();

        // 修复内容中的图片URL
        let content = self.fix_content_images(&content, base_url);

        let thumbnail = item
            .enclosure()
            .and_then(|e| {
                if e.mime_type().starts_with("image/") {
                    let url = e.url().to_string();
                    // 修复图片URL
                    self.fix_image_url(&url, base_url)
                } else {
                    None
                }
            })
            .or_else(|| {
                // 尝试从内容中提取第一张图片
                self.extract_first_image(&content, base_url)
            });

        let original_link = item.link().unwrap_or("");
        let normalized_link = self.normalize_link(original_link);

        // 这里暂时不应用黑名单过滤，因为需要从数据库获取黑名单关键字
        // 黑名单过滤将在lib.rs中处理
        let title = item.title().unwrap_or("无标题").to_string();

        Article {
            id: 0, // 数据库将自动生成
            feed_id,
            title,
            content,
            pub_date,
            link: normalized_link,
            is_read: false,
            is_favorite: false,
            thumbnail,
            author: item.author().map(|a| a.to_string()),
            categories,
            translated_title: None,   // 默认无翻译标题
            translated_content: None, // 默认无翻译内容
        }
    }

    /// 将Atom条目转换为文章模型
    pub fn atom_item_to_article(&self, entry: &AtomEntry, feed_id: i64, base_url: &str) -> Article {
        // 处理发布日期，确保转换为Utc时间
        let pub_date: DateTime<Utc> = entry
            .published()
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|| entry.updated().with_timezone(&Utc));

        let categories = entry
            .categories()
            .iter()
            .map(|c| c.term().to_string())
            .collect();

        // 处理缩略图
        let thumbnail = entry
            .links()
            .iter()
            .find(|link| {
                link.rel() == "enclosure"
                    && link.mime_type().map(|mt| mt.starts_with("image/")) == Some(true)
            })
            .and_then(|link| self.fix_image_url(link.href(), base_url))
            .or_else(|| {
                // 尝试从内容中提取第一张图片
                let content = entry
                    .content()
                    .and_then(|c| c.value())
                    .or_else(|| entry.summary().map(|s| &**s))
                    .unwrap_or_default();
                self.extract_first_image(content, base_url)
            });

        // 处理内容
        let content = entry
            .content()
            .and_then(|c| c.value())
            .or_else(|| entry.summary().map(|s| &**s))
            .unwrap_or_default()
            .to_string();

        // 修复内容中的图片URL
        let content = self.fix_content_images(&content, base_url);

        // 处理链接
        let original_link = entry
            .links()
            .iter()
            .find(|link| link.rel() == "alternate")
            .map(|link| link.href().to_string())
            .unwrap_or_default();
        let normalized_link = self.normalize_link(&original_link);

        // 处理作者
        let author = entry
            .authors()
            .iter()
            .next()
            .map(|author| author.name().to_string());

        // 这里暂时不应用黑名单过滤，因为需要从数据库获取黑名单关键字
        // 黑名单过滤将在lib.rs中处理
        let title = entry.title().to_string();

        Article {
            id: 0, // 数据库将自动生成
            feed_id,
            title,
            content,
            pub_date,
            link: normalized_link,
            is_read: false,
            is_favorite: false,
            thumbnail,
            author,
            categories,
            translated_title: None,   // 默认无翻译标题
            translated_content: None, // 默认无翻译内容
        }
    }

    /// 从HTML内容中提取第一张图片，并确保URL是完整的绝对路径
    fn extract_first_image(&self, content: &str, base_url: &str) -> Option<String> {
        let document = scraper::Html::parse_document(content);
        let img_selector = scraper::Selector::parse("img").ok()?;
        let img_element = document.select(&img_selector).next()?;
        let src = img_element.value().attr("src")?;

        // 处理图片URL，确保是完整的绝对路径
        self.fix_image_url(src, base_url)
    }

    /// 修复图片URL，确保是完整的绝对路径
    fn fix_image_url(&self, url: &str, base_url: &str) -> Option<String> {
        // 移除前后空格
        let url = url.trim();

        // 如果URL已经是完整的绝对路径，直接返回
        if url.starts_with("http://") || url.starts_with("https://") {
            return Some(url.to_string());
        }

        // 处理以//开头的URL，添加协议
        if url.starts_with("//") {
            return Some(format!("https:{}", url));
        }

        // 处理相对路径，使用RSS源的URL作为基础
        let base_url = url::Url::parse(base_url).ok()?;

        // 处理以/开头的根相对路径
        if url.starts_with("/") {
            let mut new_url = base_url.clone();
            new_url.set_path(url);
            new_url.set_query(None);
            new_url.set_fragment(None);
            return Some(new_url.to_string());
        }

        // 处理相对路径
        let new_url = base_url.join(url).ok()?;
        Some(new_url.to_string())
    }

    /// 修复HTML内容中的所有图片URL
    fn fix_content_images(&self, content: &str, base_url: &str) -> String {
        let document = scraper::Html::parse_document(content);
        let img_selector = scraper::Selector::parse("img").unwrap();

        // 检查是否有需要修复的图片
        let mut has_images_to_fix = false;
        for img_element in document.select(&img_selector) {
            if let Some(src) = img_element.value().attr("src") {
                // 如果图片URL不是完整的绝对路径，则需要修复
                if !src.starts_with("http://") && !src.starts_with("https://") {
                    has_images_to_fix = true;
                    break;
                }
            }
        }

        // 如果没有需要修复的图片，直接返回原始内容
        if !has_images_to_fix {
            return content.to_string();
        }

        // 需要修复图片URL，重新构建HTML内容
        let mut result = String::new();
        let mut last_end = 0;

        for img_element in document.select(&img_selector) {
            let html = img_element.html();
            let start_pos = content.find(&html).unwrap_or(0);

            // 添加图片之前的内容
            result.push_str(&content[last_end..start_pos]);

            // 修复图片URL
            if let Some(src) = img_element.value().attr("src") {
                if let Some(fixed_url) = self.fix_image_url(src, base_url) {
                    // 替换src属性
                    let fixed_html = html.replace(src, &fixed_url);
                    result.push_str(&fixed_html);
                } else {
                    result.push_str(&html);
                }
            } else {
                result.push_str(&html);
            }

            last_end = start_pos + html.len();
        }

        // 添加剩余内容
        if last_end < content.len() {
            result.push_str(&content[last_end..]);
        }

        result
    }
}

/// RSS更新器
pub struct RssUpdater {
    reqwest_fetcher: ReqwestFetcher,
    parser: RssParser,
}

impl RssUpdater {
    pub fn new() -> Self {
        Self {
            reqwest_fetcher: ReqwestFetcher::new(),
            parser: RssParser::new(),
        }
    }

    /// 更新单个RSS源，支持智能重试
    pub async fn update_feed(
        &self,
        feed: &Feed,
    ) -> Result<Vec<Article>, Box<dyn std::error::Error + Send + Sync>> {
        const MAX_RETRIES: u32 = 2;
        const RETRY_DELAY: tokio::time::Duration = tokio::time::Duration::from_secs(1);

        let mut last_error: Option<Box<dyn std::error::Error + Send + Sync>> = None;

        println!("开始更新RSS源: {} ({})", feed.name, feed.url);

        // 尝试获取RSS内容，支持重试
        for attempt in 0..=MAX_RETRIES {
            match self.attempt_update_feed(feed).await {
                Ok(articles) => {
                    println!(
                        "成功更新RSS源: {}，获取到 {} 篇文章",
                        feed.name,
                        articles.len()
                    );
                    return Ok(articles);
                }
                Err(e) => {
                    // 详细的错误日志
                    eprintln!(
                        "更新RSS源 {} 失败 (尝试 {}/{})",
                        feed.name,
                        attempt + 1,
                        MAX_RETRIES + 1
                    );
                    eprintln!("  URL: {}", feed.url);
                    eprintln!(
                        "  错误类型: {}",
                        std::any::type_name::<dyn std::error::Error + Send + Sync>()
                    );
                    eprintln!("  错误信息: {}", e);

                    // 记录错误
                    last_error = Some(e);

                    // 如果不是最后一次尝试，等待一段时间后重试
                    if attempt < MAX_RETRIES {
                        eprintln!("  {}秒后重试...", RETRY_DELAY.as_secs());
                        tokio::time::sleep(RETRY_DELAY).await;
                    }
                }
            }
        }

        // 所有尝试都失败，返回最后一次错误
        let error = last_error.unwrap();
        eprintln!("所有尝试更新RSS源 {} 都失败了", feed.name);
        Err(error)
    }

    /// 单次尝试更新RSS源
    async fn attempt_update_feed(
        &self,
        feed: &Feed,
    ) -> Result<Vec<Article>, Box<dyn std::error::Error + Send + Sync>> {
        // 使用reqwest获取内容
        println!("  正在获取RSS内容: {}", feed.url);
        let content = self.reqwest_fetcher.fetch(&feed.url).await?;
        println!("  成功获取RSS内容，大小: {} 字节", content.len());

        // 解析RSS或Atom内容，传递feed.url作为base_url
        println!("  正在解析RSS内容...");
        let mut articles = self.parser.parse(&content, &feed.url)?;
        println!("  成功解析RSS内容，找到 {} 篇文章", articles.len());

        // 设置feed_id
        for article in &mut articles {
            article.feed_id = feed.id;
        }

        Ok(articles)
    }

    /// 并发更新多个RSS源
    pub async fn update_feeds(
        &self,
        feeds: &[Feed],
    ) -> Vec<Result<(Feed, Vec<Article>), Box<dyn std::error::Error + Send + Sync>>> {
        let total_feeds = feeds.len();
        println!("开始并发更新 {} 个RSS源", total_feeds);

        let mut tasks = Vec::with_capacity(total_feeds);

        for feed in feeds {
            let feed_clone = feed.clone();
            let updater_clone = self.clone();
            tasks.push(tokio::spawn(async move {
                let result = updater_clone.update_feed(&feed_clone).await;
                (feed_clone, result)
            }));
        }

        let mut results = Vec::with_capacity(total_feeds);
        let mut success_count = 0;
        let mut failure_count = 0;

        for task in tasks {
            match task.await {
                Ok((feed, Ok(articles))) => {
                    success_count += 1;
                    results.push(Ok((feed, articles)));
                }
                Ok((_feed, Err(e))) => {
                    failure_count += 1;
                    results.push(Err(e));
                }
                Err(e) => {
                    failure_count += 1;
                    results.push(Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>));
                }
            }
        }

        println!(
            "并发更新完成: {} 成功, {} 失败, 总计 {}",
            success_count, failure_count, total_feeds
        );

        results
    }
}

impl Clone for RssUpdater {
    fn clone(&self) -> Self {
        Self {
            reqwest_fetcher: ReqwestFetcher::new(),
            parser: RssParser::new(),
        }
    }
}
