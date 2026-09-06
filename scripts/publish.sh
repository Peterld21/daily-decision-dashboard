#!/usr/bin/env bash
# 兼容性自检：macOS 自带 bash 3.2，对嵌套引号 + 多行 $(...) 易抽风
# 本脚本已重写避坑；如果再加新代码，请确保不依赖 bash 4+ 语法
# ============================================================================
# publish.sh — 一键发布每日决策仪表盘
#
#   1) 在 daily_stock_analysis 跑主流程（可 --skip-* 分段跳过）：
#        - main.py                          (行情 API + 新闻 + LLM)
#        - rebuild_benchmark_from_db.py     (SQLite 对齐 QQQ 个股基准)
#        - generate_trade_action_report.py（交易动作）
#        - fetch_watchlist_fundamentals     (可选；雪球基本面)
#
#   2) benchmark_return（仪表盘「指数趋势」Tab；默认开，可跳过）：
#        - fetch_benchmark_data.py → market_prices_post2020_publish.csv（本地产物，不进库）
#        - generate_benchmark_html.py → ../data/benchmark_indices.json（静态同源，访客零外部 API）
#
#   3) report_to_json.py → webapp/data/**
#
#   4) git add data/ (+ commit)，可选 --push → Cloudflare Pages / GitHub
#
# 网络：部分网络对 GitHub HTTPS 的 HTTP/2 会间歇性超时（Recv failure / Operation timed out）。
# publish 时默认 export GIT_HTTP_VERSION=HTTP/1.1，并带有限次重试；可在 publish.config.sh 里覆盖：
#   GIT_HTTP_VERSION=HTTP/1.1   # 为空则关闭（走系统默认，多为 HTTP/2）
#   GIT_PUSH_MAX_ATTEMPTS=5
#   GIT_PUSH_RETRY_DELAY_SEC=20
#
# 用法：
#   ./scripts/publish.sh                # dry-run，落地 JSON 但不 push
#   ./scripts/publish.sh --push         # 真的 push 到 GitHub
#   ./scripts/publish.sh --data-only    # 跳过本地分析、只重转 JSON 并 push
#   ./scripts/publish.sh --force-analyze # 忽略同交易日完整报告，强制重跑新闻/LLM
#   ./scripts/publish.sh --date 20260505 --push
#   ./scripts/publish.sh --skip-fundamentals --push
#   ./scripts/publish.sh --skip-benchmark-indices --push   # 禁拉五指数 CSV（离线 / 数据源故障）
#   ./scripts/publish.sh --force-benchmark-indices --push  # 强制重拉五指数
#   ./scripts/publish.sh --skip-ai-infra --push            # 不同步 marco_analysis 的 AI Infra 总览页
#
# 非交易日（周末/休市）：仍会跑 main.py（自动加 --force-run），报告日期对齐最新交易日。
#
# 退出码：
#   0  全部成功；或仅"无变更" (data 未变)
#   2  配置缺失或前置检查失败
#   3  Python pipeline 失败
#   4  git push 失败
# ============================================================================
set -euo pipefail

# --- 颜色 ---------------------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; CYAN=""; RESET=""
fi
ts() { date +"%H:%M:%S"; }
log()  { printf "${DIM}[%s]${RESET} %s\n" "$(ts)" "$*"; }
ok()   { printf "${DIM}[%s]${RESET} ${GREEN}✓${RESET} %s\n" "$(ts)" "$*"; }
warn() { printf "${DIM}[%s]${RESET} ${YELLOW}!${RESET} %s\n" "$(ts)" "$*" >&2; }
err()  { printf "${DIM}[%s]${RESET} ${RED}✗${RESET} %s\n" "$(ts)" "$*" >&2; }
step() { printf "\n${BOLD}${BLUE}── %s ──${RESET}\n" "$*"; }

# --- 路径解析 -----------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
WEBAPP_ROOT="$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)"
WEBAPP_DATA="${WEBAPP_ROOT}/data"
LOG_DIR="${WEBAPP_ROOT}/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/publish_$(date +%Y%m%d_%H%M%S).log"

