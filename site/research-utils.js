// 纯函数：核素检索与统计可脱离浏览器验证，不改写原始引用元数据。
const ELEMENTS = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' '));

export function scientificText(value = '') {
  let result = String(value).normalize('NFKC');
  result = result.replace(/\\texorpdfstring\{((?:[^{}]|\{[^{}]*\})*)\}\{[^{}]*\}/g, '$1');
  // 展平常见排版包装，保留物理符号；复杂公式仍可从原文/Cite 查看。
  for (let i = 0; i < 4; i += 1) result = result.replace(/\\(?:mathrm|textrm|text|mathbf|mathit|operatorname|textsf)\s*\{([^{}]*)\}/g, '$1');
  const greek = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', sigma: 'σ', Sigma: 'Σ', lambda: 'λ', Lambda: 'Λ', nu: 'ν', mu: 'μ', pi: 'π', tau: 'τ', hbar: 'ℏ' };
  result = result.replace(/\\([a-zA-Z]+)\b/g, (all, name) => greek[name] || all);
  return result.replace(/\$|\\[(),!;]/g, '').replace(/\^\{([\d, ]+)\}/g, '$1').replace(/\^(\d+)/g, '$1').replace(/[‐‑–—−]/g, '-').replace(/\s+/g, ' ').trim();
}

export function nuclidesIn(value = '') {
  const normalized = scientificText(value).replace(/\{\}/g, '');
  const found = [];
  const add = (mass, element) => {
    if (ELEMENTS.has(element) && Number(mass) > 0 && Number(mass) <= 350) found.push(`${Number(mass)}${element}`);
  };
  for (const m of normalized.matchAll(/(?<![\w.])(\d{1,3}(?:\s*,\s*\d{1,3})*)\s*(?:\{)?([A-Z][a-z]?)(?![a-zA-Z])/g)) m[1].split(',').forEach(a => add(a.trim(), m[2]));
  for (const m of normalized.matchAll(/\b([A-Z][a-z]?)\s*-\s*(\d{1,3})\b/g)) add(m[2], m[1]);
  return [...new Set(found)];
}

export function searchText(value = '') {
  return `${scientificText(value)} ${nuclidesIn(value).join(' ')}`.toLocaleLowerCase('zh-CN');
}

export function isChinese(value = '') {
  // 数学排版命令不参与中英文比例统计，与服务端待译判定保持一致。
  const content = String(value).replace(/https?:\/\/[^\s<>，。；]+/g, '')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\nuclide\[[^\]]*\]\{[^}]*\}/g, ' ');
  const han = (content.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (content.match(/[a-z]/gi) || []).length;
  return han >= 2 && han / Math.max(1, han + latin) >= 0.25;
}

export function translationCoverage(records, translations = {}) {
  const stats = { total: 0, complete: 0, native: 0, titleDone: 0, titleTotal: 0, bodyDone: 0, bodyTotal: 0, missingBody: 0, partial: 0 };
  for (const item of records) {
    const title = String(item.title || '').trim();
    const body = String(item.abstract || item.content || item.summary || '').trim();
    const translated = translations[item.id] || item;
    const titleNative = isChinese(title) || (title && !/[A-Za-z]{2,}/.test(title));
    const bodyNative = body && (isChinese(body) || !/[A-Za-z]{2,}/.test(body));
    if (!body) stats.missingBody += 1;
    if (titleNative && (!body || bodyNative)) { stats.native += 1; continue; }
    stats.total += 1;
    if (!titleNative) { stats.titleTotal += 1; if (isChinese(translated.title_zh)) stats.titleDone += 1; }
    if (body && !bodyNative) { stats.bodyTotal += 1; if (isChinese(translated.abstract_zh)) stats.bodyDone += 1; }
    const titleReady = titleNative || isChinese(translated.title_zh);
    const bodyReady = !body || bodyNative || isChinese(translated.abstract_zh);
    if (titleReady && bodyReady) stats.complete += 1;
    else if ((!titleNative && titleReady) || (body && !bodyNative && bodyReady)) stats.partial += 1;
  }
  return stats;
}
