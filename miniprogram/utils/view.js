const { compactText } = require('./format');

function cardItem(item, descriptionLength = 180) {
  return {
    id: item.id,
    type: item.type,
    displayTitle: item.displayTitle,
    displayDescription: compactText(item.displayDescription, descriptionLength),
    cardDescription: compactText(item.displayDescription, descriptionLength),
    sourceLabel: item.sourceLabel,
    dateLabel: item.dateLabel,
    categoryNames: item.categoryNames || [],
    hasTranslation: item.hasTranslation,
    importance: item.importance || 0,
    noticeGroupLabel: item.noticeGroupLabel || ''
  };
}

function openDetail(item) {
  const app = getApp();
  app.globalData.selectedItem = item;
  wx.navigateTo({ url: `/pages/detail/detail?type=${encodeURIComponent(item.type || 'paper')}&id=${encodeURIComponent(item.id)}` });
}

module.exports = { cardItem, openDetail };
