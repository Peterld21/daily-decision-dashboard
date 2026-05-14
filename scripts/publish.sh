#!/usr/bin/env bash
# ============================================================================
# publish.sh — 一键发布每日决策仪表盘
#
#   1) 在 daily_stock_analysis 跑完整本地流水线：
#        - main.py                          (行情 API + 新闻 + LLM 综合分析)
#        - generate_trade_action_report.py  (规则引擎 + LLM 总结)
#        - fetch_watchlist_fundamentals     (可选；雪球基本面)
#   2) report_to_json.py 把 md/csv/json/SQLite 序列化成 webapp/data/**.json
#   3) git add / commit / push    →    Cloudflare Pages 自动重建
#
# 用法：
#   ./scripts/publish.sh                # dry-run，落地 JSON 但不 push
#   ./scripts/publish.sh --push         # 真的 push 到 GitHub
#   ./scripts/publish.sh --data-only    # 跳过本地分析、只重转 JSON 并 push
#   ./scripts/publish.sh --date 20260505 --push
#   ./scripts/publish.sh --skip-fundamentals --push
#   ./scripts/publish.sh --no-llm-summary --push
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

# 子步骤执行包装：
#   - 实时把 stdout/stderr 同步到屏幕 & 日志
#   - pipefail + PIPESTATUS 捕获真实退出码
#   - 描述行打到屏幕
run_step() {
  local label="$1"; shift
  printf "${DIM}[%s]${RESET} ${CYAN}\$${RESET} %s\n" "$(ts)" "$*" | tee -a "$LOG_FILE" >&2
  set +e
  "$@" 2>&1 | tee -a "$LOG_FILE"
  local rc=${PIPESTATUS[0]}
  set -e
  if [[ $rc -ne 0 ]]; then
    err "$label 失败 (exit=$rc)，详见 $LOG_FILE"
    return $rc
  fi
  return 0
}

# --- 默认参数 -----------------------------------------------------------------
PUSH=0
DATA_ONLY=0
SKIP_ANALYZE=0
SKIP_TRADE_ACTION=0
RUN_FUNDAMENTALS=1
USE_TA_SUMMARY_LLM=1
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

# --- 参数解析 -----------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)                PUSH=1; shift ;;
    --no-push)             PUSH=0; shift ;;
    --data-only)           DATA_ONLY=1; SKIP_ANALYZE=1; SKIP_TRADE_ACTION=1; RUN_FUNDAMENTALS=0; shift ;;
    --skip-analyze)        SKIP_ANALYZE=1; shift ;;
    --skip-trade-action)   SKIP_TRADE_ACTION=1; shift ;;
    --skip-fundamentals)   RUN_FUNDAMENTALS=0; shift ;;
    --no-llm-summary)      USE_TA_SUMMARY_LLM=0; shift ;;
    --date)                FORCE_DATE="${2:-}"; shift 2 ;;
    --stocks)              STOCKS="${2:-}"; shift 2 ;;
    --bars)                CHART_BARS="${2:-60}"; shift 2 ;;
    -h|--help)
      sed -n '2,40p' "$0"
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
step "Plan"
printf "  ${CYAN}WEBAPP_ROOT${RESET}  %s\n" "$WEBAPP_ROOT"
printf "  ${CYAN}DSA_DIR    ${RESET}  %s\n" "$DSA_DIR"
printf "  ${CYAN}PYTHON_BIN ${RESET}  %s\n" "$PYTHON_BIN"
printf "  ${CYAN}STOCKS     ${RESET}  %s\n" "${STOCKS:-(skipped)}"
printf "  ${CYAN}PUSH       ${RESET}  %s\n" "$([[ $PUSH -eq 1 ]] && echo yes || echo "no (dry-run)")"
printf "  ${CYAN}DATA_ONLY  ${RESET}  %s\n" "$([[ $DATA_ONLY -eq 1 ]] && echo yes || echo no)"
[[ -n "$FORCE_DATE" ]] && printf "  ${CYAN}FORCE_DATE ${RESET}  %s\n" "$FORCE_DATE"

