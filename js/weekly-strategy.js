/**
 * 周度策略首屏：只渲染 report_to_json 已生成的静态数据。
 */
function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function renderTickerList(items, emptyText) {
  if (!Array.isArray(items) || !items.length) {
    return `<p class="weekly-empty">${escapeHtml(emptyText)}</p>`;
  }
  return items.map((item) => `
    <article class="weekly-ticker">
      <div class="weekly-ticker-head">
        <strong>${escapeHtml(item.ticker)}</strong>
        <span>${escapeHtml(item.action || '观察')}</span>
        <b>${item.score == null ? '—' : escapeHtml(item.score)}分</b>
      </div>
      <div class="weekly-ticker-meta">
        5日 ${formatPct(item.ret5_pct)} · 20日 ${formatPct(item.ret20_pct)}
      </div>
      <p>${escapeHtml(item.reason || '')}</p>
    </article>
  `).join('');
}

export function renderWeeklyStrategy(strategy) {
  const wrap = document.getElementById('weekly-strategy-panel');
  if (!wrap) return;
  if (!(strategy && strategy.stance && strategy.breadth)) {
    wrap.hidden = true;
    return;
  }

  const stance = strategy.stance;
  const breadth = strategy.breadth;
  const playbook = Array.isArray(strategy.playbook) ? strategy.playbook : [];
  const tone = ['positive', 'negative', 'neutral'].includes(stance.tone)
    ? stance.tone
    : 'neutral';

  wrap.hidden = false;
  wrap.innerHTML = `
    <header class="weekly-head">
      <div>
        <p class="weekly-eyebrow">WEEKLY PLAYBOOK · ${escapeHtml(strategy.week_window || strategy.as_of || '')}</p>
        <h2>本周策略</h2>
      </div>
      <span class="weekly-stance ${tone}">${escapeHtml(stance.label)}</span>
    </header>
    <div class="weekly-overview">
      <div class="weekly-thesis">
        <strong>${escapeHtml(stance.position_band || '')}</strong>
        <p>${escapeHtml(stance.summary || '')}</p>
      </div>
      <div class="weekly-stats" aria-label="周度市场广度">
        <div><b>${breadth.average_score == null ? '—' : escapeHtml(breadth.average_score)}</b><span>平均评分</span></div>
        <div><b>${escapeHtml(breadth.above_ma10_pct)}%</b><span>站上 MA10</span></div>
        <div><b>${escapeHtml(breadth.buy_count)}</b><span>买入/加仓</span></div>
        <div><b>${escapeHtml(breadth.sell_count)}</b><span>卖出/减仓</span></div>
      </div>
    </div>
    <div class="weekly-grid">
      <section>
        <h3>优先观察</h3>
        ${renderTickerList(strategy.focus, '暂无明确进攻候选，保持耐心。')}
      </section>
      <section>
        <h3>风险清单</h3>
        ${renderTickerList(strategy.risks, '暂无集中风险标的。')}
      </section>
      <section class="weekly-rules">
        <h3>执行纪律</h3>
        <ol>${playbook.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>
        <p class="weekly-source">${escapeHtml(strategy.source || '')}</p>
      </section>
    </div>
  `;
}
