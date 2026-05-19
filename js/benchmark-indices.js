/**
 * 「指数趋势」Tab：读取 data/benchmark_indices.json（由 benchmark_return/generate_benchmark_html.py 生成），
 * 结构与单机 HTML 中嵌入的 Chart.js 数据一致，此处用站内已有的 ECharts 渲染。
 */

import { fetchJSON } from './utils.js';

const state = {
  payload: null,
  chart: null,
  currentViewKey: 'sinceBase',
  /** @type {Promise<void> | null} */
  loadPromise: null,
  resizeBound: false,
  subTabsBound: false,
};

/** @param {string} id */
function $(id) {
  return document.getElementById(id);
}

function onResizeChart() {
  try {
    state.chart?.resize();
  } catch (_) {
    /* ignore */
  }
}

function attachResizeOnce() {
  if (state.resizeBound) return;
  state.resizeBound = true;
  window.addEventListener('resize', onResizeChart);
}

function bindBenchSubtabs() {
  const wrap = document.querySelector('.benchmark-inner-tabs');
  if (!wrap || state.subTabsBound) return;
  state.subTabsBound = true;
  wrap.querySelectorAll('[data-bench-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.benchView;
      if (!key || !state.payload) return;
      state.currentViewKey = key;
      wrap.querySelectorAll('[data-bench-view]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      applyBenchView(state.payload, key);
      queueMicrotask(onResizeChart);
    });
  });
}

function renderMetaGrid(el, view) {
  el.replaceChildren();
  const defs = [
    ['基期 / 起始日', view.baseDate],
    ['数据点数', String(view.points)],
  ];
  for (const [lbl, val] of defs) {
    const pill = document.createElement('div');
    pill.className = 'benchmark-meta-pill';
    pill.innerHTML = `<div class="benchmark-meta-label">${lbl}</div><div class="benchmark-meta-value">${val}</div>`;
    el.appendChild(pill);
  }
}

function renderMetricsRow(el, payload, view) {
  el.replaceChildren();
  const { seriesOrder, colors } = payload;
  for (const name of seriesOrder) {
    const v = view.latest[name];
    const pill = document.createElement('div');
    pill.className = 'benchmark-metric';
    pill.style.borderTop = `3px solid ${colors[name] || '#9e9e9e'}`;
    const lbl = document.createElement('div');
    lbl.className = 'benchmark-metric-label';
    lbl.textContent = name;
    const val = document.createElement('div');
    val.className = 'benchmark-metric-value';
    if (v > 0) val.classList.add('positive');
    if (v < 0) val.classList.add('negative');
    val.textContent = `${v >= 0 ? '+' : ''}${v}%`;
    pill.appendChild(lbl);
    pill.appendChild(val);
    el.appendChild(pill);
  }
}

function ensureChart(dom) {
  if (typeof window.echarts === 'undefined') return null;
  if (!state.chart) {
    state.chart = window.echarts.init(dom, null, { renderer: 'canvas' });
  }
  return state.chart;
}

/**
 * @param {object} payload
 * @param {'sinceBase'|'ytd'} viewKey
 */
function applyBenchView(payload, viewKey) {
  const view = payload.views[viewKey];
  if (!view) return;

  $('benchmark-title').textContent = view.title;
  $('benchmark-desc').innerHTML = view.description;
  renderMetaGrid($('benchmark-meta-grid'), view);
  renderMetricsRow($('benchmark-metrics-row'), payload, view);

  const dom = $('benchmark-echart');
  const chart = ensureChart(dom);
  if (!chart) return;

  const { seriesOrder, colors } = payload;

  chart.setOption(
    {
      animationDuration: 420,
      color: seriesOrder.map((n) => colors[n]),
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter(tps) {
          if (!tps?.length) return '';
          let out = `<div style="font-weight:700;margin-bottom:4px">${tps[0].axisValue}</div>`;
          const sorted = [...tps].sort((a, b) => Number(b.value) - Number(a.value));
          for (const p of sorted) {
            const num =
              typeof p.value === 'number' && Number.isFinite(p.value) ? p.value.toFixed(2) : String(p.value);
            out += `<div style="margin:2px 0">${p.marker} ${p.seriesName}<span style="float:right;margin-left:12px;font-weight:700">${num}%</span></div>`;
          }
          return out;
        },
      },
      legend: {
        data: seriesOrder,
        bottom: 0,
        type: 'scroll',
        itemGap: 10,
        textStyle: { fontSize: 11, color: '#5c6570' },
      },
      grid: { left: 50, right: 14, top: 32, bottom: 58 },
      xAxis: {
        type: 'category',
        data: view.labels,
        boundaryGap: false,
        axisLabel: {
          formatter: (v) => String(v).replace(/^\d{4}-/, ''),
          rotate: view.labels.length > 160 ? 30 : 0,
          hideOverlap: true,
          fontSize: 10,
          color: '#5c6570',
        },
        axisLine: { lineStyle: { color: '#b0bec5' } },
      },
      yAxis: {
        type: 'value',
        name: view.yAxisLabel,
        nameGap: 12,
        nameTextStyle: { fontSize: 11, color: '#5c6570', padding: [0, 0, 0, 46] },
        axisLabel: { fontSize: 10, color: '#5c6570' },
        splitLine: { lineStyle: { type: 'dashed', color: '#e0e7ee' } },
        scale: true,
      },
      series: seriesOrder.map((name) => ({
        name,
        type: 'line',
        smooth: 0.12,
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: name === 'S&P 500' ? 3 : 2 },
        emphasis: { focus: 'series' },
        data: view.datasets[name],
      })),
    },
    { notMerge: true },
  );

  queueMicrotask(onResizeChart);
}

