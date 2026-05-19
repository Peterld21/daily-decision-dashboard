#!/usr/bin/env python3
"""
Generate cumulative returns HTML visualization from benchmark CSV.

Reads a CSV file with columns [date, index, close, source, note] and generates
an interactive HTML chart showing cumulative returns since a base date, with
optional YTD view.

Usage:
    python generate_benchmark_html.py [--input INPUT_CSV] [--output OUTPUT_HTML] [--json-output PATH]

Output:
    Interactive HTML with Chart.js visualization showing:
    - Tab 1: Cumulative returns since base date (first common trading day)
    - Tab 2: YTD cumulative returns (2026 only)

    Additionally writes zh-CN structured JSON for the web dashboard «指数趋势» tab:
    ../data/benchmark_indices.json (override with --json-output, suppress with --no-dashboard-json).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path


def load_csv_series(csv_path, wanted_indices):
    """
    Load time series from CSV file.

    Args:
        csv_path: Path to CSV file
        wanted_indices: Dict mapping index names to display labels

    Returns:
        Dict mapping index names to {date: close_price}
    """
    series = {key: {} for key in wanted_indices}
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            idx = row['index']
            if idx in series:
                series[idx][row['date']] = float(row['close'])
    return series


def build_view(series, wanted_indices, labels, anchor_date, key, title, description, y_axis_label):
    """
    Build a single view (tab) of cumulative returns.

    Args:
        series: Dict mapping index names to {date: close_price}
        wanted_indices: Dict mapping index names to display labels
        labels: List of dates to include in this view
        anchor_date: Base date for cumulative return calculation
        key: View identifier
        title: View title
        description: View description HTML
        y_axis_label: Y-axis label for chart

    Returns:
        Dict with view configuration
    """
    base_close = {idx: series[idx][anchor_date] for idx in wanted_indices}
    datasets = {}
    latest = {}

    for idx, label in wanted_indices.items():
        values = [round((series[idx][d] / base_close[idx] - 1.0) * 100, 4) for d in labels]
        datasets[label] = values
        latest[label] = round(values[-1], 2)

    return {
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


def build_views(series, wanted_indices, common_dates, base_date, ytd_dates, ytd_base_date, *, zh: bool, ytd_year: int):
    """组装 sinceBase / ytd 两套视图；zh=True 时标题与说明为中文版（仪表盘 Tab2）。"""
    if zh:
        return {
            'sinceBase': build_view(
                series, wanted_indices, common_dates, base_date, 'sinceBase',
                '自共同基期以来累计涨跌',
                f'基期为各指数<strong>首个共同交易日</strong>：<strong>{base_date}</strong>。'
                '各线为该基期以来累计收益率，可直接对比风格轮动。',
                '累计涨跌（%）',
            ),
            'ytd': build_view(
                series, wanted_indices, ytd_dates, ytd_base_date, 'ytd',
                f'{ytd_year} 年年初至今（YTD）',
                f'YTD 起算日为 <strong>{ytd_base_date}</strong>（各指数 {ytd_year} 年首个共有交易日）。'
                '弱化跨年长期复利基差，便于观察当年相对强弱。',
                'YTD 累计涨跌（%）',
            ),
        }
    return {
        'sinceBase': build_view(
            series, wanted_indices, common_dates, base_date, 'sinceBase',
            'Cumulative Returns Since Base Date',
            f"Base date is the first common trading day on or after 2020-01-01 across all five series: <strong>{base_date}</strong>. "
            "Each line shows cumulative return since that shared base date so cross-index rotation and leadership stay directly comparable.",
            'Cumulative return since base date (%)',
        ),
        'ytd': build_view(
            series, wanted_indices, ytd_dates, ytd_base_date, 'ytd',
            f'Cumulative Returns YTD ({ytd_year})',
            f"YTD starts from the first common {ytd_year} trading day across all five series: <strong>{ytd_base_date}</strong>. "
            "This isolates the current-year rotation pattern without the distortion of older-year compounding base.",
            f'Cumulative return since {ytd_year} YTD start (%)',
        ),
    }


def build_dashboard_payload(
    csv_path: Path | str,
    wanted_indices: dict,
    colors: dict,
    series_order: list,
    *,
    zh: bool = True,
) -> dict:
    """
    产出与 HTML 嵌入结构一致的 dict，可供 webapp 静态 JSON（ECharts）使用。
    zh=True（默认）：中文标题与说明，对齐仪表盘 Tab「指数趋势」。
    """
    csv_path = Path(csv_path)
    series = load_csv_series(csv_path, wanted_indices)
    common_dates = sorted(set.intersection(*[set(values.keys()) for values in series.values()]))
    if not common_dates:
        raise ValueError('No common trading dates across required indices')
    base_date = common_dates[0]
    ytd_year = datetime.now().year
    ytd_dates = [d for d in common_dates if d.startswith(f'{ytd_year}-')]
    ytd_base_date = ytd_dates[0] if ytd_dates else base_date

    views = build_views(
        series, wanted_indices, common_dates, base_date,
        ytd_dates, ytd_base_date,
        zh=zh, ytd_year=ytd_year,
    )

    return {
        'schemaVersion': 1,
        'seriesOrder': series_order,
        'colors': colors,
        'views': views,
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'sourceCsv': csv_path.name,
    }


def generate_html(csv_path, output_path, wanted_indices, colors, series_order):
    """
    Generate HTML visualization from CSV data.

    Args:
        csv_path: Path to input CSV
        output_path: Path to output HTML
        wanted_indices: Dict mapping index names to display labels
        colors: Dict mapping display labels to hex colors
        series_order: List of display labels in desired order
    """
    payload = build_dashboard_payload(csv_path, wanted_indices, colors, series_order, zh=False)
    views = payload['views']

    # Generate HTML
    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cumulative Returns Comparison</title>
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
    .wrap {{ max-width: 1320px; margin: 0 auto; padding: 28px 20px 40px; }}
    .card {{
      background: var(--card);
      border: 1px solid rgba(217, 224, 234, 0.9);
      border-radius: 18px;
      padding: 24px;
      box-shadow: var(--shadow);
    }}
    h1 {{ margin: 0 0 10px; font-size: 30px; line-height: 1.15; }}
    .subhead {{ color: var(--muted); margin: 0 0 18px; line-height: 1.6; max-width: 980px; }}
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
    .note {{ font-size: 12px; color: var(--muted-2); line-height: 1.6; margin-top: 14px; }}
    @media (max-width: 820px) {{
      .wrap {{ padding: 18px 14px 28px; }}
      .card {{ padding: 18px; }}
      h1 {{ font-size: 24px; }}
      .chart-panel {{ height: 460px; padding: 12px 8px 6px; }}
      .metric-value {{ font-size: 22px; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="tabs" role="tablist" aria-label="Return comparison views">
        <button class="tab active" type="button" role="tab" aria-selected="true" data-view="sinceBase">Tab 1 · Since Base</button>
        <button class="tab" type="button" role="tab" aria-selected="false" data-view="ytd">Tab 2 · 2026 YTD</button>
      </div>

      <h1 id="title"></h1>
      <p class="subhead" id="description"></p>

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

      <div class="chart-panel">
        <canvas id="chart"></canvas>
      </div>

      <p class="note">Input CSV: <code>{Path(csv_path).name}</code>. Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}.</p>
    </div>
  </div>

  <script>
    const seriesOrder = {json.dumps(payload["seriesOrder"], ensure_ascii=False)};
    const colors = {json.dumps(payload["colors"], ensure_ascii=False)};
    const views = {json.dumps(views, ensure_ascii=False)};

    const tabButtons = Array.from(document.querySelectorAll('.tab'));
    const titleEl = document.getElementById('title');
    const descriptionEl = document.getElementById('description');
    const baseDateEl = document.getElementById('base-date');
    const pointsEl = document.getElementById('points');
    const metricsEl = document.getElementById('metrics');

    function formatReturn(value) {{
      const sign = value > 0 ? '+' : '';
      return `${{sign}}${{value.toFixed(2)}}%`;
    }}

    function renderMetrics(latest) {{
      metricsEl.innerHTML = seriesOrder.map((label) => {{
        const value = latest[label];
        const klass = value >= 0 ? 'positive' : 'negative';
        return `
          <div class="metric">
            <div class="metric-label">${{label}}</div>
            <div class="metric-value ${{klass}}">${{formatReturn(value)}}</div>
          </div>
        `;
      }}).join('');
    }}

    const chart = new Chart(document.getElementById('chart'), {{
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
          x: {{
            title: {{ display: true, text: 'Trading day' }},
            ticks: {{ maxTicksLimit: 18 }}
          }},
          y: {{
            title: {{ display: true, text: '' }},
            ticks: {{ callback: (value) => value + '%' }}
          }}
        }}
      }}
    }});

    function applyView(viewKey) {{
      const view = views[viewKey];

      tabButtons.forEach((button) => {{
        const active = button.dataset.view === viewKey;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      }});

      titleEl.textContent = view.title;
      descriptionEl.innerHTML = view.description;
      baseDateEl.textContent = view.baseDate;
      pointsEl.textContent = view.points.toLocaleString();
      renderMetrics(view.latest);

      chart.data.labels = view.labels;
      chart.data.datasets = seriesOrder.map((label) => ({{
        label,
        data: view.datasets[label],
        borderColor: colors[label],
        backgroundColor: colors[label],
        borderWidth: label === 'S&P 500' ? 3 : 2,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.08,
      }}));
      chart.options.scales.y.title.text = view.yAxisLabel;
      chart.update();
    }}

    tabButtons.forEach((button) => {{
      button.addEventListener('click', () => applyView(button.dataset.view));
    }});

    applyView('sinceBase');
  </script>
</body>
</html>
'''

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)


def main():
    dash_json_default = Path(__file__).resolve().parent.parent / 'data' / 'benchmark_indices.json'
    parser = argparse.ArgumentParser(description='Generate cumulative returns HTML from benchmark CSV')
    parser.add_argument('--input', default='market_prices_post2020_*.csv',
                        help='Input CSV path (glob pattern supported)')
    parser.add_argument('--output', default='cumulative_returns_since_20200101_{date}.html',
                        help='Output HTML path (use {date} for YYYYMMDD timestamp)')
    parser.add_argument('--json-output', type=Path, default=dash_json_default,
                        help='Write zh-CN dashboard JSON for webapp Tab2 (ECharts)')
    parser.add_argument('--no-dashboard-json', action='store_true',
                        help='Do not write benchmark_indices.json')
    args = parser.parse_args()

    bench_dir = Path(__file__).resolve().parent

    # Resolve input path（默认同目录 CSV；支持从任意 cwd 运行）
    input_path = args.input
    if '*' in input_path:
        from glob import glob

        pattern = input_path if Path(input_path).is_absolute() else str(bench_dir / input_path)
        matches = sorted(glob(pattern))
        if not matches:
            print(f'ERROR: No files matching pattern: {pattern}', file=sys.stderr)
            sys.exit(1)
        input_path = matches[-1]
        print(f'Using latest CSV: {input_path}')
    elif not Path(input_path).is_absolute():
        input_path = str(bench_dir / input_path)

    if not Path(input_path).exists():
        print(f'ERROR: Input file not found: {input_path}', file=sys.stderr)
        sys.exit(1)

    # Resolve output path（HTML 默认写在 benchmark_return 目录）
    output_path = args.output
    if '{date}' in output_path:
        date_tag = datetime.now().strftime('%Y%m%d')
        output_path = output_path.replace('{date}', date_tag)
    if not Path(output_path).is_absolute():
        output_path = str(bench_dir / output_path)

    # Configuration
    wanted_indices = {
        'sp500': 'S&P 500',
        'nasdaq': 'Nasdaq Composite',
        'smh': 'SMH',
        'xlk': 'XLK',
        'xlf': 'XLF',
    }

    colors = {
        'S&P 500': '#111827',
        'Nasdaq Composite': '#2563eb',
        'SMH': '#dc2626',
        'XLK': '#16a34a',
        'XLF': '#9333ea',
    }

    series_order = ['S&P 500', 'Nasdaq Composite', 'SMH', 'XLK', 'XLF']

    print(f"Generating HTML from {input_path}...")
    generate_html(input_path, output_path, wanted_indices, colors, series_order)
    print(f"✓ Wrote {output_path}")

    if not args.no_dashboard_json:
        payload_zh = build_dashboard_payload(input_path, wanted_indices, colors, series_order, zh=True)
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        with open(args.json_output, 'w', encoding='utf-8') as f:
            json.dump(payload_zh, f, ensure_ascii=False, indent=2)
        print(f"✓ Wrote {args.json_output}")


if __name__ == '__main__':
    main()
