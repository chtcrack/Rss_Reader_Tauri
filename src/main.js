// 导入Tauri API
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// 应用状态
let htmlElement;
let themeToggle;
let addFeedBtn;
let addFeedModal;
let closeModal;
let cancelBtn;
let addFeedForm;
let addGroupBtn;
let addGroupModal;
let addGroupForm;
let editGroupModal;
let editGroupForm;
let deleteGroupModal;
let confirmDeleteGroupBtn;
let editFeedModal;
let editFeedForm;
let deleteFeedModal;
let confirmDeleteFeedBtn;
let refreshBtn;
let settingsBtn;
let searchInput;
let searchBtn;
let filterBtns;
let currentFilter = 'all';
let currentFeedId = null;
let currentGroupId = null;
let currentEditingGroup = null;
let currentEditingFeed = null;

// 订阅源ID到名称的映射
let feedMap = new Map();

// 删除文章相关变量
let deleteAllBtn;
let deleteArticlesModal;
let confirmDeleteArticlesBtn;
let currentDeletingArticleId = null; // 当前要删除的文章ID
let deleteType = 'all'; // 'all' 或 'single'

// AI平台相关状态
let aiPlatformsModal;
let aiPlatformsList;
let addAIPlatformBtn;
let addAIPlatformModal;
let addAIPlatformForm;
let editAIPlatformModal;
let editAIPlatformForm;
let deleteAIPlatformModal;
let confirmDeleteAIPlatformBtn;
let currentEditingAIPlatform = null;

// 分页状态
let currentPage = 1;
let pageSize = 20;
let totalArticles = 0;
let totalPages = 1;

// 无限滚动状态
let isLoading = false;
let hasMore = true;
let isSearching = false;

// 加载分组列表到下拉选择框
async function loadGroupsToSelect(selectId) {
  try {
    console.log('开始加载分组列表到下拉选择框...');
    const groups = await invoke('get_all_groups');
    console.log('成功加载分组列表:', groups.length, '个分组');
    
    // 确定要处理的选择框ID列表
    const selectIds = selectId 
      ? [selectId] 
      : ['feed-group', 'edit-feed-group'];
    
    // 处理每个选择框
    for (const id of selectIds) {
      const groupSelect = document.getElementById(id);
      if (!groupSelect) {
        console.warn(`未找到id为${id}的元素`);
        continue;
      }
      
      // 清空现有选项（保留"无分组"选项或创建一个）
      let noGroupOption = groupSelect.querySelector('option[value=""]');
      if (!noGroupOption) {
        noGroupOption = document.createElement('option');
        noGroupOption.value = '';
        noGroupOption.textContent = '无分组';
      }
      groupSelect.innerHTML = '';
      groupSelect.appendChild(noGroupOption);
      
      // 添加动态生成的分组选项
      groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        groupSelect.appendChild(option);
      });
      
      console.log(`分组列表已成功加载到ID为${id}的下拉选择框`);
    }
  } catch (error) {
    console.error('加载分组列表到下拉选择框失败:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
  }
}

