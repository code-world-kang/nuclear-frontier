const { mergeCloudState, readState, writeState } = require('./personal');

function status() {
  const app = getApp();
  return {
    enabled: Boolean(wx.cloud && app.globalData.cloudSyncEnabled),
    envId: app.globalData.cloudEnvId || ''
  };
}

function call(action, payload = {}) {
  const current = status();
  if (!current.enabled) return Promise.reject(new Error('尚未绑定微信云环境'));
  return wx.cloud.callFunction({
    name: 'researchSync',
    data: { action, payload }
  }).then(response => {
    const result = response.result || {};
    if (!result.ok) throw new Error(result.message || '云端同步失败');
    return result;
  });
}

function syncNow() {
  const local = readState();
  const operations = (local.pendingOperations || []).slice(0, 200);
  return call('sync', { operations }).then(result => {
    const acknowledged = new Set(result.acknowledgedIds || operations.map(item => item.id));
    const latest = readState();
    const remaining = (latest.pendingOperations || []).filter(item => !acknowledged.has(item.id));
    const merged = mergeCloudState(result.state || {}, remaining);
    replayOperations(merged, remaining);
    merged.lastCloudSyncAt = new Date().toISOString();
    writeState(merged);
    return { state: merged, synced: acknowledged.size, zoteroQueued: result.zoteroQueued || 0 };
  });
}

function replayOperations(state, operations) {
  operations.forEach(operation => {
    const { itemId, payload = {}, type } = operation;
    if (!itemId) return;
    if (type === 'favorite') {
      if (payload.active && payload.record) state.favorites[itemId] = payload.record;
      else delete state.favorites[itemId];
    } else if (type === 'ignored') {
      if (payload.active && payload.record) state.ignored[itemId] = payload.record;
      else delete state.ignored[itemId];
    } else if (type === 'note') {
      if (payload.text) state.notes[itemId] = { text: payload.text, updatedAt: operation.createdAt };
      else delete state.notes[itemId];
    } else if (type === 'keywords') {
      if ((payload.keywords || []).length) state.keywords[itemId] = payload.keywords;
      else delete state.keywords[itemId];
    }
  });
}

function ping() {
  return call('ping');
}

module.exports = { ping, status, syncNow };
