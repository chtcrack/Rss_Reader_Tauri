# Rust RSS阅读器 for Windows 10

一个轻量级、高性能的RSS阅读器，具有现代化的用户界面和流畅的用户体验。
使用Tauri 框架，前端采用html+javascript+css,后端采用Rust，可显示图片，网页布局

## 功能特性

### RSS源管理
- 添加/删除/编辑RSS源
- RSS源分组分类与管理
- 导入/导出OPML文件
- 支持RSS和Atom格式

### 文章阅读
- 文章列表显示（标题、发布时间、来源、缩略图）
- 文章内容渲染（支持HTML标签和图片显示）
- 标记已读/未读状态
- 收藏重要文章
- 全文搜索功能

### 内容获取
- 自动定时更新（可配置间隔）
- 手动刷新
- 后台静默更新
- 智能重试机制
- 403错误处理（自动切换到Headless Chrome）

### 用户界面
- 三栏布局（源列表→文章列表→内容区域）
- 支持中文显示
- 响应式设计
- 字体大小调整

### 其他功能
- 新文章桌面通知(未实现)
- AI翻译功能
- 滚动到底部自动加载的瀑布流效果
- 文章列表分页功能

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 编程语言 | Rust | 2024 Edition |
| 框架 | Tauri | 2.0 |
| 前端构建工具 | Vite | 5.0 |
| HTTP客户端 | reqwest | 0.12 |
| RSS解析 | rss | 2.0 |
| Atom解析 | atom_syndication | 0.12 |
| 数据存储 | SQLite | 内嵌 |
| 异步运行时 | tokio | 1.48 |
| 时间处理 | chrono | 0.4 |
| JSON处理 | serde_json | 1.0 |
| 配置管理 | toml | 0.8 |

## 编译指南

### 前提条件

1. **安装Rust环境**
   - 访问 https://www.rust-lang.org/ 下载并安装Rust
   - 验证安装：`rustc --version` 和 `cargo --version`

2. **安装Node.js**
   - 访问 https://nodejs.org/ 下载并安装Node.js
   - 验证安装：`node --version` 和 `npm --version`

3. **安装Tauri CLI**
   ```bash
   npm install -g @tauri-apps/cli
   ```

### 编译步骤

#### 1. 克隆项目

```bash
# 假设你已经在项目目录中
cd g:\Rss_Reader_Tauri
```

#### 2. 安装前端依赖

```bash
cd rss_reader
npm install
```

#### 3. 编译前端

```bash
npm run build
```

#### 4. 编译并运行开发版本

```bash
# 在rss_reader目录下
npm run tauri dev
```

或使用Cargo直接运行：

```bash
cd src-tauri
cargo tauri dev
```

#### 5. 构建发布版本

```bash
# 在rss_reader目录下
npm run tauri build
```

或使用Cargo直接构建：

```bash
cd src-tauri
cargo tauri build
```

构建完成后，可执行文件将位于 `src-tauri/target/release/` 目录下。

## 目录结构

```
Rss_Reader_Tauri/
├── rss_reader/                    # 前端代码
│   ├── src/                       # 前端源代码
│   │   ├── assets/                # 静态资源
│   │   ├── index.html             # 主HTML文件
│   │   ├── main.js                # 前端入口
│   │   └── styles.css             # 样式文件
│   ├── src-tauri/                 # 后端Rust代码
│   │   ├── src/                   # Rust源代码
│   │   │   ├── ai_translator.rs   # AI翻译模块
│   │   │   ├── db.rs              # 数据库操作
│   │   │   ├── lib.rs             # 核心逻辑
│   │   │   ├── main.rs            # 入口文件
│   │   │   ├── models.rs          # 数据模型
│   │   │   └── rss.rs             # RSS处理
│   │   ├── Cargo.toml             # Rust依赖配置
│   │   └── tauri.conf.json        # Tauri配置
│   ├── package.json               # 前端依赖配置
│   └── vite.config.js             # Vite配置
└── README.md                      # 项目说明文档
```

## 使用说明

### 基本操作

1. **添加RSS源**
   - 点击左侧栏的"添加源"按钮
   - 输入RSS源URL和分组名称
   - 点击"添加"按钮

2. **阅读文章**
   - 在左侧选择RSS源或分组
   - 在中间栏浏览文章列表
   - 点击文章标题查看内容
   - 使用"标记已读"/"标记未读"按钮管理阅读状态

3. **搜索文章**
   - 在顶部搜索框输入关键词
   - 按回车键或点击搜索按钮

4. **导入OPML**
   - 点击"导入OPML"按钮
   - 选择OPML文件
   - 点击"导入"按钮

5. **导出OPML**
   - 点击"导出OPML"按钮
   - 选择保存位置

### 配置说明

- **更新间隔**：在设置中配置自动更新间隔时间
- **主题切换**：支持暗色/亮色主题切换
- **字体大小**：可调整文章内容的字体大小

## 性能特点

- 启动时间<2秒
- 支持100+ RSS源同时更新
- 内存占用低
- 响应迅速

## 注意事项

- 首次运行时会创建数据库文件
- 确保网络连接正常以获取RSS内容
- 对于403错误，应用会自动切换到Headless Chrome获取内容
- 定期备份OPML文件以防止数据丢失

## 许可证

ISC

## 开发者

chtcr

## 问题反馈

如有任何问题或建议，请提交Issue或联系开发者。