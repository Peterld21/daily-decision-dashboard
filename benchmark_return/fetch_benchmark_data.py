#!/usr/bin/env python3
"""
Fetch benchmark index data from historyofmarket.com and Yahoo Finance chart API.

Fetches daily price data for S&P 500, Nasdaq Composite, XLK, XLF from
historyofmarket.com API, and SMH from Yahoo Finance chart API. Outputs a unified CSV
with all series aligned to post-2020 trading days.

Usage:
    python fetch_benchmark_data.py [--output OUTPUT_CSV]

Output:
    CSV with columns: date, index, close, source, note
    （默认文件名 market_prices_post2020_publish.csv，相对路径相对于本脚本所在目录，
     供 generate_benchmark_html.py 生成 data/benchmark_indices.json）
"""

import argparse
import csv
import json
import math
import sys
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen, Request

SCRIPT_DIR = Path(__file__).resolve().parent


def fetch_json(url, headers=None):
    """Fetch JSON from URL with optional headers."""
    if headers is None:
        headers = {'User-Agent': 'Mozilla/5.0'}
    req = Request(url, headers=headers)
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def fetch_historyofmarket_series(url, series_key, date_key, value_key, start_date='2020-01-01'):
    """
    Fetch a time series from historyofmarket.com API.

    Args:
        url: API endpoint URL
        series_key: JSON key containing the series array
        date_key: Key for date field in each series item
        value_key: Key for value field in each series item
        start_date: Filter to dates >= this value

    Returns:
        List of (date, value) tuples sorted by date
    """
    obj = fetch_json(url)
    rows = []
    for item in obj.get(series_key, []):
        d = item.get(date_key)
        v = item.get(value_key)
        if d and v is not None and d >= start_date:
            rows.append((d, float(v)))
    return sorted(rows, key=lambda x: x[0])


def fetch_smh_yahoo_chart(start_date='2020-01-01'):
    """
    Fetch SMH price data from Yahoo Finance chart API.

    Args:
        start_date: Start date in YYYY-MM-DD format

    Returns:
        List of (date, value) tuples sorted by date
    """
    start_ts = int(datetime.strptime(start_date, '%Y-%m-%d').timestamp())
    url = (
        'https://query1.finance.yahoo.com/v8/finance/chart/SMH'
        f'?period1={start_ts}&period2=9999999999&interval=1d&includeAdjustedClose=false'
    )
    req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urlopen(req, timeout=30) as r:
        obj = json.loads(r.read().decode('utf-8'))

    result = obj.get('chart', {}).get('result', [])
    if not result:
        raise RuntimeError('Failed to fetch SMH from Yahoo Finance chart API')

    payload = result[0]
    timestamps = payload.get('timestamp', [])
    quote = payload.get('indicators', {}).get('quote', [{}])[0]
    closes = quote.get('close', [])

    rows = []
    for ts, val in zip(timestamps, closes):
        if val is None or (isinstance(val, float) and math.isnan(val)):
            continue
        date = datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d')
        if date >= start_date:
            rows.append((date, float(val)))

    if not rows:
        raise RuntimeError('SMH chart API returned no usable rows')

    return rows


def main():
    parser = argparse.ArgumentParser(description='Fetch benchmark index data from historyofmarket.com and yfinance')
    parser.add_argument(
        '--output',
        default='market_prices_post2020_publish.csv',
        help='输出 CSV（相对路径相对于本脚本目录；占位 {date} 表示当天 YYYYMMDD）',
    )
    parser.add_argument('--start-date', default='2020-01-01',
                        help='Start date for data fetch (default: 2020-01-01)')
    args = parser.parse_args()

    # Resolve output path
    output_path = args.output
    if '{date}' in output_path:
        date_tag = datetime.now().strftime('%Y%m%d')
        output_path = output_path.replace('{date}', date_tag)
    out_p = Path(output_path)
    if not out_p.is_absolute():
        out_p = SCRIPT_DIR / out_p
    output_path = str(out_p)

    print(f"Fetching benchmark data from {args.start_date}...")

    # Define data sources
    sources = {
        'sp500': {
            'url': 'https://historyofmarket.com/api/sp500/price.json',
            'series_key': 'series',
            'date_key': 'date',
            'value_key': 'close',
            'source_label': 'historyofmarket',
        },
        'nasdaq': {
            'url': 'https://historyofmarket.com/api/nasdaq/composite.json',
            'series_key': 'series',
            'date_key': 'date',
            'value_key': 'value',
            'source_label': 'historyofmarket',
        },
        'xlk': {
            'url': 'https://historyofmarket.com/api/xlk/price.json',
            'series_key': 'series',
            'date_key': 'date',
            'value_key': 'close',
            'source_label': 'historyofmarket',
        },
        'xlf': {
            'url': 'https://historyofmarket.com/api/fin/price.json',
            'series_key': 'series',
            'date_key': 'date',
            'value_key': 'close',
            'source_label': 'historyofmarket',
        },
    }

    # Fetch historyofmarket series
    series_map = {}
    for name, config in sources.items():
        print(f"  Fetching {name.upper()} from historyofmarket.com...")
        rows = fetch_historyofmarket_series(
            config['url'],
            config['series_key'],
            config['date_key'],
            config['value_key'],
            args.start_date
        )
        series_map[name] = {
            'rows': rows,
            'source': config['source_label'],
        }
        print(f"    → {len(rows)} data points")

    # Fetch SMH from Yahoo Finance chart API
    print("  Fetching SMH from Yahoo Finance chart API...")
    smh_rows = fetch_smh_yahoo_chart(args.start_date)
    series_map['smh'] = {
        'rows': smh_rows,
        'source': 'yahoo_chart',
    }
    print(f"    → {len(smh_rows)} data points")

    # Write unified CSV
    print(f"\nWriting CSV to {output_path} ...")
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['date', 'index', 'close', 'source', 'note'])

        for name in ['sp500', 'nasdaq', 'smh', 'xlk', 'xlf']:
            config = series_map[name]
            for date, value in config['rows']:
                writer.writerow([date, name, f'{value:.6f}', config['source'], ''])

    print(f"✓ Wrote {output_path}")
    print(f"  Indices: sp500, nasdaq, smh, xlk, xlf")
    print(f"  Date range: {args.start_date} → latest available")


if __name__ == '__main__':
    main()
