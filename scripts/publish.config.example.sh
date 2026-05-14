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

# 是否走 DeepSeek 精简摘要 (`--no-ta-summary-llm` 反向开关)；默认 1（开）
USE_TA_SUMMARY_LLM=1

# K 线天数（report_to_json --bars）
CHART_BARS=60

# Git commit 作者（留空则用当前 git config）
# GIT_AUTHOR_NAME="Peter Li"
# GIT_AUTHOR_EMAIL="you@example.com"
