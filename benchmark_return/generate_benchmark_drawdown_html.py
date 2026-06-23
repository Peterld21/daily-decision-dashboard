#!/usr/bin/env python3
"""
Generate benchmark HTML visualization with cumulative return tabs plus drawdown compare.

Reads only market_prices_post2020_publish.csv from the current folder and writes:
- cumulative_returns_since_20200101_20260519.html
- drawdown_compare_since_20200102_20260519.csv
"""

from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path


START_DATE = '2020-01-02'
INPUT_CSV = 'market_prices_post2020_publish.csv'
OUTPUT_HTML = 'cumulative_returns_since_20200101_20260519.html'
OUTPUT_DRAWDOWN_CSV = 'drawdown_compare_since_20200102_20260519.csv'
WANTED_INDICES = {
    'sp500': 'S&P 500',
    'nasdaq': 'Nasdaq Composite',
    'smh': 'SMH',
    'xlk': 'XLK',
    'xlf': 'XLF',
}
COLORS = {
    'S&P 500': '#111827',
    'Nasdaq Composite': '#2563eb',
    'SMH': '#dc2626',
    'XLK': '#16a34a',
    'XLF': '#9333ea',
}
SERIES_ORDER = ['S&P 500', 'Nasdaq Composite', 'SMH', 'XLK', 'XLF']


def forward_fill_aligned_series(series: dict[str, dict[str, float]], wanted_indices: dict):
    keys = list(wanted_indices.keys())
    raw = series
    all_dates_sorted = sorted(set.union(*(set(raw[idx].keys()) for idx in keys)))

    aligned: dict[str, dict[str, float]] = {}
    for idx in keys:
        last_val = None
        dmap: dict[str, float] = {}
        for d in all_dates_sorted:
            if d in raw[idx]:
                last_val = raw[idx][d]
            if last_val is not None:
                dmap[d] = last_val
        aligned[idx] = dmap

    start = max(min(raw[idx].keys()) for idx in keys)
    common_dates = [
        d for d in all_dates_sorted
        if d >= start and all(d in aligned[idx] for idx in keys)
    ]
    if not common_dates:
        raise ValueError('No common trading dates after forward-fill alignment')
    return aligned, common_dates


def load_csv_series(csv_path: Path, wanted_indices: dict[str, str]) -> dict[str, dict[str, float]]:
    series = {key: {} for key in wanted_indices}
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            idx = row['index']
            if idx in series:
                series[idx][row['date']] = float(row['close'])
    return series


def trim_dates(common_dates: list[str], start_date: str) -> list[str]:
    labels = [d for d in common_dates if d >= start_date]
    if not labels or labels[0] != start_date:
        raise ValueError(f'Start date {start_date} not present after alignment')
    return labels


def build_return_view(series, wanted_indices, labels, anchor_date, key, title, description, y_axis_label):
    base_close = {idx: series[idx][anchor_date] for idx in wanted_indices}
    datasets = {}
    latest = {}

    for idx, label in wanted_indices.items():
        values = [round((series[idx][d] / base_close[idx] - 1.0) * 100, 4) for d in labels]
        datasets[label] = values
        latest[label] = round(values[-1], 2)

    return {
        'type': 'returns',
        'key': key,
        'labels': labels,
        'baseDate': anchor_date,
        'points': len(labels),
        'datasets': datasets,
        'latest': latest,
        'title': title,
        'description': description,
        'yAxisLabel': y_axis_label,
    }