// 初始化函数，在DOM加载完成后执行
function initEventListeners() {
  // 主题切换功能
  htmlElement = document.documentElement;
  themeToggle = document.getElementById('theme-toggle');

  // 初始化主题
  const savedTheme = localStorage.getItem('theme') || 'light';
  htmlElement.setAttribute('data-theme', savedTheme);
  if (themeToggle) {
    themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  }

  // 主题切换事件
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = htmlElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      htmlElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    });
  }

  // 添加RSS源模态框
  addFeedBtn = document.getElementById('add-feed-btn');
  addFeedModal = document.getElementById('add-feed-modal');
  closeModal = document.querySelector('.close');
  cancelBtn = document.querySelector('.form-actions button.cancel');
  addFeedForm = document.getElementById('add-feed-form');

  if (addFeedBtn) {
    addFeedBtn.addEventListener('click', async () => {
      // 加载分组列表并更新下拉选项
      await loadGroupsToSelect();
      addFeedModal.classList.add('show');
    });
  }

  if (closeModal) {
    closeModal.addEventListener('click', () => {
      addFeedModal.classList.remove('show');
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      addFeedModal.classList.remove('show');
    });
  }

  if (addFeedModal) {
    addFeedModal.addEventListener('click', (e) => {
      if (e.target === addFeedModal) {
        addFeedModal.classList.remove('show');
      }
    });
  }

  // 添加RSS源表单提交
  if (addFeedForm) {
    addFeedForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const feedName = document.getElementById('feed-name').value;
      const feedUrl = document.getElementById('feed-url').value;
      const feedGroup = document.getElementById('feed-group').value;
      
      try {
        const translateEnabled = document.getElementById('translate-enabled').checked;
      
      const feed = {
          id: 0, // 数据库自动生成
          name: feedName,
          url: feedUrl,
          group_id: feedGroup ? parseInt(feedGroup) : null,
          last_updated: null,
          translate_enabled: translateEnabled
        };
        
        await invoke('add_feed', { feed });
        addFeedModal.classList.remove('show');
        addFeedForm.reset();
        await loadFeeds(); // 重新加载RSS源列表
        
        // 显示加载状态
        const articlesContainer = document.getElementById('articles-container');
        articlesContainer.innerHTML = '<div class="loading-state"><div class="loading-spinner-small"></div><span class="loading-text">正在获取中…</span></div>';
        
        // 不立即重新加载文章列表，等待后台更新完成
      } catch (error) {
        console.error('Failed to add feed:', error);
        alert('添加RSS源失败: ' + error);
      }
    });
  }

  // 刷新按钮事件
  refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      try {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⏳';
        
        if (currentFeedId) {
          // 更新单个RSS源
          await invoke('update_single_feed', { feedId: currentFeedId });
        } else {
          // 更新所有RSS源
          await invoke('update_all_feeds');
        }
        
        await loadFeeds(); // 重新加载RSS源列表
        await loadFilteredArticles(); // 重新加载文章列表
      } catch (error) {
        console.error('Failed to refresh feeds:', error);
        alert('刷新失败: ' + error);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄';
      }
    });
  }

  // 设置按钮事件 - 打开AI平台管理
  settingsBtn = document.getElementById('settings-btn');
  aiPlatformsModal = document.getElementById('ai-platforms-modal');
  aiPlatformsList = document.getElementById('ai-platforms-list');
  addAIPlatformBtn = document.getElementById('add-ai-platform-btn');
  addAIPlatformModal = document.getElementById('add-ai-platform-modal');
  addAIPlatformForm = document.getElementById('add-ai-platform-form');
  editAIPlatformModal = document.getElementById('edit-ai-platform-modal');
  editAIPlatformForm = document.getElementById('edit-ai-platform-form');
  deleteAIPlatformModal = document.getElementById('delete-ai-platform-modal');
  confirmDeleteAIPlatformBtn = document.getElementById('confirm-delete-ai-platform');
  
  // 自动更新设置
  const updateIntervalSelect = document.getElementById('update-interval');
  const saveUpdateIntervalBtn = document.getElementById('save-update-interval');

  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      await loadAIPlatforms();
      aiPlatformsModal.classList.add('show');
    });
  }
  
  // 保存自动更新间隔
  if (saveUpdateIntervalBtn) {
    saveUpdateIntervalBtn.addEventListener('click', async () => {
      const intervalMinutes = parseInt(updateIntervalSelect.value);
      const intervalSeconds = intervalMinutes * 60;
      
      try {
        // 调用Tauri命令更新自动更新间隔
        await invoke('update_update_interval', { interval: intervalSeconds });
        
        // 显示成功消息
        alert('自动更新间隔已保存，将在下次更新时生效');
      } catch (error) {
        console.error('Failed to save update interval:', error);
        alert('保存失败: ' + error);
      }
    });
  }

  // AI平台管理模态框关闭事件
  const aiPlatformsClose = aiPlatformsModal.querySelector('.close');
  if (aiPlatformsClose) {
    aiPlatformsClose.addEventListener('click', () => {
      aiPlatformsModal.classList.remove('show');
    });
  }

  // 点击模态框外部关闭
  if (aiPlatformsModal) {
    aiPlatformsModal.addEventListener('click', (e) => {
      if (e.target === aiPlatformsModal) {
        aiPlatformsModal.classList.remove('show');
      }
    });
  }

  // 添加AI平台按钮点击事件
  if (addAIPlatformBtn) {
    addAIPlatformBtn.addEventListener('click', () => {
      addAIPlatformModal.classList.add('show');
    });
  }

  // 添加AI平台模态框关闭事件
  const addAIPlatformClose = addAIPlatformModal.querySelector('.close');
  if (addAIPlatformClose) {
    addAIPlatformClose.addEventListener('click', () => {
      addAIPlatformModal.classList.remove('show');
      addAIPlatformForm.reset();
    });
  }

  // 添加AI平台取消按钮事件
  const addAIPlatformCancel = addAIPlatformModal.querySelector('.cancel');
  if (addAIPlatformCancel) {
    addAIPlatformCancel.addEventListener('click', () => {
      addAIPlatformModal.classList.remove('show');
      addAIPlatformForm.reset();
    });
  }

  // 点击模态框外部关闭
  if (addAIPlatformModal) {
    addAIPlatformModal.addEventListener('click', (e) => {
      if (e.target === addAIPlatformModal) {
        addAIPlatformModal.classList.remove('show');
        addAIPlatformForm.reset();
      }
    });
  }

  // 添加AI平台表单提交
  if (addAIPlatformForm) {
    addAIPlatformForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const platformName = document.getElementById('ai-platform-name').value;
      const apiUrl = document.getElementById('ai-platform-url').value;
      const apiKey = document.getElementById('ai-platform-key').value;
      const apiModel = document.getElementById('ai-platform-model').value;
      const isDefault = document.getElementById('ai-platform-is-default').checked;
      
      try {
        const platform = {
          id: 0, // 数据库自动生成
          name: platformName,
          api_url: apiUrl,
          api_key: apiKey,
          api_model: apiModel,
          is_default: isDefault
        };
        
        await invoke('add_ai_platform', { platform });
        addAIPlatformModal.classList.remove('show');
        addAIPlatformForm.reset();
        await loadAIPlatforms(); // 重新加载AI平台列表
      } catch (error) {
        console.error('Failed to add AI platform:', error);
        alert('添加AI平台失败: ' + error);
      }
    });
  }

  // 编辑AI平台模态框关闭事件
  const editAIPlatformClose = editAIPlatformModal.querySelector('.close');
  if (editAIPlatformClose) {
    editAIPlatformClose.addEventListener('click', () => {
      editAIPlatformModal.classList.remove('show');
      editAIPlatformForm.reset();
      currentEditingAIPlatform = null;
    });
  }

  // 编辑AI平台取消按钮事件
  const editAIPlatformCancel = editAIPlatformModal.querySelector('.cancel');
  if (editAIPlatformCancel) {
    editAIPlatformCancel.addEventListener('click', () => {
      editAIPlatformModal.classList.remove('show');
      editAIPlatformForm.reset();
      currentEditingAIPlatform = null;
    });
  }

  // 点击模态框外部关闭
  if (editAIPlatformModal) {
    editAIPlatformModal.addEventListener('click', (e) => {
      if (e.target === editAIPlatformModal) {
        editAIPlatformModal.classList.remove('show');
        editAIPlatformForm.reset();
        currentEditingAIPlatform = null;
      }
    });
  }

  // 编辑AI平台表单提交
  if (editAIPlatformForm) {
    editAIPlatformForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!currentEditingAIPlatform) return;
      
      const platformId = parseInt(document.getElementById('edit-ai-platform-id').value);
      const platformName = document.getElementById('edit-ai-platform-name').value;
      const apiUrl = document.getElementById('edit-ai-platform-url').value;
      const apiKey = document.getElementById('edit-ai-platform-key').value;
      const apiModel = document.getElementById('edit-ai-platform-model').value;
      const isDefault = document.getElementById('edit-ai-platform-is-default').checked;
      
      try {
        const platform = {
          id: platformId,
          name: platformName,
          api_url: apiUrl,
          api_key: apiKey,
          api_model: apiModel,
          is_default: isDefault
        };
        
        await invoke('update_ai_platform', { platform });
        editAIPlatformModal.classList.remove('show');
        editAIPlatformForm.reset();
        currentEditingAIPlatform = null;
        await loadAIPlatforms(); // 重新加载AI平台列表
      } catch (error) {
        console.error('Failed to update AI platform:', error);
        alert('更新AI平台失败: ' + error);
      }
    });
  }

  // 删除AI平台模态框关闭事件
  const deleteAIPlatformClose = deleteAIPlatformModal.querySelector('.close');
  if (deleteAIPlatformClose) {
    deleteAIPlatformClose.addEventListener('click', () => {
      deleteAIPlatformModal.classList.remove('show');
    });
  }

  // 删除AI平台取消按钮事件
  const deleteAIPlatformCancel = deleteAIPlatformModal.querySelector('.cancel');
  if (deleteAIPlatformCancel) {
    deleteAIPlatformCancel.addEventListener('click', () => {
      deleteAIPlatformModal.classList.remove('show');
    });
  }

  // 点击模态框外部关闭
  if (deleteAIPlatformModal) {
    deleteAIPlatformModal.addEventListener('click', (e) => {
      if (e.target === deleteAIPlatformModal) {
        deleteAIPlatformModal.classList.remove('show');
      }
    });
  }

  // 确认删除AI平台事件
  if (confirmDeleteAIPlatformBtn) {
    confirmDeleteAIPlatformBtn.addEventListener('click', async () => {
      const platformId = parseInt(document.getElementById('delete-ai-platform-id').value);
      
      try {
        await invoke('delete_ai_platform', { platformId });
        deleteAIPlatformModal.classList.remove('show');
        await loadAIPlatforms(); // 重新加载AI平台列表
      } catch (error) {
        console.error('Failed to delete AI platform:', error);
        alert('删除AI平台失败: ' + error);
      }
    });
  }

  // 搜索功能
  searchInput = document.getElementById('search-input');
  searchBtn = document.getElementById('search-btn');

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      resetArticles(); // 重置文章列表状态
      performSearch(currentPage, pageSize);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        resetArticles(); // 重置文章列表状态
        performSearch(currentPage, pageSize);
      }
    });
  }

  // 文章过滤功能
    filterBtns = document.querySelectorAll('.filter-btn');
    if (filterBtns) {
        filterBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                // 更新按钮状态
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // 更新当前过滤条件
                currentFilter = btn.dataset.filter;
                
                // 重置文章列表状态
                resetArticles();
                
                // 加载过滤后的文章
                await loadFilteredArticles(currentPage, pageSize);
            });
        });
    }

  // OPML导出功能
  const exportOpmlBtn = document.getElementById('export-opml-btn');
  if (exportOpmlBtn) {
    exportOpmlBtn.addEventListener('click', exportOpml);
  }

  // OPML导入功能
  const importOpmlBtn = document.getElementById('import-opml-btn');
  const opmlFileInput = document.getElementById('opml-file-input');
  
  if (importOpmlBtn && opmlFileInput) {
    importOpmlBtn.addEventListener('click', () => {
      opmlFileInput.click();
    });
    
    opmlFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        importOpml(file);
      }
    });
  }
  
  // 添加分组模态框
  addGroupBtn = document.getElementById('add-group-btn');
  addGroupModal = document.getElementById('add-group-modal');
  addGroupForm = document.getElementById('add-group-form');
  
  if (addGroupBtn) {
    addGroupBtn.addEventListener('click', () => {
      addGroupModal.classList.add('show');
    });
  }
  
  // 添加分组模态框关闭事件
  const addGroupClose = addGroupModal.querySelector('.close');
  if (addGroupClose) {
    addGroupClose.addEventListener('click', () => {
      addGroupModal.classList.remove('show');
    });
  }
  
  // 添加分组取消按钮事件
  const addGroupCancel = addGroupModal.querySelector('.cancel');
  if (addGroupCancel) {
    addGroupCancel.addEventListener('click', () => {
      addGroupModal.classList.remove('show');
    });
  }
  
  // 点击模态框外部关闭
  if (addGroupModal) {
    addGroupModal.addEventListener('click', (e) => {
      if (e.target === addGroupModal) {
        addGroupModal.classList.remove('show');
      }
    });
  }
  
  // 添加分组表单提交
  if (addGroupForm) {
    addGroupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const groupName = document.getElementById('group-name').value;
      const groupOrder = parseInt(document.getElementById('group-order').value);
      
      try {
        const group = {
          id: 0, // 数据库自动生成
          name: groupName,
          order_index: groupOrder
        };
        
        await invoke('add_group', { group });
        addGroupModal.classList.remove('show');
        addGroupForm.reset();
        await loadFeeds(); // 重新加载RSS源列表和分组
      } catch (error) {
        console.error('Failed to add group:', error);
        alert('添加分组失败: ' + error);
      }
    });
  }
  
  // 编辑分组模态框
  editGroupModal = document.getElementById('edit-group-modal');
  editGroupForm = document.getElementById('edit-group-form');
  
  // 编辑分组模态框关闭事件
  const editGroupClose = editGroupModal.querySelector('.close');
  if (editGroupClose) {
    editGroupClose.addEventListener('click', () => {
      editGroupModal.classList.remove('show');
    });
  }
  
  // 编辑分组取消按钮事件
  const editGroupCancel = editGroupModal.querySelector('.cancel');
  if (editGroupCancel) {
    editGroupCancel.addEventListener('click', () => {
      editGroupModal.classList.remove('show');
    });
  }
  
  // 点击模态框外部关闭
  if (editGroupModal) {
    editGroupModal.addEventListener('click', (e) => {
      if (e.target === editGroupModal) {
        editGroupModal.classList.remove('show');
      }
    });
  }
  
  // 编辑分组表单提交
  if (editGroupForm) {
    editGroupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const groupId = parseInt(document.getElementById('edit-group-id').value);
      const groupName = document.getElementById('edit-group-name').value;
      const groupOrder = parseInt(document.getElementById('edit-group-order').value);
      
      try {
        const group = {
          id: groupId,
          name: groupName,
          order_index: groupOrder
        };
        
        await invoke('update_group', { group });
        editGroupModal.classList.remove('show');
        await loadFeeds(); // 重新加载RSS源列表和分组
      } catch (error) {
        console.error('Failed to update group:', error);
        alert('更新分组失败: ' + error);
      }
    });
  }
  
  // 删除分组模态框
  deleteGroupModal = document.getElementById('delete-group-modal');
  confirmDeleteGroupBtn = document.getElementById('confirm-delete-group');
  
  // 删除分组模态框关闭事件
  const deleteGroupClose = deleteGroupModal.querySelector('.close');
  if (deleteGroupClose) {
    deleteGroupClose.addEventListener('click', () => {
      deleteGroupModal.classList.remove('show');
    });
  }
  
  // 删除分组取消按钮事件
  const deleteGroupCancel = deleteGroupModal.querySelector('.cancel');
  if (deleteGroupCancel) {
    deleteGroupCancel.addEventListener('click', () => {
      deleteGroupModal.classList.remove('show');
    });
  }
  
  // 点击模态框外部关闭
  if (deleteGroupModal) {
    deleteGroupModal.addEventListener('click', (e) => {
      if (e.target === deleteGroupModal) {
        deleteGroupModal.classList.remove('show');
      }
    });
  }
  
  // 确认删除分组事件
  if (confirmDeleteGroupBtn) {
    confirmDeleteGroupBtn.addEventListener('click', async () => {
      const groupId = parseInt(document.getElementById('delete-group-id').value);
      
      try {
        await invoke('delete_group', { groupId });
        deleteGroupModal.classList.remove('show');
        await loadFeeds(); // 重新加载RSS源列表和分组
      } catch (error) {
        console.error('Failed to delete group:', error);
        alert('删除分组失败: ' + error);
      }
    });
  }
  
  // 编辑订阅源模态框
  editFeedModal = document.getElementById('edit-feed-modal');
  editFeedForm = document.getElementById('edit-feed-form');
  
  // 编辑订阅源模态框关闭事件
  const editFeedClose = editFeedModal.querySelector('.close');
  if (editFeedClose) {
    editFeedClose.addEventListener('click', () => {
      editFeedModal.classList.remove('show');
    });
  }
  
  // 编辑订阅源取消按钮事件
  const editFeedCancel = editFeedModal.querySelector('.cancel');
  if (editFeedCancel) {
    editFeedCancel.addEventListener('click', () => {
      editFeedModal.classList.remove('show');
    });
  }
  
  // 点击模态框外部关闭
  if (editFeedModal) {
    editFeedModal.addEventListener('click', (e) => {
      if (e.target === editFeedModal) {
        editFeedModal.classList.remove('show');
      }
    });
  }
  
  // 编辑订阅源表单提交
  if (editFeedForm) {
    editFeedForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const feedId = parseInt(document.getElementById('edit-feed-id').value);
      const feedName = document.getElementById('edit-feed-name').value;
      const feedUrl = document.getElementById('edit-feed-url').value;
      const feedGroup = document.getElementById('edit-feed-group').value;
      
      try {
        const translateEnabled = document.getElementById('edit-translate-enabled').checked;
      
      const feed = {
          id: feedId,
          name: feedName,
          url: feedUrl,
          group_id: feedGroup ? parseInt(feedGroup) : null,
          last_updated: null, // 由后端更新
          translate_enabled: translateEnabled
        };
        
        await invoke('update_feed', { feed });
        editFeedModal.classList.remove('show');
        await loadFeeds(); // 重新加载RSS源列表和分组
        await loadFilteredArticles(); // 重新加载文章列表
      } catch (error) {
        console.error('Failed to update feed:', error);
        alert('更新订阅源失败: ' + error);
      }
    });
  }
  
  // 删除订阅源模态框
  deleteFeedModal = document.getElementById('delete-feed-modal');
  confirmDeleteFeedBtn = document.getElementById('confirm-delete-feed');
  
  // 删除订阅源模态框关闭事件
  const deleteFeedClose = deleteFeedModal.querySelector('.close');
  if (deleteFeedClose) {
    deleteFeedClose.addEventListener('click', () => {
      deleteFeedModal.classList.remove('show');
    });
  }
  
  // 删除订阅源取消按钮事件
  const deleteFeedCancel = deleteFeedModal.querySelector('.cancel');
  if (deleteFeedCancel) {
    deleteFeedCancel.addEventListener('click', () => {
      deleteFeedModal.classList.remove('show');
    });
  }
  
  // 点击模态框外部关闭
  if (deleteFeedModal) {
    deleteFeedModal.addEventListener('click', (e) => {
      if (e.target === deleteFeedModal) {
        deleteFeedModal.classList.remove('show');
      }
    });
  }
  
  // 确认删除订阅源事件
  if (confirmDeleteFeedBtn) {
    confirmDeleteFeedBtn.addEventListener('click', async () => {
      const feedId = parseInt(document.getElementById('delete-feed-id').value);
      
      try {
        await invoke('delete_feed', { feedId });
        deleteFeedModal.classList.remove('show');
        await loadFeeds(); // 重新加载RSS源列表和分组
        await loadFilteredArticles(); // 重新加载文章列表
      } catch (error) {
        console.error('Failed to delete feed:', error);
        alert('删除订阅源失败: ' + error);
      }
    });
  }

  // 删除文章按钮事件
  deleteAllBtn = document.getElementById('delete-all-btn');
  deleteArticlesModal = document.getElementById('delete-articles-modal');
  confirmDeleteArticlesBtn = document.getElementById('confirm-delete-articles');
  
  // 删除文章按钮点击事件
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', () => {
      // 设置删除类型为全部
      deleteType = 'all';
      // 根据currentFeedId设置删除消息
      const deleteMessage = document.getElementById('delete-articles-message');
      if (currentFeedId) {
        deleteMessage.textContent = '确定要删除当前订阅源的所有文章吗？此操作不可恢复。';
      } else {
        deleteMessage.textContent = '确定要删除所有订阅源的文章吗？此操作不可恢复。';
      }
      deleteArticlesModal.classList.add('show');
    });
  }
  
  // 删除文章模态框关闭事件
  const deleteArticlesClose = deleteArticlesModal.querySelector('.close');
  if (deleteArticlesClose) {
    deleteArticlesClose.addEventListener('click', () => {
      deleteArticlesModal.classList.remove('show');
    });
  }
  
  // 删除文章取消按钮事件
  const deleteArticlesCancel = deleteArticlesModal.querySelector('.cancel');
  if (deleteArticlesCancel) {
    deleteArticlesCancel.addEventListener('click', () => {
      deleteArticlesModal.classList.remove('show');
    });
  }
  
  // 点击模态框外部关闭
  if (deleteArticlesModal) {
    deleteArticlesModal.addEventListener('click', (e) => {
      if (e.target === deleteArticlesModal) {
        deleteArticlesModal.classList.remove('show');
      }
    });
  }
  
  // 确认删除文章事件
  if (confirmDeleteArticlesBtn) {
    confirmDeleteArticlesBtn.addEventListener('click', async () => {
      try {
        if (deleteType === 'single' && currentDeletingArticleId) {
          // 删除单篇文章
          await invoke('delete_article', { articleId: currentDeletingArticleId });
          // 清空当前文章内容显示
          document.getElementById('article-title').textContent = '';
          document.getElementById('article-body').innerHTML = '<div class="empty-state"><p>请选择一篇文章阅读</p></div>';
          document.getElementById('article-meta').innerHTML = '';
        } else {
          // 删除所有文章
          await invoke('delete_articles', { feedId: currentFeedId });
        }
        
        deleteArticlesModal.classList.remove('show');
        await loadFilteredArticles(); // 重新加载文章列表
        await updateUnreadCounts(); // 更新未读计数
      } catch (error) {
        console.error('Failed to delete articles:', error);
        alert('删除文章失败: ' + error);
      }
    });
  }
  
  // 添加滚动事件监听，实现无限滚动
  const articlesContainer = document.getElementById('articles-container');
  if (articlesContainer) {
    // 节流函数，优化滚动事件性能
    function throttle(func, delay) {
      let lastCall = 0;
      return function(...args) {
        const now = new Date().getTime();
        if (now - lastCall < delay) {
          return;
        }
        lastCall = now;
        return func.apply(this, args);
      };
    }
    
    // 滚动事件处理函数
    const handleScroll = throttle(() => {
      // 检查是否滚动到底部附近（100px以内）
      const { scrollTop, scrollHeight, clientHeight } = articlesContainer;
      if (scrollTop + clientHeight >= scrollHeight - 100 && !isLoading && hasMore) {
        currentPage++;
        if (isSearching) {
          performSearch(currentPage, pageSize, true);
        } else {
          loadFilteredArticles(currentPage, pageSize, true);
        }
      }
    }, 200);
    
    articlesContainer.addEventListener('scroll', handleScroll);
  }
}

