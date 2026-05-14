/**
 * 重要信息总览（利空 / 利好）：
 * 输入：report index.json 的 intel = { bear: {TICKER: [..]}, bull: {TICKER: [..]} }
 */
import { h } from './utils.js';

export function renderIntelDigest(intel) {
  const root = document.getElementById('intel-digest-cols');
  if (!root) return;
  root.innerHTML = '';

  const bear = (intel && intel.bear) || {};
  const bull = (intel && intel.bull) || {};

  const bearCol = h('div', { class: 'news-digest-col nd-col-bear' }, [
    h('h4', { class: 'nd-sec nd-bear', text: '利空 / 风险' }),
    ...renderGroup(bear),
  ]);
  const bullCol = h('div', { class: 'news-digest-col nd-col-bull' }, [
    h('h4', { class: 'nd-sec nd-bull', text: '利好 / 催化' }),
    ...renderGroup(bull),
  ]);

  root.append(bearCol, bullCol);
}

function renderGroup(byTicker) {
  const tickers = Object.keys(byTicker);
  if (!tickers.length) return [h('p', { class: 'news-empty', text: '暂无' })];
  const nodes = [];
  for (const tk of tickers) {
    const items = byTicker[tk] || [];
    if (!items.length) continue;
    nodes.push(
      h('div', { class: 'news-digest-ticker', 'data-ticker': tk }, [
        h('h5', { class: 'nd-tk', text: tk }),
        h('ul', { class: 'news-digest-list' }, items.map((s) => h('li', { text: s }))),
      ]),
    );
  }
  if (!nodes.length) return [h('p', { class: 'news-empty', text: '暂无' })];
  return nodes;
}
