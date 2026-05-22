/**
 * 当日总结：交易提醒（规则）+ 要闻速评（与同页 intel 一致的 JSON 字段，由 report_to_json 拼好）
 */

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function formatReminderParagraphs(fullText) {
  if (!fullText || typeof fullText !== 'string') return '';
  const parts = fullText.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
}

/**
 * @param dailyDigest {{ trading?: object, news?: object } | null | undefined }
 */
export function renderDailyDigest(dailyDigest) {
  const wrap = document.getElementById('daily-digest-panel');
  if (!wrap) return;
  const empty = !(dailyDigest && dailyDigest.trading);

  if (empty) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  const t = dailyDigest.trading || {};
  const n = dailyDigest.news || {};

  const buyBlock = formatReminderParagraphs(t.buy_hints_text || '');
  const warnBlock = formatReminderParagraphs(t.decline_warnings_text || '');

  const bull = escapeHtml(n.bull_one_liner || '—');
  const bear = escapeHtml(n.bear_one_liner || '—');

  wrap.innerHTML = `
    <header class="daily-digest-head daily-digest-header">
      <h2 class="daily-digest-h2 daily-digest-title">当日总结</h2>
      ${dailyDigest.computed_at ? `<p class="daily-digest-time daily-digest-date">生成：${escapeHtml(dailyDigest.computed_at)}</p>` : ''}
    </header>
    <div class="daily-digest-grid">
      <section class="daily-digest-card" aria-labelledby="dd-trading-label">
        <h3 id="dd-trading-label" class="daily-digest-h3">交易提醒</h3>
        <div class="daily-digest-section daily-digest-subsection">
          <h4 class="daily-digest-h4 daily-digest-subheading buy"><span class="daily-digest-chip">MA10</span>右侧提示（站上10日均线）</h4>
          <div class="daily-digest-body">${buyBlock || '<p>—</p>'}</div>
        </div>
        <div class="daily-digest-section daily-digest-subsection">
          <h4 class="daily-digest-h4 daily-digest-subheading alert"><span class="daily-digest-chip">MA10</span>下跌预警（跌破10日均线）</h4>
          <div class="daily-digest-body">${warnBlock || '<p>—</p>'}</div>
        </div>
        <p class="daily-digest-foot daily-digest-text">不构成投资建议；数据来源为当日 SQLite / 报告中数值。</p>
      </section>
      <section class="daily-digest-card" aria-labelledby="dd-news-label">
        <h3 id="dd-news-label" class="daily-digest-h3">要闻速评 · 一言</h3>
        <div class="daily-digest-one daily-digest-sentiment-row">
          <span class="label label-bull daily-digest-sentiment-label bullish">利好</span>
          <p class="daily-digest-text">${bull}</p>
        </div>
        <div class="daily-digest-one daily-digest-one-bear daily-digest-sentiment-row">
          <span class="label label-bear daily-digest-sentiment-label bearish">利空</span>
          <p class="daily-digest-text">${bear}</p>
        </div>
        <p class="daily-digest-news-meta">摘编自当日重要信息总览，已去重精简。</p>
      </section>
    </div>`;
}