// 加载RSS源列表
async function loadFeeds() {
  try {
    console.log('开始加载RSS源列表...');
    // 获取所有分组和RSS源
    const [feeds, groups] = await Promise.all([
      invoke('get_all_feeds'),
      invoke('get_all_groups')
    ]);
    
    console.log('成功加载RSS源列表:', feeds.length, '个源');
    console.log('成功加载分组列表:', groups.length, '个分组');
    
    // 更新订阅源ID到名称的映射
    feedMap.clear();
    feeds.forEach(feed => {
      feedMap.set(feed.id, feed.name);
    });
    
    const feedGroups = document.querySelector('.feed-groups');
    
    // 清空现有源列表（保留"全部"分组）
    const allFeedsGroup = document.getElementById('all-feeds');
    feedGroups.innerHTML = '';
    feedGroups.appendChild(allFeedsGroup);
    
    // 绑定"全部"分组点击事件
    allFeedsGroup.addEventListener('click', () => {
        document.querySelectorAll('.feed-item, .group').forEach(item => {
            item.classList.remove('active');
        });
        allFeedsGroup.classList.add('active');
        
        document.getElementById('current-feed-name').textContent = '全部文章';
        currentFeedId = null;
        currentGroupId = null;
        resetArticles(); // 重置文章列表状态
        loadFilteredArticles(currentPage, pageSize);
    });
    
    // 将RSS源按分组ID分组
    const feedsByGroup = {};
    feeds.forEach(feed => {
      const groupId = feed.group_id || 'ungrouped';
      if (!feedsByGroup[groupId]) {
        feedsByGroup[groupId] = [];
      }
      feedsByGroup[groupId].push(feed);
    });
    
    // 添加分组和对应的RSS源
    groups.forEach(group => {
      // 创建分组元素
      const groupElement = document.createElement('div');
      groupElement.className = 'group';
      groupElement.dataset.groupId = group.id;
      
      // 创建分组头部
      const groupHeader = document.createElement('div');
      groupHeader.className = 'group-header';
      groupHeader.innerHTML = `
        <span class="group-name">${group.name}</span>
        <span class="unread-count group-unread" id="group-unread-${group.id}">0</span>
        <span class="group-actions">
          <button class="group-action-btn edit-btn" data-group-id="${group.id}">✏️</button>
          <button class="group-action-btn delete-btn" data-group-id="${group.id}">🗑️</button>
        </span>
        <span class="group-toggle">▼</span>
      `;
      
      // 创建分组内容容器
      const groupContent = document.createElement('div');
      groupContent.className = 'group-content';
      
      // 添加分组头部点击事件（展开/折叠）
      groupHeader.addEventListener('click', (e) => {
        // 如果点击的是分组名称或未读计数，切换展开/折叠状态
        if (e.target.classList.contains('group-name') || e.target.classList.contains('unread-count')) {
          groupContent.classList.toggle('collapsed');
          const toggle = groupHeader.querySelector('.group-toggle');
          toggle.textContent = groupContent.classList.contains('collapsed') ? '▶' : '▼';
        }
      });
      
      // 添加分组点击事件（查看该分组下的所有文章）
    groupElement.addEventListener('click', () => {
      document.querySelectorAll('.feed-item, .group').forEach(item => {
        item.classList.remove('active');
      });
      groupElement.classList.add('active');
      
      document.getElementById('current-feed-name').textContent = group.name;
      currentFeedId = null;
      currentGroupId = group.id;
      resetArticles(); // 重置文章列表状态
      loadFilteredArticles(currentPage, pageSize);
    });
      
      // 添加该分组下的RSS源
      const groupFeeds = feedsByGroup[group.id] || [];
      groupFeeds.forEach(feed => {
        const feedItem = document.createElement('div');
        feedItem.className = 'feed-item';
        feedItem.dataset.feedId = feed.id;
        
        // 创建订阅源内容容器
        const feedContent = document.createElement('div');
        feedContent.className = 'feed-content';
        
        const feedName = document.createElement('span');
        feedName.className = 'feed-name';
        feedName.textContent = feed.name;
        
        const unreadCount = document.createElement('span');
        unreadCount.className = 'unread-count';
        unreadCount.textContent = '0'; // 后续更新未读计数
        
        // 创建订阅源操作按钮容器
        const feedActions = document.createElement('div');
        feedActions.className = 'feed-actions';
        feedActions.innerHTML = `
          <button class="feed-action-btn edit-btn" data-feed-id="${feed.id}">✏️</button>
          <button class="feed-action-btn delete-btn" data-feed-id="${feed.id}">🗑️</button>
        `;
        
        feedContent.appendChild(feedName);
        feedContent.appendChild(unreadCount);
        feedItem.appendChild(feedContent);
        feedItem.appendChild(feedActions);
        
        // 添加点击事件
        feedItem.addEventListener('click', (e) => {
          // 如果点击的是操作按钮，不执行订阅源点击事件
          if (e.target.closest('.feed-actions')) {
            return;
          }
          
          e.stopPropagation(); // 阻止事件冒泡到分组
          document.querySelectorAll('.feed-item, .group').forEach(item => {
            item.classList.remove('active');
          });
          feedItem.classList.add('active');
          
          document.getElementById('current-feed-name').textContent = feed.name;
          currentFeedId = feed.id;
          currentGroupId = null;
          resetArticles(); // 重置文章列表状态
          loadFilteredArticles(currentPage, pageSize);
        });
        
        // 添加编辑按钮点击事件
        const feedEditBtn = feedActions.querySelector('.edit-btn');
        if (feedEditBtn) {
          feedEditBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // 阻止事件冒泡到订阅源和分组
            
            // 加载分组列表到下拉选择框
            await loadGroupsToSelect();
            
            // 打开编辑订阅源模态框，并填充现有信息
            document.getElementById('edit-feed-id').value = feed.id;
            document.getElementById('edit-feed-name').value = feed.name;
            document.getElementById('edit-feed-url').value = feed.url;
            document.getElementById('edit-feed-group').value = feed.group_id || '';
            document.getElementById('edit-translate-enabled').checked = feed.translate_enabled || false;
            editFeedModal.classList.add('show');
          });
        }
        
        // 添加删除按钮点击事件
        const feedDeleteBtn = feedActions.querySelector('.delete-btn');
        if (feedDeleteBtn) {
          feedDeleteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡到订阅源和分组
            
            // 打开删除订阅源确认模态框
            document.getElementById('delete-feed-id').value = feed.id;
            document.getElementById('delete-feed-name').textContent = feed.name;
            deleteFeedModal.classList.add('show');
          });
        }
        
        groupContent.appendChild(feedItem);
      });
      
      // 添加编辑按钮点击事件
      const editBtn = groupHeader.querySelector('.edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // 阻止事件冒泡到分组
          // 打开编辑分组模态框
          document.getElementById('edit-group-id').value = group.id;
          document.getElementById('edit-group-name').value = group.name;
          document.getElementById('edit-group-order').value = group.order_index;
          editGroupModal.classList.add('show');
        });
      }
      
      // 添加删除按钮点击事件
      const deleteBtn = groupHeader.querySelector('.delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // 阻止事件冒泡到分组
          // 打开删除分组确认模态框
          document.getElementById('delete-group-id').value = group.id;
          document.getElementById('delete-group-name').textContent = group.name;
          deleteGroupModal.classList.add('show');
        });
      }
      
      // 组装分组元素
      groupElement.appendChild(groupHeader);
      groupElement.appendChild(groupContent);
      feedGroups.appendChild(groupElement);
    });
    
    // 添加未分组的RSS源
    const ungroupedFeeds = feedsByGroup['ungrouped'] || [];
    if (ungroupedFeeds.length > 0) {
      // 创建未分组元素
      const ungroupedElement = document.createElement('div');
      ungroupedElement.className = 'group';
      ungroupedElement.dataset.groupId = 'ungrouped';
      
      // 创建未分组头部
      const ungroupedHeader = document.createElement('div');
      ungroupedHeader.className = 'group-header';
      ungroupedHeader.innerHTML = `
        <span class="group-name">未分组</span>
        <span class="unread-count group-unread" id="group-unread-ungrouped">0</span>
        <span class="group-toggle">▼</span>
      `;
      
      // 创建未分组内容容器
      const ungroupedContent = document.createElement('div');
      ungroupedContent.className = 'group-content';
      
      // 添加未分组头部点击事件（展开/折叠）
      ungroupedHeader.addEventListener('click', (e) => {
        // 如果点击的是分组名称或未读计数，切换展开/折叠状态
        if (e.target.classList.contains('group-name') || e.target.classList.contains('unread-count')) {
          ungroupedContent.classList.toggle('collapsed');
          const toggle = ungroupedHeader.querySelector('.group-toggle');
          toggle.textContent = ungroupedContent.classList.contains('collapsed') ? '▶' : '▼';
        }
      });
      
      // 添加未分组点击事件
    ungroupedElement.addEventListener('click', () => {
      document.querySelectorAll('.feed-item, .group').forEach(item => {
        item.classList.remove('active');
      });
      ungroupedElement.classList.add('active');
      
      document.getElementById('current-feed-name').textContent = '未分组';
      currentFeedId = null;
      currentGroupId = 'ungrouped';
      resetArticles(); // 重置文章列表状态
      loadFilteredArticles(currentPage, pageSize);
    });
      
      // 添加未分组的RSS源
      ungroupedFeeds.forEach(feed => {
        const feedItem = document.createElement('div');
        feedItem.className = 'feed-item';
        feedItem.dataset.feedId = feed.id;
        
        // 创建订阅源内容容器
        const feedContent = document.createElement('div');
        feedContent.className = 'feed-content';
        
        const feedName = document.createElement('span');
        feedName.className = 'feed-name';
        feedName.textContent = feed.name;
        
        const unreadCount = document.createElement('span');
        unreadCount.className = 'unread-count';
        unreadCount.textContent = '0'; // 后续更新未读计数
        
        // 创建订阅源操作按钮容器
        const feedActions = document.createElement('div');
        feedActions.className = 'feed-actions';
        feedActions.innerHTML = `
          <button class="feed-action-btn edit-btn" data-feed-id="${feed.id}">✏️</button>
          <button class="feed-action-btn delete-btn" data-feed-id="${feed.id}">🗑️</button>
        `;
        
        feedContent.appendChild(feedName);
        feedContent.appendChild(unreadCount);
        feedItem.appendChild(feedContent);
        feedItem.appendChild(feedActions);
        
        // 添加点击事件
        feedItem.addEventListener('click', (e) => {
          // 如果点击的是操作按钮，不执行订阅源点击事件
          if (e.target.closest('.feed-actions')) {
            return;
          }
          
          e.stopPropagation(); // 阻止事件冒泡到分组
          document.querySelectorAll('.feed-item, .group').forEach(item => {
            item.classList.remove('active');
          });
          feedItem.classList.add('active');
          
          document.getElementById('current-feed-name').textContent = feed.name;
          currentFeedId = feed.id;
          currentGroupId = null;
          currentPage = 1; // 重置页码
          loadFilteredArticles(currentPage, pageSize);
        });
        
        // 添加编辑按钮点击事件
        const feedEditBtn = feedActions.querySelector('.edit-btn');
        if (feedEditBtn) {
          feedEditBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // 阻止事件冒泡到订阅源和分组
            
            // 加载分组列表到下拉选择框
            await loadGroupsToSelect();
            
            // 打开编辑订阅源模态框，并填充现有信息
            document.getElementById('edit-feed-id').value = feed.id;
            document.getElementById('edit-feed-name').value = feed.name;
            document.getElementById('edit-feed-url').value = feed.url;
            document.getElementById('edit-feed-group').value = feed.group_id || '';
            document.getElementById('edit-translate-enabled').checked = feed.translate_enabled || false;
            editFeedModal.classList.add('show');
          });
        }
        
        // 添加删除按钮点击事件
        const feedDeleteBtn = feedActions.querySelector('.delete-btn');
        if (feedDeleteBtn) {
          feedDeleteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡到订阅源和分组
            
            // 打开删除订阅源确认模态框
            document.getElementById('delete-feed-id').value = feed.id;
            document.getElementById('delete-feed-name').textContent = feed.name;
            deleteFeedModal.classList.add('show');
          });
        }
        
        ungroupedContent.appendChild(feedItem);
      });
      
      // 组装未分组元素
      ungroupedElement.appendChild(ungroupedHeader);
      ungroupedElement.appendChild(ungroupedContent);
      feedGroups.appendChild(ungroupedElement);
    }
    
    // 更新未读计数
    await updateUnreadCounts();
  } catch (error) {
    console.error('加载RSS源列表失败:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    const errorMessage = `加载RSS源列表失败: ${error.message || '未知错误'}`;
    const errorStateDiv = document.createElement('div');
    errorStateDiv.className = 'error-state';
    
    const errorParagraph = document.createElement('p');
    errorParagraph.textContent = errorMessage;
    
    const retryButton = document.createElement('button');
    retryButton.textContent = '重试';
    retryButton.addEventListener('click', loadFeeds);
    
    errorStateDiv.appendChild(errorParagraph);
    errorStateDiv.appendChild(retryButton);
    
    document.querySelector('.feed-groups').appendChild(errorStateDiv);
  }
}

