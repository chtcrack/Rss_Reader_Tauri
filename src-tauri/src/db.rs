use crate::models::{Article, Feed, FeedGroup, AIPlatform};
use rusqlite::{Connection, Result, params};
use chrono::{DateTime, TimeZone, Utc};
use std::path::PathBuf;
use opml::{Outline, OPML};

/// 数据库管理器
pub struct DbManager {
    conn: Connection,
}

impl Drop for DbManager {
    fn drop(&mut self) {
        // 简化析构函数，只保留必要的清理逻辑
        // Connection类型会自动处理连接关闭
        println!("数据库连接正在关闭...");
        
        // 执行CHECKPOINT，确保所有数据都写入磁盘
        if let Err(e) = self.conn.execute("CHECKPOINT", []) {
            eprintln!("警告: 数据库检查点失败: {}", e);
        }
        
        // 执行VACUUM命令压缩数据库，回收未使用的空间
        println!("正在执行数据库压缩...");
        if let Err(e) = self.conn.execute("VACUUM", []) {
            eprintln!("警告: 数据库压缩失败: {}", e);
        } else {
            println!("数据库压缩完成");
        }
        
        println!("数据库连接已关闭");
    }
}

impl DbManager {
    /// 创建或连接到数据库
    pub fn new(db_path: &str) -> Result<Self> {
        // 确保数据库目录存在
        if let Some(parent) = PathBuf::from(db_path).parent()
            && let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("警告: 无法创建数据库目录: {}", e);
        }
        
        // 初始化数据库连接
        let conn = Connection::open(db_path)?;
        
        // 初始化数据库表
        Self::create_tables(&conn)?;
        
