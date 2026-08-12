function compactText(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}

function shortAuthors(authors, max = 4) {
  const values = (authors || []).filter(Boolean);
  if (!values.length) return '作者信息暂缺';
  return values.length > max ? `${values.slice(0, max).join('、')} 等` : values.join('、');
}

function todayChina() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function displayDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : (value || '日期待补充');
}

function noticeGroup(item) {
  const category = String(item.notice_category || '').toLowerCase();
  if (category.includes('beam') || category.includes('proposal') || category.includes('facility')) return 'beam';
  if (category.includes('fund') || category.includes('fellow') || category.includes('csc') || category.includes('postdoc')) return 'fund';
  return 'meeting';
}

function noticeGroupLabel(group) {
  return ({ meeting: '会议通知', fund: '科研基金', beam: '束流申请' })[group] || '通知';
}

module.exports = { compactText, displayDate, noticeGroup, noticeGroupLabel, shortAuthors, todayChina };