# Python 输出不要被块缓冲（关键：这样你能实时看到进度）
export PYTHONUNBUFFERED=1
export PYTHONIOENCODING=UTF-8
# 避免调用方继承 LITELLM_LOG=DEBUG 后把完整 Prompt 写入超大日志。
export LITELLM_LOG="${PUBLISH_LITELLM_LOG:-WARNING}"
PIPELINE_STARTED=$SECONDS

# 子步骤执行包装：
#   - 实时把 stdout/stderr 同步到屏幕 & 日志
#   - pipefail + PIPESTATUS 捕获真实退出码
#   - 描述行打到屏幕
run_step() {
  local label="$1"; shift
  local started=$SECONDS
  printf "${DIM}[%s]${RESET} ${CYAN}\$${RESET} %s\n" "$(ts)" "$*" | tee -a "$LOG_FILE" >&2
  set +e
  "$@" 2>&1 | tee -a "$LOG_FILE"
  local rc=${PIPESTATUS[0]}
  set -e
  if [[ $rc -ne 0 ]]; then
    err "$label 失败 (exit=$rc, elapsed=$((SECONDS - started))s)，详见 $LOG_FILE"
    return $rc
  fi
  ok "$label 完成 (elapsed=$((SECONDS - started))s)"
  return 0
}

# GitHub HTTPS：HTTP/2 在部分网络下会 recv 超时；仅用环境变量（不写 git config）。
# 若需恢复默认传输，在 publish.config.sh 中设：  GIT_HTTP_VERSION=
git_push_with_retries() {
  local a=1 rc=0
  local max_attempts="${GIT_PUSH_MAX_ATTEMPTS:-5}"
  local delay_sec="${GIT_PUSH_RETRY_DELAY_SEC:-20}"
  local post_buffer="${GIT_PUSH_POST_BUFFER:-524288000}"
  local -a git_push_args=(-c "http.postBuffer=${post_buffer}" -c http.lowSpeedLimit=0 -c http.lowSpeedTime=999999)
  if [[ -n "${GIT_HTTP_VERSION+x}" && -z "${GIT_HTTP_VERSION}" ]]; then
    :
  else
    export GIT_HTTP_VERSION="${GIT_HTTP_VERSION:-HTTP/1.1}"
    git_push_args+=(-c "http.version=${GIT_HTTP_VERSION}")
  fi
  while [[ $a -le $max_attempts ]]; do
    log "git push（第 ${a}/${max_attempts} 次） GIT_HTTP_VERSION=${GIT_HTTP_VERSION:-<默认>} postBuffer=${post_buffer}"
    set +e
    git "${git_push_args[@]}" push
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      return 0
    fi
    if [[ $a -lt $max_attempts ]]; then
      warn "git push 失败 (exit=$rc)，${delay_sec}s 后重试…"
      sleep "$delay_sec"
    fi
    a=$((a + 1))
  done
  return "$rc"
}

# --- 默认参数 -----------------------------------------------------------------
PUSH=0
DATA_ONLY=0
SKIP_ANALYZE=0
SKIP_TRADE_ACTION=0
FORCE_ANALYZE=0
FORCE_BENCHMARK_INDICES=0
RUN_FUNDAMENTALS=1
CHART_BARS=60
FORCE_DATE=""

