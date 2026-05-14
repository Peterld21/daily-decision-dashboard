/**
 * ECharts 通用配置工厂：
 *  - K 线主图 + 成交量副图（双 grid）
 *  - 量价菱形 / 金叉死叉 / 操作点位 markLine 与 markPoint 渲染
 *  - benchmark vs QQQ 双折线
 *  - 宏观 hero（QQQ/SCHD + 恐贪）三轴
 *
 * 设计目标：浏览器 0 外部 API；所有 option 仅从同源 payload 推导。
 */

/** ECharts 实例的容器自适应高度。 */
const __ECHARTS_INSTANCES = new Set();

export function disposeOnExit(chart, el) {
  if (!chart || !el) return;
  __ECHARTS_INSTANCES.add(chart);
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);
}

// 屏幕旋转 / 软键盘 / 浏览器 UI 隐显都会触发 visualViewport 变化 —— iOS Safari 必备兜底
if (typeof window !== 'undefined') {
  const fireResize = () => {
    for (const c of __ECHARTS_INSTANCES) {
      try { c.resize(); } catch (_) { /* disposed */ }
    }
  };
  window.addEventListener('orientationchange', () => setTimeout(fireResize, 80));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fireResize, { passive: true });
  }
}

/** K 线 option 工厂。 */
export function buildKlineOption(payload) {
  if (!payload || !payload.dates || !payload.dates.length) return null;

  const { dates, ohlc, volume, ma5, ma10, ma20 } = payload;
  const crosses = payload.crosses_last3 || [];
  const volPts = payload.volume_points || [];
  const levels = payload.price_levels || {};

  // 操作点位 markLine
  const priceMarklines = [];
  if (levels.ideal_buy != null)  priceMarklines.push({ yAxis: levels.ideal_buy,  lineStyle: { color: '#0d7c4d', type: 'dashed', width: 1 }, label: { formatter: '理想买入' } });
  if (levels.second_buy != null) priceMarklines.push({ yAxis: levels.second_buy, lineStyle: { color: '#1565c0', type: 'dashed', width: 1 }, label: { formatter: '次优买入' } });
  if (levels.stop_loss != null)  priceMarklines.push({ yAxis: levels.stop_loss,  lineStyle: { color: '#c62828', type: 'dashed', width: 1 }, label: { formatter: '止损' } });
  if (levels.target != null)     priceMarklines.push({ yAxis: levels.target,     lineStyle: { color: '#6a1b9a', type: 'dashed', width: 1 }, label: { formatter: '目标' } });

  // 金叉死叉 markPoint
  const crossMarks = crosses.map(c => ({
    name: c.label,
    coord: [c.date, c.price],
    symbol: 'pin',
    symbolSize: 28,
    itemStyle: { color: c.kind === 'golden' ? '#d4a017' : '#37474f' },
    label: { show: true, formatter: c.label, fontSize: 9, color: '#fff' },
  }));

  // 量价菱形（绘制在成交量子图上）
  const vpColors = {
    '放量上涨': '#1565c0',
    '放量下跌': '#6a1b9a',
    '缩量上涨': '#00838f',
    '缩量下跌': '#f57c00',
  };
  const vpMarks = volPts.map(v => ({
    name: v.label,
    coord: [v.date, v.price],
    symbol: 'diamond',
    symbolSize: 8,
    symbolOffset: [0, 18],
    itemStyle: { color: vpColors[v.label] || '#90a4ae', borderColor: '#263238', borderWidth: 1 },
    label: { show: true, formatter: v.label, fontSize: 7, color: '#37474f', offset: [0, 20] },
  }));

  return {
    animation: false,
    legend: {
      data: ['K线', 'MA5', 'MA10', 'MA20'],
      top: 4,
      left: 'center',
      textStyle: { fontSize: 10 },
    },
    grid: [
      { left: 40, right: 16, top: 30, height: '60%' },
      { left: 40, right: 16, top: '75%', height: '18%' },
    ],
    xAxis: [
      { type: 'category', data: dates, scale: true, boundaryGap: false, axisLabel: { fontSize: 9 }, axisLine: { onZero: false }, splitLine: { show: false } },
      { type: 'category', data: dates, scale: true, boundaryGap: false, gridIndex: 1, axisLabel: { show: false }, axisLine: { onZero: false }, splitLine: { show: false } },
    ],
    yAxis: [
      { scale: true, splitArea: { show: false }, axisLabel: { fontSize: 9 } },
      { gridIndex: 1, splitNumber: 2, axisLabel: { show: false }, splitLine: { show: false } },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params) => formatKlineTooltip(params),
    },
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: ohlc,
        itemStyle: { color: '#c62828', color0: '#1b5e20', borderColor: '#c62828', borderColor0: '#1b5e20' },
        markLine: priceMarklines.length ? { silent: true, symbol: 'none', label: { fontSize: 9 }, data: priceMarklines } : undefined,
        markPoint: crossMarks.length ? { data: crossMarks } : undefined,
      },
      { name: 'MA5',  type: 'line', data: ma5  || [], smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#ff9800' } },
      { name: 'MA10', type: 'line', data: ma10 || [], smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#7e57c2' } },
      { name: 'MA20', type: 'line', data: ma20 || [], smooth: true, showSymbol: false, lineStyle: { width: 1.2, color: '#3949ab' } },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volume || [],
        itemStyle: { color: '#90a4ae' },
        markPoint: vpMarks.length ? { data: vpMarks } : undefined,
      },
    ],
  };
}

