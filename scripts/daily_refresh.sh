#!/usr/bin/env bash
# 兼容 macOS 自带 bash 3.2：避免 bash 4+ 语法（关联数组 / mapfile 等）。
# ============================================================================
# daily_refresh.sh — 每日「本地刷数 → 计算 → 推送 JSON」一键编排
#
#   一条命令把三条本地数据流水线按正确顺序各跑一次，最后推送 data/ 到 GitHub：
#
#     ① AI Infra      marco_analysis/run_dashboard_pipeline.sh
#                       (timsun + yfinance → html_reports/dashboard_*.html)
#     ② 个股 + 指数    webapp/scripts/publish.sh  内部依次：
#                       - main.py（行情/新闻/LLM）→ reports/report_*.md
#                       - rebuild_benchmark_from_db（QQQ 对齐）
#                       - generate_trade_action_report（交易动作）
#                       - fetch_watchlist_fundamentals（雪球市值/PE）
#                       - fetch_benchmark_data + generate_benchmark_html（指数趋势 JSON）
#                       - sync_ai_infra（把 ① 的 html 拷进 data/ai_infra）
#                       - report_to_json（落地 data/**）
#                       - git add data/ (+ --push)
#
#   设计原则：所有「数据请求 + 计算」都在本地完成；GitHub 仓库只承载
#   「前端渲染 + data/ 静态 JSON」。Cloudflare/Pages 不执行任何脚本。
#   每天本地刷一次，推送 data/，访客浏览器零外部 API（CSP connect-src 'self'）。
#
# 用法：
#   ./scripts/daily_refresh.sh                 # 全量 dry-run（不 push）
#   ./scripts/daily_refresh.sh --push          # 全量并推送到 GitHub
#   ./scripts/daily_refresh.sh --skip-marco --push      # 跳过 AI Infra 重算，仅同步既有 html
#   ./scripts/daily_refresh.sh --marco-only             # 只刷 AI Infra 数据，不发布
#   ./scripts/daily_refresh.sh --data-only --push       # 跳过本地分析，只重转 JSON 并推送
#
#   其余未识别参数（--date / --skip-fundamentals / --skip-benchmark-indices
#   / --skip-ai-infra / --bars 等）原样转发给 publish.sh。
#
# 去重说明（见 AI_INFRA_TAB_PIPELINE.md §3）：
#   - 指数趋势抓的是 sp500/nasdaq/SMH/XLK/XLF（指数/ETF），与另两源不重叠。
#   - QQQ 与约 16 个半导体/算力标的在「个股」与「AI Infra」两源各抓一次，但落到
#     不同存储（SQLite vs marco/data）、用途不同（OHLCV vs 市值/PE/收益指标）。
#     两源各自增量抓取；本脚本保证「每天每源各跑一次」，避免人工重复触发。
#
# 退出码：0 成功；2 配置错误；3 marco 流水线失败（未加 --keep-going 时）；其余沿用 publish.sh。
# ============================================================================
set -euo pipefail

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
step() { printf "\n${BOLD}${BLUE}━━ %s ━━${RESET}\n" "$*"; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
WEBAPP_ROOT="$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)"

# 加载用户配置（与 publish.sh 共用；含 MARCO_DIR / RUN_MARCO 等可选项）
CONFIG="${SCRIPT_DIR}/publish.config.sh"
if [[ -f "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG"
fi

# --- 默认值 / 路径 ------------------------------------------------------------
RUN_MARCO="${RUN_MARCO:-1}"      # 是否重跑 marco 的 AI Infra 数据流水线
MARCO_ONLY=0
KEEP_GOING=0                     # marco 失败时是否仍继续 publish
# marco_analysis 默认与 webapp 同级（…/webapp_dev/marco_analysis）
MARCO_DIR="${MARCO_DIR:-${WEBAPP_ROOT%/webapp}/marco_analysis}"
# DSA 根目录（用于在 marco 缺 .env 时兜底借用 DeepSeek/DashScope key）
DSA_DIR="${DSA_DIR:-${WEBAPP_ROOT%/webapp}/daily_stock_analysis}"

# marco 的 DeepSeek 步骤从 os.environ 读 key；若当前环境与 marco/.env 均无，
# 则从 daily_stock_analysis/.env 兜底导出（仅本进程会话，不落盘、不打印明文）。
bridge_llm_keys_from_dsa() {
  local env_file="${DSA_DIR}/.env"
  [[ -f "$env_file" ]] || return 0
  local k v
  for k in DEEPSEEK_API_KEY DASHSCOPE_API_KEY; do
    eval "v=\${$k:-}"
    if [[ -z "$v" ]]; then
      v="$(grep -aoE "${k}=[^[:space:]\"']+" "$env_file" | head -1 | sed -E "s/^${k}=//")"
      [[ -n "$v" ]] && export "$k=$v"
    fi
  done
}

# --- 解析「本脚本独有」参数，其余转发 publish.sh -----------------------------
PASSTHRU=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-marco)   RUN_MARCO=0; shift ;;
    --marco-only)   MARCO_ONLY=1; shift ;;
    --keep-going)   KEEP_GOING=1; shift ;;
    -h|--help)      sed -n '2,55p' "$0"; exit 0 ;;
    *)              PASSTHRU+=("$1"); shift ;;
  esac