# --- 加载用户配置 -------------------------------------------------------------
CONFIG="${SCRIPT_DIR}/publish.config.sh"
if [[ -f "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG"
  log "loaded config: $CONFIG"
else
  warn "未找到 ${CONFIG}；将使用默认值"
  warn "建议：cp scripts/publish.config.example.sh scripts/publish.config.sh 后编辑 STOCKS"
fi

# 从 daily_stock_analysis/.env 桥接雪球 token / 基本面策略（仅本进程，不打印明文）
bridge_dsa_env() {
  local env_file="${DSA_DIR:-${WEBAPP_ROOT%/webapp}/daily_stock_analysis}/.env"
  [[ -f "$env_file" ]] || return 0
  local k v
  for k in XUEQIU_XQ_A_TOKEN XQ_A_TOKEN FUNDAMENTALS_SKIP_YFINANCE \
           FUNDAMENTALS_PREFER_XUEQIU FUNDAMENTALS_XQ_INTER_TICKER_SLEEP \
           FUNDAMENTALS_YF_HTTP_BLOCK_FAST_FAIL; do
    eval "v=\${$k:-}"
    if [[ -z "$v" ]]; then
      v="$(grep -aoE "${k}=[^[:space:]\"']+" "$env_file" 2>/dev/null | head -1 | sed -E "s/^${k}=//" || true)"
      [[ -n "$v" ]] && export "$k=$v"
    fi
  done
  return 0
}
RUN_BENCHMARK_INDICES="${RUN_BENCHMARK_INDICES:-1}"
RUN_AI_INFRA="${RUN_AI_INFRA:-1}"

# --- 参数解析 -----------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)                PUSH=1; shift ;;
    --no-push)             PUSH=0; shift ;;
    --data-only)           DATA_ONLY=1; SKIP_ANALYZE=1; SKIP_TRADE_ACTION=1; RUN_FUNDAMENTALS=0; shift ;;
    --skip-analyze)        SKIP_ANALYZE=1; shift ;;
    --force-analyze)       FORCE_ANALYZE=1; shift ;;
    --skip-trade-action)   SKIP_TRADE_ACTION=1; shift ;;
    --skip-fundamentals)   RUN_FUNDAMENTALS=0; shift ;;
    --skip-benchmark-indices) RUN_BENCHMARK_INDICES=0; shift ;;
    --force-benchmark-indices) FORCE_BENCHMARK_INDICES=1; shift ;;
    --skip-ai-infra)       RUN_AI_INFRA=0; shift ;;
    --date)                FORCE_DATE="${2:-}"; shift 2 ;;
    --stocks)              STOCKS="${2:-}"; shift 2 ;;
    --bars)                CHART_BARS="${2:-60}"; shift 2 ;;
    -h|--help)
      sed -n '2,52p' "$0"
      exit 0 ;;
    *)
      err "未知参数：$1"
      exit 2 ;;
  esac
done

# --- 解析关键路径 -------------------------------------------------------------
DSA_DIR="${DSA_DIR:-${WEBAPP_ROOT%/webapp}/daily_stock_analysis}"
if [[ ! -d "$DSA_DIR" ]]; then
  err "找不到 daily_stock_analysis 目录：$DSA_DIR"
  err "请在 publish.config.sh 中设置 DSA_DIR"
  exit 2
fi

PYTHON_BIN="${PYTHON_BIN:-${DSA_DIR}/.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  warn "venv python 不存在或不可执行：$PYTHON_BIN"
  warn "回退到系统 python3"
  PYTHON_BIN="$(command -v python3)"
fi

if [[ -z "${STOCKS:-}" && $SKIP_ANALYZE -eq 0 ]]; then
  err "STOCKS 列表为空。请在 publish.config.sh 中设置，或加 --stocks AAPL,TSLA,..."
  exit 2
fi

# --- 概览 ---------------------------------------------------------------------
# 兼容 macOS bash 3.2：避免嵌套引号 + 括号在 $(...) 内（会触发幽灵语法错误）
if [[ $PUSH       -eq 1 ]]; then PUSH_STR="yes";          else PUSH_STR="no (dry-run)"; fi
if [[ $DATA_ONLY  -eq 1 ]]; then DATAONLY_STR="yes";      else DATAONLY_STR="no";       fi
STOCKS_STR="${STOCKS:-[skipped]}"

if [[ $RUN_BENCHMARK_INDICES -eq 1 ]]; then BENCH_STR="yes"; else BENCH_STR="no"; fi
if [[ $RUN_AI_INFRA -eq 1 ]]; then AIINFRA_STR="yes"; else AIINFRA_STR="no"; fi

