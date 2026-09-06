#!/usr/bin/env python3
"""Offline quality gate for generated dashboard data."""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Any


def _load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        obj = json.load(handle)
    if not isinstance(obj, dict):
        raise ValueError(f"{path} root must be an object")
    return obj


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--report-date", required=True, help="YYYYMMDD")
    parser.add_argument("--expected-date", default="", help="daily run expected YYYYMMDD")
    parser.add_argument("--stocks", required=True, help="comma-separated tickers")
    args = parser.parse_args()

    expected = {
        item.strip().upper() for item in args.stocks.split(",") if item.strip()
    }
    report_day = datetime.strptime(args.report_date, "%Y%m%d").date()
    index_path = args.data_dir / "reports" / args.report_date / "index.json"
    charts_dir = index_path.parent / "charts"
    errors: list[str] = []
    warnings: list[str] = []

    if args.expected_date:
        normalized_expected = args.expected_date.replace("-", "")
        if normalized_expected != args.report_date:
            errors.append(
                f"报告日期不符合本轮有效交易日: report={args.report_date}, "
                f"expected={normalized_expected}"
            )

    try:
        payload = _load(index_path)
    except Exception as exc:
        print(f"[QUALITY][ERROR] index.json 无法读取: {exc}", file=sys.stderr)
        return 1

    rows = payload.get("summary_rows") or []
    cards = payload.get("cards") or []
    actual = {
        str(row.get("ticker") or "").upper()
        for row in rows if isinstance(row, dict)
    }
    missing = sorted(expected - actual)
    if missing:
        errors.append(f"摘要缺少 {len(missing)} 只股票: {', '.join(missing)}")
    if len(actual) != len(expected):
        warnings.append(f"摘要数量 expected={len(expected)}, actual={len(actual)}")

    blank_advice = [
        str(row.get("ticker") or "?")
        for row in rows
        if isinstance(row, dict) and not str(row.get("advice") or "").strip()
    ]
    if blank_advice:
        errors.append(f"交易建议为空: {', '.join(blank_advice)}")
    advice_counts = Counter(
        str(row.get("advice") or "").strip() for row in rows if isinstance(row, dict)
    )
    if rows and len(advice_counts) == 1:
        only = next(iter(advice_counts))
        errors.append(f"全部 {len(rows)} 只股票建议相同（{only or '空'}），疑似分析降级")

    missing_fundamentals = [
        str(row.get("ticker") or "?")
        for row in rows
        if isinstance(row, dict)
        and str(row.get("market_cap_display") or "—").strip() == "—"
        and str(row.get("pe_forward_display") or "—").strip() == "—"
    ]
    if len(missing_fundamentals) > len(rows) // 2:
        warnings.append(
            f"基本面大面积缺失 {len(missing_fundamentals)}/{len(rows)}；"
            "请检查雪球 token/限流"
        )

    card_map = {
        str(card.get("ticker") or "").upper(): card
        for card in cards if isinstance(card, dict)
    }
    missing_intel = [
        ticker for ticker in sorted(expected)
        if not str((card_map.get(ticker) or {}).get("intel_md") or "").strip()
    ]
    if len(missing_intel) > max(2, len(expected) // 5):
        errors.append(
            f"新闻情报缺失 {len(missing_intel)}/{len(expected)}: "
            + ", ".join(missing_intel)
        )
    elif missing_intel:
        warnings.append(f"少量新闻情报缺失: {', '.join(missing_intel)}")

    chart_count = sum(1 for ticker in expected if (charts_dir / f"{ticker}.json").is_file())
    if chart_count < len(expected):
        errors.append(f"图表文件不完整: {chart_count}/{len(expected)}")

    weekly = payload.get("weekly_strategy") or {}
    if not weekly or not weekly.get("stance") or not weekly.get("breadth"):
        errors.append("weekly_strategy 缺失或结构不完整")

    benchmark_path = args.data_dir / "benchmark_indices.json"
    try:
        benchmark = _load(benchmark_path)
        views = benchmark.get("views") or {}
        labels = (views.get("sinceBase") or {}).get("labels") or []
        if labels:
            benchmark_day = date.fromisoformat(labels[-1])
            lag = (report_day - benchmark_day).days
            if lag > 7:
                errors.append(f"指数数据落后报告 {lag} 天（latest={benchmark_day}）")
            elif lag > 3:
                warnings.append(f"指数数据落后报告 {lag} 天（可能含周末/休市）")
        else:
            errors.append("benchmark_indices.json 缺少 sinceBase.labels")
    except Exception as exc:
        errors.append(f"benchmark_indices.json 无法读取: {exc}")

    for message in warnings:
        print(f"[QUALITY][WARN] {message}", file=sys.stderr)
    for message in errors:
        print(f"[QUALITY][ERROR] {message}", file=sys.stderr)

    if errors:
        print(
            f"[QUALITY] FAILED errors={len(errors)} warnings={len(warnings)}",
            file=sys.stderr,
        )
        return 1
    print(
        f"[QUALITY] PASS stocks={len(actual)} charts={chart_count} "
        f"advice={dict(advice_counts)} warnings={len(warnings)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