// 更新未读计数
async function updateUnreadCounts() {
  try {
    console.log('开始更新未读计数...');
    // 更新"全部"分组的未读计数
    const allUnread = await invoke('get_unread_count', { feedId: null });
    console.log('全部未读计数:', allUnread);
    const allUnreadElement = document.getElementById('all-unread');
    if (allUnreadElement) {
      allUnreadElement.textContent = allUnread;
    } else {
      console.warn('未找到id为all-unread的元素');
    }
    
    // 获取所有分组和RSS源
    const [feeds, groups] = await Promise.all([
      invoke('get_all_feeds'),
      invoke('get_all_groups')
    ]);
    
    // 将RSS源按分组ID分组
    const feedsByGroup = {};
    feeds.forEach(feed => {
      const groupId = feed.group_id || 'ungrouped';
      if (!feedsByGroup[groupId]) {
        feedsByGroup[groupId] = [];
      }
      feedsByGroup[groupId].push(feed);
    });
    
    // 更新每个分组的未读计数
    console.log('开始更新分组未读计数...');
    for (const group of groups) {
      try {
        let groupUnreadCount = 0;
        const groupFeeds = feedsByGroup[group.id] || [];
        
        // 计算该分组下所有源的未读计数之和
        for (const feed of groupFeeds) {
          const unreadCount = await invoke('get_unread_count', { feedId: feed.id });
          groupUnreadCount += unreadCount;
        }
        
        console.log(`分组 ${group.name} (${group.id}) 的未读计数:`, groupUnreadCount);
        const groupUnreadElement = document.getElementById(`group-unread-${group.id}`);
        if (groupUnreadElement) {
          groupUnreadElement.textContent = groupUnreadCount;
        } else {
          console.warn(`未找到分组 ${group.name} (${group.id}) 的未读计数元素`);
        }
      } catch (groupError) {
        console.error(`更新分组 ${group.name} 未读计数失败:`, {
          message: groupError?.message,
          name: groupError?.name,
          stack: groupError?.stack,
          groupId: group.id
        });
      }
    }
    
    // 更新未分组的未读计数
    try {
      let ungroupedUnreadCount = 0;
      const ungroupedFeeds = feedsByGroup['ungrouped'] || [];
      
      // 计算未分组下所有源的未读计数之和
      for (const feed of ungroupedFeeds) {
        const unreadCount = await invoke('get_unread_count', { feedId: feed.id });
        ungroupedUnreadCount += unreadCount;
      }
      
      console.log('未分组的未读计数:', ungroupedUnreadCount);
      const ungroupedUnreadElement = document.getElementById('group-unread-ungrouped');
      if (ungroupedUnreadElement) {
        ungroupedUnreadElement.textContent = ungroupedUnreadCount;
      }
    } catch (ungroupedError) {
      console.error('更新未分组未读计数失败:', {
        message: ungroupedError?.message,
        name: ungroupedError?.name,
        stack: ungroupedError?.stack
      });
    }
    
    // 更新每个源的未读计数
    console.log('开始更新', feeds.length, '个源的未读计数');
    for (const feed of feeds) {
      try {
        const unreadCount = await invoke('get_unread_count', { feedId: feed.id });
        console.log(`源 ${feed.name} (${feed.id}) 的未读计数:`, unreadCount);
        const feedItem = document.querySelector(`.feed-item[data-feed-id="${feed.id}"] .unread-count`);
        if (feedItem) {
          feedItem.textContent = unreadCount;
        } else {
          console.warn(`未找到源 ${feed.name} (${feed.id}) 的未读计数元素`);
        }
      } catch (feedError) {
        console.error(`更新源 ${feed.name} 未读计数失败:`, {
          message: feedError?.message,
          name: feedError?.name,
          stack: feedError?.stack,
          feedId: feed.id
        });
      }
    }
    console.log('未读计数更新完成');
  } catch (error) {
    console.error('更新未读计数失败:', {
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      error: error
    });
    // 移除alert，避免阻塞用户体验
  }
}

