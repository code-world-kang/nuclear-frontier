const { requestJson, localizedItem, categoryMap, findById } = require('../../utils/data');
const { compactText, displayDate, shortAuthors } = require('../../utils/format');
const { bibtex, gbt } = require('../../utils/citation');
const { itemState, queueZotero, saveNote, setKeywords, toggleFavorite, toggleIgnored } = require('../../utils/personal');
const cloudSync = require('../../utils/cloud-sync');

Page({
  data: {
    loading: true,
    error: '',
    item: null,
    showOriginal: false,
    favorite: false,
    ignored: false,
    note: '',
    keywords: [],
    keywordInput: '',
    citeOpen: false,
    citeFormat: 'bibtex',
    citation: '',
    zoteroOpen: false,
    zoteroCollection: '待读论文',
    zoteroTagsInput: '',
    cloudReady: false
  },

  onLoad(options) {
    this._type = options.type || 'paper';
    this._id = options.id || '';
    const selected = getApp().globalData.selectedItem;
    if (selected && String(selected.id) === String(this._id)) {
      this.prepareItem(selected);
    } else {
      this.loadItem();
    }
  },

  loadItem() {
    const endpoint = this._type === 'news' ? 'news' : (this._type === 'notice' ? 'notices' : 'papers');
    Promise.all([requestJson(endpoint), requestJson('translations'), requestJson('meta')])
      .then(([items, translations, meta]) => {
        const raw = findById(items, this._id);
        if (!raw) throw new Error('未找到该条目');
        this.prepareItem(localizedItem(raw, translations, categoryMap(meta)));
      })
      .catch(error => this.setData({ loading: false, error: error.message }));
  },

  prepareItem(item) {
    this._item = item;
    const state = itemState(item.id);
    const authors = shortAuthors(item.authors || item.citation_authors, 8);
    const detail = Object.assign({}, item, {
      authorsText: authors,
      publishedText: displayDate(item.published || item.updated),
      originalDescription: item.originalDescription || item.abstract || item.summary || item.content || '该来源暂未提供可公开介绍。',
      doiText: item.doi || '暂无 DOI',
      categoryText: (item.categoryNames || []).join('·') || '物理前沿',
      sourceText: item.source || item.sourceLabel || '来源待补充'
    });
    const defaultTags = state.keywords.length ? state.keywords : (item.categoryNames || []).slice(0, 3);
    this.setData({
      loading: false,
      item: detail,
      favorite: state.favorite,
      ignored: state.ignored,
      note: state.note,
      keywords: state.keywords,
      zoteroTagsInput: defaultTags.join('、'),
      citation: bibtex(item),
      cloudReady: cloudSync.status().enabled
    });
  },

  toggleOriginal() { this.setData({ showOriginal: !this.data.showOriginal }); },
  toggleFavorite() {
    const active = toggleFavorite(this._item);
    this.setData({ favorite: active });
    this.scheduleCloudSync();
    wx.showToast({ title: active ? '已收藏' : '已取消收藏', icon: 'none' });
  },
  toggleIgnored() {
    const active = toggleIgnored(this._item);
    this.setData({ ignored: active });
    this.scheduleCloudSync();
    wx.showToast({ title: active ? '已加入忽略' : '已恢复显示', icon: 'none' });
  },
  onNoteInput(event) { this.setData({ note: event.detail.value }); },
  saveNote() {
    const value = saveNote(this._item, this.data.note);
    this.setData({ note: value });
    this.scheduleCloudSync();
    wx.showToast({ title: this.data.cloudReady ? '笔记已保存' : '笔记已进入待同步队列', icon: 'none' });
  },
  onKeywordInput(event) { this.setData({ keywordInput: event.detail.value }); },
  addKeyword() {
    const values = this.data.keywordInput.split(/[,，;；\s]+/).map(value => value.trim()).filter(Boolean);
    if (!values.length) return;
    const keywords = setKeywords(this._item, [...this.data.keywords, ...values]);
    this.setData({ keywords, keywordInput: '' });
    this.scheduleCloudSync();
  },
  removeKeyword(event) {
    const keywords = this.data.keywords.filter((_, index) => index !== Number(event.currentTarget.dataset.index));
    setKeywords(this._item, keywords);
    this.setData({ keywords });
    this.scheduleCloudSync();
  },
  toggleCite() { this.setData({ citeOpen: !this.data.citeOpen }); },
  chooseCiteFormat(event) {
    const citeFormat = event.currentTarget.dataset.format;
    this.setData({ citeFormat, citation: citeFormat === 'gbt' ? gbt(this._item) : bibtex(this._item) });
  },
  copyCitation() { wx.setClipboardData({ data: this.data.citation }); },
  toggleZotero() { this.setData({ zoteroOpen: !this.data.zoteroOpen }); },
  onZoteroCollection(event) { this.setData({ zoteroCollection: event.detail.value }); },
  onZoteroTags(event) { this.setData({ zoteroTagsInput: event.detail.value }); },
  submitZotero() {
    const tags = this.data.zoteroTagsInput.split(/[,，;；]+/).map(value => value.trim()).filter(Boolean);
    if (!this.data.zoteroCollection.trim()) return wx.showToast({ title: '请填写 Zotero 分类', icon: 'none' });
    if (!tags.length) return wx.showToast({ title: '请至少设置 1 个分类标签', icon: 'none' });
    queueZotero(this._item, { collection: this.data.zoteroCollection, tags, note: this.data.note });
    this.setData({ zoteroOpen: false });
    this.scheduleCloudSync();
    wx.showModal({
      title: '已加入 Zotero 队列',
      content: this.data.cloudReady
        ? '论文、PDF 链接、笔记和分类将同步到微信云端队列，供电脑端 Zotero 助手处理。'
        : '云环境尚未开通，记录已进入待同步队列；云端启用后会自动补传。',
      showCancel: false
    });
  },
  scheduleCloudSync() {
    if (!cloudSync.status().enabled) return;
    if (this._syncTimer) clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => cloudSync.syncNow().catch(() => {}), 700);
  },
  onUnload() {
    if (this._syncTimer) clearTimeout(this._syncTimer);
  },
  copySourceLink() { wx.setClipboardData({ data: this._item.url || this._item.source_url || '' }); },
  copyPdfLink() { wx.setClipboardData({ data: this._item.pdf_url || '' }); }
});
