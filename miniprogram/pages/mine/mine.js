const { requestJson } = require('../../utils/data');
const { readState } = require('../../utils/personal');

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
    cloudReady: false
  },

  onLoad() { this.loadResources(); },
  onShow() { this.refreshPersonal(); },

  refreshPersonal() {
    const state = readState();
    const keywordCounts = {};
    Object.values(state.keywords || {}).flat().forEach(value => { keywordCounts[value] = (keywordCounts[value] || 0) + 1; });
    this.setData({
      favoriteItems: Object.values(state.favorites || {}).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt))),
      keywordStats: Object.entries(keywordCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
      pendingCount: (state.pendingOperations || []).length,
      noteCount: Object.keys(state.notes || {}).length
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
  showCloudInfo() {
    wx.showModal({
      title: '云端同步待接入',
      content: '取得正式小程序 AppID 后，将启用登录与云端队列，再把收藏、笔记、关键词和 Zotero 任务同步到您的科研空间。',
      showCancel: false
    });
  }
});
