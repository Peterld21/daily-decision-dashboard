# Daily Stock Decision Dashboard (Webapp)

> 个人美股决策仪表盘的纯静态前端。
> **本地** 跑 Python 流水线产出 JSON，**前端** 只读 JSON、用 ECharts 在浏览器现场绘图。
> 部署目标：GitHub + Cloudflare Pages。

---

## 一、技术栈（对齐 `TECH_STACK_ANALYSIS.md` 中 Big Picture 路线）

| 层 | 选择 | 说明 |
|---|---|---|
| 前端形态 | 原生 HTML + CSS + ES Modules | 不引入 React/Vue/打包器 |
| 图表 | Apache ECharts 5（CDN） | 与 Big Picture 一致 |
| 字体 | system-ui + PingFang SC 兜底 | 极简 |
| 加载 | 中央数据仓库 + `IntersectionObserver` 懒初始化 | 仿 `panels.js` |
| 缓存策略 | 首屏 `index.json` 走 `force-cache`；细分 K 线 JSON 加 `?v=<DATA_VERSION>` | 仿 Big Picture 双策略 |

**铁律**：浏览器 **绝不** 请求任何外部 API（yfinance / fear&greed / 雪球 …），一切数据来自同源 `data/*.json`。

---

## 二、目录结构

```text
webapp/
├── index.html
├── css/
│   └── main.css
├── js/
│   ├── utils.js          # fetchJSON / DATA_VERSION / DOM helpers
│   ├── app.js            # 入口：中央数据仓库 + 调度 + 懒初始化
│   ├── chart-helpers.js  # ECharts 通用配置
│   ├── macro-hero.js     # QQQ/SCHD + 恐贪指数
│   ├── intel-digest.js   # 重要信息总览（利空/利好）
│   ├── summary-table.js  # 决策摘要表
│   ├── stock-cards.js    # 个股卡片渲染
│   ├── kline.js          # 个股 K 线 ECharts option
│   └── benchmark.js      # 个股 vs QQQ 累计涨跌幅
└── data/
    ├── manifest.json
    └── reports/
        └── 20260505/
            ├── index.json
            └── charts/
                ├── AAPL.json
                ├── GOOG.json
                └── ...
```

---

## 三、数据契约

### 3.1 `data/manifest.json`

```json
{
  "latest": "20260505",
  "history": ["20260505", "20260502", "20260501"],
  "generated_at": "2026-05-05T18:10:00+08:00"
}
```

### 3.2 `data/reports/<YYYYMMDD>/index.json`

> 首屏完整可读，含全部摘要级与文本数据，**不含 K 线 OHLCV**。

字段（节选）：

```json
{
  "date": "2026-05-05",
  "title": "🎯 2026-05-05 决策仪表盘",
  "subtitle": "共分析 27 只股票 | 🟢买入:10 🟡观望:15 🔴卖出:2",
  "counts": { "buy": 10, "hold": 15, "watch": 0, "sell": 2, "total": 27 },

  "macro": {
    "dates": ["2026-02-05", "..."],
    "qqq_pct": [0, 0.21, ...],
    "schd_pct": [0, 0.15, ...],
    "fng_values": [40, 41, ...]
  },

  "intel": {
    "bear": { "AAPL": ["..."], "GOOG": ["..."] },
    "bull": { "AAPL": ["..."], "TSLA": ["..."] }
  },

  "summary_rows": [
    {
      "emoji": "🟢", "ticker": "AAPL", "name": "苹果",
      "advice": "买入", "score": 77, "trend": "看多",
      "close": 276.83, "ma5": 275.06, "ma10": 273.13, "ma20": 268.42,
      "bias": "0.6% 安全", "support": 275.06, "resistance": 280.63,
      "ret5_pct": 3.4, "ret20_pct": 6.9,
      "market_cap_display": "3.97T", "pe_forward_display": "23.6",
      "ta_summary": "强多头趋势，MACD 零上强势..."
    }
  ],

  "cards": [
    {
      "ticker": "AAPL", "emoji": "🟢", "name": "苹果",
      "signal_class": "signal-buy",
      "intel_md": "**💭 舆情情绪**: ...",
      "core_conclusion_md": "**🟢 买入** | 看多\n...",
      "ta_summary": "强多头趋势...",
      "daily_quote_md": "| 收盘 | ... |\n|---|---|\n| 276.83 | ... |",
      "data_perspective_md": "**均线排列**: MA5 > MA10 > MA20 ..."
    }
  ]
}
```

### 3.3 `data/reports/<YYYYMMDD>/charts/<TICKER>.json`

> 每只标的的图表数据，懒加载。

```json
{
  "ticker": "AAPL",
  "kline": {
    "dates": ["2026-02-05", ...],
    "ohlc":  [[279, 281, 276, 282], ...],   // [open, close, low, high]
    "volume": [54593798, ...],
    "ma5":  [null, null, null, null, 80.81, ...],
    "ma10": [null, ...],
    "ma20": [null, ...],
    "crosses_last3": [{"date": "...", "price": 76.55, "label": "金叉", "kind": "golden"}],
    "volume_points": [{"date": "...", "price": 76.55, "label": "放量上涨", "kind": "vp"}],
    "volume_last_note": "最近交易日：量能约为5日均量的0.8倍（中性）...",
    "price_levels": {
      "ideal_buy": 275.06,
      "second_buy": 273.13,
      "stop_loss": 268.42,
      "target": 280.63
    }
  },
  "benchmark": {
    "base_date": "2026-02-05",
    "end_date": "2026-05-04",
    "dates": ["2026-02-05", ...],
    "stock_vs_base_pct": [0, 0.43, ...],
    "qqq_vs_base_pct":   [0, 0.31, ...],
    "excess_return_pct": -10.91
  }
}
```

---

## 四、本地构建 → 推送 GitHub 流程

```bash
# 1) 跑你的分析流水线（已有）
cd daily_stock_analysis
.venv/bin/python main.py ...
.venv/bin/python scripts/generate_trade_action_report.py reports/report_YYYYMMDD.md
.venv/bin/python scripts/fetch_watchlist_fundamentals_xueqiu.py --date YYYYMMDD --report reports/report_YYYYMMDD.md

# 2) ★ 新增一步：把 md/csv/json/SQLite → webapp/data/*.json
.venv/bin/python scripts/report_to_json.py reports/report_YYYYMMDD.md \
    --out ../webapp/data

# 3) 推送到 GitHub
cd ../webapp
git add data/ && git commit -m "auto-update dashboard YYYYMMDD" && git push
```

GitHub 收到 push 后，Cloudflare Pages 会自动构建并部署整站。

---

## 五、本地开发

```bash
cd webapp
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

> 用 `http.server` 而非 `file://` 直接打开，避免 ES Modules / `fetch` 的 CORS 限制。