step "Plan"
printf "  ${CYAN}WEBAPP_ROOT${RESET}  %s\n" "$WEBAPP_ROOT"
printf "  ${CYAN}DSA_DIR    ${RESET}  %s\n" "$DSA_DIR"
printf "  ${CYAN}PYTHON_BIN ${RESET}  %s\n" "$PYTHON_BIN"
printf "  ${CYAN}STOCKS     ${RESET}  %s\n" "$STOCKS_STR"
printf "  ${CYAN}PUSH       ${RESET}  %s\n" "$PUSH_STR"
printf "  ${CYAN}DATA_ONLY  ${RESET}  %s\n" "$DATAONLY_STR"
printf "  ${CYAN}BENCH_TAB  ${RESET}  %s  (historyofmarket + Yahoo → benchmark_indices.json)\n" "$BENCH_STR"
printf "  ${CYAN}AI_INFRA   ${RESET}  %s  (marco_analysis html_reports → data/ai_infra)\n" "$AIINFRA_STR"
[[ -n "$FORCE_DATE" ]] && printf "  ${CYAN}FORCE_DATE ${RESET}  %s\n" "$FORCE_DATE"

# --- 交易日历：有效报告日 & 是否需 force-run -----------------------------------
EFFECTIVE_TRADE_DATE=""
FORCE_RUN_FLAG=0
if [[ -n "${STOCKS:-}" ]]; then
  set +e
  CALENDAR_OUT=$("$PYTHON_BIN" -u "$DSA_DIR/scripts/publish_trading_calendar.py" --stocks "$STOCKS" 2>>"$LOG_FILE")
  CALENDAR_RC=$?
  set -e
  if [[ $CALENDAR_RC -ne 0 ]]; then
    err "交易日历解析失败 (exit=$CALENDAR_RC)，拒绝回退到可能错误的报告日期；详见 $LOG_FILE"
    exit 2
  fi
  EFFECTIVE_TRADE_DATE=$(printf '%s\n' "$CALENDAR_OUT" | sed -n 's/^effective_date=//p')
  FORCE_RUN_FLAG=$(printf '%s\n' "$CALENDAR_OUT" | sed -n 's/^force_run=//p')
  if [[ -z "$EFFECTIVE_TRADE_DATE" ]]; then
    err "交易日历未返回 effective_date，拒绝继续发布；详见 $LOG_FILE"
    exit 2
  fi
  [[ -n "$EFFECTIVE_TRADE_DATE" ]] && \
    printf "  ${CYAN}AS_OF      ${RESET}  %s  (最新有效交易日)\n" "$EFFECTIVE_TRADE_DATE"
  if [[ "${FORCE_RUN_FLAG:-0}" == "1" ]]; then
    printf "  ${CYAN}CALENDAR   ${RESET}  今日非交易日 → main.py 将加 --force-run\n"
  fi
fi

bridge_dsa_env

# 同一交易日完整产物复用：避免重复执行 27 票 × 新闻搜索 × LLM。
# 每只配置股票都必须出现在报告二级标题中，否则视为不完整并重跑。
REUSED_COMPLETE_REPORT=0
report_is_complete() {
  local report_path="$1"
  [[ -s "$report_path" ]] || return 1
  local ticker
  local old_ifs="$IFS"
  IFS=','
  for ticker in ${STOCKS:-}; do
    ticker="$(printf '%s' "$ticker" | tr -d '[:space:]')"
    [[ -n "$ticker" ]] || continue
    grep -Eq "^## .*\\(${ticker}\\)" "$report_path" || { IFS="$old_ifs"; return 1; }
  done
  IFS="$old_ifs"
  return 0
}

