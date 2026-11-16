// Cache complete monthly records for this page session; retry only missing files.
export function createPaperLibraryLoader({ root, fetchImpl = fetch, concurrency = 8 }) {
  const records = new Map();
  const loadedMonths = new Set();
  let months;
  let running;
  let lastProgress = 0;
  const listeners = new Set();
  const snapshot = () => ({ items: [...records.values()], loaded: loadedMonths.size, total: months?.length || 0 });
  const publish = (force = false) => {
    if (!listeners.size || (!force && Date.now() - lastProgress < 300)) return;
    lastProgress = Date.now();
    const value = snapshot();
    listeners.forEach(listener => listener(value));
  };
  async function eachConcurrent(values, task) {
    let next = 0;
    const failures = [];
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const value = values[next++];
        try { await task(value); } catch (error) { failures.push(error); }
      }
    }));
    if (failures.length) throw failures[0];
  }
  async function read(path) {
    const response = await fetchImpl(`${root}${path}`, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }
  async function run(years) {
    if (!months) {
      const summaries = [];
      await eachConcurrent(years, async ({ year }) => summaries.push(await read(`stats/${year}.json`)));
      months = [...new Set(summaries.flatMap(summary => summary.months.map(entry => entry.month)))].sort().reverse();
    }
    const missing = months.filter(month => !loadedMonths.has(month));
    try {
      await eachConcurrent(missing, async month => {
        const [year, number] = month.split('-');
        const items = await read(`papers/${year}/${number}.json`);
        if (!Array.isArray(items)) throw new Error(`${month}: 无效论文数据`);
        items.forEach(item => records.set(item.id, item));
        loadedMonths.add(month);
        publish();
      });
    } finally { publish(true); }
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
