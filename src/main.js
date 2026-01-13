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

// 标记全部已读相关变量
let markAllReadBtn;

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
        const notificationEnabled = document.getElementById('notification-enabled').checked;
      
      const feed = {
          id: 0, // 数据库自动生成
          name: feedName,
          url: feedUrl,
          group_id: feedGroup ? parseInt(feedGroup) : null,
          last_updated: null,
          translate_enabled: translateEnabled,
          notification_enabled: notificationEnabled,
          last_update_status: null,
          update_attempts: 0,
          next_retry_time: null
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
        const notificationEnabled = document.getElementById('edit-notification-enabled').checked;
      
      const feed = {
          id: feedId,
          name: feedName,
          url: feedUrl,
          group_id: feedGroup ? parseInt(feedGroup) : null,
          last_updated: null, // 由后端更新
          translate_enabled: translateEnabled,
          notification_enabled: notificationEnabled,
          last_update_status: null,
          update_attempts: 0,
          next_retry_time: null
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
  
  // 标记全部已读按钮事件
  markAllReadBtn = document.getElementById('mark-all-read-btn');
  
  // 标记全部已读按钮点击事件
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', () => {
      // 根据currentFeedId设置确认消息
      const deleteMessage = document.getElementById('delete-articles-message');
      if (currentFeedId) {
        deleteMessage.textContent = '确定要将当前订阅源的所有文章标记为已读吗？';
      } else {
        deleteMessage.textContent = '确定要将所有订阅源的文章标记为已读吗？';
      }
      // 复用删除文章的模态框，修改标题
      deleteArticlesModal.querySelector('h2').textContent = '标记为已读';
      // 修改确认按钮文本和样式
      const confirmBtn = document.getElementById('confirm-delete-articles');
      confirmBtn.textContent = '标记为已读';
      confirmBtn.classList.remove('danger');
      confirmBtn.classList.add('success');
      // 保存当前操作类型
      deleteType = 'mark-read-all';
      deleteArticlesModal.classList.add('show');
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
        } else if (deleteType === 'mark-read-all') {
          // 标记全部已读
          await invoke('mark_all_articles_as_read', { feedId: currentFeedId });
        } else {
          // 删除所有文章
          await invoke('delete_articles', { feedId: currentFeedId });
        }
        
        deleteArticlesModal.classList.remove('show');
        await loadFilteredArticles(); // 重新加载文章列表
        await updateUnreadCounts(); // 更新未读计数
      } catch (error) {
        console.error('操作失败:', error);
        alert('操作失败: ' + error);
      }
    });
  }
  
  // 模态框关闭时恢复原始样式
  function resetDeleteModal() {
    // 恢复模态框标题
    deleteArticlesModal.querySelector('h2').textContent = '删除文章';
    // 恢复确认按钮样式
    const confirmBtn = document.getElementById('confirm-delete-articles');
    confirmBtn.textContent = '删除';
    confirmBtn.classList.remove('success');
    confirmBtn.classList.add('danger');
    // 恢复默认删除类型
    deleteType = 'all';
  }
  
  // 删除文章模态框关闭事件
  const deleteArticlesClose = deleteArticlesModal.querySelector('.close');
  if (deleteArticlesClose) {
    deleteArticlesClose.addEventListener('click', () => {
      deleteArticlesModal.classList.remove('show');
      resetDeleteModal();
    });
  }
  
  // 删除文章取消按钮事件
  const deleteArticlesCancel = deleteArticlesModal.querySelector('.cancel');
  if (deleteArticlesCancel) {
    deleteArticlesCancel.addEventListener('click', () => {
      deleteArticlesModal.classList.remove('show');
      resetDeleteModal();
    });
  }
  
  // 点击模态框外部关闭
  if (deleteArticlesModal) {
    deleteArticlesModal.addEventListener('click', (e) => {
      if (e.target === deleteArticlesModal) {
        deleteArticlesModal.classList.remove('show');
        resetDeleteModal();
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
            document.getElementById('edit-notification-enabled').checked = feed.notification_enabled !== false;
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
            document.getElementById('edit-notification-enabled').checked = feed.notification_enabled !== false;
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
    
    // 获取所有分组、RSS源和所有源的未读计数
    const [feeds, groups, allUnreadCounts] = await Promise.all([
      invoke('get_all_feeds'),
      invoke('get_all_groups'),
      invoke('get_all_unread_counts') // 一次性获取所有源的未读计数
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
        
        // 从allUnreadCounts中获取该分组下所有源的未读计数之和
        for (const feed of groupFeeds) {
          groupUnreadCount += allUnreadCounts[feed.id] || 0;
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
      
      // 从allUnreadCounts中获取未分组下所有源的未读计数之和
      for (const feed of ungroupedFeeds) {
        ungroupedUnreadCount += allUnreadCounts[feed.id] || 0;
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
        // 直接从allUnreadCounts中获取，避免重复API调用
        const unreadCount = allUnreadCounts[feed.id] || 0;
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
    } else {
      // 如果是追加模式，更新currentPage为当前请求的page
      currentPage = page;
    }
    
    let articles;
    const offset = (page - 1) * size;
    
    // 获取分组下的所有RSS源（如果有分组过滤）
    let groupFeedIds = [];
    if (currentGroupId) {
      const groupFeeds = currentGroupId === 'ungrouped' 
        ? (await invoke('get_all_feeds')).filter(feed => !feed.group_id)
        : await invoke('get_feeds_by_group', { groupId: currentGroupId });
      
      // 获取这些源的ID
      groupFeedIds = groupFeeds.map(feed => feed.id);
    }
    
    // 获取过滤条件下的所有相关文章用于计算总页数
    let allFilteredArticles;
    switch (currentFilter) {
      case 'unread':
        if (currentFeedId) {
          // 获取特定源的所有未读文章
          const allArticles = await invoke('get_articles_by_feed', { feedId: currentFeedId, limit: 1000, offset: 0 });
          allFilteredArticles = groupFeedIds.length > 0 
            ? allArticles.filter(article => !article.is_read && groupFeedIds.includes(article.feed_id))
            : allArticles.filter(article => !article.is_read);
        } else {
          // 获取所有未读文章
          const allArticles = await invoke('get_unread_articles', { limit: 1000, offset: 0 });
          allFilteredArticles = groupFeedIds.length > 0 
            ? allArticles.filter(article => groupFeedIds.includes(article.feed_id))
            : allArticles;
        }
        break;
      case 'favorite':
        if (currentFeedId) {
          // 获取特定源的所有文章
          const allArticles = await invoke('get_articles_by_feed', { feedId: currentFeedId, limit: 1000, offset: 0 });
          allFilteredArticles = groupFeedIds.length > 0 
            ? allArticles.filter(article => article.is_favorite && groupFeedIds.includes(article.feed_id))
            : allArticles.filter(article => article.is_favorite);
        } else {
          // 获取所有收藏文章
          const allArticles = await invoke('get_favorite_articles', { limit: 1000, offset: 0 });
          allFilteredArticles = groupFeedIds.length > 0 
            ? allArticles.filter(article => groupFeedIds.includes(article.feed_id))
            : allArticles;
        }
        break;
      default:
        if (currentFeedId) {
          // 获取特定源的所有文章
          const allArticles = await invoke('get_articles_by_feed', { feedId: currentFeedId, limit: 1000, offset: 0 });
          allFilteredArticles = groupFeedIds.length > 0 
            ? allArticles.filter(article => groupFeedIds.includes(article.feed_id))
            : allArticles;
        } else {
          // 获取所有文章
          const allArticles = await invoke('get_all_articles', { limit: 1000, offset: 0 });
          allFilteredArticles = groupFeedIds.length > 0 
            ? allArticles.filter(article => groupFeedIds.includes(article.feed_id))
            : allArticles;
        }
    }
    
    // 更新总文章数和总页数
    totalArticles = allFilteredArticles.length;
    totalPages = Math.ceil(totalArticles / size);
    
    // 截取当前页的文章
    articles = allFilteredArticles.slice(offset, offset + size);
    console.log(`成功加载文章:`, articles.length, '篇');
    if (groupFeedIds.length > 0) {
      console.log(`成功过滤分组 ${currentGroupId} 的文章:`, articles.length, '篇');
    }
    
    // 更新文章总数显示
    const articleCountElement = document.getElementById('article-count');
    if (articleCountElement) {
      articleCountElement.textContent = `共 ${totalArticles} 篇文章`;
    }
    
    // 如果是第一页且没有文章，显示空状态
    if (page === 1 && articles.length === 0) {
      articlesContainer.innerHTML = '<div class="empty-state"><p>暂无文章</p></div>';
      return;
    }
    
    // 渲染文章列表
    articles.forEach(article => {
      // 检查是否已存在该文章，如果存在则跳过
      if (document.querySelector(`[data-article-id="${article.id}"]`)) {
        console.warn('文章已存在，跳过渲染:', article.id);
        return;
      }
      
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
    
    // 移除所有加载状态元素
    const loadingElements = articlesContainer.querySelectorAll('.loading-state');
    loadingElements.forEach(element => element.remove());
    
    // 检查是否还有更多数据
    hasMore = offset + articles.length < totalArticles;
    
    // 只有在追加模式且有更多数据时，才显示"正在加载更多"提示
    if (append && hasMore) {
      const loadingElement = document.createElement('div');
      loadingElement.className = 'loading-state';
      loadingElement.innerHTML = '<div class="loading-spinner-small"></div><span class="loading-text">正在加载更多…</span>';
      articlesContainer.appendChild(loadingElement);
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
    // 只调用一次search_articles获取所有结果
    const allResults = await invoke('search_articles', { query, limit: 1000, offset: 0, feedId: currentFeedId });
    console.log('搜索完成，找到', allResults.length, '篇文章');
    
    // 计算总页数
    totalArticles = allResults.length;
    totalPages = Math.ceil(totalArticles / size);
    
    // 更新文章总数显示
    const articleCountElement = document.getElementById('article-count');
    if (articleCountElement) {
      articleCountElement.textContent = `共 ${totalArticles} 篇文章`;
    }
    
    const articlesContainer = document.getElementById('articles-container');
    
    // 如果不是追加模式，清空容器，重置状态
    if (!append) {
      articlesContainer.innerHTML = '';
      currentPage = 1;
      hasMore = true;
    }
    
    // 计算当前页的偏移量
    const offset = (page - 1) * size;
    
    // 截取当前页的结果
    const currentPageResults = allResults.slice(offset, offset + size);
    
    // 检查是否还有更多数据
    hasMore = offset + currentPageResults.length < totalArticles;
    
    if (currentPageResults.length === 0 && page === 1) {
      articlesContainer.innerHTML = '<div class="empty-state"><p>未找到匹配的文章</p></div>';
      return;
    }
    
    currentPageResults.forEach(([article, feedName]) => {
      // 检查是否已存在该文章，如果存在则跳过
      if (document.querySelector(`[data-article-id="${article.id}"]`)) {
        console.warn('文章已存在，跳过渲染:', article.id);
        return;
      }
      
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
    
    // 移除所有加载状态元素
    const loadingElements = articlesContainer.querySelectorAll('.loading-state');
    loadingElements.forEach(element => element.remove());
    
    // 只有在追加模式且有更多数据时，才显示"正在加载更多"提示
    if (append && hasMore) {
      const loadingElement = document.createElement('div');
      loadingElement.className = 'loading-state';
      loadingElement.innerHTML = '<div class="loading-spinner-small"></div><span class="loading-text">正在加载更多…</span>';
      articlesContainer.appendChild(loadingElement);
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
  await listen('ai_chat_response', async (event) => {
    await handleChatResponse(event.payload);
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
let chatSessions = [];
let currentSession = null;
const MAX_CONTEXT_SIZE = 8192;

// 文件上传功能
let fileUploadBtn;
let fileUpload;
let filePreviewArea;
let uploadedFiles = [];

// 会话管理DOM元素
let sessionsContainer;
let newChatBtn;
let addSessionBtn;

// 从后端加载所有聊天会话
async function loadChatSessions() {
  try {
    const sessions = await invoke('get_chat_sessions');
    chatSessions = sessions.map(session => ({
      ...session,
      created_at: new Date(session.created_at * 1000),
      updated_at: new Date(session.updated_at * 1000),
      messages: session.messages.map(msg => ({
        ...msg,
        timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
      }))
    }));
    
    // 如果没有会话，创建一个新会话
    if (chatSessions.length === 0) {
      currentSession = await createChatSession();
    } else {
      // 获取最新的会话
      const latestSession = await invoke('get_latest_chat_session');
      if (latestSession) {
        currentSession = {
          ...latestSession,
          created_at: new Date(latestSession.created_at * 1000),
          updated_at: new Date(latestSession.updated_at * 1000),
          messages: latestSession.messages.map(msg => ({
            ...msg,
            timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
          }))
        };
      } else {
        currentSession = chatSessions[0];
      }
    }
    
    // 加载当前会话的聊天历史
    chatHistory = currentSession.messages || [];
    
    // 更新会话列表界面
    updateSessionList();
  } catch (error) {
    console.error('加载聊天会话失败:', error);
    chatSessions = [];
    currentSession = await createChatSession();
  }
}

// 创建新的聊天会话
async function createChatSession(name) {
  try {
    const session = await invoke('create_chat_session', { name });
    const newSession = {
      ...session,
      created_at: new Date(session.created_at * 1000),
      updated_at: new Date(session.updated_at * 1000),
      messages: []
    };
    
    chatSessions.unshift(newSession);
    currentSession = newSession;
    chatHistory = [];
    
    // 更新会话列表界面
    updateSessionList();
    updateChatMessages();
    
    return newSession;
  } catch (error) {
    console.error('创建会话失败:', error);
    return null;
  }
}

// 切换聊天会话
async function switchChatSession(sessionId) {
  try {
    // 保存当前会话
    if (currentSession) {
      await saveChatSession();
    }
    
    // 查找要切换的会话
    const session = chatSessions.find(s => s.id === sessionId);
    if (session) {
      currentSession = session;
      chatHistory = session.messages || [];
      
      // 更新会话列表界面
      updateSessionList();
      updateChatMessages();
    }
  } catch (error) {
    console.error('切换会话失败:', error);
  }
}

// 保存当前聊天会话
async function saveChatSession() {
  try {
    if (currentSession) {
      // 转换聊天消息格式，适配后端预期的格式
      const convertedMessages = chatHistory.map(msg => {
        // 转换消息内容，将前端格式转换为后端格式
        let content;
        if (typeof msg.content === 'string') {
          // 普通文本消息
          content = msg.content;
        } else {
          // 包含文本和文件的消息，只保留文本内容
          content = msg.content.text || '';
        }
        
        return {
          role: msg.role,
          content: content,
          timestamp: msg.timestamp.toISOString()
        };
      });
      
      // 更新会话的消息和更新时间
      const sessionToSave = {
        ...currentSession,
        messages: convertedMessages,
        updated_at: new Date()
      };
      
      // 保存到后端
      await invoke('save_chat_session', {
        session: {
          ...sessionToSave,
          created_at: Math.floor(sessionToSave.created_at.getTime() / 1000),
          updated_at: Math.floor(sessionToSave.updated_at.getTime() / 1000)
        }
      });
      
      // 更新会话列表界面
      updateSessionList();
    }
  } catch (error) {
    console.error('保存会话失败:', error);
  }
}

// 删除聊天会话
async function deleteChatSession(sessionId) {
  try {
    // 确认删除
    if (!confirm('确定要删除这个会话吗？')) {
      return;
    }
    
    // 从后端删除会话
    await invoke('delete_chat_session', { sessionId: sessionId });
    
    // 从本地会话列表中移除
    const sessionIndex = chatSessions.findIndex(s => s.id === sessionId);
    if (sessionIndex !== -1) {
      chatSessions.splice(sessionIndex, 1);
    }
    
    // 如果删除的是当前会话，切换到其他会话
    if (currentSession && currentSession.id === sessionId) {
      if (chatSessions.length > 0) {
        currentSession = chatSessions[0];
        chatHistory = currentSession.messages || [];
      } else {
        currentSession = await createChatSession();
        chatHistory = [];
      }
    }
    
    // 更新会话列表界面
    updateSessionList();
    updateChatMessages();
  } catch (error) {
    console.error('删除会话失败:', error);
  }
}

// 更新聊天会话列表界面
function updateSessionList() {
  if (!sessionsContainer) return;
  
  // 清空会话列表
  sessionsContainer.innerHTML = '';
  
  // 渲染每个会话
  chatSessions.forEach(session => {
    const sessionItem = document.createElement('div');
    sessionItem.className = `session-item ${currentSession && currentSession.id === session.id ? 'active' : ''}`;
    sessionItem.dataset.sessionId = session.id;
    
    // 会话名称元素
    const sessionName = document.createElement('div');
    sessionName.className = 'session-name';
    sessionName.textContent = session.name;
    
    // 会话操作按钮容器
    const sessionActions = document.createElement('div');
    sessionActions.className = 'session-actions';
    
    // 编辑会话按钮
    const editBtn = document.createElement('button');
    editBtn.className = 'session-action-btn';
    editBtn.innerHTML = '✏️';
    editBtn.title = '编辑会话名称';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editSessionName(session.id);
    });
    
    // 删除会话按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'session-action-btn delete';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.title = '删除会话';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChatSession(session.id);
    });
    
    // 添加操作按钮
    sessionActions.appendChild(editBtn);
    sessionActions.appendChild(deleteBtn);
    
    // 添加点击事件，切换会话
    sessionItem.addEventListener('click', () => {
      switchChatSession(session.id);
    });
    
    // 组装会话项
    sessionItem.appendChild(sessionName);
    sessionItem.appendChild(sessionActions);
    
    // 添加到会话列表
    sessionsContainer.appendChild(sessionItem);
  });
}

// 编辑会话名称
function editSessionName(sessionId) {
  const session = chatSessions.find(s => s.id === sessionId);
  if (!session) return;
  
  const sessionItem = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
  const sessionNameElement = sessionItem.querySelector('.session-name');
  
  // 创建输入框
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'session-name editing';
  input.value = session.name;
  input.maxLength = 50;
  
  // 替换文本为输入框
  sessionItem.replaceChild(input, sessionNameElement);
  
  // 自动聚焦并选中文本
  input.focus();
  input.select();
  
  // 处理输入框事件
  const handleBlur = async () => {
    const newName = input.value.trim();
    if (newName && newName !== session.name) {
      try {
        // 更新会话名称
        const updatedSession = await invoke('update_chat_session', {
          sessionId: sessionId,
          name: newName
        });
        
        // 更新本地会话数据
        session.name = newName;
        session.updated_at = new Date();
        
        // 更新会话列表界面
        updateSessionList();
      } catch (error) {
        console.error('更新会话名称失败:', error);
        // 恢复原名称
        input.value = session.name;
      }
    }
    
    // 恢复文本显示
    updateSessionList();
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      // 取消编辑，恢复原名称
      updateSessionList();
    }
  };
  
  // 添加事件监听器
  input.addEventListener('blur', handleBlur);
  input.addEventListener('keydown', handleKeyDown);
}

// 初始化AI聊天功能
function initAIChat() {
  // 获取DOM元素
  aiChatModal = document.getElementById('ai-chat-modal');
  aiChatBtn = document.getElementById('ai-chat-btn');
  aiChatMessages = document.getElementById('ai-chat-messages');
  aiChatInput = document.getElementById('ai-chat-input');
  sendChatBtn = document.getElementById('send-chat-btn');
  clearChatBtn = document.getElementById('clear-chat-btn');
  newChatBtn = document.getElementById('new-chat-btn');
  aiPlatformSelect = document.getElementById('ai-platform-select');
  sessionsContainer = document.getElementById('sessions-container');
  addSessionBtn = document.getElementById('add-session-btn');
  
  // 文件上传相关DOM元素
  fileUploadBtn = document.getElementById('file-upload-btn');
  fileUpload = document.getElementById('file-upload');
  filePreviewArea = document.getElementById('file-preview-area');
  
  // AI聊天按钮点击事件
  if (aiChatBtn) {
    aiChatBtn.addEventListener('click', async () => {
      aiChatModal.classList.add('show');
      // 加载AI平台列表
      await loadAIPlatformsToSelect();
      // 加载聊天会话
      await loadChatSessions();
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
    clearChatBtn.addEventListener('click', async () => {
      clearChatHistory();
      // 保存清理后的会话
      await saveChatSession();
    });
  }
  
  // 新会话按钮点击事件
  if (newChatBtn) {
    newChatBtn.addEventListener('click', async () => {
      await createChatSession();
    });
  }
  
  // 添加会话按钮点击事件
  if (addSessionBtn) {
    addSessionBtn.addEventListener('click', async () => {
      await createChatSession();
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
    aiChatModal.addEventListener('click', async (e) => {
      if (e.target === aiChatModal) {
        // 关闭前保存会话
        await saveChatSession();
        aiChatModal.classList.remove('show');
      }
    });
  }
  
  // 关闭按钮点击事件
  const closeBtns = aiChatModal.querySelectorAll('.close');
  closeBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      // 关闭前保存会话
      await saveChatSession();
      aiChatModal.classList.remove('show');
    });
  });
  
  // 文件上传按钮点击事件
  if (fileUploadBtn) {
    fileUploadBtn.addEventListener('click', () => {
      fileUpload.click();
    });
  }
  
  // 文件选择事件
  if (fileUpload) {
    fileUpload.addEventListener('change', handleFileSelect);
  }
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

// 处理文件选择
function handleFileSelect(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  
  // 处理每个选中的文件
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    handleFile(file);
  }
  
  // 清空文件输入，允许重复选择同一文件
  event.target.value = '';
}

// 处理单个文件
function handleFile(file) {
  // 检查文件类型
  const isTextFile = file.type.startsWith('text/') || ['.txt', '.md'].includes(getFileExtension(file.name));
  const isImageFile = file.type.startsWith('image/');
  
  if (!isTextFile && !isImageFile) {
    showNotification('不支持的文件类型', 'error');
    return;
  }
  
  // 检查文件大小（限制为10MB）
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    showNotification('文件大小超过限制（最大10MB）', 'error');
    return;
  }
  
  // 读取文件
  const reader = new FileReader();
  
  reader.onload = (e) => {
    const fileData = {
      name: file.name,
      type: file.type,
      size: file.size
    };
    
    if (isTextFile) {
      // 文本文件：直接使用文本内容
      fileData.content = e.target.result;
      fileData.contentType = 'text';
    } else if (isImageFile) {
      // 图片文件：使用base64编码
      fileData.content = e.target.result;
      fileData.contentType = 'image_url';
    }
    
    // 添加到已上传文件列表
    uploadedFiles.push(fileData);
    
    // 更新文件预览
    updateFilePreview();
  };
  
  if (isTextFile) {
    reader.readAsText(file);
  } else if (isImageFile) {
    reader.readAsDataURL(file);
  }
}

// 获取文件扩展名
function getFileExtension(filename) {
  return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2);
}

// 更新文件预览
function updateFilePreview() {
  filePreviewArea.innerHTML = '';
  
  if (uploadedFiles.length === 0) return;
  
  uploadedFiles.forEach((file, index) => {
    const previewItem = document.createElement('div');
    previewItem.className = 'file-preview-item';
    previewItem.innerHTML = `
      <div class="file-preview-info">
        <span class="file-name">${file.name}</span>
        <span class="file-size">(${formatFileSize(file.size)})</span>
      </div>
      <button class="file-preview-remove" data-index="${index}">×</button>
    `;
    
    filePreviewArea.appendChild(previewItem);
  });
  
  // 添加删除文件事件监听
  const removeButtons = filePreviewArea.querySelectorAll('.file-preview-remove');
  removeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      removeFile(index);
    });
  });
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 删除已上传的文件
function removeFile(index) {
  uploadedFiles.splice(index, 1);
  updateFilePreview();
}

// 发送消息
async function sendMessage() {
  const message = aiChatInput.value.trim();
  
  // 检查是否有消息或文件
  if (!message && uploadedFiles.length === 0) return;
  
  // 构建包含文件的用户消息
  const userMsgContent = {
    text: message,
    files: [...uploadedFiles]
  };
  
  // 添加用户消息到聊天历史
  const userMsg = {
    role: 'user',
    content: userMsgContent,
    timestamp: new Date()
  };
  chatHistory.push(userMsg);
  
  // 更新聊天界面
  updateChatMessages();
  
  // 保存聊天记录到当前会话
  await saveChatSession();
  
  // 清空输入框和文件列表
  aiChatInput.value = '';
  uploadedFiles = [];
  updateFilePreview();
  
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
  
  // 保存聊天记录到当前会话
  await saveChatSession();
  
  // 构建聊天请求，过滤掉临时消息和转换角色
  const messages = chatHistory
    // 过滤掉"正在思考..."消息
    .filter(msg => msg.content !== '正在思考...')
    // 转换角色，将'ai'转换为API接受的'assistant'
    .map(msg => {
      // 转换消息格式
      const apiMsg = {
        role: msg.role === 'ai' ? 'assistant' : msg.role
      };
      
      // 处理消息内容
      if (typeof msg.content === 'string') {
        // 普通文本消息
        apiMsg.content = msg.content;
      } else {
        // 包含文件的消息
        const contentItems = [];
        
        // 添加文本内容（如果有）
        if (msg.content.text && msg.content.text.trim()) {
          contentItems.push({
            type: 'text',
            text: msg.content.text.trim()
          });
        }
        
        // 添加文件内容（如果有）
        if (msg.content.files && msg.content.files.length > 0) {
          msg.content.files.forEach(file => {
            if (file.contentType === 'text') {
              contentItems.push({
                type: 'text',
                text: file.content
              });
            } else if (file.contentType === 'image_url') {
              contentItems.push({
                type: 'image_url',
                image_url: {
                  url: file.content
                }
              });
            }
          });
        }
        
        // 设置消息内容
        apiMsg.content = contentItems.length === 1 && contentItems[0].type === 'text' 
          ? contentItems[0].text 
          : contentItems;
      }
      
      return apiMsg;
    });
  
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
    
    // 尝试从错误消息中提取有用的信息
    let errorMessage = 'AI聊天失败';
    
    if (error && error.message) {
      // 如果错误消息包含"API Error"，提取API错误信息
      if (error.message.includes('API Error')) {
        // 尝试提取API返回的错误消息
        const apiErrorMatch = error.message.match(/"message":"([^"]+)"/);
        if (apiErrorMatch && apiErrorMatch[1]) {
          errorMessage = `AI聊天失败: ${apiErrorMatch[1]}`;
        } else {
          errorMessage = `AI聊天失败: ${error.message}`;
        }
      } else {
        errorMessage = `AI聊天失败: ${error.message}`;
      }
    }
    
    // 替换正在思考消息为错误消息
    chatHistory[chatHistory.length - 1].content = errorMessage;
    updateChatMessages();
    
    // 保存聊天记录到当前会话
    await saveChatSession();
  }
}

// 处理聊天响应
async function handleChatResponse(content) {
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
  // 保存聊天记录到当前会话
  await saveChatSession();
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
  
  // 处理不同类型的消息内容
  if (typeof msg.content === 'string') {
    // 普通文本消息
    bubble.textContent = msg.content;
  } else {
    // 包含文件的消息
    // 添加文本内容（如果有）
    if (msg.content.text && msg.content.text.trim()) {
      const textParagraph = document.createElement('p');
      textParagraph.textContent = msg.content.text.trim();
      bubble.appendChild(textParagraph);
    }
    
    // 添加文件内容（如果有）
    if (msg.content.files && msg.content.files.length > 0) {
      const filesContainer = document.createElement('div');
      filesContainer.className = 'message-files';
      
      msg.content.files.forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = 'message-file-item';
        
        if (file.contentType === 'text') {
          // 文本文件
          fileItem.innerHTML = `
            <div class="file-icon">📄</div>
            <div class="file-info">
              <div class="file-name">${file.name}</div>
              <div class="file-size">${formatFileSize(file.size)}</div>
            </div>
          `;
        } else if (file.contentType === 'image_url') {
          // 图片文件
          fileItem.innerHTML = `
            <div class="image-preview-container">
              <img src="${file.content}" alt="${file.name}" class="message-image-preview" />
              <div class="file-name">${file.name}</div>
            </div>
          `;
        }
        
        filesContainer.appendChild(fileItem);
      });
      
      bubble.appendChild(filesContainer);
    }
  }
  
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
        // 清空气泡内容
        bubble.innerHTML = '';
        
        // 处理不同类型的消息内容
        if (typeof lastMessage.content === 'string') {
          // 普通文本消息
          bubble.textContent = lastMessage.content;
        } else {
          // 包含文件的消息
          // 添加文本内容（如果有）
          if (lastMessage.content.text && lastMessage.content.text.trim()) {
            const textParagraph = document.createElement('p');
            textParagraph.textContent = lastMessage.content.text.trim();
            bubble.appendChild(textParagraph);
          }
          
          // 添加文件内容（如果有）
          if (lastMessage.content.files && lastMessage.content.files.length > 0) {
            const filesContainer = document.createElement('div');
            filesContainer.className = 'message-files';
            
            lastMessage.content.files.forEach(file => {
              const fileItem = document.createElement('div');
              fileItem.className = 'message-file-item';
              
              if (file.contentType === 'text') {
                // 文本文件
                fileItem.innerHTML = `
                  <div class="file-icon">📄</div>
                  <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                  </div>
                `;
              } else if (file.contentType === 'image_url') {
                // 图片文件
                fileItem.innerHTML = `
                  <div class="image-preview-container">
                    <img src="${file.content}" alt="${file.name}" class="message-image-preview" />
                    <div class="file-name">${file.name}</div>
                  </div>
                `;
              }
              
              filesContainer.appendChild(fileItem);
            });
            
            bubble.appendChild(filesContainer);
          }
        }
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
}

// 管理聊天上下文，确保不超过最大限制
function manageChatContext() {
  // 计算当前上下文大小
  let contextSize = 0;
  for (const msg of chatHistory) {
    if (typeof msg.content === 'string') {
      // 普通文本消息
      contextSize += msg.content.length;
    } else {
      // 包含文件的消息
      // 计算文本内容大小
      if (msg.content.text) {
        contextSize += msg.content.text.length;
      }
      // 计算文件内容大小（对于文本文件，直接使用内容长度；对于图片文件，使用base64编码的长度）
      if (msg.content.files) {
        msg.content.files.forEach(file => {
          contextSize += file.content.length;
        });
      }
    }
  }
  
  // 如果超过最大限制，移除最早的消息
  while (contextSize > MAX_CONTEXT_SIZE && chatHistory.length > 2) {
    // 移除第一条消息（保留至少一条用户消息和一条AI消息）
    const removedMsg = chatHistory.shift();
    if (typeof removedMsg.content === 'string') {
      // 普通文本消息
      contextSize -= removedMsg.content.length;
    } else {
      // 包含文件的消息
      // 减去文本内容大小
      if (removedMsg.content.text) {
        contextSize -= removedMsg.content.text.length;
      }
      // 减去文件内容大小
      if (removedMsg.content.files) {
        removedMsg.content.files.forEach(file => {
          contextSize -= file.content.length;
        });
      }
    }
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