if [[ $SKIP_ANALYZE -eq 0 && $FORCE_ANALYZE -eq 0 \
      && "${PUBLISH_REUSE_COMPLETE_REPORT:-1}" == "1" \
      && -n "${EFFECTIVE_TRADE_DATE:-}" ]]; then
  CACHED_REPORT="${DSA_DIR}/reports/report_${EFFECTIVE_TRADE_DATE}.md"
  if report_is_complete "$CACHED_REPORT"; then
    SKIP_ANALYZE=1
    REUSED_COMPLETE_REPORT=1
    ok "复用同交易日完整报告：$CACHED_REPORT"
    log "如需强制刷新新闻/LLM：加 --force-analyze"
  fi
fi

# === 1) 行情 API + 新闻 + LLM 主分析 ==========================================
if [[ $SKIP_ANALYZE -eq 0 ]]; then
  step "1/4  main.py  (行情 API + 新闻 + LLM 综合分析)"
  pushd "$DSA_DIR" >/dev/null
  MAIN_ARGS=(--stocks "$STOCKS" --no-notify --workers "${PUBLISH_MAX_WORKERS:-2}")
  if [[ "${FORCE_RUN_FLAG:-0}" == "1" || "${PUBLISH_FORCE_RUN:-0}" == "1" ]]; then
    MAIN_ARGS+=(--force-run)
    warn "非交易日：main.py 使用 --force-run，数据截止 ${EFFECTIVE_TRADE_DATE:-最新交易日}"
  fi
  run_step "main.py" "$PYTHON_BIN" -u main.py "${MAIN_ARGS[@]}" \
    || { popd >/dev/null; exit 3; }
  popd >/dev/null
  ok "main.py 完成"
else
  warn "跳过 main.py (--skip-analyze 或 --data-only)"
fi

# --- 确定 REPORT_DATE ---------------------------------------------------------
step "Detect report date"
REPORTS_DIR="${DSA_DIR}/reports"
if [[ -n "$FORCE_DATE" ]]; then
  REPORT_DATE="$FORCE_DATE"
elif [[ -n "${EFFECTIVE_TRADE_DATE:-}" && -f "${REPORTS_DIR}/report_${EFFECTIVE_TRADE_DATE}.md" ]]; then
  REPORT_DATE="$EFFECTIVE_TRADE_DATE"
else
  # 兼容 bash 3.2：单行命令替换 + 无正则捕获括号
  REPORT_DATE=$(ls -1 "$REPORTS_DIR"/report_*.md 2>/dev/null | sed 's#.*/report_##; s#\.md$##' | sort -u | tail -n1)
  if [[ -n "${EFFECTIVE_TRADE_DATE:-}" && -n "${REPORT_DATE:-}" && "$REPORT_DATE" != "$EFFECTIVE_TRADE_DATE" ]]; then
    warn "未找到 report_${EFFECTIVE_TRADE_DATE}.md，回退为 ${REPORT_DATE}"
  fi
fi
if [[ -z "${REPORT_DATE:-}" ]]; then
  err "无法定位 report_YYYYMMDD.md；--date 强制指定或先跑 main.py"
  exit 2
fi
REPORT_MD="${REPORTS_DIR}/report_${REPORT_DATE}.md"
[[ -f "$REPORT_MD" ]] || { err "$REPORT_MD 不存在"; exit 2; }
ok "report_date = ${REPORT_DATE}    md = ${REPORT_MD}"

# === 2a) Rebuild benchmark JSON from最新 SQLite ===============================
# main.py 内部 prefetch QQQ 时 SQLite 当天数据还没入库，会用旧 QQQ forward-fill；
# 这里 main.py 已经跑完、SQLite 已经入库最新 QQQ，立刻重算，覆盖 main.py 的产物。
if [[ $SKIP_ANALYZE -eq 0 ]]; then
  step "1.5/5  rebuild_benchmark_from_db.py  (用最新 SQLite 重算 QQQ benchmark)"
  pushd "$DSA_DIR" >/dev/null
  if run_step "rebuild_benchmark_from_db" \
       "$PYTHON_BIN" -u scripts/rebuild_benchmark_from_db.py "$REPORT_MD"; then
    ok "benchmark_vs_qqq_${REPORT_DATE}.json 已用最新 SQLite 重建"
  else
    warn "重建 benchmark 失败；将沿用 main.py 产物（可能存在 QQQ forward-fill 问题）"
  fi
  popd >/dev/null
