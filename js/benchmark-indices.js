/**
 * 「指数趋势」Tab：读取 data/benchmark_indices.json（由 benchmark_return/generate_benchmark_html.py 生成）。
 *
 * 三个子视图：
 *   sinceBase        自基期以来累计涨跌（折线）
 *   ytd              2026 YTD 累计涨跌（折线）
 *   drawdownCompare  回撤对比：对比图（各指数相对自身峰值回撤）+ 5 张「价位 × 回撤」双轴小图
 *
 * 每个子视图下提供 全部 / 6M / 3M / 1M 时间窗，统一控制该视图内的所有图表（按日期切片）。
 * 浏览器零外部数据 API；仅用同源 JSON + 站内 ECharts。
 */

import { fetchJSON } from './utils.js';

const PRESETS = ['all', '6m', '3m', '1m'];

const state = {
  payload: null,
  chart: null, // returns 折线
  drawdownChart: null, // 回撤对比折线
  dualCharts: [], // 5 张双轴小图
  currentViewKey: 'sinceBase',
  rangeByView: { sinceBase: 'all', ytd: 'all', drawdownCompare: 'all' },
  /** @type {Promise<void> | null} */
  loadPromise: null,
  resizeBound: false,
  subTabsBound: false,
  presetsBound: false,
};

/** @param {string} id */
function $(id) {
  return document.getElementById(id);
}

function onResizeChart() {
  try {
    state.chart?.resize();
    state.drawdownChart?.resize();
    state.dualCharts.forEach((c) => c.resize());
  } catch (_) {
    /* ignore */
  }
}

/** 面板从 hidden 切到可见后，ECharts 常需延迟 resize 才有正确尺寸。 */
function scheduleChartResize() {
  queueMicrotask(onResizeChart);
  requestAnimationFrame(() => {
    onResizeChart();
    setTimeout(onResizeChart, 150);
  });
}

function isDrawdownView(view, viewKey) {
  return view.type === 'drawdown' || viewKey === 'drawdownCompare' || Boolean(view.drawdownDatasets);
}

function attachResizeOnce() {
  if (state.resizeBound) return;
  state.resizeBound = true;
  window.addEventListener('resize', onResizeChart);
}

// ---------------------------------------------------------------------------
// 时间窗切片
// ---------------------------------------------------------------------------

function shiftMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setMonth(dt.getMonth() - months);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** 由预设计算 [startDate, endDate]（end 恒为最新日）。 */
function presetRange(view, mode) {
  const labels = view.labels;
  const minDate = labels[0];
  const maxDate = labels[labels.length - 1];
  if (mode === '6m') return { start: shiftMonths(maxDate, 6), end: maxDate };
  if (mode === '3m') return { start: shiftMonths(maxDate, 3), end: maxDate };
  if (mode === '1m') return { start: shiftMonths(maxDate, 1), end: maxDate };
  return { start: minDate, end: maxDate };
}

