import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { prepareMathText, renderScientificText, renderScientificMath } from '../site/scientific-math.js';

function host() {
  const {document, Node} = parseHTML('<html><body><div id="text"></div></body></html>');
  globalThis.document = document;
  globalThis.Node = Node;
  return document.getElementById('text');
}

test('renders titles and abstracts with all four delimiters, fractions and nuclides', () => {
  const el = host();
  renderScientificText(el, String.raw`中文 $^{14}\mathrm{C}$，\(E=mc^2\)，$$\frac{a}{b}$$，\[\sqrt{x}\]，\nuclide[78]{Ni}，\(\ce{^{14}C -> ^{14}N}\)`);
  assert.equal(el.querySelectorAll('.katex').length, 6);
  assert.equal(el.querySelectorAll('.katex-display').length, 2);
  assert.equal(el.querySelectorAll('.katex-error').length, 0);
  assert.match(el.textContent, /中文/);
  assert.ok(el.querySelector('math msup'));
  assert.ok(el.querySelector('math mfrac'));
  renderScientificMath(el);
  assert.equal(el.querySelectorAll('.katex').length, 6, 're-render does not duplicate math');
});

test('preserves Unicode scripts and displays publisher document wrappers without preamble', () => {
  const el = host();
  const source = String.raw`⁸He cm⁻² \beta：\documentclass[12pt]{minimal}\usepackage{amsmath}\begin{document}$$^{252}$$\end{document}Cf`;
  assert.match(prepareMathText(source), /⁸He cm⁻² β/);
  renderScientificText(el, source);
  assert.equal(el.querySelectorAll('.katex').length, 1);
  assert.doesNotMatch(el.textContent, /documentclass|usepackage/);
  renderScientificText(el, String.raw`$\ensuremath{\Delta}q$`);
  assert.equal(el.querySelectorAll('.katex-error').length, 0);
});

test('malformed math remains visible; source HTML and TeX links cannot execute', () => {
  const el = host();
  renderScientificText(el, String.raw`前文 $\frac{a}$ 后文 <img src=x onerror=alert(1)> $\href{javascript:alert(1)}{bad}$`);
  assert.match(el.textContent, /前文/);
  assert.match(el.textContent, /后文/);
  assert.equal(el.querySelectorAll('img, a, script').length, 0);
  assert.ok(el.querySelector('.katex-error'));
  renderScientificText(el, '切回普通文本 ⁸He');
  assert.equal(el.textContent, '切回普通文本 ⁸He');
  assert.equal(el.querySelectorAll('.katex').length, 0);
});
