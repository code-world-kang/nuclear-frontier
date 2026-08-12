const { loadBundle, localizeList, matches, sortNewest } = require('../../utils/data');
const { readState } = require('../../utils/personal');
const { cardItem, openDetail } = require('../../utils/view');

const PAGE_SIZE = 18;

Page({
  data: {
    loading: true,
    error: '',
    query: '',
    activeCategory: 'all',
    categories: [],
    items: [],
    resultCount: 0,
    visibleCount: PAGE_SIZE,
    hasMore: false
  },

  onLoad() { this.loadData(); },
  onShow() { if (this._allItems) this.applyFilters(true); },
  onPullDownRefresh() { this.loadData(true).finally(() => wx.stopPullDownRefresh()); },

  loadData(refresh = false) {
    this.setData({ loading: true, error: '' });
    return loadBundle(['papers', 'translations', 'meta'], { refresh })
      .then(bundle => {
        this._allItems = sortNewest(localizeList(bundle.papers, bundle.translations, bundle.meta));
        this._itemMap = new Map(this._allItems.map(item => [item.id, item]));
        const counts = {};
        this._allItems.forEach(item => (item.categories || []).forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
        const categories = [{ id: 'all', name: '全部', count: this._allItems.length }]
          .concat((bundle.meta.categories || []).filter(item => counts[item.id]).map(item => ({ id: item.id, name: item.name, count: counts[item.id] })));
        this.setData({ loading: false, categories });
        this.applyFilters(true);
      })
      .catch(error => this.setData({ loading: false, error: `论文加载失败：${error.message}` }));
  },

  applyFilters(reset = false) {
    if (!this._allItems) return;
    const state = readState();
    const filtered = this._allItems.filter(item => {
      if (state.ignored[item.id]) return false;
      if (this.data.activeCategory !== 'all' && !(item.categories || []).includes(this.data.activeCategory)) return false;
      return matches(item, this.data.query);
    });
    this._filteredItems = filtered;
    const visibleCount = reset ? PAGE_SIZE : this.data.visibleCount;
    this.setData({
      visibleCount,
      resultCount: filtered.length,
      items: filtered.slice(0, visibleCount).map(item => cardItem(item, 210)),
      hasMore: visibleCount < filtered.length
    });
  },

  onSearch(event) {
    this.setData({ query: event.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.applyFilters(true), 180);
  },

  chooseCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.id });
    this.applyFilters(true);
  },

  loadMore() {
    const visibleCount = this.data.visibleCount + PAGE_SIZE;
    this.setData({
      visibleCount,
      items: this._filteredItems.slice(0, visibleCount).map(item => cardItem(item, 210)),
      hasMore: visibleCount < this._filteredItems.length
    });
  },

  openItem(event) {
    const item = this._itemMap.get(event.detail.item.id);
    if (item) openDetail(item);
  }
});
