/**
 * 宏观 hero：渲染 #macro-qqq-schd-fg。
 */
import { buildMacroOption, disposeOnExit } from './chart-helpers.js';

export function renderMacroHero(macro) {
  const el = document.getElementById('macro-qqq-schd-fg');
  if (!el) return;
  if (!macro || !macro.dates || !macro.dates.length) {
    el.innerHTML = '<div class="chart-placeholder">宏观数据缺失</div>';
    return;
  }
  const chart = window.echarts.init(el);
  const opt = buildMacroOption(macro);
  chart.setOption(opt);
  disposeOnExit(chart, el);
}
