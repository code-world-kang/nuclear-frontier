import renderMathInElement from './vendor/katex/contrib/auto-render.mjs';
import './vendor/katex/contrib/mhchem.mjs';

// Display only: never change the stored source, translation, search or citation data.
export function prepareMathText(value = '') {
  let text = String(value ?? '').replace(/\\texorpdfstring\{((?:[^{}]|\{[^{}]*\})*)\}\{[^{}]*\}/g, '$1');
  // Some publisher metadata embeds a complete TeX document for each inline formula.
  text = text.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}[\s\S]*?\\begin\{document\}([\s\S]*?)\\end\{document\}/g,
    (_, body) => body.trim().replace(/^\$\$([\s\S]*)\$\$$/, '\\($1\\)'));
  const parts = text.split(/(\$\$[\s\S]*?\$\$|(?<!\\)\$[^$]*?(?<!\\)\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g);
  return parts.map((part, index) => {
    const nuclides = part.replace(/\\nuclide\[([^\]]+)\](?:\[([^\]]+)\])?\{([^{}]+)\}/g,
      (_, mass, charge, symbol) => {
        const formula = `{}^{${mass}}${charge ? `_{${charge}}` : ''}\\mathrm{${symbol}}`;
        return index % 2 ? formula : `\\(${formula}\\)`;
      });
    if (index % 2) return nuclides;
    // Common bare Greek symbols in older translations need no invented math context.
    return nuclides.replace(/\\(alpha|beta|gamma|delta|Delta|sigma|Sigma|lambda|Lambda|nu|mu|pi|tau|hbar)\b/g,
      (_, name) => ({alpha:'α', beta:'β', gamma:'γ', delta:'δ', Delta:'Δ', sigma:'σ', Sigma:'Σ', lambda:'λ', Lambda:'Λ', nu:'ν', mu:'μ', pi:'π', tau:'τ', hbar:'ℏ'})[name]);
  }).join('');
}

export function renderScientificMath(element) {
  if (!element) return;
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement?.closest('script, style, textarea, pre, code, .katex, .katex-error')) nodes.push(node);
  }
  for (const node of nodes) node.textContent = prepareMathText(node.textContent);
  renderMathInElement(element, {
    delimiters: [
      {left: '$$', right: '$$', display: true},
      {left: '$', right: '$', display: false},
      {left: '\\(', right: '\\)', display: false},
      {left: '\\[', right: '\\]', display: true},
      ...['equation', 'equation*', 'align', 'align*', 'gather', 'gather*'].map(name =>
        ({left: `\\begin{${name}}`, right: `\\end{${name}}`, display: true})),
    ],
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxSize: 20,
    maxExpand: 1000,
    errorColor: '#795b45',
    macros: {'\\ensuremath': '#1'},
    ignoredClasses: ['katex', 'katex-error'],
  });
}

export function renderScientificText(element, value) {
  element.textContent = String(value ?? '');
  renderScientificMath(element);
}