fi

# === 2) 交易动作（规则 + LLM 总结） ===========================================
TA_MD="${REPORTS_DIR}/trade_action_${REPORT_DATE}.md"
if [[ $REUSED_COMPLETE_REPORT -eq 1 && -s "$TA_MD" ]]; then
  SKIP_TRADE_ACTION=1
  ok "复用同交易日交易动作：$TA_MD"
fi
if [[ $SKIP_TRADE_ACTION -eq 0 ]]; then
  step "2/4  generate_trade_action_report.py  (规则引擎 + DeepSeek 总结)"
  pushd "$DSA_DIR" >/dev/null
  run_step "generate_trade_action_report" \
    "$PYTHON_BIN" -u scripts/generate_trade_action_report.py "$REPORT_MD" \
    || { popd >/dev/null; exit 3; }
  popd >/dev/null
  [[ -f "$TA_MD" ]] && ok "trade_action_${REPORT_DATE}.md 已生成" \
                    || warn "未发现 $TA_MD"
else
  warn "跳过 generate_trade_action_report.py"
fi

# === 3) 基本面 CSV（默认有 token 时优先雪球，省 yfinance 耗时；见脚本文档）=======
FUND_CSV="${REPORTS_DIR}/watchlist_fundamentals_${REPORT_DATE}.csv"
if [[ $REUSED_COMPLETE_REPORT -eq 1 && -s "$FUND_CSV" ]]; then
  RUN_FUNDAMENTALS=0
  ok "复用同交易日基本面：$FUND_CSV"
fi
if [[ $RUN_FUNDAMENTALS -eq 1 ]]; then
  step "3/4  fetch_watchlist_fundamentals_xueqiu.py  (市值 / Forward PE)"
  bridge_dsa_env
  if [[ -n "${XUEQIU_XQ_A_TOKEN:-${XQ_A_TOKEN:-}}" ]]; then
    if [[ "${FUNDAMENTALS_SKIP_YFINANCE:-0}" == "1" ]]; then
      log "基本面: 雪球 token 已配置，FUNDAMENTALS_SKIP_YFINANCE=1（跳过 yfinance）"
    else
      log "基本面: 雪球 token 已配置，优先雪球（可在 DSA .env 设 FUNDAMENTALS_SKIP_YFINANCE=1 进一步加速）"
    fi
  else
    warn "未检测到 XUEQIU_XQ_A_TOKEN；基本面将仅 yfinance（易 429/403，耗时长）"
  fi
  pushd "$DSA_DIR" >/dev/null
  if run_step "fetch_watchlist_fundamentals_xueqiu" \
       "$PYTHON_BIN" -u scripts/fetch_watchlist_fundamentals_xueqiu.py \
       --date "$REPORT_DATE" --report "$REPORT_MD"; then
    ok "watchlist_fundamentals_${REPORT_DATE}.csv 已生成"
  else
    warn "雪球基本面拉取失败；摘要表 市值/PE 列会显示「—」"
  fi
  popd >/dev/null
else
  warn "跳过 fetch_watchlist_fundamentals_xueqiu.py (--skip-fundamentals 或 --data-only)"
fi

