const ROOT = 'https://raw.githubusercontent.com/code-world-kang/nuclear-frontier/main/data/translation-feed/';
const DIGEST = /^[0-9a-f]{64}$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const same = (a, b) => JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));

export function applyTranslationBatch(payload, batch) {
  if (batch.version !== 1 || !batch.items || !batch.previous) throw new Error('译文批次格式错误');
  payload.items ||= {};
  for (const [key, value] of Object.entries(batch.items)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('译文编号错误');
    const old = payload.items[key];
    if (same(old, value) || !same(old, batch.previous[key])) continue;
    if (old?.source_hash && old.source_hash !== value.source_hash) {
      payload.versions ||= {};
      payload.versions[key] ||= {};
      payload.versions[key][old.source_hash] = old;
    }
    payload.items[key] = value;
  }
  return payload;
}

export async function loadTranslationFeed(payload, { fetcher = fetch, cache = new Map() } = {}) {
  const get = async url => {
    const response = await fetcher(url, { credentials: 'omit', signal: AbortSignal.timeout(15000), cache: 'no-cache' });
    if (!response.ok) throw new Error(`译文更新 HTTP ${response.status}`);
    return response;
  };
  const manifest = await (await get(`${ROOT}manifest.json?v=${Math.floor(Date.now() / 60000)}`)).json();
  if (manifest.version !== 1 || !Array.isArray(manifest.batches) || manifest.batches.some(id => !DIGEST.test(id))) {
    throw new Error('译文索引格式错误');
  }
  const missing = manifest.batches.filter(id => !cache.has(id));
  for (let start = 0; start < missing.length; start += 4) {
    await Promise.all(missing.slice(start, start + 4).map(async id => {
      const raw = await (await get(`${ROOT}batches/${id}.json`)).arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(x => x.toString(16).padStart(2, '0')).join('');
      if (hash !== id) throw new Error('译文更新不完整，保留已有版本');
      cache.set(id, JSON.parse(new TextDecoder().decode(raw)));
    }));
  }
  // Commit the overlay only after every advertised batch has been verified.
  const merged = { items: { ...payload.items }, versions: Object.fromEntries(Object.entries(payload.versions || {}).map(([k, v]) => [k, { ...v }])) };
  for (const id of manifest.batches) applyTranslationBatch(merged, cache.get(id));
  return { payload: merged, manifest };
}
