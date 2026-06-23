# ----------------------------------------------------------------------------
# publish.config.sh  ——  本地一次性配置；publish.sh 会 source 这里。
#
# 用法：
#   cp publish.config.example.sh publish.config.sh
#   然后编辑下面的 STOCKS / 其他变量
#
# 本文件被 .gitignore 屏蔽；example 版会进仓库。
# ----------------------------------------------------------------------------

# 自选股列表（逗号分隔；同 daily_stock_analysis/main.py --stocks 入参）
STOCKS="AAPL,GOOG,TSLA,SCHD,AMZN,LNG,QQQ,NOK,INTC,LITE,NET,IBKR,CRM,SNDK,MU,AMD,MSFT,BABA,PDD,CRWV,NOW,SE,NVDA,PLTR,ORCL,META,HOOD"

# Python 解释器路径（默认用 daily_stock_analysis/.venv/bin/python）
# PYTHON_BIN="/Users/lidong/Desktop/webapp_dev/daily_stock_analysis/.venv/bin/python"

# 分析子项目根目录（默认 ../../daily_stock_analysis 相对 scripts/）
# DSA_DIR="/Users/lidong/Desktop/webapp_dev/daily_stock_analysis"

# 是否跑 Xueqiu 基本面（市值 / Forward PE）；默认 1（开）
RUN_FUNDAMENTALS=1

# 是否拉取「指数趋势」五指数 CSV 并重算 webapp/data/benchmark_indices.json
# （默认开；需在 publish 时能访问 historyofmarket + Yahoo；访客浏览器不落外部 API）

RUN_BENCHMARK_INDICES=1

# 是否同步 marco_analysis 的「AI Infra」总览页到 webapp/data/ai_infra/（默认 1）
# 仅文件拷贝，不跑 marco_analysis 的数据/分析流水线（那是独立的 run_dashboard_pipeline.sh）
RUN_AI_INFRA=1

# AI Infra 源目录（marco_analysis 的 html_reports）；默认与 webapp 同级
# AI_INFRA_SRC_DIR="/Users/lidong/Desktop/webapp_dev/marco_analysis/html_reports"

# —— daily_refresh.sh 专用（每日一键刷数）——
# marco_analysis 项目根目录（含 run_dashboard_pipeline.sh）；默认与 webapp 同级
# MARCO_DIR="/Users/lidong/Desktop/webapp_dev/marco_analysis"
# 是否在 daily_refresh 中重跑 marco 的 AI Infra 数据流水线（默认 1；设 0 等价 --skip-marco）
# RUN_MARCO=1

# Git commit 作者（留空则用当前 git config）
# GIT_AUTHOR_NAME="Peter Li"
# GIT_AUTHOR_EMAIL="you@example.com"

# git push → GitHub 网络不稳时可选（publish.sh 已实现默认 HTTP/1.1 + 重试）
# GIT_HTTP_VERSION=HTTP/1.1
# GIT_PUSH_MAX_ATTEMPTS=5
# GIT_PUSH_RETRY_DELAY_SEC=20

# main.py 并发（默认 2，低于 daily_stock_analysis/.env 的 MAX_WORKERS 时以此为准）
# PUBLISH_MAX_WORKERS=2

# 非交易日仍跑 main.py：默认自动 --force-run；设为 1 则无论是否交易日都 force-run
# PUBLISH_FORCE_RUN=0
