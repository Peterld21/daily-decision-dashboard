/**
 * 决策摘要表渲染。
 */
import { h, slug } from './utils.js';

const FMT_PCT = (v) => {
  if (v == null || Number.isNaN(v)) return null;
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
};

function retCell(v) {
  if (v == null) return h('td', { class: 'num ret-cell' }, h('span', { class: 'ret-na', text: '—' }));
  const cls = v > 0 ? 'ret-pos' : v < 0 ? 'ret-neg' : 'ret-zero';
  return h('td', { class: 'num ret-cell' }, h('strong', { class: cls, text: FMT_PCT(v) }));
}

function fmtNum(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(digits);
}

export function renderSummaryTable(rows) {
  const tbody = document.getElementById('summary-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (const r of rows || []) {
    const tr = h('tr', { 'data-ticker': r.ticker }, [
      h('td', { class: 'num', text: r.emoji || '' }),
      h('td', { class: 'name col-name-sticky', title: `${r.name || ''} (${r.ticker})` }, [
        h('a', { href: `#stock-${slug(r.ticker)}` }, [
          h('span', { class: 'tk', text: r.ticker }),
          ' ',
          h('span', { class: 'nm', text: r.name || '' }),
        ]),
      ]),
      h('td', { class: 'adv', text: r.advice || '' }),
      h('td', { class: 'num', text: r.score == null ? '—' : String(r.score) }),
      h('td', { class: 'num', text: fmtNum(r.close) }),
      h('td', { class: 'num', text: fmtNum(r.ma5) }),
      h('td', { class: 'num', text: fmtNum(r.ma10) }),
      h('td', { class: 'num', text: fmtNum(r.ma20) }),
      h('td', { class: 'bias', text: r.bias || '—' }),
      h('td', { class: 'num', text: r.support == null ? '—' : fmtNum(r.support) }),
      h('td', { class: 'num', text: r.resistance == null ? '—' : fmtNum(r.resistance) }),
      retCell(r.ret5_pct),
      retCell(r.ret20_pct),
      h('td', { class: 'num', text: r.market_cap_display || '—' }),
      h('td', { class: 'num', text: r.pe_forward_display || '—' }),
      h('td', { class: 'action-h ta-sum-cell', text: r.ta_summary || '—' }),
    ]);
    tbody.append(tr);
  }
}

export function renderTOC(cards) {
  const root = document.getElementById('toc-inner');
  if (!root) return;
  root.innerHTML = '';
  for (const c of cards || []) {
    root.append(h('a', { href: `#stock-${slug(c.ticker)}`, text: `${c.emoji || ''} ${c.ticker}` }));
  }
}
