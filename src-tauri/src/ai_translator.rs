use crate::models::AIPlatform;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;


/// AI翻译配置
#[derive(Debug, Clone)]
pub struct TranslatorConfig {
    pub max_tokens: u32,
    pub temperature: f32,
    pub timeout: u64,
}

impl Default for TranslatorConfig {
    fn default() -> Self {
        Self {
            max_tokens: 4096,
            temperature: 0.7,
            timeout: 30,
        }
    }
}

/// AI翻译请求
#[derive(Debug, Serialize)]
pub struct TranslationRequest {
    pub text: String,
    pub target_language: String,
    pub source_language: Option<String>,
}

/// AI翻译响应
#[derive(Debug, Deserialize)]
pub struct TranslationResponse {
    pub translated_text: String,
    pub source_language: String,
    pub target_language: String,
}

/// AI聊天消息内容项
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageContentItem {
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<ImageUrl>,
}

/// AI聊天图片URL
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageUrl {
    pub url: String,
}

/// AI聊天请求消息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: ChatMessageContent,
}

/// AI聊天消息内容（支持多种格式）
#[derive(Debug, Clone)]
pub enum ChatMessageContent {
    /// 简单文本格式
    Text(String),
    /// 多部分内容格式（支持文本+图像）
    Multipart(Vec<MessageContentItem>),
}

/// AI聊天请求
#[derive(Debug, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: u32,
    pub temperature: f32,
    pub stream: bool,
}

// 为ChatMessageContent实现自定义序列化，以便兼容OpenAI API格式
impl Serialize for ChatMessageContent {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            // 简单文本格式：直接序列化为字符串
            ChatMessageContent::Text(text) => {
                serializer.serialize_str(text)
            },
            // 多部分内容格式：序列化为对象数组
            ChatMessageContent::Multipart(items) => {
                use serde::ser::SerializeSeq;
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            },
        }
    }
}

// 为ChatMessageContent实现自定义反序列化，以便兼容OpenAI API格式
impl<'de> Deserialize<'de> for ChatMessageContent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        // 定义访客结构体
        struct ChatMessageContentVisitor;
        
        impl<'de> serde::de::Visitor<'de> for ChatMessageContentVisitor {
            type Value = ChatMessageContent;
            
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("string or array of message content items")
            }
            
            // 处理字符串类型（简单文本格式）
            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(ChatMessageContent::Text(v.to_string()))
            }
            
            // 处理字符串类型（另一种情况）
            fn visit_string<E>(self, v: String) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(ChatMessageContent::Text(v))
            }
            
            // 处理序列类型（多部分内容格式）
            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::SeqAccess<'de>,
            {
                let mut items = Vec::new();
                
                // 遍历序列中的每个元素
                while let Some(item) = seq.next_element::<MessageContentItem>()? {
                    items.push(item);
                }
                
                Ok(ChatMessageContent::Multipart(items))
            }
        }
        
        // 使用访客模式进行反序列化
        deserializer.deserialize_any(ChatMessageContentVisitor)
    }
}

/// AI聊天响应片段（流式）
#[derive(Debug, Deserialize)]
pub struct ChatStreamResponse {
    pub choices: Vec<ChatStreamChoice>,
}

/// AI聊天响应选项
#[derive(Debug, Deserialize)]
pub struct ChatStreamChoice {
    pub delta: ChatStreamDelta,
    pub index: u32,
    pub finish_reason: Option<String>,
}

/// AI聊天响应增量
#[derive(Debug, Deserialize)]
pub struct ChatStreamDelta {
    pub role: Option<String>,
    pub content: Option<String>,
}

/// AI翻译器
#[derive(Debug, Clone)]
pub struct AITranslator {
    client: Client,
    config: TranslatorConfig,
    default_platform: Option<AIPlatform>,
}