def compute_drawdown_payload(series, wanted_indices, labels):
    drawdown_datasets = {}
    latest_drawdown = {}
    panels = []
    csv_rows = []

    for idx, label in wanted_indices.items():
        closes = []
        drawdowns = []
        running_peak = None

        for d in labels:
            close = round(series[idx][d], 4)
            if running_peak is None:
                running_peak = close
            else:
                running_peak = max(running_peak, close)
            drawdown = round((close / running_peak - 1.0) * 100, 4)
            closes.append(close)
            drawdowns.append(drawdown)
            csv_rows.append({
                'date': d,
                'index': idx,
                'close': close,
                'running_peak': round(running_peak, 4),
                'drawdown_pct': drawdown,
            })

        drawdown_datasets[label] = drawdowns
        latest_drawdown[label] = round(drawdowns[-1], 2)
        panels.append({
            'label': label,
            'close': closes,
            'drawdown': drawdowns,
            'latestClose': closes[-1],
            'latestDrawdown': round(drawdowns[-1], 2),
        })

    view = {
        'type': 'drawdown',
        'key': 'drawdownCompare',
        'labels': labels,
        'baseDate': labels[0],
        'points': len(labels),
        'drawdownDatasets': drawdown_datasets,
        'latest': latest_drawdown,
        'title': 'Drawdown Compare',
        'description': (
            f"Drawdown starts on <strong>{labels[0]}</strong>. The top chart compares each index's drawdown from its own running peak. "
            'The five charts below pair each index level on the left axis with daily drawdown on the right axis.'
        ),
        'yAxisLabel': 'Drawdown from running peak (%)',
        'panels': panels,
    }
    return view, csv_rows


def build_payload(csv_path: Path) -> tuple[dict, list[dict[str, float | str]]]:
    series_raw = load_csv_series(csv_path, WANTED_INDICES)
    series, common_dates = forward_fill_aligned_series(series_raw, WANTED_INDICES)
    base_labels = trim_dates(common_dates, START_DATE)

    ytd_year = datetime.now().year
    ytd_labels = [d for d in base_labels if d.startswith(f'{ytd_year}-')]
    ytd_base_date = ytd_labels[0] if ytd_labels else base_labels[0]

    views = {
        'sinceBase': build_return_view(
            series,
            WANTED_INDICES,
            base_labels,
            START_DATE,
            'sinceBase',
            'Cumulative Returns Since 2020-01-02',
            (
                f"Base date is fixed at <strong>{START_DATE}</strong>. Series are aligned to the union of trading dates with forward-fill "
                'when one feed trails by a few sessions, so all five lines remain comparable through the latest date in this file.'
            ),
            'Cumulative return since 2020-01-02 (%)',
        ),
        'ytd': build_return_view(
            series,
            WANTED_INDICES,
            ytd_labels,
            ytd_base_date,
            'ytd',
            f'Cumulative Returns YTD ({ytd_year})',
            (
                f"YTD starts at <strong>{ytd_base_date}</strong>, the first aligned {ytd_year} trading day in this file. "
                'Forward-fill keeps the full basket on one calendar through the newest available session.'
            ),
            f'Cumulative return since {ytd_year} YTD start (%)',
        ),
    }

    drawdown_view, csv_rows = compute_drawdown_payload(series, WANTED_INDICES, base_labels)
    views['drawdownCompare'] = drawdown_view

    payload = {
        'seriesOrder': SERIES_ORDER,
        'colors': COLORS,
        'views': views,
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'sourceCsv': csv_path.name,
    }
    return payload, csv_rows