// 加载文章列表
async function loadArticles(feedId = null, page = 1, size = pageSize) {
  try {
    console.log('开始加载文章列表...', { feedId, page, size });
    let articles;
    const offset = (page - 1) * size;
    
    if (feedId) {
      // 获取特定RSS源的文章
      articles = await invoke('get_articles_by_feed', { feedId: feedId, limit: size, offset: offset });
      console.log(`成功加载RSS源 ${feedId} 的文章列表:`, articles.length, '篇文章');
    } else {
      // 获取所有文章
      articles = await invoke('get_all_articles', { limit: size, offset: offset });
      console.log('成功加载所有文章列表:', articles.length, '篇文章');
    }
    
    const articlesContainer = document.getElementById('articles-container');
    articlesContainer.innerHTML = '';
    
    if (articles.length === 0) {
      articlesContainer.innerHTML = '<div class="empty-state"><p>暂无文章</p></div>';
      return;
    }
    
    articles.forEach(article => {
      const articleItem = document.createElement('div');
      articleItem.className = `article-item ${article.is_read ? '' : 'unread'}`;
      articleItem.dataset.articleId = article.id;
      
      // 缩略图
      let thumbnailHtml = '';
      if (article.thumbnail) {
        thumbnailHtml = `<img src="${article.thumbnail}" alt="Thumbnail" class="article-thumbnail">`;
      }
      
      // 收藏图标
      const favoriteIcon = article.is_favorite ? '<span class="article-item-favorite">❤️</span>' : '';
      
      // 优先使用翻译后的标题
      const listTitle = article.translated_title || article.title;
      // 获取订阅源名称
      const feedName = feedMap.get(article.feed_id) || '未知来源';
      articleItem.innerHTML = `
        ${thumbnailHtml}
        <div class="article-info">
          <h3 class="article-item-title">${listTitle}</h3>
          <div class="article-item-meta">
            <span>${new Date(article.pub_date).toLocaleString()}</span>
            <span class="article-source">${feedName}</span>
            ${favoriteIcon}
          </div>
        </div>
      `;
      
      // 添加点击事件
      articleItem.addEventListener('click', () => {
        loadArticleContent(article);
      });
      
      articlesContainer.appendChild(articleItem);
    });
  } catch (error) {
    console.error('加载文章列表失败:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      feedId: feedId
    });
    alert('加载文章列表失败: ' + error.message);
  }
}

// 加载文章内容
async function loadArticleContent(article) {
  try {
    console.log('开始加载文章内容...', { articleId: article.id });
    // 更新文章内容区域，优先使用翻译后的内容
  let titleToShow = article.translated_title || article.title;
  // 去除标题中的回车换行符
  titleToShow = titleToShow.replace(/[\r\n]+/g, ' ').trim();
  const contentToShow = article.translated_content || article.content;
  document.getElementById('article-title').textContent = titleToShow;
  document.getElementById('article-body').innerHTML = contentToShow;
  // 获取订阅源名称
  const feedName = feedMap.get(article.feed_id) || '未知来源';
  document.getElementById('article-meta').innerHTML = `
    <span>作者: ${article.author || '未知'}</span>
    <span>发布时间: ${new Date(article.pub_date).toLocaleString()}</span>
    <span>来源: ${feedName}</span>
  `;
    
    // 更新文章操作按钮状态
    const markReadBtn = document.getElementById('mark-read-btn');
    const favoriteBtn = document.getElementById('favorite-btn');
    const openLinkBtn = document.getElementById('open-link-btn');
    
    if (markReadBtn) {
      markReadBtn.className = article.is_read ? 'active' : '';
      markReadBtn.textContent = article.is_read ? '✓ 已读' : '○ 未读';
      
      // 绑定标记已读事件
        markReadBtn.onclick = async () => {
          try {
            const newStatus = !article.is_read;
            await invoke('mark_article_as_read', { articleId: article.id, isRead: newStatus });
            console.log(`文章 ${article.id} 已标记为${newStatus ? '已读' : '未读'}`);
            article.is_read = newStatus;
            markReadBtn.className = newStatus ? 'active' : '';
            markReadBtn.textContent = newStatus ? '✓ 已读' : '○ 未读';
            await updateUnreadCounts();
            
            // 更新文章列表中的状态
            const articleItem = document.querySelector(`.article-item[data-article-id="${article.id}"]`);
            if (articleItem) {
              if (newStatus) {
                articleItem.classList.remove('unread');
              } else {
                articleItem.classList.add('unread');
              }
            }
          } catch (error) {
            console.error('标记文章已读状态失败:', {
              message: error.message,
              name: error.name,
              stack: error.stack,
              articleId: article.id
            });
            alert('标记文章已读状态失败: ' + error.message);
          }
        };
    }
    
    if (favoriteBtn) {
      favoriteBtn.className = article.is_favorite ? 'favorite' : '';
      favoriteBtn.textContent = article.is_favorite ? '❤️ 已收藏' : '🤍 收藏';
      
      // 绑定收藏事件
        favoriteBtn.onclick = async () => {
          try {
            const newStatus = !article.is_favorite;
            await invoke('toggle_favorite', { articleId: article.id, isFavorite: newStatus });
            console.log(`文章 ${article.id} 已${newStatus ? '收藏' : '取消收藏'}`);
            article.is_favorite = newStatus;
            favoriteBtn.className = newStatus ? 'favorite' : '';
            favoriteBtn.textContent = newStatus ? '❤️ 已收藏' : '🤍 收藏';
            
            // 更新文章列表中的收藏图标
            const articleItem = document.querySelector(`.article-item[data-article-id="${article.id}"]`);
            if (articleItem) {
              const favoriteIcon = articleItem.querySelector('.article-item-favorite');
              if (newStatus) {
                if (!favoriteIcon) {
                  const icon = document.createElement('span');
                  icon.className = 'article-item-favorite';
                  icon.textContent = '❤️';
                  articleItem.querySelector('.article-item-meta').appendChild(icon);
                }
              } else {
                if (favoriteIcon) {
                  favoriteIcon.remove();
                }
              }
            }
          } catch (error) {
            console.error('标记文章收藏状态失败:', {
              message: error.message,
              name: error.name,
              stack: error.stack,
              articleId: article.id
            });
            alert('标记文章收藏状态失败: ' + error.message);
          }
        };
    }
    
    if (openLinkBtn) {
      openLinkBtn.onclick = async () => {
        try {
          await invoke('open_link', { url: article.link });
        } catch (error) {
          console.error('打开链接失败:', error);
          alert('打开链接失败: ' + error.message);
        }
      };
    }
    
    // 删除文章按钮事件
    const deleteArticleBtn = document.getElementById('delete-article-btn');
    if (deleteArticleBtn) {
      deleteArticleBtn.onclick = () => {
        // 设置删除类型为单篇
        deleteType = 'single';
        // 设置当前要删除的文章ID
        currentDeletingArticleId = article.id;
        // 显示删除确认对话框
        const deleteMessage = document.getElementById('delete-articles-message');
        deleteMessage.textContent = '确定要删除这篇文章吗？此操作不可恢复。';
        deleteArticlesModal.classList.add('show');
      };
    }
    
    // 标记为已读
    if (!article.is_read) {
      try {
        console.log('准备自动标记文章为已读:', { article });
        await invoke('mark_article_as_read', { articleId: article.id, isRead: true });
        console.log(`文章 ${article.id} 已自动标记为已读`);
        article.is_read = true;
        if (markReadBtn) {
          markReadBtn.className = 'active';
          markReadBtn.textContent = '✓ 已读';
        }
        await updateUnreadCounts();
        
        // 更新文章列表中的状态
        const articleItem = document.querySelector(`.article-item[data-article-id="${article.id}"]`);
        if (articleItem) {
          articleItem.classList.remove('unread');
        }
      } catch (error) {
        console.error('自动标记文章为已读失败:', {
          message: error?.message,
          name: error?.name,
          stack: error?.stack,
          articleId: article.id,
          error: error
        });
      }
    }
    console.log('文章内容加载完成:', article.id);
  } catch (error) {
    console.error('加载文章内容失败:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      article: article ? article.id : '未知'
    });
    alert('加载文章内容失败: ' + error.message);
  }
}

