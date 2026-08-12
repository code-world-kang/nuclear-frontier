const STORAGE_KEY = 'nuclear-frontier-preview-personal';

function emptyState() {
  return { favorites: {}, ignored: {}, notes: {}, keywords: {}, pendingOperations: [] };
}

function readState() {
  try {
    return Object.assign(emptyState(), wx.getStorageSync(STORAGE_KEY) || {});
  } catch (error) {
    return emptyState();
  }
}

function writeState(state) {
  wx.setStorageSync(STORAGE_KEY, state);
  return state;
}

function queueOperation(state, type, itemId, payload = {}) {
  state.pendingOperations = (state.pendingOperations || []).filter(item => !(item.type === type && item.itemId === itemId));
  state.pendingOperations.push({ type, itemId, payload, createdAt: new Date().toISOString(), status: 'preview-only' });
}

function toggleFavorite(item) {
  const state = readState();
  if (state.favorites[item.id]) delete state.favorites[item.id];
  else state.favorites[item.id] = { id: item.id, type: item.type || 'paper', title: item.title, addedAt: new Date().toISOString() };
  queueOperation(state, 'favorite', item.id, { active: Boolean(state.favorites[item.id]) });
  writeState(state);
  return Boolean(state.favorites[item.id]);
}

function toggleIgnored(item) {
  const state = readState();
  if (state.ignored[item.id]) delete state.ignored[item.id];
  else state.ignored[item.id] = { id: item.id, title: item.title, ignoredAt: new Date().toISOString() };
  queueOperation(state, 'ignored', item.id, { active: Boolean(state.ignored[item.id]) });
  writeState(state);
  return Boolean(state.ignored[item.id]);
}

function saveNote(item, note) {
  const state = readState();
  const value = String(note || '').trim();
  if (value) state.notes[item.id] = { text: value, updatedAt: new Date().toISOString() };
  else delete state.notes[item.id];
  queueOperation(state, 'note', item.id, { text: value });
  writeState(state);
  return value;
}

function setKeywords(item, keywords) {
  const state = readState();
  const values = [...new Set((keywords || []).map(value => String(value).trim()).filter(Boolean))];
  state.keywords[item.id] = values;
  queueOperation(state, 'keywords', item.id, { keywords: values });
  writeState(state);
  return values;
}

function queueZotero(item, options = {}) {
  const state = readState();
  queueOperation(state, 'zotero', item.id, {
    title: item.title,
    url: item.url || '',
    pdfUrl: item.pdf_url || '',
    collection: String(options.collection || '').trim(),
    tags: (options.tags || []).map(value => String(value).trim()).filter(Boolean),
    note: String(options.note || '').trim()
  });
  writeState(state);
  return true;
}

function itemState(id) {
  const state = readState();
  return {
    favorite: Boolean(state.favorites[id]),
    ignored: Boolean(state.ignored[id]),
    note: state.notes[id] ? state.notes[id].text : '',
    keywords: state.keywords[id] || []
  };
}

module.exports = { itemState, queueZotero, readState, saveNote, setKeywords, toggleFavorite, toggleIgnored };