def render_html(payload: dict) -> str:
    views = payload['views']
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cumulative Returns and Drawdown Comparison</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {{
      --bg: #f4f6fb;
      --card: #ffffff;
      --border: #d9e0ea;
      --text: #111827;
      --muted: #4b5563;
      --muted-2: #6b7280;
      --tab-bg: #e8eef8;
      --tab-active-bg: #111827;
      --tab-active-text: #ffffff;
      --shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.08), transparent 32%),
        radial-gradient(circle at top right, rgba(22, 163, 74, 0.08), transparent 28%),
        var(--bg);
    }}
    .wrap {{ max-width: 1440px; margin: 0 auto; padding: 28px 20px 40px; }}
    .card {{
      background: var(--card);
      border: 1px solid rgba(217, 224, 234, 0.9);
      border-radius: 18px;
      padding: 24px;
      box-shadow: var(--shadow);
    }}
    h1 {{ margin: 0 0 10px; font-size: 30px; line-height: 1.15; }}
    h2.section-title {{ margin: 0 0 12px; font-size: 18px; }}
    .subhead {{ color: var(--muted); margin: 0 0 18px; line-height: 1.6; max-width: 1020px; }}
    .tabs {{ display: inline-flex; gap: 10px; padding: 8px; border-radius: 14px; background: var(--tab-bg); margin-bottom: 20px; flex-wrap: wrap; }}
    .tab {{
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: background-color 160ms ease, color 160ms ease, transform 160ms ease;
    }}
    .tab:hover {{ transform: translateY(-1px); }}
    .tab.active {{ background: var(--tab-active-bg); color: var(--tab-active-text); }}
    .controls-row {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin: 8px 0 18px;
    }}
    .preset-group {{
      display: inline-flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px;
      border-radius: 14px;
      background: #f3f6fb;
      border: 1px solid var(--border);
    }}
    .preset-btn {{
      appearance: none;
      border: 1px solid transparent;
      background: #ffffff;
      color: var(--muted);
      padding: 8px 12px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }}
    .preset-btn.active {{
      background: var(--tab-active-bg);
      color: var(--tab-active-text);
    }}
    .date-group {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }}
    .date-field {{
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--muted-2);
    }}
    .date-field input {{
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 10px;
      font: inherit;
      color: var(--text);
      background: #fff;
    }}
    .range-note {{ font-size: 12px; color: var(--muted-2); }}
    .meta-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin: 20px 0 18px;
    }}
    .meta-pill {{
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
      background: #fafbfd;
    }}
    .meta-label {{ font-size: 12px; color: var(--muted-2); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.04em; }}
    .meta-value {{ font-size: 18px; font-weight: 700; }}
    .metrics {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }}
    .metric {{
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px 16px;
      background: linear-gradient(180deg, #ffffff, #f8fafc);
    }}
    .metric-label {{ font-size: 12px; color: var(--muted-2); margin-bottom: 6px; }}
    .metric-value {{ font-size: 25px; font-weight: 800; letter-spacing: -0.02em; }}
    .metric-value.positive {{ color: #0f766e; }}
    .metric-value.negative {{ color: #b91c1c; }}
    .chart-panel {{
      height: 640px;
      padding: 16px 14px 8px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(248, 250, 252, 0.85), rgba(255, 255, 255, 1));
    }}
    .panel-block {{ display: none; }}
    .panel-block.active {{ display: block; }}
    .drawdown-grid {{ display: grid; grid-template-columns: 1fr; gap: 18px; }}
    .dual-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }}
    .mini-card {{
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      background: linear-gradient(180deg, #ffffff, #f8fafc);
    }}
    .mini-head {{ display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 12px; }}
    .mini-title {{ font-size: 16px; font-weight: 800; }}
    .mini-sub {{ font-size: 12px; color: var(--muted-2); }}
    .mini-chart {{ height: 320px; }}
    .note {{ font-size: 12px; color: var(--muted-2); line-height: 1.6; margin-top: 14px; }}
    @media (max-width: 980px) {{
      .dual-grid {{ grid-template-columns: 1fr; }}
    }}
    @media (max-width: 820px) {{
      .wrap {{ padding: 18px 14px 28px; }}
      .card {{ padding: 18px; }}
      h1 {{ font-size: 24px; }}
      .chart-panel {{ height: 460px; padding: 12px 8px 6px; }}
      .mini-chart {{ height: 280px; }}
      .metric-value {{ font-size: 22px; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="tabs" role="tablist" aria-label="Benchmark comparison views">
        <button class="tab active" type="button" role="tab" aria-selected="true" data-view="sinceBase">Tab 1 · Since Base</button>
        <button class="tab" type="button" role="tab" aria-selected="false" data-view="ytd">Tab 2 · 2026 YTD</button>
        <button class="tab" type="button" role="tab" aria-selected="false" data-view="drawdownCompare">Tab 3 · Drawdown Compare</button>
      </div>

      <h1 id="title"></h1>
      <p class="subhead" id="description"></p>

      <div class="controls-row">
        <div class="preset-group" id="range-presets" aria-label="Timeframe presets">
          <button class="preset-btn active" type="button" data-range="max">Max</button>
          <button class="preset-btn" type="button" data-range="5y">5Y</button>
          <button class="preset-btn" type="button" data-range="3y">3Y</button>
          <button class="preset-btn" type="button" data-range="1y">1Y</button>
          <button class="preset-btn" type="button" data-range="6m">6M</button>
          <button class="preset-btn" type="button" data-range="3m">3M</button>
        </div>
        <div class="date-group">
          <label class="date-field">
            <span>Start</span>
            <input id="start-date-input" type="date" />
          </label>
          <label class="date-field">
            <span>End</span>
            <input id="end-date-input" type="date" />
          </label>
        </div>
        <div class="range-note" id="range-note"></div>
      </div>

      <div class="meta-grid">
        <div class="meta-pill">
          <div class="meta-label">Base Date</div>
          <div class="meta-value" id="base-date"></div>
        </div>
        <div class="meta-pill">
          <div class="meta-label">Data Points</div>
          <div class="meta-value" id="points"></div>
        </div>
        <div class="meta-pill">
          <div class="meta-label">Series</div>
          <div class="meta-value">S&P 500 / Nasdaq / SMH / XLK / XLF</div>
        </div>
      </div>

      <div class="metrics" id="metrics"></div>

      <div id="returns-panel" class="panel-block active">
        <div class="chart-panel">
          <canvas id="returns-chart"></canvas>
        </div>
      </div>

      <div id="drawdown-panel" class="panel-block">
        <div class="drawdown-grid">
          <div>
            <h2 class="section-title">Drawdown comparison</h2>
            <div class="chart-panel">
              <canvas id="drawdown-chart"></canvas>
            </div>
          </div>
          <div>
            <h2 class="section-title">Index value and daily drawdown</h2>
            <div class="dual-grid" id="drawdown-dual-grid"></div>
          </div>
        </div>
      </div>

      <p class="note">Input CSV: <code>{payload['sourceCsv']}</code>. Generated on {payload['generatedAt']}.</p>
    </div>
  </div>

  <script>
    const seriesOrder = {json.dumps(payload['seriesOrder'], ensure_ascii=False)};
    const colors = {json.dumps(payload['colors'], ensure_ascii=False)};
    const views = {json.dumps(views, ensure_ascii=False)};

    const tabButtons = Array.from(document.querySelectorAll('.tab'));
    const presetButtons = Array.from(document.querySelectorAll('.preset-btn'));
    const titleEl = document.getElementById('title');
    const descriptionEl = document.getElementById('description');
    const baseDateEl = document.getElementById('base-date');
    const pointsEl = document.getElementById('points');
    const metricsEl = document.getElementById('metrics');
    const returnsPanel = document.getElementById('returns-panel');
    const drawdownPanel = document.getElementById('drawdown-panel');
    const dualGrid = document.getElementById('drawdown-dual-grid');
    const startDateInput = document.getElementById('start-date-input');
    const endDateInput = document.getElementById('end-date-input');
    const rangeNoteEl = document.getElementById('range-note');

    const rangeState = {{
      mode: 'max',
      start: null,
      end: null,
    }};

    let currentViewKey = 'sinceBase';

    function formatPercent(value) {{
      const sign = value > 0 ? '+' : '';
      return `${{sign}}${{value.toFixed(2)}}%`;
    }}

    function formatLevel(value) {{
      return Number(value).toLocaleString(undefined, {{ maximumFractionDigits: 2 }});
    }}

    function parseDateParts(dateStr) {{
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day);
    }}

    function shiftDate(dateStr, amount, unit) {{
      const d = parseDateParts(dateStr);
      if (unit === 'y') d.setFullYear(d.getFullYear() - amount);
      if (unit === 'm') d.setMonth(d.getMonth() - amount);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${{yyyy}}-${{mm}}-${{dd}}`;
    }}

    function clampDate(dateStr, minDate, maxDate) {{
      if (dateStr < minDate) return minDate;
      if (dateStr > maxDate) return maxDate;
      return dateStr;
    }}

    function getDateBounds(view) {{
      return {{
        minDate: view.labels[0],
        maxDate: view.labels[view.labels.length - 1],
      }};
    }}

    function computePresetRange(view, mode) {{
      const {{ minDate, maxDate }} = getDateBounds(view);
      if (mode === 'max') return {{ start: minDate, end: maxDate }};
      if (mode === '5y') return {{ start: clampDate(shiftDate(maxDate, 5, 'y'), minDate, maxDate), end: maxDate }};
      if (mode === '3y') return {{ start: clampDate(shiftDate(maxDate, 3, 'y'), minDate, maxDate), end: maxDate }};
      if (mode === '1y') return {{ start: clampDate(shiftDate(maxDate, 1, 'y'), minDate, maxDate), end: maxDate }};
      if (mode === '6m') return {{ start: clampDate(shiftDate(maxDate, 6, 'm'), minDate, maxDate), end: maxDate }};
      if (mode === '3m') return {{ start: clampDate(shiftDate(maxDate, 3, 'm'), minDate, maxDate), end: maxDate }};
      return {{ start: minDate, end: maxDate }};
    }}

    function getActiveRange(view) {{
      if (rangeState.mode === 'custom' && rangeState.start && rangeState.end) {{
        const {{ minDate, maxDate }} = getDateBounds(view);
        const start = clampDate(rangeState.start, minDate, maxDate);
        const end = clampDate(rangeState.end, minDate, maxDate);
        return start <= end ? {{ start, end }} : {{ start: end, end: start }};
      }}
      return computePresetRange(view, rangeState.mode);
    }}

    function sliceView(view) {{
      const range = getActiveRange(view);
      const startIdx = view.labels.findIndex((label) => label >= range.start);
      let endIdx = -1;
      for (let i = view.labels.length - 1; i >= 0; i -= 1) {{
        if (view.labels[i] <= range.end) {{
          endIdx = i;
          break;
        }}
      }}
      if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {{
        return {{
          labels: view.labels,
          rangeStart: view.labels[0],
          rangeEnd: view.labels[view.labels.length - 1],
          points: view.labels.length,
          latest: view.latest,
          datasets: view.datasets,
          drawdownDatasets: view.drawdownDatasets,
          panels: view.panels,
        }};
      }}

      const labels = view.labels.slice(startIdx, endIdx + 1);
      const sliced = {{
        labels,
        rangeStart: labels[0],
        rangeEnd: labels[labels.length - 1],
        points: labels.length,
      }};

      if (view.datasets) {{
        sliced.datasets = Object.fromEntries(Object.entries(view.datasets).map(([label, values]) => [label, values.slice(startIdx, endIdx + 1)]));
        sliced.latest = Object.fromEntries(Object.entries(sliced.datasets).map(([label, values]) => [label, Number(values[values.length - 1].toFixed(2))]));
      }}

      if (view.drawdownDatasets) {{
        sliced.drawdownDatasets = Object.fromEntries(Object.entries(view.drawdownDatasets).map(([label, values]) => [label, values.slice(startIdx, endIdx + 1)]));
        sliced.latest = Object.fromEntries(Object.entries(sliced.drawdownDatasets).map(([label, values]) => [label, Number(values[values.length - 1].toFixed(2))]));
      }}

      if (view.panels) {{
        sliced.panels = view.panels.map((panel) => {{
          const close = panel.close.slice(startIdx, endIdx + 1);
          const drawdown = panel.drawdown.slice(startIdx, endIdx + 1);
          return {{
            ...panel,
            close,
            drawdown,
            latestClose: close[close.length - 1],
            latestDrawdown: Number(drawdown[drawdown.length - 1].toFixed(2)),
          }};
        }});
      }}

      return sliced;
    }}

    function updateRangeControls(view, slicedView) {{
      const {{ minDate, maxDate }} = getDateBounds(view);
      const activeRange = getActiveRange(view);
      startDateInput.min = minDate;
      startDateInput.max = maxDate;
      endDateInput.min = minDate;
      endDateInput.max = maxDate;
      startDateInput.value = activeRange.start;
      endDateInput.value = activeRange.end;
      rangeNoteEl.textContent = `${{slicedView.rangeStart}} → ${{slicedView.rangeEnd}} · ${{slicedView.points.toLocaleString()}} trading days`;

      presetButtons.forEach((button) => {{
        button.classList.toggle('active', button.dataset.range === rangeState.mode);
      }});
    }}

    function renderMetrics(latest) {{
      metricsEl.innerHTML = seriesOrder.map((label) => {{
        const value = latest[label];
        const klass = value >= 0 ? 'positive' : 'negative';
        return `
          <div class="metric">
            <div class="metric-label">${{label}}</div>
            <div class="metric-value ${{klass}}">${{formatPercent(value)}}</div>
          </div>
        `;
      }}).join('');
    }}

    const returnsChart = new Chart(document.getElementById('returns-chart'), {{
      type: 'line',
      data: {{ labels: [], datasets: [] }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        interaction: {{ mode: 'index', intersect: false }},
        animation: false,
        plugins: {{
          legend: {{ position: 'top', labels: {{ usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 18 }} }},
          tooltip: {{ callbacks: {{ label: (ctx) => `${{ctx.dataset.label}}: ${{ctx.parsed.y.toFixed(2)}}%` }} }}
        }},
        scales: {{
          x: {{ title: {{ display: true, text: 'Trading day' }}, ticks: {{ maxTicksLimit: 18 }} }},
          y: {{ title: {{ display: true, text: '' }}, ticks: {{ callback: (value) => value + '%' }} }}
        }}
      }}
    }});

    const drawdownChart = new Chart(document.getElementById('drawdown-chart'), {{
      type: 'line',
      data: {{ labels: [], datasets: [] }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        interaction: {{ mode: 'index', intersect: false }},
        animation: false,
        plugins: {{
          legend: {{ position: 'top', labels: {{ usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 18 }} }},
          tooltip: {{ callbacks: {{ label: (ctx) => `${{ctx.dataset.label}}: ${{ctx.parsed.y.toFixed(2)}}%` }} }}
        }},
        scales: {{
          x: {{ title: {{ display: true, text: 'Trading day' }}, ticks: {{ maxTicksLimit: 18 }} }},
          y: {{ title: {{ display: true, text: 'Drawdown from running peak (%)' }}, ticks: {{ callback: (value) => value + '%' }} }}
        }}
      }}
    }});

    const dualCharts = new Map();

    function buildDualCards(view) {{
      dualGrid.innerHTML = '';
      dualCharts.forEach((chart) => chart.destroy());
      dualCharts.clear();
      view.panels.forEach((panel, index) => {{
        const slug = `dual-chart-${{index}}`;
        const card = document.createElement('div');
        card.className = 'mini-card';
        card.innerHTML = `
          <div class="mini-head">
            <div>
              <div class="mini-title">${{panel.label}}</div>
              <div class="mini-sub">Latest close: ${{formatLevel(panel.latestClose)}} · Latest drawdown: ${{formatPercent(panel.latestDrawdown)}}</div>
            </div>
          </div>
          <div class="mini-chart"><canvas id="${{slug}}"></canvas></div>
        `;
        dualGrid.appendChild(card);

        const chart = new Chart(card.querySelector('canvas'), {{
          type: 'line',
          data: {{
            labels: view.labels,
            datasets: [
              {{
                label: `${{panel.label}} level`,
                data: panel.close,
                borderColor: colors[panel.label],
                backgroundColor: colors[panel.label],
                yAxisID: 'yLevel',
                borderWidth: 2.5,
                pointRadius: 0,
                pointHoverRadius: 3,
                tension: 0.08,
              }},
              {{
                label: `${{panel.label}} drawdown`,
                data: panel.drawdown,
                borderColor: '#9f6b6b',
                backgroundColor: 'rgba(159, 107, 107, 0.24)',
                fill: 'origin',
                yAxisID: 'yDrawdown',
                borderWidth: 1.8,
                pointRadius: 0,
                pointHoverRadius: 3,
                tension: 0.08,
              }}
            ]
          }},
          options: {{
            responsive: true,
            maintainAspectRatio: false,
            interaction: {{ mode: 'index', intersect: false }},
            animation: false,
            plugins: {{
              legend: {{ position: 'top', labels: {{ usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 }} }},
              tooltip: {{
                callbacks: {{
                  label: (ctx) => ctx.dataset.yAxisID === 'yDrawdown'
                    ? `${{ctx.dataset.label}}: ${{ctx.parsed.y.toFixed(2)}}%`
                    : `${{ctx.dataset.label}}: ${{formatLevel(ctx.parsed.y)}}`
                }}
              }}
            }},
            scales: {{
              x: {{ ticks: {{ maxTicksLimit: 10 }} }},
              yLevel: {{
                type: 'linear',
                position: 'left',
                title: {{ display: true, text: 'Index value' }},
                ticks: {{ callback: (value) => formatLevel(value) }}
              }},
              yDrawdown: {{
                type: 'linear',
                position: 'right',
                title: {{ display: true, text: 'Drawdown (%)' }},
                ticks: {{ callback: (value) => value + '%' }},
                grid: {{ drawOnChartArea: false }}
              }}
            }}
          }}
        }});

        dualCharts.set(slug, chart);
      }});
    }}

    function applyReturnView(viewKey) {{
      const view = views[viewKey];
      const slicedView = sliceView(view);
      titleEl.textContent = view.title;
      descriptionEl.innerHTML = view.description;
      baseDateEl.textContent = slicedView.rangeStart;
      pointsEl.textContent = slicedView.points.toLocaleString();
      renderMetrics(slicedView.latest);
      updateRangeControls(view, slicedView);
      returnsPanel.classList.add('active');
      drawdownPanel.classList.remove('active');

      returnsChart.data.labels = slicedView.labels;
      returnsChart.data.datasets = seriesOrder.map((label) => ({{
        label,
        data: slicedView.datasets[label],
        borderColor: colors[label],
        backgroundColor: colors[label],
        borderWidth: label === 'S&P 500' ? 3 : 2,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.08,
      }}));
      returnsChart.options.scales.y.title.text = view.yAxisLabel;
      returnsChart.update();
    }}

    function applyDrawdownView() {{
      const view = views.drawdownCompare;
      const slicedView = sliceView(view);
      titleEl.textContent = view.title;
      descriptionEl.innerHTML = view.description;
      baseDateEl.textContent = slicedView.rangeStart;
      pointsEl.textContent = slicedView.points.toLocaleString();
      renderMetrics(slicedView.latest);
      updateRangeControls(view, slicedView);
      returnsPanel.classList.remove('active');
      drawdownPanel.classList.add('active');

      drawdownChart.data.labels = slicedView.labels;
      drawdownChart.data.datasets = seriesOrder.map((label) => ({{
        label,
        data: slicedView.drawdownDatasets[label],
        borderColor: colors[label],
        backgroundColor: `${{colors[label]}}33`,
        fill: 'origin',
        borderWidth: label === 'S&P 500' ? 2.6 : 1.8,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.08,
      }}));
      drawdownChart.update();

      buildDualCards(slicedView);
    }}

    function applyView(viewKey) {{
      currentViewKey = viewKey;
      tabButtons.forEach((button) => {{
        const active = button.dataset.view === viewKey;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      }});

      if (viewKey === 'drawdownCompare') {{
        applyDrawdownView();
      }} else {{
        applyReturnView(viewKey);
      }}
    }}

    presetButtons.forEach((button) => {{
      button.addEventListener('click', () => {{
        rangeState.mode = button.dataset.range;
        rangeState.start = null;
        rangeState.end = null;
        applyView(currentViewKey);
      }});
    }});

    function applyCustomRange() {{
      if (!startDateInput.value || !endDateInput.value) return;
      rangeState.mode = 'custom';
      rangeState.start = startDateInput.value;
      rangeState.end = endDateInput.value;
      applyView(currentViewKey);
    }}

    startDateInput.addEventListener('change', applyCustomRange);
    endDateInput.addEventListener('change', applyCustomRange);

    tabButtons.forEach((button) => {{
      button.addEventListener('click', () => applyView(button.dataset.view));
    }});

    applyView('sinceBase');
  </script>
</body>
</html>
'''


def write_drawdown_csv(output_path: Path, rows: list[dict[str, float | str]]) -> None:
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'index', 'close', 'running_peak', 'drawdown_pct'])
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    bench_dir = Path(__file__).resolve().parent
    input_path = bench_dir / INPUT_CSV
    output_html = bench_dir / OUTPUT_HTML
    output_drawdown_csv = bench_dir / OUTPUT_DRAWDOWN_CSV

    payload, drawdown_rows = build_payload(input_path)
    html = render_html(payload)

    with open(output_html, 'w', encoding='utf-8') as f:
        f.write(html)

    write_drawdown_csv(output_drawdown_csv, drawdown_rows)

    print(f'✓ Wrote {output_html}')
    print(f'✓ Wrote {output_drawdown_csv}')


if __name__ == '__main__':
    main()