// 搜索功能的实现已经在initEventListeners函数中完成

// 文章过滤功能的实现已经在initEventListeners函数中完成

// 加载过滤后的文章
async function loadFilteredArticles(page = 1, size = pageSize, append = false) {
  // 如果正在加载或者没有更多数据，直接返回
  if (isLoading || !hasMore) {
    return;
  }
  
  try {
    isLoading = true;
    console.log('开始加载过滤后的文章...', { filter: currentFilter, feedId: currentFeedId, groupId: currentGroupId, page, size, append });
    const articlesContainer = document.getElementById('articles-container');
    
    // 如果不是追加模式，清空容器，重置状态
    if (!append) {
      articlesContainer.innerHTML = '';
      currentPage = 1;
      hasMore = true;
    }
    
    let articles;
    const offset = (page - 1) * size;
    
    // 根据过滤条件获取文章
    switch (currentFilter) {
      case 'unread':
        if (currentFeedId) {
          // 获取特定源的所有文章，然后过滤未读
          // 注意：这里我们先获取所有文章，然后过滤，因为我们需要知道总文章数
          // 后续可以优化为直接从数据库获取总未读数
          const allArticles = await invoke('get_articles_by_feed', { feedId: currentFeedId, limit: 1000, offset: 0 });
          const filteredArticles = allArticles.filter(article => !article.is_read);
          totalArticles = filteredArticles.length;
          totalPages = Math.ceil(totalArticles / size);
          // 截取当前页的文章
          articles = filteredArticles.slice(offset, offset + size);
          console.log(`成功加载源 ${currentFeedId} 的未读文章:`, articles.length, '篇');
        } else {
          // 直接获取未读文章
          articles = await invoke('get_unread_articles', { limit: size, offset: offset });
          // 这里我们需要知道总未读数，暂时先使用一个较大的limit获取所有未读文章数
          const allUnreadArticles = await invoke('get_unread_articles', { limit: 1000, offset: 0 });
          totalArticles = allUnreadArticles.length;
          totalPages = Math.ceil(totalArticles / size);
          console.log('成功加载所有未读文章:', articles.length, '篇');
        }
        break;
      case 'favorite':
        if (currentFeedId) {
          // 获取特定源的所有文章，然后过滤收藏
          const allArticles = await invoke('get_articles_by_feed', { feedId: currentFeedId, limit: 1000, offset: 0 });
          const filteredArticles = allArticles.filter(article => article.is_favorite);
          totalArticles = filteredArticles.length;
          totalPages = Math.ceil(totalArticles / size);
          // 截取当前页的文章
          articles = filteredArticles.slice(offset, offset + size);
          console.log(`成功加载源 ${currentFeedId} 的收藏文章:`, articles.length, '篇');
        } else {
          // 直接获取收藏文章
          articles = await invoke('get_favorite_articles', { limit: size, offset: offset });
          // 获取总收藏数
          const allFavoriteArticles = await invoke('get_favorite_articles', { limit: 1000, offset: 0 });
          totalArticles = allFavoriteArticles.length;
          totalPages = Math.ceil(totalArticles / size);
          console.log('成功加载所有收藏文章:', articles.length, '篇');
        }
        break;
      default:
        if (currentFeedId) {
          // 获取特定源的文章
          articles = await invoke('get_articles_by_feed', { feedId: currentFeedId, limit: size, offset: offset });
          // 获取总文章数
          const allArticles = await invoke('get_articles_by_feed', { feedId: currentFeedId, limit: 1000, offset: 0 });
          totalArticles = allArticles.length;
          totalPages = Math.ceil(totalArticles / size);
          console.log(`成功加载源 ${currentFeedId} 的文章:`, articles.length, '篇');
        } else {
          // 获取所有文章
          articles = await invoke('get_all_articles', { limit: size, offset: offset });
          // 获取总文章数
          const allArticles = await invoke('get_all_articles', { limit: 1000, offset: 0 });
          totalArticles = allArticles.length;
          totalPages = Math.ceil(totalArticles / size);
          console.log('成功加载所有文章:', articles.length, '篇');
        }
    }
    
    // 如果有分组过滤，进一步筛选文章
    if (currentGroupId) {
      // 获取分组下的所有RSS源
      const groupFeeds = currentGroupId === 'ungrouped' 
        ? (await invoke('get_all_feeds')).filter(feed => !feed.group_id)
        : await invoke('get_feeds_by_group', { groupId: currentGroupId });
      
      // 获取这些源的ID
      const groupFeedIds = groupFeeds.map(feed => feed.id);
      
      // 重新获取所有文章，然后过滤分组，以便准确计算总页数
      let allFilteredArticles;
      switch (currentFilter) {
        case 'unread':
          if (currentFeedId) {
            const allArticles = await invoke('get_articles_by_feed', { feedId: currentFeedId, limit: 1000, offset: 0 });
            allFilteredArticles = allArticles.filter(article => !article.is_read && groupFeedIds.includes(article.feed_id));
          } else {
            const allUnread = await invoke('get_unread_articles', { limit: 1000, offset: 0 });
            allFilteredArticles = allUnread.filter(article => groupFeedIds.includes(article.feed_id));
          }
          break;
        case 'favorite':
          if (currentFeedId) {
            const allArticles = await invoke('get_articles_by_feed', { feedId: currentFeedId, limit: 1000, offset: 0 });
            allFilteredArticles = allArticles.filter(article => article.is_favorite && groupFeedIds.includes(article.feed_id));
          } else {
            const allFavorite = await invoke('get_favorite_articles', { limit: 1000, offset: 0 });
            allFilteredArticles = allFavorite.filter(article => groupFeedIds.includes(article.feed_id));
          }
          break;
        default:
          if (currentFeedId) {
            const allArticles = await invoke('get_articles_by_feed', { feedId: currentFeedId, limit: 1000, offset: 0 });
            allFilteredArticles = allArticles.filter(article => groupFeedIds.includes(article.feed_id));
          } else {
            const allArticles = await invoke('get_all_articles', { limit: 1000, offset: 0 });
            allFilteredArticles = allArticles.filter(article => groupFeedIds.includes(article.feed_id));
          }
      }
      
      // 更新总文章数和总页数
      totalArticles = allFilteredArticles.length;
      totalPages = Math.ceil(totalArticles / size);
      
      // 截取当前页的文章
      articles = allFilteredArticles.slice(offset, offset + size);
      console.log(`成功过滤分组 ${currentGroupId} 的文章:`, articles.length, '篇');
    }
    
    // 如果是第一页且没有文章，显示空状态
    if (page === 1 && articles.length === 0) {
      articlesContainer.innerHTML = '<div class="empty-state"><p>暂无文章</p></div>';
      return;
    }
    
    // 渲染文章列表
    articles.forEach(article => {
      const articleItem = document.createElement('div');
      articleItem.className = `article-item ${article.is_read ? '' : 'unread'}`;
      articleItem.dataset.articleId = article.id;
      
      // 缩略图
      let thumbnailHtml = '';
      if (article.thumbnail) {
        thumbnailHtml = `<img src="${article.thumbnail}" alt="Thumbnail" class="article-thumbnail">`;
      }
      
      // 收藏图标
      const favoriteIcon = article.is_favorite ? '<span class="article-item-favorite">❤️</span>' : '';
      
      // 优先使用翻译后的标题
      const listTitle = article.translated_title || article.title;
      // 获取订阅源名称
      const feedName = feedMap.get(article.feed_id) || '未知来源';
      articleItem.innerHTML = `
        ${thumbnailHtml}
        <div class="article-info">
          <h3 class="article-item-title">${listTitle}</h3>
          <div class="article-item-meta">
            <span>${new Date(article.pub_date).toLocaleString()}</span>
            <span class="article-source">${feedName}</span>
            ${favoriteIcon}
          </div>
        </div>
      `;
      
      // 添加点击事件
      articleItem.addEventListener('click', () => {
        loadArticleContent(article);
      });
      
      articlesContainer.appendChild(articleItem);
    });
    
    // 检查是否还有更多数据
    if (articles.length < size || offset + articles.length >= totalArticles) {
      hasMore = false;
      // 移除所有加载状态元素
      const loadingElements = articlesContainer.querySelectorAll('.loading-state');
      loadingElements.forEach(element => element.remove());
    } else {
      // 如果还有更多数据，确保只有一个加载状态元素
      const existingLoadingElements = articlesContainer.querySelectorAll('.loading-state');
      if (existingLoadingElements.length === 0) {
        const loadingElement = document.createElement('div');
        loadingElement.className = 'loading-state';
        loadingElement.innerHTML = '<div class="loading-spinner-small"></div><span class="loading-text">正在加载更多…</span>';
        articlesContainer.appendChild(loadingElement);
      }
    }
    
    console.log('过滤文章加载完成');
  } catch (error) {
    console.error('加载过滤后的文章失败:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      filter: currentFilter,
      feedId: currentFeedId,
      groupId: currentGroupId,
      error: error
    });
    const errorMessage = `加载文章失败: ${error.message || '未知错误'}`;
    const articlesContainer = document.getElementById('articles-container');
    
    // 如果是第一页，显示错误状态
    if (page === 1) {
      articlesContainer.innerHTML = '';
      const errorStateDiv = document.createElement('div');
      errorStateDiv.className = 'error-state';
      
      const errorParagraph = document.createElement('p');
      errorParagraph.textContent = errorMessage;
      
      const retryButton = document.createElement('button');
      retryButton.textContent = '重试';
      retryButton.addEventListener('click', () => loadFilteredArticles(currentPage, pageSize));
      
      errorStateDiv.appendChild(errorParagraph);
      errorStateDiv.appendChild(retryButton);
      articlesContainer.appendChild(errorStateDiv);
    } else {
      // 如果是加载更多时出错，显示错误信息
      const existingLoadingElement = articlesContainer.querySelector('.loading-state');
      if (existingLoadingElement) {
        existingLoadingElement.innerHTML = `<p>加载失败: ${errorMessage}</p><button onclick="loadFilteredArticles(${page}, ${size}, true)">重试</button>`;
      }
    }
  } finally {
    isLoading = false;
  }
}