function formatKlineTooltip(params) {
  if (!params || !params.length) return '';
  const ax = params[0].axisValue || '';
  const lines = [ax];
  for (const p of params) {
    const s = p.seriesName || '';
    if (s === 'K线') {
      const v = Array.isArray(p.data) ? p.data : null;
      // ECharts 在 axis 触发时 candlestick.data 可能为 [idx, open, close, low, high]
      const arr = v && v.length >= 5 ? v.slice(1) : v;
      if (arr && arr.length >= 4) {
        lines.push(`开 ${arr[0].toFixed(2)}　收 ${arr[1].toFixed(2)}　低 ${arr[2].toFixed(2)}　高 ${arr[3].toFixed(2)}`);
      }
    } else if (s === '成交量') {
      const vol = Number(p.value);
      if (!Number.isNaN(vol)) {
        const t = vol >= 1e8 ? (vol / 1e8).toFixed(2) + '亿'
                : vol >= 1e4 ? (vol / 1e4).toFixed(1) + '万'
                : vol.toFixed(0);
        lines.push(`${s} ${t}`);
      }
    } else {
      const n = parseFloat(p.value);
      if (!Number.isNaN(n)) lines.push(`${s} ${n.toFixed(2)}`);
    }
  }
  return lines.join('<br/>');
}

/** 个股 vs QQQ 双折线 option。 */
export function buildBenchmarkOption(bm) {
  if (!bm || !bm.dates || !bm.dates.length) return null;
  return {
    animation: false,
    legend: { data: ['个股', 'QQQ'], top: 4, textStyle: { fontSize: 10 } },
    grid: { left: 40, right: 16, top: 28, bottom: 26 },
    xAxis: { type: 'category', data: bm.dates, axisLabel: { fontSize: 9 } },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 9, formatter: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` },
      splitLine: { lineStyle: { color: '#eceff1' } },
    },
    tooltip: { trigger: 'axis' },
    series: [
      { name: '个股', type: 'line', data: bm.stock_vs_base_pct, smooth: true, showSymbol: false, lineStyle: { color: '#c62828', width: 1.5 } },
      { name: 'QQQ',  type: 'line', data: bm.qqq_vs_base_pct,   smooth: true, showSymbol: false, lineStyle: { color: '#1565c0', width: 1.5 } },
    ],
  };
}

/** 宏观 hero：QQQ、SCHD（左轴）+ 恐贪（右轴）。 */
export function buildMacroOption(macro) {
  if (!macro || !macro.dates || !macro.dates.length) return null;
  const series = [
    { name: 'QQQ',  type: 'line', data: macro.qqq_pct  || [], smooth: true, showSymbol: false, lineStyle: { color: '#1565c0', width: 1.5 } },
    { name: 'SCHD', type: 'line', data: macro.schd_pct || [], smooth: true, showSymbol: false, lineStyle: { color: '#2e7d32', width: 1.5 } },
  ];
  if (macro.fng_values && macro.fng_values.length) {
    series.push({
      name: '恐贪',
      type: 'line',
      yAxisIndex: 1,
      data: macro.fng_values,
      smooth: true,
      showSymbol: false,
      lineStyle: { color: '#f57c00', width: 1.2, type: 'dashed' },
    });
  }
  return {
    animation: false,
    title: { text: 'QQQ / SCHD（左轴：自基期起%）　恐贪（右轴：0-100）', textStyle: { fontSize: 12 }, left: 'center', top: 4 },
    legend: { data: ['QQQ', 'SCHD', '恐贪'], top: 28, textStyle: { fontSize: 10 } },
    grid: { left: 50, right: 50, top: 60, bottom: 30 },
    xAxis: { type: 'category', data: macro.dates, axisLabel: { fontSize: 9 } },
    yAxis: [
      { type: 'value', axisLabel: { fontSize: 9, formatter: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` }, splitLine: { lineStyle: { color: '#eceff1' } } },
      { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 9 }, splitLine: { show: false } },
    ],
    tooltip: { trigger: 'axis' },
    series,
  };
}
