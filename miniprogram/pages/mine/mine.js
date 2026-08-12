const { requestJson } = require('../../utils/data');
const { readState } = require('../../utils/personal');
const cloudSync = require('../../utils/cloud-sync');

const SECTION_LABELS = {
  papers: '我的论文',
  code: '我的代码',
  resources: '参考资料'
};

const RESOURCE_GROUPS = {
  official: '官方网站', collaborations: '合作组', chatgpt: 'ChatGPT 与 AI',
  'data-analysis': '数据分析', 'github-following': 'GitHub 跟随', software: '科研软件'
};

Page({
  data: {
    activeSection: 'papers',
    sectionTitle: SECTION_LABELS.papers,
    favoriteItems: [],
    keywordStats: [],
    pendingCount: 0,
    noteCount: 0,
    resources: [],
    resourceGroups: [],
    activeResourceGroup: 'all',
    cloudReady: false,
    cloudSyncing: false,
    cloudStatusText: '正式 AppID 已绑定，云环境待开通',
    lastCloudSyncAt: ''
  },

  onLoad() { this.loadResources(); },
  onShow() {
    this.refreshPersonal();
    if (cloudSync.status().enabled && this.data.pendingCount) this.syncCloud(true);
  },

  refreshPersonal() {
    const state = readState();
    const keywordCounts = {};
    Object.values(state.keywords || {}).flat().forEach(value => { keywordCounts[value] = (keywordCounts[value] || 0) + 1; });
    const current = cloudSync.status();
    this.setData({
      favoriteItems: Object.values(state.favorites || {}).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt))),
      keywordStats: Object.entries(keywordCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
      pendingCount: (state.pendingOperations || []).length,
      noteCount: Object.keys(state.notes || {}).length,
      cloudReady: current.enabled,
      cloudStatusText: current.enabled ? '微信云端科研空间已连接' : '正式 AppID 已绑定，云环境待开通',
      lastCloudSyncAt: state.lastCloudSyncAt ? state.lastCloudSyncAt.replace('T', ' ').slice(0, 19) : ''
    });
  },

  loadResources() {
    requestJson('resources').then(payload => {
      this._allResources = payload.items || [];
      const ids = [...new Set(this._allResources.map(item => item.group || 'official'))];
      this.setData({ resourceGroups: [{ id: 'all', name: '全部' }].concat(ids.map(id => ({ id, name: RESOURCE_GROUPS[id] || id }))) });
      this.filterResources();
    }).catch(() => this.setData({ resources: [] }));
  },

  chooseSection(event) {
    const activeSection = event.currentTarget.dataset.section;
    this.setData({ activeSection, sectionTitle: SECTION_LABELS[activeSection] });
  },
  chooseResourceGroup(event) { this.setData({ activeResourceGroup: event.currentTarget.dataset.id }); this.filterResources(); },
  filterResources() {
    const resources = (this._allResources || []).filter(item => this.data.activeResourceGroup === 'all' || item.group === this.data.activeResourceGroup);
    this.setData({ resources });
  },
  copyResource(event) { wx.setClipboardData({ data: event.currentTarget.dataset.url }); },
  copyRepository() { wx.setClipboardData({ data: 'https://github.com/code-world-kang/nuclear-frontier' }); },
  onTapCloudSync() {
    if (this.data.cloudReady) this.syncCloud(false);
    else this.showCloudInfo();
  },
  syncCloud(quiet = false) {
    if (this.data.cloudSyncing || !cloudSync.status().enabled) return;
    this.setData({ cloudSyncing: true });
    cloudSync.syncNow().then(result => {
      this.refreshPersonal();
      if (!quiet) wx.showToast({ title: `已同步 ${result.synced} 项`, icon: 'success' });
    }).catch(error => {
      if (!quiet) wx.showModal({ title: '同步没有完成', content: error.message || '请检查云环境配置。', showCancel: false });
    }).finally(() => this.setData({ cloudSyncing: false }));
  },
  showCloudInfo() {
    wx.showModal({
      title: '云端同步待接入',
      content: '正式 AppID 已绑定。下一步只需在微信开发者工具中开通云开发、填入环境 ID，并部署 researchSync 云函数。AppSecret 不需要也不能写入项目。',
      showCancel: false
    });
  }
});