// 重置文章列表状态
function resetArticles() {
  currentPage = 1;
  hasMore = true;
  isSearching = false;
  isLoading = false;
  const articlesContainer = document.getElementById('articles-container');
  if (articlesContainer) {
    articlesContainer.innerHTML = '<div class="loading-state"><div class="loading-spinner-small"></div><span class="loading-text">正在获取中…</span></div>';
  }
}

// 搜索功能实现
async function performSearch(page = 1, size = pageSize, append = false) {
  try {
    // 如果正在加载或者没有更多数据，直接返回
    if (isLoading || !hasMore) {
      return;
    }
    
    isLoading = true;
    isSearching = true;
    
    const searchInput = document.getElementById('search-input');
    const query = searchInput.value.trim();
    if (!query) {
      return;
    }
    
    console.log('开始搜索文章:', query, { page, size, append });
    const offset = (page - 1) * size;
    const results = await invoke('search_articles', { query, limit: size, offset: offset });
    console.log('搜索完成，找到', results.length, '篇文章');
    
    // 这里我们需要知道总搜索结果数，暂时先使用一个较大的limit获取所有搜索结果数
    const allResults = await invoke('search_articles', { query, limit: 1000, offset: 0 });
    totalArticles = allResults.length;
    totalPages = Math.ceil(totalArticles / size);
    
    const articlesContainer = document.getElementById('articles-container');
    
    // 如果不是追加模式，清空容器，重置状态
    if (!append) {
      articlesContainer.innerHTML = '';
      currentPage = 1;
      hasMore = true;
    }
    
    // 检查是否还有更多数据
    if (results.length < size || offset + results.length >= totalArticles) {
      hasMore = false;
      // 移除加载状态
      const loadingElement = articlesContainer.querySelector('.loading-state');
      if (loadingElement) {
        loadingElement.remove();
      }
    }
    
    if (results.length === 0 && page === 1) {
      articlesContainer.innerHTML = '<div class="empty-state"><p>未找到匹配的文章</p></div>';
      return;
    }
    
    results.forEach(([article, feedName]) => {
      const articleItem = document.createElement('div');
      articleItem.className = `article-item ${article.is_read ? '' : 'unread'}`;
      articleItem.dataset.articleId = article.id;
      
      // 缩略图
      let thumbnailHtml = '';
      if (article.thumbnail) {
        thumbnailHtml = `<img src="${article.thumbnail}" alt="Thumbnail" class="article-thumbnail">`;
      }
      
      // 收藏图标
      const favoriteIcon = article.is_favorite ? '<span class="article-item-favorite">❤️</span>' : '';
      
      // 优先使用翻译后的标题
      const listTitle = article.translated_title || article.title;
      articleItem.innerHTML = `
        ${thumbnailHtml}
        <div class="article-info">
          <h3 class="article-item-title">${listTitle}</h3>
          <div class="article-item-meta">
            <span>${feedName}</span>
            <span>${new Date(article.pub_date).toLocaleString()}</span>
            ${favoriteIcon}
          </div>
        </div>
      `;
      
      // 添加点击事件
      articleItem.addEventListener('click', () => {
        loadArticleContent(article);
      });
      
      articlesContainer.appendChild(articleItem);
    });
    
    // 检查是否还有更多数据
    if (results.length < size || offset + results.length >= totalArticles) {
      hasMore = false;
      // 移除所有加载状态元素
      const loadingElements = articlesContainer.querySelectorAll('.loading-state');
      loadingElements.forEach(element => element.remove());
    } else {
      // 如果还有更多数据，确保只有一个加载状态元素
      const existingLoadingElements = articlesContainer.querySelectorAll('.loading-state');
      if (existingLoadingElements.length === 0) {
        const loadingElement = document.createElement('div');
        loadingElement.className = 'loading-state';
        loadingElement.innerHTML = '<div class="loading-spinner-small"></div><span class="loading-text">正在加载更多…</span>';
        articlesContainer.appendChild(loadingElement);
      }
    }
    
  } catch (error) {
      console.error('搜索文章失败:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      const articlesContainer = document.getElementById('articles-container');
      const errorMessage = `搜索文章失败: ${error.message || '未知错误'}`;
      
      if (page === 1) {
        // 创建错误状态容器
        const errorStateDiv = document.createElement('div');
        errorStateDiv.className = 'error-state';
        
        // 创建错误信息段落
        const errorParagraph = document.createElement('p');
        errorParagraph.textContent = errorMessage;
        
        // 创建重试按钮
        const retryButton = document.createElement('button');
        retryButton.textContent = '重试';
        retryButton.addEventListener('click', () => performSearch(currentPage, pageSize));
        
        // 组装并添加到容器
        errorStateDiv.appendChild(errorParagraph);
        errorStateDiv.appendChild(retryButton);
        articlesContainer.appendChild(errorStateDiv);
      } else {
        // 如果是加载更多时出错，显示错误信息
        const existingLoadingElement = articlesContainer.querySelector('.loading-state');
        if (existingLoadingElement) {
          existingLoadingElement.innerHTML = `<p>加载失败: ${errorMessage}</p><button onclick="performSearch(${page}, ${size}, true)">重试</button>`;
        }
      }
    } finally {
    isLoading = false;
  }
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  
  try {
    await invoke('init_db');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    showNotification('初始化数据库失败: ' + error.message, 'error');
  }
  
  try {
    await invoke('init_ai_translator');
  } catch (error) {
    console.error('Failed to initialize AI translator:', error);
    showNotification('初始化AI翻译器失败: ' + error.message, 'error');
  }
  
  // 初始化AI聊天功能
  initAIChat();
  
  // 监听feed_updated事件
  await listen('feed_updated', (event) => {
    console.log('收到feed_updated事件:', event.payload);
    updateUnreadCounts();
    loadFilteredArticles();
  });
  
  // 监听AI聊天响应事件
  await listen('ai_chat_response', (event) => {
    handleChatResponse(event.payload);
  });
  
  // 监听AI聊天结束事件
  await listen('ai_chat_end', () => {
    console.log('AI聊天结束');
    // 可以在这里添加一些聊天结束后的处理逻辑
  });
  
  // 加载RSS源列表
  await loadFeeds();
  
  // 加载文章列表
  await loadFilteredArticles();
});

// AI聊天功能
let aiChatModal;
let aiChatBtn;
let aiChatMessages;
let aiChatInput;
let sendChatBtn;
let clearChatBtn;
let aiPlatformSelect;
let chatHistory = [];
const MAX_CONTEXT_SIZE = 8192;
const CHAT_HISTORY_KEY = 'ai_chat_history';

// 从localStorage加载聊天记录
function loadChatHistory() {
  try {
    const savedHistory = localStorage.getItem(CHAT_HISTORY_KEY);
    if (savedHistory) {
      const parsedHistory = JSON.parse(savedHistory);
      // 恢复日期对象
      chatHistory = parsedHistory.map(msg => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }));
    }
  } catch (error) {
    console.error('加载聊天记录失败:', error);
    chatHistory = [];
  }
}

// 保存聊天记录到localStorage
function saveChatHistory() {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory));
  } catch (error) {
    console.error('保存聊天记录失败:', error);
  }
}

// 初始化AI聊天功能
function initAIChat() {
  // 加载聊天记录
  loadChatHistory();
  
  // 获取DOM元素
  aiChatModal = document.getElementById('ai-chat-modal');
  aiChatBtn = document.getElementById('ai-chat-btn');
  aiChatMessages = document.getElementById('ai-chat-messages');
  aiChatInput = document.getElementById('ai-chat-input');
  sendChatBtn = document.getElementById('send-chat-btn');
  clearChatBtn = document.getElementById('clear-chat-btn');
  aiPlatformSelect = document.getElementById('ai-platform-select');
  
  // AI聊天按钮点击事件
  if (aiChatBtn) {
    aiChatBtn.addEventListener('click', async () => {
      aiChatModal.classList.add('show');
    // 加载AI平台列表
    await loadAIPlatformsToSelect();
    // 初始化聊天界面
    updateChatMessages();
  });
  }
  
  // 发送消息按钮点击事件
  if (sendChatBtn) {
    sendChatBtn.addEventListener('click', async () => {
      await sendMessage();
    });
  }
  
  // 输入框回车发送消息
  if (aiChatInput) {
    aiChatInput.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        await sendMessage();
      }
    });
  }
  
  // 清理聊天记录按钮点击事件
  if (clearChatBtn) {
    clearChatBtn.addEventListener('click', () => {
      clearChatHistory();
    });
  }
  
  // AI平台选择器change事件
  if (aiPlatformSelect) {
    aiPlatformSelect.addEventListener('change', async (e) => {
      console.log('AI平台已切换，仅影响当前聊天会话');
    });
  }
  
  // 模态框外部点击关闭
  if (aiChatModal) {
    aiChatModal.addEventListener('click', (e) => {
      if (e.target === aiChatModal) {
        aiChatModal.classList.remove('show');
      }
    });
  }
  
  // 关闭按钮点击事件
  const closeBtns = aiChatModal.querySelectorAll('.close');
  closeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      aiChatModal.classList.remove('show');
    });
  });
}

// 加载AI平台列表到选择框
async function loadAIPlatformsToSelect() {
  try {
    const aiPlatforms = await invoke('get_all_ai_platforms');
    const select = aiPlatformSelect;
    
    // 清空现有选项
    select.innerHTML = '';
    
    // 添加AI平台选项
    aiPlatforms.forEach(platform => {
      const option = document.createElement('option');
      option.value = platform.id;
      option.textContent = platform.name;
      select.appendChild(option);
      
      // 如果是默认平台，设置为选中状态
      if (platform.is_default) {
        option.selected = true;
      }
    });
  } catch (error) {
    console.error('加载AI平台列表失败:', error);
  }
}

