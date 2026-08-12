const { loadBundle, localizeList, sortNewest, translationItems } = require('../../utils/data');
const { cardItem, openDetail } = require('../../utils/view');
const { noticeGroup, noticeGroupLabel } = require('../../utils/format');

function isHomeFeatured(item) {
  const source = String(item.source || '').trim().toLowerCase();
  const short = String(item.source_short || '').trim().toLowerCase();
  return short === 'prl'
    || source === 'physical review letters'
    || source === 'nature'
    || source === 'science'
    || source === 'nature physics'
    || source === 'nature communications';
}

Page({
  data: {
    loading: true,
    error: '',
    stats: [],
    featured: [],
    news: [],
    notices: [],
    updatedAt: '',
    translationProgress: 0,
    translationText: ''
  },

  onLoad() { this.loadData(); },
  onPullDownRefresh() { this.loadData(true).finally(() => wx.stopPullDownRefresh()); },

  loadData(refresh = false) {
    this.setData({ loading: true, error: '' });
    return loadBundle(['papers', 'featured', 'news', 'notices', 'translations', 'meta', 'status'], { refresh })
      .then(bundle => {
        const papers = localizeList(bundle.papers, bundle.translations, bundle.meta);
        const featured = sortNewest(localizeList(bundle.featured, bundle.translations, bundle.meta).filter(isHomeFeatured));
        const news = sortNewest(localizeList(bundle.news, bundle.translations, bundle.meta));
        const notices = sortNewest(localizeList(bundle.notices, bundle.translations, bundle.meta)).map(item => {
          const group = noticeGroup(item);
          return Object.assign(item, { noticeGroup: group, noticeGroupLabel: noticeGroupLabel(group) });
        });
        const latestDay = papers.reduce((latest, item) => item.dateLabel > latest ? item.dateLabel : latest, '');
        const todayPapers = papers.filter(item => item.dateLabel === latestDay);
        const translatedIds = new Set(Object.keys(translationItems(bundle.translations)));
        const translatedCount = papers.filter(item => translatedIds.has(item.id)).length;
        const sources = (bundle.status && bundle.status.source_results) || [];
        const sourceOk = sources.filter(item => item.ok).length;
        const progress = papers.length ? Math.round(translatedCount / papers.length * 100) : 0;
        getApp().globalData.dataUpdatedAt = bundle.status.last_success || '';
        this._items = new Map([...papers, ...featured, ...news, ...notices].map(item => [item.id, item]));
        this.setData({
          loading: false,
          updatedAt: String(bundle.status.last_success || '').replace('T', ' ').slice(0, 16),
          translationProgress: Math.min(100, progress),
          translationText: `${translatedCount.toLocaleString('zh-CN')} / ${papers.length.toLocaleString('zh-CN')} 篇论文已有中译`,
          stats: [
            { label: '今日新增', value: todayPapers.length },
            { label: '重点论文', value: featured.length },
            { label: '科研新闻', value: news.length },
            { label: '每日通知', value: notices.length },
            { label: '历史论文', value: papers.length },
            { label: '数据源', value: `${sourceOk}/${sources.length}` }
          ],
          featured: featured.slice(0, 8).map(item => cardItem(item, 230)),
          news: news.slice(0, 5).map(item => cardItem(item, 150)),
          notices: notices.slice(0, 5).map(item => cardItem(item, 150))
        });
      })
      .catch(error => this.setData({ loading: false, error: `数据加载失败：${error.message}` }));
  },

  openItem(event) {
    const item = this._items && this._items.get(event.detail.item.id);
    if (item) openDetail(item);
  },

  switchTab(event) {
    wx.switchTab({ url: `/pages/${event.currentTarget.dataset.page}/${event.currentTarget.dataset.page}` });
  }
});