/** 按预设把视图切片；返回与原视图同构、但只含窗口内数据的对象。 */
function sliceView(view, mode) {
  const { start, end } = presetRange(view, mode);
  const labels = view.labels;
  let startIdx = labels.findIndex((l) => l >= start);
  if (startIdx === -1) startIdx = 0;
  let endIdx = labels.length - 1;
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    if (labels[i] <= end) {
      endIdx = i;
      break;
    }
  }
  if (startIdx > endIdx) startIdx = endIdx;

  const slicedLabels = labels.slice(startIdx, endIdx + 1);
  const out = {
    type: view.type,
    labels: slicedLabels,
    rangeStart: slicedLabels[0],
    rangeEnd: slicedLabels[slicedLabels.length - 1],
    points: slicedLabels.length,
    title: view.title,
    description: view.description,
    yAxisLabel: view.yAxisLabel,
  };

  const sliceMap = (obj) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.slice(startIdx, endIdx + 1)]));
  const lastOf = (obj) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Number((v[v.length - 1] ?? 0).toFixed(2))]));

  if (view.datasets) {
    out.datasets = sliceMap(view.datasets);
    out.latest = lastOf(out.datasets);
  }
  if (view.drawdownDatasets) {
    out.drawdownDatasets = sliceMap(view.drawdownDatasets);
    out.latest = lastOf(out.drawdownDatasets);
  }
  if (view.panels) {
    out.panels = view.panels.map((p) => {
      const close = p.close.slice(startIdx, endIdx + 1);
      const drawdown = p.drawdown.slice(startIdx, endIdx + 1);
      return {
        label: p.label,
        close,
        drawdown,
        latestClose: close[close.length - 1],
        latestDrawdown: Number((drawdown[drawdown.length - 1] ?? 0).toFixed(2)),
      };
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 头部信息渲染
// ---------------------------------------------------------------------------

function renderMetaGrid(el, sliced) {
  el.replaceChildren();
  const defs = [
    ['区间起始', sliced.rangeStart],
    ['区间结束', sliced.rangeEnd],
    ['数据点数', String(sliced.points)],
  ];
  for (const [lbl, val] of defs) {
    const pill = document.createElement('div');
    pill.className = 'benchmark-meta-pill';
    pill.innerHTML = `<div class="benchmark-meta-label">${lbl}</div><div class="benchmark-meta-value">${val}</div>`;
    el.appendChild(pill);
  }
}

function renderMetricsRow(el, payload, sliced) {
  el.replaceChildren();
  const { seriesOrder, colors } = payload;
  const suffix = sliced.type === 'drawdown' ? '（回撤）' : '';
  for (const name of seriesOrder) {
    const v = sliced.latest[name];
    const pill = document.createElement('div');
    pill.className = 'benchmark-metric';
    pill.style.borderTop = `3px solid ${colors[name] || '#9e9e9e'}`;
    const lbl = document.createElement('div');
    lbl.className = 'benchmark-metric-label';
    lbl.textContent = `${name}${suffix}`;
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

function setRangeNote(sliced) {
  const el = $('benchmark-range-note');
  if (el) el.textContent = `${sliced.rangeStart} → ${sliced.rangeEnd} · ${sliced.points} 个交易日`;
}

// ---------------------------------------------------------------------------
// 图表
// ---------------------------------------------------------------------------

function ensureChart(dom, key) {
  if (typeof window.echarts === 'undefined' || !dom) return null;
  if (!state[key]) {
    state[key] = window.echarts.init(dom, null, { renderer: 'canvas' });
  }
  return state[key];
}

function lineTooltip(unitPct = true) {
  return {
    trigger: 'axis',
    confine: true,
    formatter(tps) {
      if (!tps?.length) return '';
      let out = `<div style="font-weight:700;margin-bottom:4px">${tps[0].axisValue}</div>`;
      const sorted = [...tps].sort((a, b) => Number(b.value) - Number(a.value));
      for (const p of sorted) {
        const num =
          typeof p.value === 'number' && Number.isFinite(p.value) ? p.value.toFixed(2) : String(p.value);
        out += `<div style="margin:2px 0">${p.marker} ${p.seriesName}<span style="float:right;margin-left:12px;font-weight:700">${num}${unitPct ? '%' : ''}</span></div>`;
      }
      return out;
    },
  };
}

function commonXAxis(labels) {
  return {
    type: 'category',
    data: labels,
    boundaryGap: false,
    axisLabel: {
      formatter: (v) => String(v).replace(/^\d{4}-/, ''),
      rotate: labels.length > 160 ? 30 : 0,
      hideOverlap: true,
      fontSize: 10,
      color: '#5c6570',
    },
    axisLine: { lineStyle: { color: '#b0bec5' } },
  };
}

function renderReturns(payload, sliced) {
  const dom = $('benchmark-echart');
  const chart = ensureChart(dom, 'chart');
  if (!chart) return;
  const { seriesOrder, colors } = payload;

  chart.setOption(
    {
      animationDuration: 360,
      color: seriesOrder.map((n) => colors[n]),
      tooltip: lineTooltip(true),
      legend: {
        data: seriesOrder,
        bottom: 0,
        type: 'scroll',
        itemGap: 10,
        textStyle: { fontSize: 11, color: '#5c6570' },
      },
      grid: { left: 50, right: 14, top: 24, bottom: 58 },
      xAxis: commonXAxis(sliced.labels),
      yAxis: {
        type: 'value',
        name: sliced.yAxisLabel,
        nameGap: 12,
        nameTextStyle: { fontSize: 11, color: '#5c6570', padding: [0, 0, 0, 46] },
        axisLabel: { fontSize: 10, color: '#5c6570', formatter: (v) => `${v}%` },
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
        data: sliced.datasets[name],
      })),
    },
    { notMerge: true },
  );
}

function renderDrawdownCompare(payload, sliced) {
  const dom = $('benchmark-drawdown-echart');
  const chart = ensureChart(dom, 'drawdownChart');
  if (!chart) return;
  const { seriesOrder, colors } = payload;

  chart.setOption(
    {
      animationDuration: 360,
      color: seriesOrder.map((n) => colors[n]),
      tooltip: lineTooltip(true),
      legend: {
        data: seriesOrder,
        bottom: 0,
        type: 'scroll',
        itemGap: 10,
        textStyle: { fontSize: 11, color: '#5c6570' },
      },
      grid: { left: 50, right: 14, top: 24, bottom: 58 },
      xAxis: commonXAxis(sliced.labels),
      yAxis: {
        type: 'value',
        name: sliced.yAxisLabel,
        nameGap: 12,
        nameTextStyle: { fontSize: 11, color: '#5c6570', padding: [0, 0, 0, 46] },
        axisLabel: { fontSize: 10, color: '#5c6570', formatter: (v) => `${v}%` },
        splitLine: { lineStyle: { type: 'dashed', color: '#e0e7ee' } },
        scale: true,
      },
      series: seriesOrder.map((name) => ({
        name,
        type: 'line',
        smooth: 0.12,
        showSymbol: false,
        sampling: 'lttb',
        areaStyle: { opacity: 0.08 },
        lineStyle: { width: name === 'S&P 500' ? 2.6 : 1.8 },
        emphasis: { focus: 'series' },
        data: sliced.drawdownDatasets[name],
      })),
    },
    { notMerge: true },
  );
}

function disposeDualCharts() {
  state.dualCharts.forEach((c) => {
    try {
      c.dispose();
    } catch (_) {
      /* ignore */
    }
  });
  state.dualCharts = [];
}

function fmtLevel(v) {
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderDualGrid(payload, sliced) {
  const grid = $('benchmark-dual-grid');
  if (!grid) return;
  disposeDualCharts();
  grid.replaceChildren();
  if (typeof window.echarts === 'undefined') return;

  const { colors } = payload;
  for (const panel of sliced.panels) {
    const card = document.createElement('div');
    card.className = 'benchmark-mini-card';
    card.innerHTML =
      `<div class="benchmark-mini-head">` +
      `<span class="benchmark-mini-title">${panel.label}</span>` +
      `<span class="benchmark-mini-sub">最新价 ${fmtLevel(panel.latestClose)} · 回撤 ${panel.latestDrawdown >= 0 ? '+' : ''}${panel.latestDrawdown}%</span>` +
      `</div>` +
      `<div class="benchmark-mini-chart"></div>`;
    grid.appendChild(card);

    const dom = card.querySelector('.benchmark-mini-chart');
    const chart = window.echarts.init(dom, null, { renderer: 'canvas' });
    const color = colors[panel.label] || '#1565c0';
    chart.setOption({
      animation: false,
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter(tps) {
          if (!tps?.length) return '';
          let out = `<div style="font-weight:700;margin-bottom:4px">${tps[0].axisValue}</div>`;
          for (const p of tps) {
            const isDd = p.seriesName.indexOf('回撤') >= 0;
            const num = typeof p.value === 'number' ? p.value : Number(p.value);
            const txt = isDd ? `${num.toFixed(2)}%` : fmtLevel(num);
            out += `<div style="margin:2px 0">${p.marker} ${p.seriesName}<span style="float:right;margin-left:12px;font-weight:700">${txt}</span></div>`;
          }
          return out;
        },
      },
      legend: { bottom: 0, itemGap: 12, textStyle: { fontSize: 10, color: '#5c6570' } },
      grid: { left: 52, right: 48, top: 16, bottom: 40 },
      xAxis: commonXAxis(sliced.labels),
      yAxis: [
        {
          type: 'value',
          scale: true,
          position: 'left',
          name: '价位',
          nameTextStyle: { fontSize: 10, color: '#5c6570' },
          axisLabel: { fontSize: 9, color: '#5c6570', formatter: (v) => fmtLevel(v) },
          splitLine: { lineStyle: { type: 'dashed', color: '#eef2f6' } },
        },
        {
          type: 'value',
          position: 'right',
          name: '回撤%',
          nameTextStyle: { fontSize: 10, color: '#5c6570' },
          axisLabel: { fontSize: 9, color: '#5c6570', formatter: (v) => `${v}%` },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: `${panel.label} 价位`,
          type: 'line',
          yAxisIndex: 0,
          showSymbol: false,
          sampling: 'lttb',
          lineStyle: { width: 2, color },
          itemStyle: { color },
          data: panel.close,
        },
        {
          name: `${panel.label} 回撤`,
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          sampling: 'lttb',
          areaStyle: { color: 'rgba(159,107,107,0.22)' },
          lineStyle: { width: 1.6, color: '#9f6b6b' },
          itemStyle: { color: '#9f6b6b' },
          data: panel.drawdown,
        },
      ],
    });
    state.dualCharts.push(chart);
  }
}

// ---------------------------------------------------------------------------
// 视图切换
// ---------------------------------------------------------------------------

function applyView(viewKey) {
  const payload = state.payload;
  if (!payload) return;
  const view = payload.views[viewKey];
  if (!view) return;
  state.currentViewKey = viewKey;

  const mode = state.rangeByView[viewKey] || 'all';
  const sliced = sliceView(view, mode);

  $('benchmark-title').textContent = view.title;
  $('benchmark-desc').innerHTML = view.description;
  renderMetaGrid($('benchmark-meta-grid'), sliced);
  renderMetricsRow($('benchmark-metrics-row'), payload, sliced);
  setRangeNote(sliced);

  const returnsBlock = $('benchmark-returns-block');
  const drawdownBlock = $('benchmark-drawdown-block');
  const isDrawdown = isDrawdownView(view, viewKey);
  returnsBlock.hidden = isDrawdown;
  drawdownBlock.hidden = !isDrawdown;

  if (isDrawdown) {
    renderDrawdownCompare(payload, sliced);
    renderDualGrid(payload, sliced);
  } else {
    renderReturns(payload, sliced);
  }

  // 同步预设按钮高亮（反映当前视图记忆的时间窗）
  document.querySelectorAll('#benchmark-presets .benchmark-preset').forEach((b) => {
    const on = b.dataset.range === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  scheduleChartResize();
}

function bindBenchSubtabs() {
  const wrap = document.querySelector('.benchmark-inner-tabs');
  if (!wrap || state.subTabsBound) return;
  state.subTabsBound = true;
  wrap.querySelectorAll('[data-bench-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.benchView;
      if (!key || !state.payload) return;
      wrap.querySelectorAll('[data-bench-view]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      applyView(key);
    });
  });
}

function bindPresets() {
  const wrap = $('benchmark-presets');
  if (!wrap || state.presetsBound) return;
  state.presetsBound = true;
  wrap.querySelectorAll('.benchmark-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.range;
      if (!PRESETS.includes(mode) || !state.payload) return;
      state.rangeByView[state.currentViewKey] = mode;
      applyView(state.currentViewKey);
    });
  });
}