// 发送消息
async function sendMessage() {
  const message = aiChatInput.value.trim();
  if (!message) return;
  
  // 添加用户消息到聊天历史
  const userMsg = {
    role: 'user',
    content: message,
    timestamp: new Date()
  };
  chatHistory.push(userMsg);
  
  // 更新聊天界面
  updateChatMessages();
  
  // 保存聊天记录
  saveChatHistory();
  
  // 清空输入框
  aiChatInput.value = '';
  
  // 处理上下文大小
  manageChatContext();
  
  // 添加AI正在输入消息
  const aiThinkingMsg = {
    role: 'ai',
    content: '正在思考...',
    timestamp: new Date()
  };
  chatHistory.push(aiThinkingMsg);
  updateChatMessages();
  
  // 保存聊天记录
  saveChatHistory();
  
  // 构建聊天请求，过滤掉临时消息和转换角色
  const messages = chatHistory
    // 过滤掉"正在思考..."消息
    .filter(msg => msg.content !== '正在思考...')
    // 转换角色，将'ai'转换为API接受的'assistant'
    .map(msg => ({
      role: msg.role === 'ai' ? 'assistant' : msg.role,
      content: msg.content
    }));
  
  console.log('发送给API的消息:', messages);
  
  // 获取当前选择的AI平台ID
  const platformId = parseInt(aiPlatformSelect.value);
  
  // 发送聊天请求
  try {
    // 调用后端AI聊天接口
    await invoke('ai_chat', {
      messages: messages,
      maxTokens: 4096,
      temperature: 0.7,
      platformId: platformId
    });
  } catch (error) {
    console.error('AI聊天请求失败:', error);
    // 替换正在思考消息为错误消息
    chatHistory[chatHistory.length - 1].content = `AI聊天失败: ${error.message}`;
    updateChatMessages();
    
    // 保存聊天记录
    saveChatHistory();
  }
}

// 处理聊天响应
function handleChatResponse(content) {
  // 如果最后一条消息是AI正在思考，替换内容
  if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'ai') {
    if (chatHistory[chatHistory.length - 1].content === '正在思考...') {
      // 替换正在思考消息为实际内容
      chatHistory[chatHistory.length - 1].content = content;
      chatHistory[chatHistory.length - 1].timestamp = new Date();
    } else {
      // 追加内容
      chatHistory[chatHistory.length - 1].content += content;
      chatHistory[chatHistory.length - 1].timestamp = new Date();
    }
  } else {
    // 添加新的AI消息
    chatHistory.push({
      role: 'ai',
      content: content,
      timestamp: new Date()
    });
  }
  updateChatMessages();
  // 保存聊天记录
  saveChatHistory();
}

// 更新聊天消息界面
function updateChatMessages() {
  if (!aiChatMessages) return;
  
  // 检查是否为空聊天
  if (chatHistory.length === 0) {
    aiChatMessages.innerHTML = '';
    const emptyChat = document.createElement('div');
    emptyChat.className = 'empty-chat';
    emptyChat.innerHTML = `
      <div class="empty-chat-icon">🤖</div>
      <div class="empty-chat-text">开始与AI聊天</div>
      <div class="empty-chat-subtext">输入您的问题或想法，AI会为您提供帮助</div>
    `;
    aiChatMessages.appendChild(emptyChat);
    return;
  }
  
  // 检查是否需要重新渲染整个聊天历史
  const existingMessages = aiChatMessages.querySelectorAll('.chat-message');
  if (existingMessages.length !== chatHistory.length) {
    // 消息数量变化，重新渲染
    aiChatMessages.innerHTML = '';
    renderAllMessages();
  } else {
    // 只更新最后一条AI消息（如果是AI正在回复）
    updateLastAIMessage();
  }
  
  // 滚动到底部
  aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
}

// 渲染所有聊天消息
function renderAllMessages() {
  chatHistory.forEach(msg => {
    const messageDiv = createMessageElement(msg);
    aiChatMessages.appendChild(messageDiv);
  });
}

// 创建单个消息元素
function createMessageElement(msg) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${msg.role}`;
  messageDiv.dataset.messageIndex = chatHistory.indexOf(msg);
  
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = msg.role === 'user' ? '👤' : '🤖';
  
  const content = document.createElement('div');
  content.className = 'message-content';
  
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = msg.content;
  
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = msg.timestamp.toLocaleTimeString();
  
  content.appendChild(bubble);
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(content);
  messageDiv.appendChild(time);
  
  return messageDiv;
}

// 更新最后一条AI消息
function updateLastAIMessage() {
  const lastMessage = chatHistory[chatHistory.length - 1];
  if (lastMessage.role === 'ai') {
    const existingMessages = aiChatMessages.querySelectorAll('.chat-message');
    const lastElement = existingMessages[existingMessages.length - 1];
    if (lastElement) {
      const bubble = lastElement.querySelector('.message-bubble');
      if (bubble) {
        bubble.textContent = lastMessage.content;
      }
      const time = lastElement.querySelector('.message-time');
      if (time) {
        time.textContent = lastMessage.timestamp.toLocaleTimeString();
      }
    }
  }
}

// 清理聊天历史
function clearChatHistory() {
  chatHistory = [];
  updateChatMessages();
  
  // 保存聊天记录
  saveChatHistory();
}

// 管理聊天上下文，确保不超过最大限制
function manageChatContext() {
  // 计算当前上下文大小
  let contextSize = 0;
  for (const msg of chatHistory) {
    contextSize += msg.content.length;
  }
  
  // 如果超过最大限制，移除最早的消息
  while (contextSize > MAX_CONTEXT_SIZE && chatHistory.length > 2) {
    // 移除第一条消息（保留至少一条用户消息和一条AI消息）
    const removedMsg = chatHistory.shift();
    contextSize -= removedMsg.content.length;
  }
}

// OPML导出功能实现
async function exportOpml() {
  try {
    console.log('开始导出OPML...');
    const opmlContent = await invoke('export_opml');
    console.log('成功获取OPML内容，长度:', opmlContent.length);
    
    // 验证OPML内容格式
    if (!opmlContent.trim().startsWith('<opml')) {
      console.error('OPML内容格式错误，不是有效的OPML:', opmlContent.substring(0, 100));
      throw new Error('导出的OPML内容格式无效');
    }
    
    // 使用简单的下载方式，确保兼容性
    console.log('准备创建下载链接');
    
    // 创建Blob对象
    const blob = new Blob([opmlContent], { type: 'application/xml' });
    
    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rss-subscriptions-${new Date().toISOString().split('T')[0]}.opml`;
    
    // 设置链接样式，确保可见性
    link.style.display = 'block';
    link.style.position = 'absolute';
    link.style.left = '-1000px';
    link.style.top = '-1000px';
    
    // 添加到DOM并触发点击
    document.body.appendChild(link);
    
    // 使用setTimeout确保链接已添加到DOM
    setTimeout(() => {
      console.log('触发下载链接点击');
      link.click();
      
      // 清理资源
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        console.log('已清理下载资源');
      }, 100);
      
      const fileName = `rss-subscriptions-${new Date().toISOString().split('T')[0]}.opml`;
      showNotification(`OPML导出成功\n文件已保存到浏览器默认下载目录\n文件名: ${fileName}`, 'success', 5000);
      console.log('OPML导出流程完成，文件名:', fileName);
    }, 100);
    
  } catch (error) {
    console.error('Failed to export OPML:', error);
    console.error('错误详情:', error.stack);
    showNotification('OPML导出失败: ' + error.message, 'error');
  }
}

// OPML导入功能实现
async function importOpml(file) {
  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const opmlContent = e.target.result;
      const importedCount = await invoke('import_opml', { opmlContent: opmlContent });
      showNotification(`成功导入 ${importedCount} 个RSS源`, 'success');
      await loadFeeds(); // 重新加载RSS源列表
      await loadFilteredArticles(); // 重新加载文章列表
    };
    reader.readAsText(file);
  } catch (error) {
    console.error('Failed to import OPML:', error);
    showNotification('OPML导入失败: ' + error.message, 'error');
  }
}

// 显示通知
function showNotification(message, type = 'info', duration = 3000) {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  // 允许通知内容包含换行
  notification.style.whiteSpace = 'pre-line';
  
  document.body.appendChild(notification);
  
  // 显示通知
  setTimeout(() => {
    notification.classList.add('show');
  }, 100);
  
  // 指定时间后隐藏通知
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, duration);
}

// 加载AI平台列表
async function loadAIPlatforms() {
  try {
    const platforms = await invoke('get_all_ai_platforms');
    aiPlatformsList.innerHTML = '';
    
    if (platforms.length === 0) {
      aiPlatformsList.innerHTML = '<div class="empty-state"><p>暂无AI平台，请添加</p></div>';
      return;
    }
    
    platforms.forEach(platform => {
      const platformItem = document.createElement('div');
      platformItem.className = 'ai-platform-item';
      platformItem.dataset.platformId = platform.id;
      
      const platformContent = document.createElement('div');
      platformContent.className = 'ai-platform-content';
      
      const platformName = document.createElement('h3');
      platformName.className = 'ai-platform-name';
      platformName.textContent = `${platform.name} ${platform.is_default ? '(默认)' : ''}`;
      
      const platformDetails = document.createElement('div');
      platformDetails.className = 'ai-platform-details';
      platformDetails.innerHTML = `
        <p><strong>API URL:</strong> ${platform.api_url}</p>
        <p><strong>API Model:</strong> ${platform.api_model}</p>
      `;
      
      const platformActions = document.createElement('div');
      platformActions.className = 'ai-platform-actions';
      platformActions.innerHTML = `
        <button class="edit-btn" data-platform-id="${platform.id}">✏️ 编辑</button>
        <button class="delete-btn" data-platform-id="${platform.id}">🗑️ 删除</button>
      `;
      
      platformContent.appendChild(platformName);
      platformContent.appendChild(platformDetails);
      platformItem.appendChild(platformContent);
      platformItem.appendChild(platformActions);
      
      // 添加编辑按钮点击事件
      const editBtn = platformActions.querySelector('.edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          // 打开编辑AI平台模态框，并填充现有信息
          currentEditingAIPlatform = platform;
          document.getElementById('edit-ai-platform-id').value = platform.id;
          document.getElementById('edit-ai-platform-name').value = platform.name;
          document.getElementById('edit-ai-platform-url').value = platform.api_url;
          document.getElementById('edit-ai-platform-key').value = platform.api_key;
          document.getElementById('edit-ai-platform-model').value = platform.api_model;
          document.getElementById('edit-ai-platform-is-default').checked = platform.is_default;
          editAIPlatformModal.classList.add('show');
        });
      }
      
      // 添加删除按钮点击事件
      const deleteBtn = platformActions.querySelector('.delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          // 打开删除AI平台确认模态框
          document.getElementById('delete-ai-platform-id').value = platform.id;
          document.getElementById('delete-ai-platform-name').textContent = platform.name;
          deleteAIPlatformModal.classList.add('show');
        });
      }
      
      aiPlatformsList.appendChild(platformItem);
    });
  } catch (error) {
    console.error('Failed to load AI platforms:', error);
    aiPlatformsList.innerHTML = `<div class="error-state"><p>加载AI平台失败: ${error.message || error}</p></div>`;
  }
}
