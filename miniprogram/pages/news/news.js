const { loadBundle, localizeList, matches, sortNewest } = require('../../utils/data');
const { cardItem, openDetail } = require('../../utils/view');

Page({
  data: { loading: true, error: '', query: '', activeCategory: 'all', categories: [], items: [], resultCount: 0 },
  onLoad() { this.loadData(); },
  onPullDownRefresh() { this.loadData(true).finally(() => wx.stopPullDownRefresh()); },

  loadData(refresh = false) {
    this.setData({ loading: true, error: '' });
    return loadBundle(['news', 'translations', 'meta'], { refresh }).then(bundle => {
      this._allItems = sortNewest(localizeList(bundle.news, bundle.translations, bundle.meta));
      this._itemMap = new Map(this._allItems.map(item => [item.id, item]));
      const counts = {};
      this._allItems.forEach(item => (item.categories || []).forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
      const categories = [{ id: 'all', name: '全部新闻', count: this._allItems.length }]
        .concat((bundle.meta.categories || []).filter(item => counts[item.id]).map(item => ({ id: item.id, name: item.name, count: counts[item.id] })));
      this.setData({ loading: false, categories });
      this.applyFilters();
    }).catch(error => this.setData({ loading: false, error: `新闻加载失败：${error.message}` }));
  },

  applyFilters() {
    const filtered = (this._allItems || []).filter(item =>
      (this.data.activeCategory === 'all' || (item.categories || []).includes(this.data.activeCategory)) && matches(item, this.data.query));
    this.setData({ items: filtered.map(item => cardItem(item, 220)), resultCount: filtered.length });
  },
  onSearch(event) { this.setData({ query: event.detail.value }); clearTimeout(this._timer); this._timer = setTimeout(() => this.applyFilters(), 180); },
  chooseCategory(event) { this.setData({ activeCategory: event.currentTarget.dataset.id }); this.applyFilters(); },
  openItem(event) { const item = this._itemMap.get(event.detail.item.id); if (item) openDetail(item); }
});
