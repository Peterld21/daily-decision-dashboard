/**
 * 应用入口：
 *  Phase 1 — fetch manifest.json 锁定当前 latest 日期
 *  Phase 2 — fetch reports/<date>/index.json，渲染首屏（hero / 摘要表 / 卡片骨架）
 *  Phase 3 — IntersectionObserver 触发各卡片 K 线 / benchmark 懒加载
 *  Phase 4 — requestIdleCallback 后台批量预取剩余 charts/*.json
 *
 * 浏览器**绝不**请求外部 API；所有数据均同源 data/*.json。
 */

import { fetchJSON, renderMarkdown } from './utils.js';
import { renderMacroHero } from './macro-hero.js';
import { renderIntelDigest } from './intel-digest.js';
import { renderSummaryTable, renderTOC } from './summary-table.js';
import { renderCards } from './stock-cards.js';
import { attachPageTabs } from './benchmark-indices.js';

const DATA_BASE = 'data';

attachPageTabs(DATA_BASE);

/** 全局数据仓库（轻量、扁平、可观测）。 */
const STORE = {
  manifest: null,
  reportDate: null,
  index: null,
};

async function bootstrap() {
  // 1) manifest
  STORE.manifest = await fetchJSON(`${DATA_BASE}/manifest.json`);
  if (!STORE.manifest || !STORE.manifest.latest) {
    showFatal(
      navigator.onLine
        ? 'manifest.json 缺失或格式错误。可能是本地未跑 report_to_json.py 产出数据。'
        : '网络似乎离线，请检查移动数据/Wi-Fi 后刷新。'
    );
    return;
  }
  STORE.reportDate = STORE.manifest.latest;

  // 2) 当日 index.json
  STORE.index = await fetchJSON(`${DATA_BASE}/reports/${STORE.reportDate}/index.json`);
  if (!STORE.index) {
    showFatal(`无法加载 reports/${STORE.reportDate}/index.json — 请检查网络后下拉刷新。`);
    return;
  }

  // 3) 渲染首屏
  document.title = STORE.index.title || '决策仪表盘';
  document.getElementById('doc-title').textContent = STORE.index.title || '决策仪表盘';
  document.getElementById('doc-subtitle').innerHTML = renderMarkdown(STORE.index.subtitle || '');
  document.getElementById('footer-note').innerHTML =
    `来源：本地 <code>report_to_json.py</code> 产出 · 报告日期 <strong>${STORE.index.date}</strong> · 浏览器零外部 API 调用`;

  renderMacroHero(STORE.index.macro);
  renderIntelDigest(STORE.index.intel);
  renderSummaryTable(STORE.index.summary_rows);
  renderTOC(STORE.index.cards);

  // 4) 卡片网格 + 懒加载 chart
  renderCards(STORE.index.cards, STORE.reportDate, DATA_BASE);

  // 5) 后台预取（保留给以后做历史回看 / 多日切换）
  schedulePrefetch();
}

function schedulePrefetch() {
  // 当前只预热 manifest.history 列表里相邻日期的 index.json（不动 charts）
  const history = (STORE.manifest && STORE.manifest.history) || [];
  if (history.length < 2) return;
  const run = () => {
    const others = history.filter((d) => d !== STORE.reportDate).slice(0, 3);
    for (const d of others) {
      // 预取索引，不渲染
      fetchJSON(`${DATA_BASE}/reports/${d}/index.json`).catch(() => {});
    }
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 1500);
  }
}

function showFatal(msg) {
  const root = document.querySelector('.wrap') || document.body;
  const banner = document.createElement('div');
  banner.style.cssText = 'margin:1rem;padding:0.9rem 1rem;border:1px solid #ef9a9a;background:#ffebee;color:#b71c1c;border-radius:8px;font-size:0.9rem;line-height:1.5;';
  banner.textContent = `⚠️ ${msg}`;
  root.prepend(banner);
}

// 启动
bootstrap();

// 暴露调试入口（仅开发期方便观察数据仓库状态）
window.__APP__ = STORE;
