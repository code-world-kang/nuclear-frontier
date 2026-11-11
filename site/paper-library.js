// Cache complete monthly records for this page session; retry only missing files.
export function createPaperLibraryLoader({ root, fetchImpl = fetch, concurrency = 4 }) {
  const records = new Map();
  const loadedMonths = new Set();
  let months;
  let running;
  const listeners = new Set();
  const snapshot = () => ({ items: [...records.values()], loaded: loadedMonths.size, total: months?.length || 0 });
  const publish = () => listeners.forEach(listener => listener(snapshot()));
  async function read(path) {
    const response = await fetchImpl(`${root}${path}`, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }
  async function run(years) {
    if (!months) {
      const summaries = [];
      for (let i = 0; i < years.length; i += concurrency) {
        summaries.push(...await Promise.all(years.slice(i, i + concurrency).map(({ year }) => read(`stats/${year}.json`))));
      }
      months = [...new Set(summaries.flatMap(summary => summary.months.map(entry => entry.month)))].sort().reverse();
    }
    const missing = months.filter(month => !loadedMonths.has(month));
    for (let i = 0; i < missing.length; i += concurrency) {
      const batch = missing.slice(i, i + concurrency);
      const results = await Promise.allSettled(batch.map(async month => {
        const [year, number] = month.split('-');
        const items = await read(`papers/${year}/${number}.json`);
        if (!Array.isArray(items)) throw new Error(`${month}: 无效论文数据`);
        items.forEach(item => records.set(item.id, item));
        loadedMonths.add(month);
      }));
      publish();
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
    return snapshot();
  }
  return async ({ daily, years, onProgress }) => {
    daily.forEach(item => { if (!records.has(item.id)) records.set(item.id, item); });
    if (onProgress) listeners.add(onProgress);
    try {
      onProgress?.(snapshot());
      if (!running) running = run(years).finally(() => { running = null; });
      return await running;
    } finally {
      listeners.delete(onProgress);
    }
  };
}