# === 3b) 五指数 CSV → 仪表盘「指数趋势」JSON（本机流水线拉取；访客浏览器只读静态 JSON）
BENCH_DIR="${WEBAPP_ROOT}/benchmark_return"
BENCH_CSV="${BENCH_DIR}/market_prices_post2020_publish.csv"
if [[ $RUN_BENCHMARK_INDICES -eq 1 && $FORCE_BENCHMARK_INDICES -eq 0 \
      && "${PUBLISH_REUSE_FRESH_BENCHMARK:-1}" == "1" \
      && -n "${EFFECTIVE_TRADE_DATE:-}" && -s "$BENCH_CSV" ]]; then
  BENCH_DATE="${EFFECTIVE_TRADE_DATE}"
  if [[ "$BENCH_DATE" =~ ^[0-9]{8}$ ]]; then
    BENCH_DATE="${BENCH_DATE:0:4}-${BENCH_DATE:4:2}-${BENCH_DATE:6:2}"
  fi
  if awk -F, -v d="$BENCH_DATE" '
    NR > 1 && $1 >= d { seen[$2] = 1 }
    END {
      exit !(seen["sp500"] && seen["nasdaq"] && seen["smh"] && seen["xlk"] && seen["xlf"])
    }
  ' "$BENCH_CSV"; then
    RUN_BENCHMARK_INDICES=0
    ok "复用已覆盖 ${BENCH_DATE} 的五指数 CSV/JSON"
    log "如需强制刷新指数：加 --force-benchmark-indices"
  fi
fi
if [[ $RUN_BENCHMARK_INDICES -eq 1 ]]; then
  step "fetch_benchmark_data + generate_benchmark_html  (benchmark_indices.json)"
  if run_step "fetch_benchmark_data" \
       "$PYTHON_BIN" -u "${BENCH_DIR}/fetch_benchmark_data.py" \
       --output market_prices_post2020_publish.csv; then
    pushd "$BENCH_DIR" >/dev/null || exit 2
    if run_step "generate_benchmark_html" \
         "$PYTHON_BIN" -u generate_benchmark_html.py \
         --input market_prices_post2020_publish.csv; then
      ok "指数趋势数据源已写入 webapp/data/benchmark_indices.json"
    else
      warn "generate_benchmark_html.py 失败；指数趋势 Tab 可能仍为旧数据"
    fi
    popd >/dev/null
  else
    warn "fetch_benchmark_data 失败（网络或第三方 API）；跳过指数 CSV/JSON（沿用仓库内既有 benchmark_indices.json）"
  fi
else
  warn "跳过 fetch_benchmark_data (--skip-benchmark-indices / publish.config RUN_BENCHMARK_INDICES=0)"
fi

# === 3c) 同步 marco_analysis 的 AI Infra 总览页 → webapp/data/ai_infra/ =========
# 仅文件拷贝；marco_analysis 的数据/分析流水线 (run_dashboard_pipeline.sh) 单独运行。
if [[ $RUN_AI_INFRA -eq 1 ]]; then
  step "sync_ai_infra.sh  (marco_analysis html_reports → data/ai_infra)"
  if run_step "sync_ai_infra" "${SCRIPT_DIR}/sync_ai_infra.sh"; then
    ok "AI Infra 总览页已同步至 data/ai_infra/"
  else
    warn "AI Infra 同步失败；AI Infra Tab 将沿用仓库内既有 data/ai_infra/"
  fi
else
  warn "跳过 sync_ai_infra (--skip-ai-infra / publish.config RUN_AI_INFRA=0)"
fi

# === 4) Markdown → JSON =======================================================
EXISTING_INDEX="${WEBAPP_DATA}/reports/${REPORT_DATE}/index.json"
if [[ $REUSED_COMPLETE_REPORT -eq 1 && -s "$EXISTING_INDEX" \
      && "$(grep -c '"weekly_strategy"' "$EXISTING_INDEX" || true)" -gt 0 ]]; then
  ok "复用同交易日完整 JSON：$EXISTING_INDEX"
else
  step "4/4  report_to_json.py  (落地 webapp/data/**)"
  JSON_ARGS=(
    "$REPORT_MD"
    --out "$WEBAPP_DATA"
    --bars "$CHART_BARS"
  )
  if [[ $REUSED_COMPLETE_REPORT -eq 1 ]]; then
    JSON_ARGS+=(--reuse-existing-extras)
    log "同日报告重转：复用现有 macro/daily_digest，避免重复 API/LLM"
  fi
  pushd "$DSA_DIR" >/dev/null
  run_step "report_to_json" \
    "$PYTHON_BIN" -u scripts/report_to_json.py "${JSON_ARGS[@]}" \
    || { popd >/dev/null; exit 3; }
  popd >/dev/null
  ok "JSON 已落地：$WEBAPP_DATA"
