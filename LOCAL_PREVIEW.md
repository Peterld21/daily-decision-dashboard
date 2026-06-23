# 本地 HTML 前端迭代链路

目标：改 `webapp/` 里 **HTML / CSS / JS** 时，先用**仓库里已有**的日报数据生成 `data/*.json`，在浏览器确认后再推送 GitHub（Cloudflare Pages 等会自动部署）。

与 **「报告编译 + 函数级说明」** 的对应关系见：[`../daily_stock_analysis/docs/HTML_PIPELINE_OFFLINE.md`](../daily_stock_analysis/docs/HTML_PIPELINE_OFFLINE.md)。

## 前提

- `daily_stock_analysis/reports/` 里已有对应日期的 `report_YYYYMMDD.md`（以及常见的 `trade_action_*.md`、`watchlist_fundamentals_*.csv`、benchmark JSON 等；缺省时部分表格会显示「—」或为空，但仍可预览布局）。
- 已创建虚拟环境：`daily_stock_analysis/.venv`
- 可选：在 `webapp/scripts/publish.config.sh` 中配置 `DSA_DIR`、`CHART_BARS` 等（与 `publish.sh` 共用）。

## 推荐用法（每天调 UI）

在 **`webapp/`** 目录：

```bash
chmod +x scripts/local-preview.sh   # 仅首次
./scripts/local-preview.sh --offline --serve
```

- `--offline` → 传给 `report_to_json.py` 的 **`--no-macro`**，避免编译期请求恐贪等**外网**接口；QQQ/SCHD 宏观序列仍可走 **本地 SQLite**（有数据时）。
- 改 `index.html` / `css/` / `js/` 后**强刷**即可；需要更新摘要/K 线 JSON 时再跑同一命令。

浏览器访问终端里给出的 `http://127.0.0.1:8765/`（**务必 `http://`**，不要用 `file://`，否则 ES Module / `fetch` 会受限）。

脚本内说明性输出已用 **`printf` / 纯 ASCII**，避免在 `set -u` 下因含全角括号等字符串触发的异常参数展开。

### 常用参数

| 参数 | 含义 |
|------|------|
| `--date 20260516` | 指定日期；不传则用 `reports/` 下最新的 `report_*.md` |
| `--offline` | 不写宏观区里依赖**外部**恐贪接口的数据（仍用本地 SQLite 的 QQQ/SCHD 序列，若有） |
| `--no-charts` | 不生成 `charts/*.json`，改摘要表/页顶时可加快 |
| `--no-llm` | 摘要表交易总结不走 DeepSeek（与 `publish.sh --no-llm-summary` 一致） |
| `--serve 9000` | 编译完成后起静态服务（默认端口 8765） |

不加 `--serve` 时，脚本只生成 JSON，并打印如何用 `python3 -m http.server` 手动起服务。

## 与上线的关系

1. **只改前端**：反复执行 `./scripts/local-preview.sh`（推荐加 `--offline --serve`），**不必**跑 `main.py`。
2. **本脚本在流水线中的位置**：`local-preview.sh` **仅**封装 `daily_stock_analysis/scripts/report_to_json.py`，与 `publish.sh` 的 **第 4 步（Markdown → `webapp/data`）**一致；**不会**拉五指数、**不会** `git commit/push`。若「指数趋势」Tab 也要刷新，需另行跑 `benchmark_return/fetch_benchmark_data.py` + `generate_benchmark_html.py`，或跑完整 `publish.sh`（默认含 3b）。
3. **验收后推远程**：在 `daily_stock_analysis` 侧已有所需 `report_*.md` 等产物时：

   ```bash
   cd webapp
   ./scripts/publish.sh --data-only --push
   ```

   `--data-only` 会跳过 `main.py`、交易动作、基本面抓取，但仍会按配置执行 **五指数 → `benchmark_indices.json`**（若未 `--skip-benchmark-indices`），再跑 `report_to_json.py`，最后 commit/push **`data/`**。若只想推送与本地预览**完全一致**的 JSON、且仓库里指数 JSON 已满意，可用 `git` 手工只提交所需文件，或临时在 `publish.config.sh` 设 `RUN_BENCHMARK_INDICES=0` 再 `--data-only --push`。

## 说明

- `report_to_json.py` 在**未**加 `--offline` 时，宏观区可能访问恐贪等接口；纯前端调试可始终加 `--offline`。
- K 线依赖本地 **SQLite**；若库中无数据，图表区可能为空，属正常现象。
