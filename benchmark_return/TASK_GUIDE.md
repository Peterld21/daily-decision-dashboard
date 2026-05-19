# benchmark_return 任务说明

## 目标

在 `webapp/benchmark_return/` 下维护一套可复用的基准收益分析资产，用于：

- 抓取 `historyofmarket.com` 相关指数数据
- 补充 `SMH` 历史价格序列
- 输出统一格式的 CSV 数据文件
- 生成可直接打开的收益对比 HTML 页面
- 为后续策略、相对收益、轮动分析提供稳定输入

---

## 当前目录结构

```text
benchmark_return/
├── fetch_benchmark_data.py
├── generate_benchmark_html.py
├── market_prices_post2020_20260513.csv
├── cumulative_returns_since_20200101_20260513.html
└── TASK_GUIDE.md
```

说明：

- `fetch_benchmark_data.py`：负责抓数据并生成 CSV
- `generate_benchmark_html.py`：负责读取 CSV 并生成 HTML
- `market_prices_post2020_*.csv`：标准化后的长表数据
- `cumulative_returns_since_20200101_*.html`：可视化页面

---

## 数据来源

### historyofmarket.com

当前使用的接口：

- `https://historyofmarket.com/api/sp500/price.json`
- `https://historyofmarket.com/api/nasdaq/composite.json`
- `https://historyofmarket.com/api/xlk/price.json`
- `https://historyofmarket.com/api/fin/price.json`

覆盖指数：

- `sp500`
- `nasdaq`
- `xlk`
- `xlf`

### SMH

由于历史任务中 `historyofmarket.com` 没有直接提供稳定可复用的 `SMH` 同类价格接口，当前脚本改为：

- 使用 Yahoo Finance chart API 获取 `SMH` 日线价格

这样可以避免 `yfinance` 的额外依赖和限流问题。

---

## 运行方式

### 1. 生成 CSV

```bash
python3 benchmark_return/fetch_benchmark_data.py \
  --output benchmark_return/market_prices_post2020_{date}.csv
```

默认行为：

- 起始日期：`2020-01-01`
- 自动输出当天日期命名的 CSV

### 2. 生成 HTML

```bash
python3 benchmark_return/generate_benchmark_html.py \
  --input "benchmark_return/market_prices_post2020_*.csv" \
  --output benchmark_return/cumulative_returns_since_20200101_{date}.html
```

默认行为：

- 自动选择最新的 CSV
- 生成双 tab HTML 页面：
  - Since Base
  - 2026 YTD

---

## CSV 结构

输出字段：

```text
date,index,close,source,note
```

字段说明：

- `date`: 交易日，格式 `YYYY-MM-DD`
- `index`: 指数代码，当前包括 `sp500/nasdaq/smh/xlk/xlf`
- `close`: 收盘价
- `source`: 数据来源
- `note`: 预留说明字段

这是后续所有分析脚本的标准输入格式，新增脚本应尽量复用。

---

## HTML 当前功能

当前 HTML 具备：

- Tab 1：自共同基期以来的累计收益率
- Tab 2：2026 YTD 累计收益率
- 五条指数曲线统一展示
- 每个视图显示：
  - base date
  - data points
  - latest cumulative return summary

---

## 建议的下一步迭代

### P1：补回月度相对收益表

历史任务最初要求之一是：

- 计算 `nasdaq / smh / xlk / xlf` 相对 `sp500` 的 monthly return comparison
- 在 HTML 中展示折线图和表格

建议新增：

- `generate_benchmark_monthly_relative_html.py`

功能建议：

- 先按月末收盘价聚合
- 计算每个指数月收益率
- 再计算相对 `sp500` 的 excess return
- 生成：
  - 折线图
  - 最近 24 个月表格

### P2：参数化年份

当前 HTML 中 YTD 视图写死为 `2026`。

建议改为：

- 自动识别最新年份
- 或通过参数传入 `--ytd-year 2026`

这样后续无需每年改代码。

### P3：增加更多 benchmark

可扩展加入：

- `QQQ`
- `SOXX`
- `IWM`
- `DIA`
- `VGT`
- `XLE`
- `XLI`

��求：

- 保持 CSV schema 不变
- 仅扩展 `index` 取值
- HTML 脚本增加可配置选择列表

### P4：增加数据质量检查

建议在 CSV 生成后加入校验：

- 是否每个指数都有数据
- 是否起始日覆盖到 2020-01-01 之后
- 是否存在长时间缺口
- 是否最新日期严重滞后

可新增：

- `validate_benchmark_data.py`

### P5：为 webapp 首页集成做准备

如果后续要把这个页面并入主站：

- 将 HTML 的数据部分改成读取本地 JSON/CSV
- 将页面样式拆分到 `css/`
- 将图表逻辑拆分到 `js/`
- 最终挂到独立路由或入口页

---

## 推荐任务拆分

后续可以按下面顺序继续：

1. 把 monthly relative return 逻辑独立成第三个脚本
2. 给 HTML 增加 monthly table
3. 把 YTD 年份改为自动推断
4. 增加数据校验脚本
5. 再考虑前端集成到主 webapp

---

## 注意事项

- `historyofmarket.com` 接口字段并不完全一致：
  - 有的用 `close`
  - 有的用 `value`
- 因此新增指数前，先验证接口 schema
- `SMH` 当前不走 `historyofmarket.com`，而是走 Yahoo chart API
- 如果未来发现更稳定的 `SMH` 公共接口，可以替换，但要保持 CSV 输出格式不变

---

## 交付标准

后续每次迭代建议至少满足：

- 脚本可重复运行
- CSV 输出结构不变
- HTML 可直接本地打开
- 若改动指标口径，需要同步更新本文件