fi

# --- 发布质量闸门：完全离线，阻止不完整/全同建议/新闻大面积缺失的数据上线 -------
step "Quality gate"
QUALITY_ARGS=(
  --data-dir "$WEBAPP_DATA"
  --report-date "$REPORT_DATE"
  --stocks "${STOCKS:-}"
)
if [[ -z "$FORCE_DATE" && -n "${EFFECTIVE_TRADE_DATE:-}" ]]; then
  QUALITY_ARGS+=(--expected-date "$EFFECTIVE_TRADE_DATE")
fi
run_step "validate_publish_output" \
  "$PYTHON_BIN" -u "${SCRIPT_DIR}/validate_publish_output.py" \
  "${QUALITY_ARGS[@]}" \
  || exit 3

# --- 输出体检 ----------------------------------------------------------------
step "Snapshot of webapp/data/"
( cd "$WEBAPP_ROOT" && \
  printf "  manifest.json                       %s\n" "$(wc -c < data/manifest.json 2>/dev/null) B" && \
  printf "  data/benchmark_indices.json           %s\n" "$(wc -c < data/benchmark_indices.json 2>/dev/null) B" && \
  printf "  reports/${REPORT_DATE}/index.json   %s\n" "$(wc -c < data/reports/${REPORT_DATE}/index.json 2>/dev/null) B" && \
  charts=$(/bin/ls -1 data/reports/${REPORT_DATE}/charts/*.json 2>/dev/null | wc -l | tr -d ' ') && \
  printf "  reports/${REPORT_DATE}/charts/      %s 个 ticker\n" "$charts"
)

# === 5) Git commit + push =====================================================
step "Git"
cd "$WEBAPP_ROOT"
if ! git diff --quiet -- data || ! git diff --cached --quiet -- data; then
  CHANGED_FILES="$(git status --porcelain -- data | wc -l | tr -d ' ')"
  log "data/ 有 ${CHANGED_FILES} 个文件变更"
  git add data/
  COMMIT_TS=$(date +'%Y-%m-%d %H:%M')
  COMMIT_MSG="data: ${REPORT_DATE} refresh [${COMMIT_TS}]"
  if [[ -n "${GIT_AUTHOR_NAME:-}" && -n "${GIT_AUTHOR_EMAIL:-}" ]]; then
    git -c user.name="$GIT_AUTHOR_NAME" -c user.email="$GIT_AUTHOR_EMAIL" \
        commit -m "$COMMIT_MSG"
  else
    git commit -m "$COMMIT_MSG"
  fi
  ok "本地 commit 完成：$COMMIT_MSG"

  if [[ $PUSH -eq 1 ]]; then
    if run_step "git push" git_push_with_retries; then
      ok "已 push 到 origin/$(git rev-parse --abbrev-ref HEAD)"
      printf "\n${GREEN}🎉  Cloudflare Pages 将在 30~60s 内重建。${RESET}\n"
      printf "    访问：${CYAN}%s${RESET}\n" "https://daily-decision-dashboard.peterinnyc.workers.dev/"
    else
      err "git push 失败"; exit 4
    fi
  else
    warn "未加 --push；本次为 dry-run，已 commit 但 ${BOLD}未${RESET}${YELLOW}推送。${RESET}"
    log "下一步：  GIT_HTTP_VERSION=HTTP/1.1 git -C $WEBAPP_ROOT push    或重跑加 --push"
  fi
else
  ok "data/ 无变化，无需 commit"
fi

printf "\n${GREEN}${BOLD}publish.sh done.${RESET}  elapsed=%ss  log → %s\n" \
  "$((SECONDS - PIPELINE_STARTED))" "$LOG_FILE"
