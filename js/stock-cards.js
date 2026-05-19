/**
 * 个股卡片：先用 index.json 的元数据渲染外壳，
 * 然后 IntersectionObserver 触发图表 JSON 懒加载（K 线 + benchmark）。
 */
import { fetchJSON, h, slug, renderMarkdown, signalClass } from './utils.js';
import { buildKlineOption, buildBenchmarkOption, disposeOnExit } from './chart-helpers.js';

const VP_LEGEND_HTML =
  '<p class="vp-legend vp-legend-compact">K 线上方小字为量价信号（相对 5 日均量；' +
  '<span class="vp-s1">放量涨</span> <span class="vp-s2">放量跌</span> ' +
  '<span class="vp-s3">缩量涨</span> <span class="vp-s4">缩量跌</span>）。' +
  '放量 &gt; 均量×1.2；缩量 &lt; 均量×0.8。</p>';

/** 构造卡片 DOM；不立即拉图表数据。 */
function buildCardEl(card) {
  const sg = slug(card.ticker);
  const article = h('article', {
    id: `stock-${sg}`,
    class: `stock-card ${card.signal_class || signalClass(card.emoji)}`,
    'data-ticker': card.ticker,
  });

  const header = h('header', { class: 'card-head' }, [
    h('span', { class: 'card-emoji', 'aria-hidden': 'true', text: card.emoji || '' }),
    h('div', { class: 'card-titles' }, [
      h('h2', { class: 'card-title', text: card.name || card.ticker }),
      h('span', { class: 'card-ticker', text: card.ticker }),
    ]),
  ]);

  const chartStack = h('div', { class: 'chart-stack' }, [
    h('div', { class: 'chart-box', id: `chart-${sg}`, 'data-ticker': card.ticker }),
    h('p', { class: 'vp-note', id: `vp-note-${sg}`, text: '行情数据加载中…' }),
    h('div', { class: 'vp-legend-wrap', html: VP_LEGEND_HTML }),
    h('p', { class: 'bm-title', text: '个股 vs QQQ（自基期起累计涨跌幅）' }),
    h('div', { class: 'chart-box benchmark-chart', id: `bm-chart-${sg}`, 'data-ticker': card.ticker }),
    h('p', { class: 'bm-hint', id: `bm-hint-${sg}` }),
    h('p', { class: 'bm-range-note', id: `bm-range-${sg}` }),
  ]);

  // 卡片正文：用 markdown 渲染保留原报告的丰富文案
  const bodyInner = [];
  if (card.intel_md) {
    bodyInner.push(
      h('section', {
        class: 'intel-qv',
        'aria-label': '重要信息速览',
        html: `<h3>📰 重要信息速览</h3>${renderMarkdown(card.intel_md)}`,
      }),
    );
  }
  if (card.core_conclusion_md) {
    bodyInner.push(h('h3', { text: '📌 核心结论' }));
    bodyInner.push(h('div', { html: renderMarkdown(card.core_conclusion_md) }));
  }
  if (card.ta_summary) {
    bodyInner.push(h('h4', { text: '交易动作总结' }));
    bodyInner.push(h('p', { text: card.ta_summary }));
  }
  if (card.daily_quote_md) {
    bodyInner.push(h('h3', { text: '📈 当日行情' }));
    bodyInner.push(h('div', { html: renderMarkdown(card.daily_quote_md) }));
  }
  if (card.data_perspective_md) {
    bodyInner.push(h('h3', { text: '📊 数据透视' }));
    bodyInner.push(h('div', { html: renderMarkdown(card.data_perspective_md) }));
  }

  const body = h('div', { class: 'card-body' }, bodyInner);

  article.append(header, chartStack, body);
  return article;
}

/** 卡片网格批量渲染。 */
export function renderCards(cards, reportDate, baseUrl) {
  const grid = document.getElementById('stocks-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const articles = (cards || []).map(buildCardEl);
  for (const a of articles) grid.append(a);

  if (!('IntersectionObserver' in window)) {
    for (const a of articles) loadChartsFor(a, reportDate, baseUrl);
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          loadChartsFor(e.target, reportDate, baseUrl);
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '200px 0px' },
  );
  for (const a of articles) io.observe(a);
}

/** 拉某个卡片的 K 线 JSON 并渲染。 */
async function loadChartsFor(article, reportDate, baseUrl) {
  const ticker = article.getAttribute('data-ticker');
  if (!ticker) return;
  const sg = slug(ticker);
  const url = `${baseUrl}/reports/${reportDate}/charts/${ticker}.json`;
  const payload = await fetchJSON(url);
  if (!payload) {
    const box = document.getElementById(`chart-${sg}`);
    if (box) box.innerHTML = '<div class="chart-placeholder">K线数据缺失</div>';
    const bmBox = document.getElementById(`bm-chart-${sg}`);
    if (bmBox) bmBox.innerHTML = '<div class="chart-placeholder">QQQ 基准数据缺失</div>';
    return;
  }

  renderKline(sg, payload.kline);
  renderBenchmark(sg, payload.benchmark);
}

function renderKline(sg, kline) {
  const el = document.getElementById(`chart-${sg}`);
  if (!el) return;
  if (!kline || !kline.dates || !kline.dates.length) {
    el.innerHTML = '<div class="chart-placeholder">K线数据缺失</div>';
    return;
  }
  const chart = window.echarts.init(el);
  const opt = buildKlineOption(kline);
  if (!opt) {
    el.innerHTML = '<div class="chart-placeholder">K线 option 构造失败</div>';
    return;
  }
  chart.setOption(opt);
  disposeOnExit(chart, el);

  const note = document.getElementById(`vp-note-${sg}`);
  if (note) note.textContent = kline.volume_last_note || '';
}

function renderBenchmark(sg, bm) {
  const el = document.getElementById(`bm-chart-${sg}`);
  if (!el) return;
  if (!bm || !bm.dates || !bm.dates.length) {
    el.innerHTML = '<div class="chart-placeholder">QQQ 基准数据缺失</div>';
    return;
  }
  const chart = window.echarts.init(el);
  const opt = buildBenchmarkOption(bm);
  chart.setOption(opt);
  disposeOnExit(chart, el);

  const hint = document.getElementById(`bm-hint-${sg}`);
  if (hint && bm.excess_return_pct != null) {
    hint.innerHTML = `窗口末日相对 QQQ 超额收益：<strong>${bm.excess_return_pct.toFixed(2)}%</strong>`;
  }
  const range = document.getElementById(`bm-range-${sg}`);
  if (range && bm.base_date && bm.end_date) {
    range.innerHTML = `基期 ${bm.base_date} → 最新交易日 ${bm.end_date}（曲线含 <strong>${bm.dates.length}</strong> 个交易日）。`;
  }
}
