const { loadBundle, localizeList, matches, sortNewest } = require('../../utils/data');
const { noticeGroup, noticeGroupLabel } = require('../../utils/format');
const { cardItem, openDetail } = require('../../utils/view');

Page({
  data: {
    loading: true, error: '', query: '', activeGroup: 'all', resultCount: 0, items: [],
    groups: [
      { id: 'all', name: '全部通知', icon: '🌿', count: 0 },
      { id: 'meeting', name: '会议通知', icon: '🎓', count: 0 },
      { id: 'fund', name: '科研基金', icon: '🌱', count: 0 },
      { id: 'beam', name: '束流申请', icon: '⚛', count: 0 }
    ]
  },
  onLoad() { this.loadData(); },
  onPullDownRefresh() { this.loadData(true).finally(() => wx.stopPullDownRefresh()); },

  loadData(refresh = false) {
    this.setData({ loading: true, error: '' });
    return loadBundle(['notices', 'translations', 'meta'], { refresh }).then(bundle => {
      this._allItems = sortNewest(localizeList(bundle.notices, bundle.translations, bundle.meta)).map(item => {
        const group = noticeGroup(item);
        return Object.assign(item, { noticeGroup: group, noticeGroupLabel: noticeGroupLabel(group) });
      });
      this._itemMap = new Map(this._allItems.map(item => [item.id, item]));
      const counts = this._allItems.reduce((result, item) => { result[item.noticeGroup] = (result[item.noticeGroup] || 0) + 1; return result; }, {});
      const groups = this.data.groups.map(group => Object.assign({}, group, { count: group.id === 'all' ? this._allItems.length : (counts[group.id] || 0) }));
      this.setData({ loading: false, groups });
      this.applyFilters();
    }).catch(error => this.setData({ loading: false, error: `通知加载失败：${error.message}` }));
  },
  applyFilters() {
    const filtered = (this._allItems || []).filter(item => (this.data.activeGroup === 'all' || item.noticeGroup === this.data.activeGroup) && matches(item, this.data.query));
    this.setData({ items: filtered.map(item => cardItem(item, 220)), resultCount: filtered.length });
  },
  onSearch(event) { this.setData({ query: event.detail.value }); clearTimeout(this._timer); this._timer = setTimeout(() => this.applyFilters(), 180); },
  chooseGroup(event) { this.setData({ activeGroup: event.currentTarget.dataset.id }); this.applyFilters(); },
  openItem(event) { const item = this._itemMap.get(event.detail.item.id); if (item) openDetail(item); }
});