impl AITranslator {
    /// 创建新的AI翻译器
    pub fn new(config: Option<TranslatorConfig>) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(config.as_ref().unwrap_or(&TranslatorConfig::default()).timeout))
                .build()
                .unwrap(),
            config: config.unwrap_or_default(),
            default_platform: None,
        }
    }

    /// 设置默认AI平台（返回新的实例，不影响原实例）
    pub fn with_default_platform(mut self, platform: Option<AIPlatform>) -> Self {
        self.default_platform = platform;
        self
    }

    /// 获取默认AI平台
    pub fn get_default_platform(&self) -> &Option<AIPlatform> {
        &self.default_platform
    }

    /// 翻译文本
    pub async fn translate_text(
        &self,
        text: &str,
        target_language: &str,
        source_language: Option<&str>,
    ) -> Result<String, Box<dyn std::error::Error>> {
        eprintln!("[AI] ===== 开始翻译文本 =====");
        eprintln!("[AI] 文本长度: {}, 首50字符: {}...", text.len(), text.chars().take(50).collect::<String>());
        eprintln!("[AI] 目标语言: {}", target_language);
        eprintln!("[AI] 源语言: {:?}", source_language);
        
        // 获取默认AI平台
        eprintln!("[AI] 开始获取默认AI平台...");
        let platform = self.get_default_platform().clone();
        if platform.is_none() {
            eprintln!("[AI] 错误: 没有配置默认AI平台");
            return Err("No default AI platform configured".into());
        }
        let platform = platform.unwrap();
        eprintln!("[AI] 成功获取默认AI平台: {}", platform.name);
        eprintln!("[AI] 平台API URL: {}", platform.api_url);
        eprintln!("[AI] 平台API Model: {}", platform.api_model);

        // 构建翻译提示词
        let prompt = match source_language {
            Some(src) => {
                eprintln!("[AI] 使用指定源语言: {}", src);
                format!("Translate the following text from {} to {}: {}", src, target_language, text)
            },
            None => {
                eprintln!("[AI] 使用自动检测源语言");
                format!("Translate the following text to {}: {}", target_language, text)
            }
        };
        eprintln!("[AI] 提示词长度: {}", prompt.len());
        eprintln!("[AI] 提示词前100字符: {}...", prompt.chars().take(100).collect::<String>());

        // 构建聊天请求
        eprintln!("[AI] 开始构建聊天请求...");
        let chat_request = ChatRequest {
            model: platform.api_model,
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: ChatMessageContent::Text(prompt),
            }],
            max_tokens: self.config.max_tokens,
            temperature: self.config.temperature,
            stream: false,
        };
        eprintln!("[AI] 聊天请求构建完成");
        eprintln!("[AI] 请求max_tokens: {}, temperature: {}", chat_request.max_tokens, chat_request.temperature);

        // 发送请求
        eprintln!("[AI] 开始发送请求到API...");
        eprintln!("[AI] API URL: {}", platform.api_url);
        let response = match self.client
            .post(&platform.api_url)
            .header("Authorization", format!("Bearer {}", platform.api_key))
            .header("Content-Type", "application/json")
            .json(&chat_request)
            .send()
            .await
        {
            Ok(resp) => {
                eprintln!("[AI] 成功收到API响应");
                eprintln!("[AI] 响应状态码: {:?}", resp.status());
                resp
            },
            Err(e) => {
                eprintln!("[AI] 发送请求失败: {}", e);
                eprintln!("[AI] 错误详情: {:?}", e);
                return Err(e.into());
            }
        };

        // 解析响应
        eprintln!("[AI] 开始读取响应内容...");
        let response_text = match response.text().await {
            Ok(text) => {
                eprintln!("[AI] 成功读取响应内容，长度: {}", text.len());
                // 确保只在有效的字符边界处截断字符串
                let preview_len = std::cmp::min(200, text.len());
                let truncated_text = text.char_indices().take_while(|&(i, _)| i < preview_len).map(|(_, c)| c).collect::<String>();
                eprintln!("[AI] 响应内容前200字符: {}...", truncated_text);
                text
            },
            Err(e) => {
                eprintln!("[AI] 读取响应内容失败: {}", e);
                return Err(e.into());
            }
        };
        
        // 解析JSON响应
        eprintln!("[AI] 开始解析JSON响应...");
        let response: serde_json::Value = match serde_json::from_str(&response_text) {
            Ok(json) => {
                eprintln!("[AI] 成功解析JSON响应");
                json
            },
            Err(e) => {
                eprintln!("[AI] JSON解析失败: {}", e);
                eprintln!("[AI] 原始响应内容: {}", response_text);
                return Err(e.into());
            }
        };

        // 检查是否有错误信息
        if let Some(error) = response.get("error") {
            eprintln!("[AI] API返回错误: {:?}", error);
            return Err(format!("API Error: {:?}", error).into());
        }

        // 提取翻译结果
        eprintln!("[AI] 开始提取翻译结果...");
        let translated_text = match response
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
        {
            Some(text) => {
                let trimmed_text = text.trim();
                eprintln!("[AI] 成功提取翻译结果，长度: {}", trimmed_text.len());
                // 确保只在有效的字符边界处截断字符串
                let preview_len = std::cmp::min(100, trimmed_text.len());
                let truncated_text = trimmed_text.char_indices().take_while(|&(i, _)| i < preview_len).map(|(_, c)| c).collect::<String>();
                eprintln!("[AI] 翻译结果前100字符: {}...", truncated_text);
                trimmed_text.to_string()
            },
            None => {
                eprintln!("[AI] 提取翻译结果失败");
                eprintln!("[AI] 响应结构: {:?}", response);
                return Err("Failed to extract translated text".into());
            }
        };
        
        eprintln!("[AI] ===== 翻译文本完成 =====");
        Ok(translated_text)
    }

    /// 翻译RSS文章标题和内容
    pub async fn translate_rss_content(
        &self,
        title: &str,
        content: &str,
        target_language: &str,
    ) -> Result<(String, String), Box<dyn std::error::Error>> {
        eprintln!("[AI] 开始翻译RSS文章标题和内容...");
        
        // 翻译标题
        eprintln!("[AI] 开始翻译文章标题...");
        let translated_title = self.translate_text(title, target_language, None).await?;
        eprintln!("[AI] 文章标题翻译完成: {}", translated_title);
        
        // 翻译内容，限制内容长度以避免超出API限制
        eprintln!("[AI] 开始翻译文章内容...");
        // 使用字符迭代器来安全地截断内容，避免字节索引问题
        let mut truncated_content = String::new();
        let mut char_count = 0;
        for c in content.chars() {
            if char_count >= 8192 {
                eprintln!("[AI] 文章内容过长，限制为8192字符");
                break;
            }
            truncated_content.push(c);
            char_count += 1;
        }
        let translated_content = self.translate_text(&truncated_content, target_language, None).await?;
        // 安全地获取前100个字符，避免字节索引问题
        let preview = translated_content.chars().take(100).collect::<String>();
        eprintln!("[AI] 文章内容翻译完成: {}...", preview);

        Ok((translated_title, translated_content))
    }

    /// 查找缓冲区中的换行符位置
    fn find_newline(buffer: &[u8]) -> Option<usize> {
        for (i, &byte) in buffer.iter().enumerate() {
            if byte == b'\n' {
                return Some(i);
            }
        }
        None
    }

    /// 流式聊天
    pub async fn chat_completion_stream(
        &self,
        messages: Vec<ChatMessage>,
        max_tokens: Option<u32>,
        temperature: Option<f32>,
        tx: mpsc::Sender<String>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let platform = self.get_default_platform().clone();
        if platform.is_none() {
            eprintln!("[AI] 错误: 没有配置默认AI平台");
            return Err("No default AI platform configured".into());
        }
        let platform = platform.unwrap();
        eprintln!("[AI] 开始流式聊天请求，平台: {}", platform.name);

        let chat_request = ChatRequest {
            model: platform.api_model,
            messages,
            max_tokens: max_tokens.unwrap_or(self.config.max_tokens),
            temperature: temperature.unwrap_or(self.config.temperature),
            stream: true,
        };

        let response = self.client
            .post(&platform.api_url)
            .header("Authorization", format!("Bearer {}", platform.api_key))
            .header("Content-Type", "application/json")
            .json(&chat_request)
            .send()
            .await?;

        // 获取响应状态码并保存
        let status = response.status();
        eprintln!("[AI] API响应状态: {:?}", status);
        
        // 检查API响应状态码，如果不是成功状态，读取并输出响应内容
        if !status.is_success() {
            let response_text = response.text().await?;
            eprintln!("[AI] API错误响应: {}", response_text);
            
            // 尝试解析错误响应JSON，提取错误消息
            let error_message = if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response_text) {
                // 尝试多种错误消息格式
                if let Some(msg) = json.get("message").and_then(|m| m.as_str()) {
                    msg.to_string()
                } else if let Some(msg) = json.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
                    msg.to_string()
                } else if let Some(msg) = json.get("error").and_then(|e| e.as_str()) {
                    msg.to_string()
                } else {
                    response_text.clone()
                }
            } else {
                response_text.clone()
            };
            
            return Err(format!("API错误: {}", error_message).into());
        }

        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        let mut total_received = 0;
        let mut total_sent = 0;

        eprintln!("[AI] 开始接收流式数据...");

        while let Some(chunk_result) = futures::StreamExt::next(&mut stream).await {
            let chunk = chunk_result?;
            total_received += chunk.len();
            eprintln!("[AI] 收到数据块: {} 字节, 累计: {}", chunk.len(), total_received);

            buffer.extend_from_slice(&chunk);

            loop {
                let newline_pos = Self::find_newline(&buffer);

                if let Some(pos) = newline_pos {
                    // 先复制数据，避免借用冲突
                    let line_bytes = buffer[..pos].to_vec();
                    buffer.drain(..pos + 1);

                    let line = String::from_utf8_lossy(&line_bytes);
                    let trimmed_line = line.trim();
                    if trimmed_line.is_empty() {
                        continue;
                    }

                    eprintln!("[AI] 处理行: {} 字节", line.len());

                    if trimmed_line == "data: [DONE]" {
                        eprintln!("[AI] 收到结束标记，流式完成。共发送: {} 个片段", total_sent);
                        return Ok(());
                    }

                    if let Some(json_str) = trimmed_line.strip_prefix("data: ") {
                        match serde_json::from_str::<ChatStreamResponse>(json_str) {
                            Ok(stream_response) => {
                                for choice in stream_response.choices {
                                    if let Some(content) = choice.delta.content {
                                        match tx.send(content.clone()).await {
                                            Ok(_) => {
                                                total_sent += 1;
                                                // 添加短暂延迟，避免发送过快导致前端无法响应
                                                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                                            }
                                            Err(e) => {
                                                eprintln!("[AI] 发送内容片段失败: {}", e);
                                                return Err(format!("Failed to send content: {}", e).into());
                                            }
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("[AI] 解析JSON失败: {}, 原始字符串长度: {}", e, json_str.len());
                                if json_str.len() < 200 {
                                    eprintln!("[AI] 原始字符串: {}", json_str);
                                }
                            }
                        }
                    }
                } else {
                    break;
                }
            }
        }

        eprintln!("[AI] 流结束。共接收: {} 字节, 发送: {} 个片段", total_received, total_sent);
        Ok(())
    }

    /// 非流式聊天
    pub async fn chat_completion(
        &self,
        messages: Vec<ChatMessage>,
        max_tokens: Option<u32>,
        temperature: Option<f32>,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let platform = self.get_default_platform().clone();
        if platform.is_none() {
            return Err("No default AI platform configured".into());
        }
        let platform = platform.unwrap();

        // 构建聊天请求
        let chat_request = ChatRequest {
            model: platform.api_model,
            messages,
            max_tokens: max_tokens.unwrap_or(self.config.max_tokens),
            temperature: temperature.unwrap_or(self.config.temperature),
            stream: false,
        };

        // 发送请求
        let response = self.client
            .post(&platform.api_url)
            .header("Authorization", format!("Bearer {}", platform.api_key))
            .header("Content-Type", "application/json")
            .json(&chat_request)
            .send()
            .await?;

        // 获取响应状态码并保存
        let status = response.status();
        eprintln!("[AI] API响应状态: {:?}", status);
        
        // 检查API响应状态码，如果不是成功状态，读取并输出响应内容
        if !status.is_success() {
            let response_text = response.text().await?;
            eprintln!("[AI] API错误响应: {}", response_text);
            
            // 尝试解析错误响应JSON，提取错误消息
            let error_message = if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response_text) {
                // 尝试多种错误消息格式
                if let Some(msg) = json.get("message").and_then(|m| m.as_str()) {
                    msg.to_string()
                } else if let Some(msg) = json.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
                    msg.to_string()
                } else if let Some(msg) = json.get("error").and_then(|e| e.as_str()) {
                    msg.to_string()
                } else {
                    response_text.clone()
                }
            } else {
                response_text.clone()
            };
            
            return Err(format!("API错误: {}", error_message).into());
        }

        // 解析响应
        let response_text = response.text().await?;
        let response: serde_json::Value = serde_json::from_str(&response_text)?;

        // 提取聊天结果
        let content = response
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .ok_or("Failed to extract chat content")?
            .to_string();

        Ok(content)
    }
}

/// AI翻译器单例
pub struct AITranslatorSingleton {
    translator: Arc<AITranslator>,
}

impl AITranslatorSingleton {
    /// 创建单例
    pub fn new() -> Self {
        Self {
            translator: Arc::new(AITranslator::new(None)),
        }
    }

    /// 获取翻译器实例（返回克隆副本，支持并行操作）
    pub async fn get_translator(&self) -> AITranslator {
        (*self.translator).clone()
    }
}

/// 全局AI翻译器实例
lazy_static::lazy_static! {
    pub static ref AI_TRANSLATOR: AITranslatorSingleton = AITranslatorSingleton::new();
}