# === 1) 行情 API + 新闻 + LLM 主分析 ==========================================
if [[ $SKIP_ANALYZE -eq 0 ]]; then
  step "1/4  main.py  (行情 API + 新闻 + LLM 综合分析)"
  pushd "$DSA_DIR" >/dev/null
  run_step "main.py" "$PYTHON_BIN" -u main.py --stocks "$STOCKS" --no-notify \
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
else
  REPORT_DATE="$(/bin/ls -1 "$REPORTS_DIR"/report_*.md 2>/dev/null \
                 | sed -E 's#.*/report_([0-9]{8})\.md$#\1#' \
                 | sort -u | tail -n1)"
fi
if [[ -z "${REPORT_DATE:-}" ]]; then
  err "无法定位 report_YYYYMMDD.md；--date 强制指定或先跑 main.py"
  exit 2
fi
REPORT_MD="${REPORTS_DIR}/report_${REPORT_DATE}.md"
[[ -f "$REPORT_MD" ]] || { err "$REPORT_MD 不存在"; exit 2; }
ok "report_date = ${REPORT_DATE}    md = ${REPORT_MD}"

# === 2) 交易动作（规则 + LLM 总结） ===========================================
TA_MD="${REPORTS_DIR}/trade_action_${REPORT_DATE}.md"
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

# === 3) 基本面 CSV（雪球） ====================================================
FUND_CSV="${REPORTS_DIR}/watchlist_fundamentals_${REPORT_DATE}.csv"
if [[ $RUN_FUNDAMENTALS -eq 1 ]]; then
  step "3/4  fetch_watchlist_fundamentals_xueqiu.py  (雪球：市值 / Forward PE)"
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

# === 4) Markdown → JSON =======================================================
step "4/4  report_to_json.py  (落地 webapp/data/**)"
JSON_ARGS=(
  "$REPORT_MD"
  --out "$WEBAPP_DATA"
  --bars "$CHART_BARS"
)
[[ $USE_TA_SUMMARY_LLM -eq 0 ]] && JSON_ARGS+=( --no-ta-summary-llm )
pushd "$DSA_DIR" >/dev/null
run_step "report_to_json" \
  "$PYTHON_BIN" -u scripts/report_to_json.py "${JSON_ARGS[@]}" \
  || { popd >/dev/null; exit 3; }
popd >/dev/null
ok "JSON 已落地：$WEBAPP_DATA"

# --- 输出体检 ----------------------------------------------------------------
step "Snapshot of webapp/data/"
( cd "$WEBAPP_ROOT" && \
  printf "  manifest.json                       %s\n" "$(wc -c < data/manifest.json 2>/dev/null) B" && \
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
  COMMIT_MSG="data: ${REPORT_DATE} refresh ($(date +'%Y-%m-%d %H:%M'))"
  AUTHOR_ARGS=()
  if [[ -n "${GIT_AUTHOR_NAME:-}" && -n "${GIT_AUTHOR_EMAIL:-}" ]]; then
    AUTHOR_ARGS=( --author="${GIT_AUTHOR_NAME} <${GIT_AUTHOR_EMAIL}>" )
  fi
  git "${AUTHOR_ARGS[@]+"${AUTHOR_ARGS[@]}"}" commit -m "$COMMIT_MSG"
  ok "本地 commit 完成：$COMMIT_MSG"

  if [[ $PUSH -eq 1 ]]; then
    if run_step "git push" git push; then
      ok "已 push 到 origin/$(git rev-parse --abbrev-ref HEAD)"
      printf "\n${GREEN}🎉  Cloudflare Pages 将在 30~60s 内重建。${RESET}\n"
      printf "    访问：${CYAN}%s${RESET}\n" "https://daily-decision-dashboard.peterinnyc.workers.dev/"
    else
      err "git push 失败"; exit 4
    fi
  else
    warn "未加 --push；本次为 dry-run，已 commit 但 ${BOLD}未${RESET}${YELLOW}推送。${RESET}"
    log "下一步：  git -C $WEBAPP_ROOT push    或重跑加 --push"
  fi
else
  ok "data/ 无变化，无需 commit"
fi

printf "\n${GREEN}${BOLD}publish.sh done.${RESET}  log → %s\n" "$LOG_FILE"
