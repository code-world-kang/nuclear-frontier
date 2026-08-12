function escapeBib(value) {
  return String(value || '').replace(/[{}]/g, match => `\\${match}`);
}

function citeKey(item) {
  const surname = String((item.citation_authors || item.authors || [])[0] || 'paper')
    .split(/[ ,]/)[0].replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'paper';
  const year = String(item.published || '').slice(0, 4) || 'nd';
  return `${surname}${year}${String(item.id || '').slice(0, 4)}`;
}

function bibtex(item) {
  const authors = item.citation_authors || item.authors || [];
  const fields = [
    ['title', item.title],
    ['author', authors.join(' and ')],
    ['journal', item.journal_abbrev || item.source],
    ['volume', item.volume],
    ['number', item.issue],
    ['pages', item.pages],
    ['year', String(item.published || '').slice(0, 4)],
    ['publisher', item.publisher],
    ['doi', item.doi],
    ['url', item.url]
  ].filter(([, value]) => value);
  return `@article{${citeKey(item)},\n${fields.map(([key, value]) => `  ${key} = {${escapeBib(value)}}`).join(',\n')}\n}`;
}

function gbt(item) {
  const authors = (item.citation_authors || item.authors || []).slice(0, 3);
  const authorText = authors.length ? `${authors.join(', ')}${(item.authors || []).length > 3 ? ', et al.' : ''}` : '佚名';
  const year = String(item.published || '').slice(0, 4) || '[日期不详]';
  const journal = item.journal_abbrev || item.source || '[刊名不详]';
  const volumeIssue = [item.volume, item.issue ? `(${item.issue})` : ''].join('');
  const pages = item.pages ? `:${item.pages}` : '';
  const doi = item.doi ? `. DOI:${item.doi}` : '';
  return `${authorText}. ${item.title}[J]. ${journal}, ${year}${volumeIssue ? `, ${volumeIssue}` : ''}${pages}${doi}.`;
}

module.exports = { bibtex, gbt };
