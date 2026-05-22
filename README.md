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
│   ├── benchmark-indices.js # 「指数趋势」Tab（读 benchmark_indices.json + ECharts）
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

### 3.4 `data/benchmark_indices.json`（「指数趋势」Tab）

> 五条指数对齐基期后的累计涨跌曲线；前端只读这一份 JSON。

- **产出（本机跑一次，不进浏览器）**：`benchmark_return/fetch_benchmark_data.py` 拉 historyofmarket + Yahoo → 本地 CSV（默认 `benchmark_return/market_prices_post2020_publish.csv`，已 `.gitignore`）→ `generate_benchmark_html.py` 写入 **`data/benchmark_indices.json`**。  
- **发布**：默认已并入 `./scripts/publish.sh`；可在 `publish.config.sh` 里设 `RUN_BENCHMARK_INDICES=0`，或 CLI 传 `--skip-benchmark-indices`（离线 / 数据源故障时）。  

---

## 四、本地构建 → 推送 GitHub 流程

**先验收再推 `data/`**：只改 `webapp/` 前端或想快速看效果时，不要用 `file://`；在 `webapp/` 下执行 `./scripts/local-preview.sh --offline --serve`，浏览器打开终端提示的 `http://127.0.0.1:8765/`。详参 [`LOCAL_PREVIEW.md`](./LOCAL_PREVIEW.md)。

**一键全量发布**（含指数 JSON，见脚本头注释）：

```bash
cd webapp
./scripts/publish.sh --push
```

等价的手动分拆步骤如下（便于理解每一环）：

```bash
# 1) 跑分析流水线（在 daily_stock_analysis）
cd daily_stock_analysis
.venv/bin/python main.py ...
.venv/bin/python scripts/generate_trade_action_report.py reports/report_YYYYMMDD.md
.venv/bin/python scripts/fetch_watchlist_fundamentals_xueqiu.py --date YYYYMMDD --report reports/report_YYYYMMDD.md

# 1b) 指数趋势静态 JSON（与 publish.sh 内置步骤一致）
.venv/bin/python ../webapp/benchmark_return/fetch_benchmark_data.py
.venv/bin/python ../webapp/benchmark_return/generate_benchmark_html.py --input market_prices_post2020_publish.csv

# 2) 把 md/csv/json/SQLite → webapp/data/*.json（首屏个股等）
.venv/bin/python scripts/report_to_json.py reports/report_YYYYMMDD.md \
    --out ../webapp/data

# 3) 推送（通常只提交 data/；也可用 publish.sh）
cd ../webapp
git add data/ && git commit -m "auto-update dashboard YYYYMMDD" && git push
```

GitHub 收到 push 后，Cloudflare Pages 会自动构建并部署整站。

**端到端链路**（GitHub Actions、GitHub Pages 备用、`publish.sh`、与 Cloudflare 的分工）：见工作区上一级 [`PROJECT_PIPELINE_AND_DEPLOYMENT.md`](../PROJECT_PIPELINE_AND_DEPLOYMENT.md)（与 `webapp/` 同属 `webapp_dev` 根目录时可用此相对路径）。

**只改前端、先用本地已有数据预览**：不要在未确认前就把 `data/` 推上线。

- 每日迭代 UI：[`LOCAL_PREVIEW.md`](./LOCAL_PREVIEW.md) 中的 `./scripts/local-preview.sh --offline --serve`（从 `report_*.md` 编译 JSON，与 `publish.sh` **第 4 步**同源；**不**含五指数拉数、**不** git）。
- 确认后再执行 `./scripts/publish.sh --data-only --push`（仍会按配置刷新 `benchmark_indices.json` 等；见 `LOCAL_PREVIEW.md` 说明）。

与 **单页 HTML（`report_to_html.py`）**、**函数级管线** 合并说明见 [`../daily_stock_analysis/docs/HTML_PIPELINE_OFFLINE.md`](../daily_stock_analysis/docs/HTML_PIPELINE_OFFLINE.md)。

---

## 五、本地开发

```bash
cd webapp
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

> 用 `http.server` 而非 `file://` 直接打开，避免 ES Modules / `fetch` 的 CORS 限制。更简单的一步见 [`LOCAL_PREVIEW.md`](./LOCAL_PREVIEW.md)（自动从 `daily_stock_analysis/reports/` 生成 `data/` 并可带 `--serve`）。

---

## 六、移动端访问

### 6.1 推荐顺序

1. **首选** Cloudflare Pages 的 `*.pages.dev` 主域，或自己的自定义域。
2. **备用** GitHub Pages（已配置 `.github/workflows/pages.yml` 自动镜像）：
   `https://<user>.github.io/<repo>/`
3. `*.workers.dev` 在部分移动运营商 / 公共 Wi-Fi 上会被 DNS 屏蔽，**不建议**作为主入口。

### 6.2 已做的移动适配

- `<meta viewport>` 包含 `viewport-fit=cover`，适配 iPhone 刘海屏。
- 安全区内边距 `env(safe-area-inset-*)` 避免 Home Bar 遮挡。
- 摘要表横向滚动 + 首列 sticky（滚到右侧仍能看到代码）。
- TOC 在手机端变成横向 scroll-snap 条，不再占整屏宽度。
- 个股卡片单列；K 线 220px、benchmark 170px；超小屏（< 380px）再减小。
- 取消 `.card-body` 的 `max-height: 42vh`（嵌套滚动在 iOS Safari 体验差）。
- ECharts 监听 `orientationchange` + `visualViewport.resize`，旋转屏幕后图表自动重绘。
- `navigator.onLine` 判断离线给出明确提示。

### 6.3 故障排查

- 手机能打开 Google / 其他网站，但本站打不开 → 八成是运营商屏蔽了 `*.workers.dev`，换 `*.pages.dev` 或 GitHub Pages 地址。
- 页面打开但卡片空 → 应该已经看到红色横幅提示；检查 `data/manifest.json` 是否成功上传。
- 图表显示但拖动卡顿 → ECharts dataZoom 默认开启了手机触控；如仍卡，可在 `chart-helpers.js` 中临时把 `animation: false`。