done

step "Plan"
printf "  ${CYAN}WEBAPP_ROOT${RESET}  %s\n" "$WEBAPP_ROOT"
printf "  ${CYAN}MARCO_DIR  ${RESET}  %s\n" "$MARCO_DIR"
if [[ $RUN_MARCO -eq 1 ]]; then printf "  ${CYAN}RUN_MARCO  ${RESET}  yes (重算 AI Infra)\n"; else printf "  ${CYAN}RUN_MARCO  ${RESET}  no (沿用既有 html_reports)\n"; fi
if [[ $MARCO_ONLY -eq 1 ]]; then printf "  ${CYAN}MARCO_ONLY ${RESET}  yes (不发布)\n"; fi
printf "  ${CYAN}PUBLISH    ${RESET}  %s\n" "${PASSTHRU[*]:-<默认 dry-run>}"

# === ① AI Infra 数据流水线（marco_analysis） =================================
if [[ $RUN_MARCO -eq 1 ]]; then
  step "1/2  marco_analysis  (AI Infra: fetch → qqq → metrics → dashboards → DeepSeek → unified)"
  bridge_llm_keys_from_dsa
  if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
    warn "未检测到 DEEPSEEK_API_KEY（marco/.env 与 DSA/.env 均无）；marco 的 DeepSeek 步骤会被跳过。"
  fi
  MARCO_SH="${MARCO_DIR}/run_dashboard_pipeline.sh"
  if [[ ! -f "$MARCO_SH" ]]; then
    err "找不到 marco 流水线：$MARCO_SH"
    err "可在 publish.config.sh 设置 MARCO_DIR，或加 --skip-marco 跳过。"
    [[ $KEEP_GOING -eq 1 ]] || exit 2
  else
    set +e
    bash "$MARCO_SH"
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      ok "marco AI Infra 流水线完成 → ${MARCO_DIR}/html_reports/"
    else
      err "marco 流水线失败 (exit=$rc)"
      if [[ $KEEP_GOING -eq 1 ]]; then
        warn "--keep-going：继续发布，AI Infra 将沿用仓库内既有 data/ai_infra/"
      else
        err "中止；如需用旧 AI Infra 数据继续发布，请加 --keep-going 或 --skip-marco。"
        exit 3
      fi
    fi
  fi
else
  warn "跳过 marco 数据流水线（--skip-marco / RUN_MARCO=0）；publish 仍会同步既有 html_reports。"
fi

if [[ $MARCO_ONLY -eq 1 ]]; then
  ok "--marco-only：AI Infra 数据已刷新；未触发 publish。"
  log "如需发布：./scripts/daily_refresh.sh --skip-marco --push"
  exit 0
fi

# === ② 个股 + 指数 + 同步 + JSON + git（publish.sh） ==========================
step "2/2  publish.sh  (个股/指数/同步 AI Infra/落地 JSON/git)"
# bash 3.2：空数组需用 ${arr[@]+...} 安全展开，否则 set -u 会报 unbound。
exec "${SCRIPT_DIR}/publish.sh" ${PASSTHRU[@]+"${PASSTHRU[@]}"}