        Ok(Self { conn })
    }

    /// 检查列是否存在
    fn column_exists(conn: &Connection, table_name: &str, column_name: &str) -> Result<bool> {
        let sql = format!(
            "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?",
            table_name
        );
        let count: i32 = conn.query_row(&sql, params![column_name], |row| row.get(0))?;
        Ok(count > 0)
    }

    /// 创建数据库表
    fn create_tables(conn: &Connection) -> Result<()> {
        // 创建分组表
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS feed_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                order_index INTEGER NOT NULL DEFAULT 0
            )
            "#,
            [],
        )?;

        // 创建RSS源表
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS feeds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                group_id INTEGER REFERENCES feed_groups(id) ON DELETE SET NULL,
                last_updated INTEGER
            )
            "#,
            [],
        )?;

        // 为现有数据库添加translate_enabled列（如果不存在）
        if !Self::column_exists(conn, "feeds", "translate_enabled")? {
            conn.execute(
                "ALTER TABLE feeds ADD COLUMN translate_enabled BOOLEAN NOT NULL DEFAULT FALSE",
                [],
            )?;
        }

        // 为现有数据库添加last_update_status列（如果不存在）
        if !Self::column_exists(conn, "feeds", "last_update_status")? {
            conn.execute(
                "ALTER TABLE feeds ADD COLUMN last_update_status TEXT",
                [],
            )?;
        }
        
        // 为现有数据库添加update_attempts列（如果不存在）
        if !Self::column_exists(conn, "feeds", "update_attempts")? {
            conn.execute(
                "ALTER TABLE feeds ADD COLUMN update_attempts INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        
        // 为现有数据库添加next_retry_time列（如果不存在）
        if !Self::column_exists(conn, "feeds", "next_retry_time")? {
            conn.execute(
                "ALTER TABLE feeds ADD COLUMN next_retry_time INTEGER",
                [],
            )?;
        }
        
        // 为现有数据库添加notification_enabled列（如果不存在）
        if !Self::column_exists(conn, "feeds", "notification_enabled")? {
            conn.execute(
                "ALTER TABLE feeds ADD COLUMN notification_enabled BOOLEAN NOT NULL DEFAULT TRUE",
                [],
            )?;
        }

        // 创建文章表
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                pub_date INTEGER NOT NULL,
                link TEXT NOT NULL,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
                thumbnail TEXT,
                author TEXT,
                categories TEXT,
                summary TEXT
            )
            "#,
            [],
        )?;

        // 为现有数据库添加translated_title列（如果不存在）
        if !Self::column_exists(conn, "articles", "translated_title")? {
            conn.execute(
                "ALTER TABLE articles ADD COLUMN translated_title TEXT",
                [],
            )?;
        }

        // 为现有数据库添加translated_content列（如果不存在）
        if !Self::column_exists(conn, "articles", "translated_content")? {
            conn.execute(
                "ALTER TABLE articles ADD COLUMN translated_content TEXT",
                [],
            )?;
        }

        // 创建索引，提高查询性能
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_articles_title ON articles(title);",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_articles_content ON articles(content);",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_articles_summary ON articles(summary);",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read);",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_articles_is_favorite ON articles(is_favorite);",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_articles_pub_date ON articles(pub_date);",
            [],
        )?;

        // 创建FTS5虚拟表用于全文搜索
        conn.execute(
            r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
                title,
                content,
                summary,
                article_id UNINDEXED,
                feed_id UNINDEXED,
                pub_date UNINDEXED
            )
            "#,
            [],
        )?;

        // 创建AI平台表
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS ai_platforms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                api_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                api_model TEXT NOT NULL,
                is_default BOOLEAN NOT NULL DEFAULT FALSE
            )
            "#,
            [],
        )?;

        // 创建触发器，自动更新FTS表
        conn.execute(
            r#"
            CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
                INSERT INTO articles_fts(rowid, title, content, summary, article_id, feed_id, pub_date)
                VALUES (new.id, new.title, new.content, new.summary, new.id, new.feed_id, new.pub_date);
            END;
            "#,
            [],
        )?;

        conn.execute(
            r#"
            CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
                DELETE FROM articles_fts WHERE rowid = old.id;
            END;
            "#,
            [],
        )?;

        conn.execute(
            r#"
            CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
                UPDATE articles_fts SET
                    title = new.title,
                    content = new.content,
                    summary = new.summary
                WHERE rowid = new.id;
            END;
            "#,
            [],
        )?;

        Ok(())
    }

    /// 添加RSS源
    pub fn add_feed(&mut self, feed: &Feed) -> Result<i64> {
        let last_updated_ts = feed.last_updated.map(|t| {
            t.timestamp()
        });

        let group_id = feed.group_id;
        let last_updated = last_updated_ts.unwrap_or(0);
        
        // 开始事务
        let tx = self.conn.transaction()?;
        
        let id = tx.query_row(
            r#"INSERT INTO feeds (name, url, group_id, last_updated, translate_enabled, notification_enabled) 
               VALUES (?, ?, ?, ?, ?, ?) RETURNING id"#,
            params![
                feed.name.as_str(),
                feed.url.as_str(),
                group_id,
                last_updated,
                feed.translate_enabled,
                feed.notification_enabled
            ],
            |row| row.get(0)
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(id)
    }

    /// 获取所有RSS源
    pub fn get_all_feeds(&self) -> Result<Vec<Feed>> {
        let mut stmt = self.conn.prepare("SELECT id, name, url, group_id, last_updated, translate_enabled, notification_enabled, last_update_status, update_attempts, next_retry_time FROM feeds ORDER BY name")?;
        let feeds = stmt.query_map([], |row| {
            let last_updated = row.get::<_, Option<i64>>(4)?
                .map(|ts| Utc.timestamp(ts, 0));
            let next_retry_time = row.get::<_, Option<i64>>(9)?
                .map(|ts| Utc.timestamp(ts, 0));
            Ok(Feed {
                id: row.get::<_, i64>(0)?,
                name: row.get(1)?,
                url: row.get(2)?,
                group_id: row.get::<_, Option<i64>>(3)?,
                last_updated,
                translate_enabled: row.get(5)?,
                notification_enabled: row.get(6)?,
                last_update_status: row.get(7)?,
                update_attempts: row.get(8)?,
                next_retry_time,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        Ok(feeds)
    }

    /// 检查文章是否已存在且已有翻译内容
    pub fn article_needs_translation(&self, feed_id: i64, link: &str) -> Result<bool> {
        // 查询文章是否存在以及是否已有翻译标题
        let result = self.conn.query_row(
            r#"SELECT translated_title FROM articles WHERE feed_id = ? AND link = ?"#,
            params![feed_id, link],
            |row| {
                let translated_title: Option<String> = row.get(0)?;
                // 只检查标题是否需要翻译
                Ok(translated_title.is_none() || translated_title == Some(String::new()))
            }
        ).ok();

        // 如果文章不存在或需要翻译，则返回true
        Ok(result.unwrap_or(true))
    }

    /// 添加或更新文章，返回是否成功添加了新文章
    pub fn add_article(&self, article: &Article) -> Result<bool> {
        let pub_date_ts = article.pub_date.timestamp();

        let categories_str = serde_json::to_string(&article.categories)
            .unwrap_or_else(|_| String::from("[]"));

        // 首先尝试获取现有文章的ID
        let existing_id = self.conn.query_row(
            r#"SELECT id, translated_title, translated_content FROM articles WHERE feed_id = ? AND link = ?"#,
            params![article.feed_id, article.link.as_str()],
            |row| {
                let id: i64 = row.get(0)?;
                let existing_translated_title: Option<String> = row.get(1)?;
                let existing_translated_content: Option<String> = row.get(2)?;
                Ok((id, existing_translated_title, existing_translated_content))
            }
        ).ok();

        let is_new_article = existing_id.is_none();
        
        let _rows_affected = match existing_id {
            Some((id, existing_translated_title, existing_translated_content)) => {
                // 文章已存在，更新文章信息，但保留原有翻译内容
                // 只在明确提供了新的翻译内容时才更新翻译字段
                let translated_title_to_use = article.translated_title.as_ref().or(existing_translated_title.as_ref());
                let translated_content_to_use = article.translated_content.as_ref().or(existing_translated_content.as_ref());
                
                self.conn.execute(
                    r#"UPDATE articles SET 
                        title = ?, 
                        content = ?, 
                        pub_date = ?, 
                        thumbnail = ?, 
                        author = ?, 
                        categories = ?, 
                        translated_title = ?, 
                        translated_content = ?
                   WHERE id = ?"#,
                    params![
                        article.title.as_str(),
                        article.content.as_str(),
                        pub_date_ts,
                        article.thumbnail.as_deref(),
                        article.author.as_deref(),
                        categories_str.as_str(),
                        translated_title_to_use,
                        translated_content_to_use,
                        id
                    ],
                )?
            },
            None => {
                // 文章不存在，插入新文章
                self.conn.execute(
                    r#"INSERT INTO articles (feed_id, title, content, pub_date, link, is_read, is_favorite, thumbnail, author, categories, translated_title, translated_content) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
                    params![
                        article.feed_id,
                        article.title.as_str(),
                        article.content.as_str(),
                        pub_date_ts,
                        article.link.as_str(),
                        article.is_read,
                        article.is_favorite,
                        article.thumbnail.as_deref(),
                        article.author.as_deref(),
                        categories_str.as_str(),
                        article.translated_title.as_deref(),
                        article.translated_content.as_deref()
                    ],
                )?
            }
        };
        
        // 返回是否成功添加了新文章（如果是更新，返回false；如果是插入，返回true）
        Ok(is_new_article)
    }

    /// 获取未读文章数量
    pub fn get_unread_count(&self, feed_id: Option<i64>) -> Result<u32> {
        match feed_id {
            Some(id) => {
                let count: u32 = self.conn.query_row(
                    "SELECT COUNT(*) FROM articles WHERE feed_id = ? AND is_read = FALSE",
                    params![id],
                    |row| row.get(0),
                )?;
                Ok(count)
            }
            None => {
                let count: u32 = self.conn.query_row(
                    "SELECT COUNT(*) FROM articles WHERE is_read = FALSE",
                    [],
                    |row| row.get(0),
                )?;
                Ok(count)
            }
        }
    }

    /// 标记文章为已读
    pub fn mark_article_as_read(&self, article_id: i64, is_read: bool) -> Result<()> {
        let rows_affected = self.conn.execute(
            "UPDATE articles SET is_read = ? WHERE id = ?",
            params![is_read, article_id],
        )?;
        if rows_affected == 0 {
            eprintln!("警告: 未找到ID为 {} 的文章，无法标记为已读", article_id);
        }
        Ok(())
    }

    /// 搜索文章
    pub fn search_articles(&self, query: &str, limit: u32) -> Result<Vec<(Article, String)>> {
        // 使用FTS5进行全文搜索
        let mut stmt = self.conn.prepare(
            r#"
            SELECT a.id, a.feed_id, a.title, a.content, a.pub_date, a.link, a.is_read, a.is_favorite, a.thumbnail, a.author, a.categories, a.translated_title, a.translated_content, f.name as feed_name 
            FROM articles a
            JOIN feeds f ON a.feed_id = f.id
            JOIN articles_fts ft ON a.id = ft.rowid
            WHERE ft.articles_fts MATCH ?
            ORDER BY a.pub_date DESC
            LIMIT ?
            "#,
        )?;

        let results = stmt.query_map(params![query, limit], |row| {
            let pub_date = Utc.timestamp_opt(row.get::<_, i64>(4)?, 0).single().unwrap_or(Utc::now());
            
            let categories_str: Option<String> = row.get(10)?;
            let categories: Vec<String> = categories_str
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(Vec::new);

            let article = Article {
                id: row.get::<_, i64>(0)?,
                feed_id: row.get::<_, i64>(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                pub_date,
                link: row.get(5)?,
                is_read: row.get(6)?,
                is_favorite: row.get(7)?,
                thumbnail: row.get(8)?,
                author: row.get(9)?,
                categories,
                translated_title: row.get(11)?,
                translated_content: row.get(12)?,
            };

            let feed_name: String = row.get(13)?;
            Ok((article, feed_name))
        })?
        .collect::<Result<Vec<_>>>()?;

        Ok(results)
    }

    /// 删除RSS源
    pub fn delete_feed(&mut self, feed_id: i64) -> Result<()> {
        // 开始事务
        let tx = self.conn.transaction()?;
        
        tx.execute(
            "DELETE FROM feeds WHERE id = ?",
            params![feed_id],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }

    /// 更新RSS源
    pub fn update_feed(&mut self, feed: &Feed) -> Result<()> {
        let last_updated_ts = feed.last_updated.map(|t| {
            t.timestamp()
        });

        let last_updated = last_updated_ts.unwrap_or(0);
        
        // 开始事务
        let tx = self.conn.transaction()?;
        
        tx.execute(
            r#"UPDATE feeds SET name = ?, url = ?, group_id = ?, last_updated = ?, translate_enabled = ?, notification_enabled = ? 
               WHERE id = ?"#,
            params![
                feed.name.as_str(),
                feed.url.as_str(),
                feed.group_id,
                last_updated,
                feed.translate_enabled,
                feed.notification_enabled,
                feed.id
            ],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }
    
    /// 仅更新RSS源的最后更新时间
    pub fn update_feed_last_updated(&mut self, feed_id: i64, last_updated: DateTime<Utc>) -> Result<()> {
        let last_updated_ts = last_updated.timestamp();
        
        // 开始事务
        let tx = self.conn.transaction()?;
        
        tx.execute(
            r#"UPDATE feeds SET last_updated = ? WHERE id = ?"#,
            params![last_updated_ts, feed_id],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }
    
    /// 更新RSS源的更新成功状态
    pub fn update_feed_success(&mut self, feed_id: i64, last_updated: DateTime<Utc>) -> Result<()> {
        let last_updated_ts = last_updated.timestamp();
        
        // 开始事务
        let tx = self.conn.transaction()?;
        
        tx.execute(
            r#"UPDATE feeds SET last_updated = ?, last_update_status = 'success', update_attempts = 0, next_retry_time = NULL WHERE id = ?"#,
            params![last_updated_ts, feed_id],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }
    
    /// 更新RSS源的更新失败状态，并计算下次重试时间
    pub fn update_feed_failure(&mut self, feed_id: i64, error_message: &str) -> Result<()> {
        // 获取当前尝试次数
        let current_attempts: i32 = self.conn.query_row(
            r#"SELECT update_attempts FROM feeds WHERE id = ?"#,
            params![feed_id],
            |row| row.get(0),
        )?;
        
        // 计算下次重试时间：使用指数退避策略
        let retry_delay_seconds = 2_u64.pow(current_attempts as u32) * 60;
        let next_retry_time = Utc::now() + chrono::Duration::seconds(retry_delay_seconds as i64);
        let next_retry_time_ts = next_retry_time.timestamp();
        
        // 开始事务
        let tx = self.conn.transaction()?;
        
        tx.execute(
            r#"UPDATE feeds SET last_update_status = ?, update_attempts = update_attempts + 1, next_retry_time = ? WHERE id = ?"#,
            params![error_message, next_retry_time_ts, feed_id],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }

    /// 添加分组
    pub fn add_group(&mut self, group: &FeedGroup) -> Result<i64> {
        // 开始事务
        let tx = self.conn.transaction()?;
        
        let id = tx.query_row(
            r#"INSERT INTO feed_groups (name, order_index) VALUES (?, ?) RETURNING id"#,
            params![group.name.as_str(), group.order_index],
            |row| row.get(0)
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(id)
    }

    /// 获取所有分组
    pub fn get_all_groups(&self) -> Result<Vec<FeedGroup>> {
        let mut stmt = self.conn.prepare("SELECT id, name, order_index FROM feed_groups ORDER BY order_index")?;
        let groups = stmt.query_map([], |row| {
            Ok(FeedGroup {
                id: row.get::<_, i64>(0)?,
                name: row.get(1)?,
                order_index: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        Ok(groups)
    }

    /// 更新分组
    pub fn update_group(&mut self, group: &FeedGroup) -> Result<()> {
        // 开始事务
        let tx = self.conn.transaction()?;
        
        tx.execute(
            r#"UPDATE feed_groups SET name = ?, order_index = ? WHERE id = ?"#,
            params![group.name.as_str(), group.order_index, group.id],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }

    /// 删除分组
    pub fn delete_group(&mut self, group_id: i64) -> Result<()> {
        // 开始事务
        let tx = self.conn.transaction()?;
        
        // 首先将属于该分组的RSS源的group_id设为NULL
        tx.execute(
            "UPDATE feeds SET group_id = NULL WHERE group_id = ?",
            params![group_id],
        )?;
        
        // 然后删除分组
        tx.execute(
            "DELETE FROM feed_groups WHERE id = ?",
            params![group_id],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }

    /// 获取特定分组的RSS源
    pub fn get_feeds_by_group(&self, group_id: i64) -> Result<Vec<Feed>> {
        let mut stmt = self.conn.prepare("SELECT id, name, url, group_id, last_updated, translate_enabled, notification_enabled, last_update_status, update_attempts, next_retry_time FROM feeds WHERE group_id = ? ORDER BY name")?;
        let feeds = stmt.query_map(params![group_id], |row| {
            let last_updated = row.get::<_, Option<i64>>(4)?
                .map(|ts| Utc.timestamp_opt(ts, 0).unwrap());
            let next_retry_time = row.get::<_, Option<i64>>(9)?
                .map(|ts| Utc.timestamp_opt(ts, 0).unwrap());
            Ok(Feed {
                id: row.get::<_, i64>(0)?,
                name: row.get(1)?,
                url: row.get(2)?,
                group_id: row.get::<_, Option<i64>>(3)?,
                last_updated,
                translate_enabled: row.get(5)?,
                notification_enabled: row.get(6)?,
                last_update_status: row.get(7)?,
                update_attempts: row.get(8)?,
                next_retry_time,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        Ok(feeds)
    }

    /// 根据ID获取RSS源
    pub fn get_feed_by_id(&self, feed_id: i64) -> Result<Feed> {
        let mut stmt = self.conn.prepare("SELECT id, name, url, group_id, last_updated, translate_enabled, notification_enabled, last_update_status, update_attempts, next_retry_time FROM feeds WHERE id = ?")?;
        let feed = stmt.query_row(params![feed_id], |row| {
            let last_updated = row.get::<_, Option<i64>>(4)?
                .map(|ts| Utc.timestamp_opt(ts, 0).unwrap());
            let next_retry_time = row.get::<_, Option<i64>>(9)?
                .map(|ts| Utc.timestamp_opt(ts, 0).unwrap());
            Ok(Feed {
                id: row.get::<_, i64>(0)?,
                name: row.get(1)?,
                url: row.get(2)?,
                group_id: row.get::<_, Option<i64>>(3)?,
                last_updated,
                translate_enabled: row.get(5)?,
                notification_enabled: row.get(6)?,
                last_update_status: row.get(7)?,
                update_attempts: row.get(8)?,
                next_retry_time,
            })
        })?;
        Ok(feed)
    }

    /// 获取特定RSS源的文章
    pub fn get_articles_by_feed(&self, feed_id: i64, limit: u32, offset: u32) -> Result<Vec<Article>> {
        let mut stmt = self.conn.prepare("SELECT id, feed_id, title, content, pub_date, link, is_read, is_favorite, thumbnail, author, categories, translated_title, translated_content FROM articles WHERE feed_id = ? ORDER BY pub_date DESC LIMIT ? OFFSET ?")?;
        let articles = stmt.query_map(params![feed_id, limit, offset], |row| {
            let pub_date = Utc.timestamp_opt(row.get::<_, i64>(4)?, 0).single().unwrap_or(Utc::now());
            let categories_str: Option<String> = row.get(10)?;
            let categories: Vec<String> = categories_str
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(Vec::new);
            Ok(Article {
                id: row.get::<_, i64>(0)?,
                feed_id: row.get::<_, i64>(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                pub_date,
                link: row.get(5)?,
                is_read: row.get(6)?,
                is_favorite: row.get(7)?,
                thumbnail: row.get(8)?,
                author: row.get(9)?,
                categories,
                translated_title: row.get(11)?,
                translated_content: row.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        Ok(articles)
    }

    /// 获取所有文章
    pub fn get_all_articles(&self, limit: u32, offset: u32) -> Result<Vec<Article>> {
        let mut stmt = self.conn.prepare("SELECT id, feed_id, title, content, pub_date, link, is_read, is_favorite, thumbnail, author, categories, translated_title, translated_content FROM articles ORDER BY pub_date DESC LIMIT ? OFFSET ?")?;
        let articles = stmt.query_map(params![limit, offset], |row| {
            let pub_date = Utc.timestamp_opt(row.get::<_, i64>(4)?, 0).single().unwrap_or(Utc::now());
            let categories_str: Option<String> = row.get(10)?;
            let categories: Vec<String> = categories_str
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(Vec::new);
            Ok(Article {
                id: row.get::<_, i64>(0)?,
                feed_id: row.get::<_, i64>(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                pub_date,
                link: row.get(5)?,
                is_read: row.get(6)?,
                is_favorite: row.get(7)?,
                thumbnail: row.get(8)?,
                author: row.get(9)?,
                categories,
                translated_title: row.get(11)?,
                translated_content: row.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        Ok(articles)
    }

    /// 标记文章为收藏
    pub fn toggle_favorite(&self, article_id: i64, is_favorite: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE articles SET is_favorite = ? WHERE id = ?",
            params![is_favorite, article_id],
        )?;
        Ok(())
    }

    /// 获取收藏的文章
    pub fn get_favorite_articles(&self, limit: u32, offset: u32) -> Result<Vec<Article>> {
        let mut stmt = self.conn.prepare("SELECT id, feed_id, title, content, pub_date, link, is_read, is_favorite, thumbnail, author, categories, translated_title, translated_content FROM articles WHERE is_favorite = TRUE ORDER BY pub_date DESC LIMIT ? OFFSET ?")?;
        let articles = stmt.query_map(params![limit, offset], |row| {
            let pub_date = Utc.timestamp_opt(row.get::<_, i64>(4)?, 0).single().unwrap_or(Utc::now());
            let categories_str: Option<String> = row.get(10)?;
            let categories: Vec<String> = categories_str
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(Vec::new);
            Ok(Article {
                id: row.get::<_, i64>(0)?,
                feed_id: row.get::<_, i64>(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                pub_date,
                link: row.get(5)?,
                is_read: row.get(6)?,
                is_favorite: row.get(7)?,
                thumbnail: row.get(8)?,
                author: row.get(9)?,
                categories,
                translated_title: row.get(11)?,
                translated_content: row.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        Ok(articles)
    }

    /// 获取未读文章
    pub fn get_unread_articles(&self, limit: u32, offset: u32) -> Result<Vec<Article>> {
        let mut stmt = self.conn.prepare("SELECT id, feed_id, title, content, pub_date, link, is_read, is_favorite, thumbnail, author, categories, translated_title, translated_content FROM articles WHERE is_read = FALSE ORDER BY pub_date DESC LIMIT ? OFFSET ?")?;
        let articles = stmt.query_map(params![limit, offset], |row| {
            let pub_date = Utc.timestamp_opt(row.get::<_, i64>(4)?, 0).single().unwrap_or(Utc::now());
            let categories_str: Option<String> = row.get(10)?;
            let categories: Vec<String> = categories_str
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(Vec::new);
            Ok(Article {
                id: row.get::<_, i64>(0)?,
                feed_id: row.get::<_, i64>(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                pub_date,
                link: row.get(5)?,
                is_read: row.get(6)?,
                is_favorite: row.get(7)?,
                thumbnail: row.get(8)?,
                author: row.get(9)?,
                categories,
                translated_title: row.get(11)?,
                translated_content: row.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        Ok(articles)
    }

    /// 删除文章
    /// 如果提供feed_id，则删除该源的所有文章
    /// 如果不提供feed_id，则删除所有文章
    pub fn delete_articles(&mut self, feed_id: Option<i64>) -> Result<()> {
        // 开始事务
        let tx = self.conn.transaction()?;
        
        match feed_id {
            Some(id) => {
                // 删除特定源的所有文章
                tx.execute(
                    "DELETE FROM articles WHERE feed_id = ?",
                    params![id],
                )?;
            },
            None => {
                // 删除所有文章
                tx.execute(
                    "DELETE FROM articles",
                    [],
                )?;
            }
        }
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }
    
    /// 删除单篇文章
    pub fn delete_article(&mut self, article_id: i64) -> Result<()> {
        // 开始事务
        let tx = self.conn.transaction()?;
        
        // 删除特定文章
        tx.execute(
            "DELETE FROM articles WHERE id = ?",
            params![article_id],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }

    /// 导出OPML文件
    pub fn export_opml(&self) -> Result<String> {
        // 获取所有分组和RSS源
        let groups = self.get_all_groups()?;
        let feeds = self.get_all_feeds()?;
        
        // 按分组组织RSS源
        let mut group_feeds = std::collections::HashMap::new();
        let mut ungrouped_feeds = Vec::new();
        
        for feed in feeds {
            if let Some(group_id) = feed.group_id {
                group_feeds.entry(group_id).or_insert_with(Vec::new).push(feed);
            } else {
                ungrouped_feeds.push(feed);
            }
        }
        
        // 创建OPML对象
        let mut opml = OPML {
            version: "2.0".to_string(),
            head: Some(opml::Head {
                title: Some("RSS Reader Subscriptions".to_string()),
                ..Default::default()
            }),
            body: opml::Body {
                outlines: vec![]
            },
        };
        
        // 添加未分组的RSS源
        for feed in ungrouped_feeds {
            let outline = Outline {
                text: feed.name.clone(),
                title: Some(feed.name.clone()),
                xml_url: Some(feed.url.clone()),
                ..Default::default()
            };
            opml.body.outlines.push(outline);
        }
        
        // 添加分组的RSS源
        for group in groups {
            let mut group_outline = Outline {
                text: group.name.clone(),
                title: Some(group.name.clone()),
                outlines: vec![],
                ..Default::default()
            };
            
            if let Some(feeds) = group_feeds.get(&group.id) {
                for feed in feeds {
                    let feed_outline = Outline {
                        text: feed.name.clone(),
                        title: Some(feed.name.clone()),
                        xml_url: Some(feed.url.clone()),
                        ..Default::default()
                    };
                    group_outline.outlines.push(feed_outline);
                }
            }
            
            opml.body.outlines.push(group_outline);
        }
        
        // 生成OPML XML字符串
        opml.to_string().map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })
    }

    /// 导入OPML文件
    pub fn import_opml(&mut self, opml_content: &str) -> Result<usize> {
        // 解析OPML内容
        let opml = OPML::from_str(opml_content).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Null, Box::new(e))
        })?;
        
        let mut imported_count = 0;
        
        // 处理所有outline
        for outline in opml.body.outlines {
            imported_count += self.process_outline(&outline, None)?;
        }
        
        Ok(imported_count)
    }

    /// 递归处理OPML outline
    fn process_outline(&mut self, outline: &Outline, parent_group_id: Option<i64>) -> Result<usize> {
        let mut imported_count = 0;
        
        // 如果是分组（没有xml_url，但有子outline）
        if outline.xml_url.is_none() && !outline.outlines.is_empty() {
            // 创建或获取分组
            let group_id = self.get_or_create_group(&outline.text)?;
            
            // 处理子outline
            for child_outline in &outline.outlines {
                imported_count += self.process_outline(child_outline, Some(group_id))?;
            }
        } else if let Some(xml_url) = &outline.xml_url {
            // 是RSS源
            let feed_name = outline.title.as_deref().unwrap_or(&outline.text);
            
            // 检查是否已存在该RSS源
            let existing_feed = self.conn.query_row(
                "SELECT id FROM feeds WHERE url = ?",
                params![xml_url],
                |row| row.get::<usize, i64>(0)
            );
            
            if existing_feed.is_err() {
                // 不存在，创建新的RSS源
                let feed = Feed {
                    id: 0,
                    name: feed_name.to_string(),
                    url: xml_url.to_string(),
                    group_id: parent_group_id,
                    last_updated: None,
                    translate_enabled: false,
                    notification_enabled: true, // 默认启用通知
                    last_update_status: None,
                    update_attempts: 0,
                    next_retry_time: None,
                };
                
                self.add_feed(&feed)?;
                imported_count += 1;
            }
        }
        
        Ok(imported_count)
    }

    /// 获取或创建分组
    fn get_or_create_group(&mut self, group_name: &str) -> Result<i64> {
        // 检查分组是否已存在
        let existing_group = self.conn.query_row(
            "SELECT id FROM feed_groups WHERE name = ?",
            params![group_name],
            |row| row.get(0)
        );
        
        if let Ok(group_id) = existing_group {
            Ok(group_id)
        } else {
            // 不存在，创建新分组
            let group = FeedGroup {
                id: 0,
                name: group_name.to_string(),
                order_index: 0, // 默认顺序
            };
            
            self.add_group(&group)
        }
    }

    /// 添加AI平台
    pub fn add_ai_platform(&mut self, platform: &AIPlatform) -> Result<i64> {
        // 开始事务
        let tx = self.conn.transaction()?;
        
        // 如果设置为默认平台，先将其他平台的默认标志设为false
        if platform.is_default {
            tx.execute(
                "UPDATE ai_platforms SET is_default = FALSE",
                [],
            )?;
        }
        
        let id = tx.query_row(
            r#"INSERT INTO ai_platforms (name, api_url, api_key, api_model, is_default) 
               VALUES (?, ?, ?, ?, ?) RETURNING id"#,
            params![
                platform.name.as_str(),
                platform.api_url.as_str(),
                platform.api_key.as_str(),
                platform.api_model.as_str(),
                platform.is_default
            ],
            |row| row.get(0)
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(id)
    }

    /// 获取所有AI平台
    pub fn get_all_ai_platforms(&self) -> Result<Vec<AIPlatform>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, api_url, api_key, api_model, is_default 
             FROM ai_platforms ORDER BY name"
        )?;
        let platforms = stmt.query_map([], |row| {
            Ok(AIPlatform {
                id: row.get::<_, i64>(0)?,
                name: row.get(1)?,
                api_url: row.get(2)?,
                api_key: row.get(3)?,
                api_model: row.get(4)?,
                is_default: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        Ok(platforms)
    }

    /// 获取默认AI平台
    pub fn get_default_ai_platform(&self) -> Result<Option<AIPlatform>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, api_url, api_key, api_model, is_default 
             FROM ai_platforms WHERE is_default = TRUE"
        )?;
        let platform = stmt.query_row([], |row| {
            Ok(AIPlatform {
                id: row.get::<_, i64>(0)?,
                name: row.get(1)?,
                api_url: row.get(2)?,
                api_key: row.get(3)?,
                api_model: row.get(4)?,
                is_default: row.get(5)?,
            })
        });
        
        match platform {
            Ok(platform) => Ok(Some(platform)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
    
    /// 根据ID获取AI平台
    pub fn get_ai_platform_by_id(&self, id: i64) -> Result<Option<AIPlatform>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, api_url, api_key, api_model, is_default 
             FROM ai_platforms WHERE id = ?"
        )?;
        let platform = stmt.query_row(params![id], |row| {
            Ok(AIPlatform {
                id: row.get::<_, i64>(0)?,
                name: row.get(1)?,
                api_url: row.get(2)?,
                api_key: row.get(3)?,
                api_model: row.get(4)?,
                is_default: row.get(5)?,
            })
        });
        
        match platform {
            Ok(platform) => Ok(Some(platform)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 更新AI平台
    pub fn update_ai_platform(&mut self, platform: &AIPlatform) -> Result<()> {
        // 开始事务
        let tx = self.conn.transaction()?;
        
        // 如果设置为默认平台，先将其他平台的默认标志设为false
        if platform.is_default {
            tx.execute(
                "UPDATE ai_platforms SET is_default = FALSE",
                [],
            )?;
        }
        
        tx.execute(
            r#"UPDATE ai_platforms SET name = ?, api_url = ?, api_key = ?, api_model = ?, is_default = ? 
               WHERE id = ?"#,
            params![
                platform.name.as_str(),
                platform.api_url.as_str(),
                platform.api_key.as_str(),
                platform.api_model.as_str(),
                platform.is_default,
                platform.id
            ],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }

    /// 删除AI平台
    pub fn delete_ai_platform(&mut self, platform_id: i64) -> Result<()> {
        // 开始事务
        let tx = self.conn.transaction()?;
        
        tx.execute(
            "DELETE FROM ai_platforms WHERE id = ?",
            params![platform_id],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }

    /// 设置默认AI平台
    pub fn set_default_ai_platform(&mut self, platform_id: i64) -> Result<()> {
      
        
        // 开始事务
        let tx = self.conn.transaction()?;
        
        // 先将所有平台的默认标志设为false
        tx.execute(
            "UPDATE ai_platforms SET is_default = FALSE",
            [],
        )?;
        
        // 设置指定平台为默认
        tx.execute(
            "UPDATE ai_platforms SET is_default = TRUE WHERE id = ?",
            params![platform_id],
        )?;
        
        // 提交事务
        tx.commit()?;
        
        Ok(())
    }
}