async function mountBenchmarkIndices(dataBase) {
  const loadEl = $('benchmark-load-state');
  const errEl = $('benchmark-error');

  if (state.payload) {
    bindBenchSubtabs();
    bindPresets();
    attachResizeOnce();
    applyView(state.currentViewKey);
    if (loadEl) loadEl.hidden = true;
    scheduleChartResize();
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
      bindPresets();
      attachResizeOnce();
      applyView(state.currentViewKey);
      if (loadEl) loadEl.hidden = true;
      scheduleChartResize();
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

/** AI Infra Tab：首次激活时再把 data-src 赋给 iframe（懒加载，避免拖慢首屏）。 */
function mountAiInfra() {
  const frame = $('ai-infra-frame');
  if (!frame) return;
  if (!frame.getAttribute('src')) {
    const src = frame.getAttribute('data-src');
    if (src) frame.setAttribute('src', src);
  }
}

/**
 * 绑定顶层 Tab（个股分析 / 指数趋势 / AI Infra），按 data-panel ↔ panel-<name> 约定切换。
 * 指数侧首次进入时拉取静态 JSON；AI Infra 首次进入时懒挂载 iframe。
 * @param {string} dataBase 与 app.js 中 DATA_BASE 一致，通常为 'data'。
 */
export function attachPageTabs(dataBase) {
  const strip = document.querySelector('.page-tab-strip');
  if (!strip) return;

  const tabs = Array.from(strip.querySelectorAll('.page-tab')).filter((b) => b.dataset.panel);
  const panels = new Map(
    tabs
      .map((b) => [b.dataset.panel, $(`panel-${b.dataset.panel}`)])
      .filter(([, el]) => el),
  );
  if (!panels.size) return;

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const active = btn.dataset.panel;
      if (!active || !panels.has(active)) return;

      tabs.forEach((b) => {
        const on = b.dataset.panel === active;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      for (const [name, el] of panels) {
        const on = name === active;
        el.hidden = !on;
        el.setAttribute('aria-hidden', on ? 'false' : 'true');
      }

      if (active === 'indices') {
        mountBenchmarkIndices(dataBase).then(() => scheduleChartResize());
      } else if (active === 'ai-infra') mountAiInfra();
    });
  });
}