async function mountBenchmarkIndices(dataBase) {
  const loadEl = $('benchmark-load-state');
  const errEl = $('benchmark-error');

  if (state.payload) {
    bindBenchSubtabs();
    attachResizeOnce();
    applyBenchView(state.payload, state.currentViewKey);
    if (loadEl) loadEl.hidden = true;
    return;
  }

  if (!state.loadPromise) {
    state.loadPromise = (async () => {
      if (loadEl) {
        loadEl.hidden = false;
        loadEl.textContent = '正在加载 benchmark_indices.json…';
      }
      if (errEl) {
        errEl.hidden = true;
        errEl.replaceChildren();
      }

      const data = await fetchJSON(`${dataBase}/benchmark_indices.json`);
      if (!data || !data.views || !data.seriesOrder || !data.colors) {
        throw new Error('JSON 结构无效或为空');
      }
      state.payload = data;

      const foot = $('benchmark-foot-note');
      if (foot) {
        foot.replaceChildren();
        if (data.sourceCsv) {
          foot.append(document.createTextNode('数据文件：'));
          const c = document.createElement('code');
          c.textContent = data.sourceCsv;
          foot.appendChild(c);
          if (data.generatedAt) {
            foot.append(document.createTextNode(` · 快照 ${data.generatedAt}`));
          }
        }
      }

      bindBenchSubtabs();
      attachResizeOnce();
      applyBenchView(state.payload, state.currentViewKey);
      if (loadEl) loadEl.hidden = true;
    })().catch((e) => {
      if (loadEl) loadEl.hidden = true;
      if (errEl) {
        errEl.hidden = false;
        const detail = String(e?.message ?? e)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        errEl.innerHTML =
          '无法加载 <code>data/benchmark_indices.json</code>。请在仓库内执行：<br/>' +
          '<code style="white-space:normal;word-break:break-all">python3 webapp/benchmark_return/generate_benchmark_html.py</code><br/>' +
          `<span style="opacity:.85">（${detail}）</span>`;
      }
      state.loadPromise = null;
    });
  }

  await state.loadPromise;
}

/**
 * 绑定「个股分析」「指数趋势」顶层 Tab；指数侧首次进入时再拉取静态 JSON。
 * @param {string} dataBase 与 app.js 中 DATA_BASE 一致，通常为 'data'。
 */
export function attachPageTabs(dataBase) {
  const strip = document.querySelector('.page-tab-strip');
  const stocksPanel = $('panel-stocks');
  const indicesPanel = $('panel-indices');

  if (!strip || !stocksPanel || !indicesPanel) return;

  strip.querySelectorAll('.page-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      if (!panel) return;

      strip.querySelectorAll('.page-tab').forEach((b) => {
        const on = b.dataset.panel === panel;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      const showIndices = panel === 'indices';

      stocksPanel.hidden = showIndices;
      stocksPanel.setAttribute('aria-hidden', showIndices ? 'true' : 'false');
      indicesPanel.hidden = !showIndices;
      indicesPanel.setAttribute('aria-hidden', showIndices ? 'false' : 'true');

      if (showIndices) {
        mountBenchmarkIndices(dataBase);
      }
    });
  });
}
