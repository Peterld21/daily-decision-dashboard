#!/usr/bin/env bash
# ============================================================================
# local-preview.sh — 用本地已有产物生成 webapp/data，离线预览 HTML/JS/CSS
#
#   不涉及 main.py / 雪球拉数；只读 daily_stock_analysis/reports/ 下已有
#   report_*.md、trade_action_*.md、watchlist_fundamentals_*.csv、
#   benchmark_vs_qqq_*.json，以及 SQLite 中的 K 线（除非加 --no-charts）。
#
#   典型流程：
#     1) ./scripts/local-preview.sh --serve
#     2) 改 webapp/js、css、index.html，浏览器强刷验证
#     3) 满意后再: ./scripts/publish.sh --data-only --push
#
# 详参：../LOCAL_PREVIEW.md（参数表、与 publish 第 4 步关系、--data-only 与五指数）。
#
# 用法：
#   ./scripts/local-preview.sh [--date YYYYMMDD] [--offline] [--no-charts] [--serve [PORT]]
#
#   --offline     跳过宏观区（不调恐贪等外部接口）；QQQ/SCHD 仍读本地库
#   --no-charts   不生成 charts/*.json（仅测摘要/卡片时可加快）
#   --no-ai-infra 不同步 marco_analysis 的 AI Infra 总览页（沿用已有 data/ai_infra/）
#   --serve 8765  编译完后在本机起静态服务（默认端口 8765）；Ctrl+C 结束
#
# 兼容：macOS bash 3.2
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
WEBAPP_ROOT="$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)"
WEBAPP_DATA="${WEBAPP_ROOT}/data"

OFFLINE=0
NO_CHARTS=0
SERVE=0
SERVE_PORT=8765
FORCE_DATE=""
NO_AI_INFRA=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --offline)    OFFLINE=1; shift ;;
    --no-charts)  NO_CHARTS=1; shift ;;
    --no-ai-infra) NO_AI_INFRA=1; shift ;;
    --date)       FORCE_DATE="${2:-}"; shift 2 ;;
    --serve)
      SERVE=1
      if [[ -n "${2:-}" ]] && [[ "${2:-}" =~ ^[0-9]+$ ]]; then
        SERVE_PORT="$2"
        shift 2
      else
        shift
      fi
      ;;
    -h|--help)
      sed -n '2,28p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 2
      ;;
  esac
done

CONFIG="${SCRIPT_DIR}/publish.config.sh"
if [[ -f "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG"
fi

DSA_DIR="${DSA_DIR:-${WEBAPP_ROOT%/webapp}/daily_stock_analysis}"
PYTHON_BIN="${PYTHON_BIN:-${DSA_DIR}/.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(command -v python3)"
fi

CHART_BARS="${CHART_BARS:-60}"
REPORTS_DIR="${DSA_DIR}/reports"

if [[ ! -d "$DSA_DIR" ]]; then
  echo "找不到 daily_stock_analysis：$DSA_DIR" >&2
  echo "可在 publish.config.sh 里设置 DSA_DIR" >&2
  exit 2
fi

if [[ -n "$FORCE_DATE" ]]; then
  REPORT_DATE="$FORCE_DATE"
else
  REPORT_DATE=$(ls -1 "$REPORTS_DIR"/report_*.md 2>/dev/null | sed 's#.*/report_##; s#\.md$##' | sort -u | tail -n1)
fi
if [[ -z "${REPORT_DATE:-}" ]]; then
  echo "未找到 $REPORTS_DIR/report_*.md；请先跑分析或传 --date YYYYMMDD" >&2
  exit 2
fi

REPORT_MD="${REPORTS_DIR}/report_${REPORT_DATE}.md"
if [[ ! -f "$REPORT_MD" ]]; then
  echo "找不到 $REPORT_MD" >&2
  exit 2
fi

echo "── local-preview ──"
echo "  DSA_DIR     $DSA_DIR"
echo "  REPORT_DATE $REPORT_DATE"
echo "  OUT         $WEBAPP_DATA"
echo "  offline=$OFFLINE  no_charts=$NO_CHARTS  bars=$CHART_BARS"

JSON_ARGS=(
  "$REPORT_MD"
  --out "$WEBAPP_DATA"
  --bars "$CHART_BARS"
)
[[ "$OFFLINE" -eq 1 ]] && JSON_ARGS+=( --no-macro )
[[ "$NO_CHARTS" -eq 1 ]] && JSON_ARGS+=( --no-charts )

# 同步 marco_analysis 的 AI Infra 总览页（仅文件拷贝；缺源时自动跳过）。
# 关闭：--no-ai-infra 或在 publish.config.sh 设 RUN_AI_INFRA=0
if [[ "${RUN_AI_INFRA:-1}" -eq 1 && "$NO_AI_INFRA" -eq 0 ]]; then
  "${SCRIPT_DIR}/sync_ai_infra.sh" || echo "[warn] sync_ai_infra 失败，沿用已有 data/ai_infra/"
fi

pushd "$DSA_DIR" >/dev/null
"$PYTHON_BIN" -u scripts/report_to_json.py "${JSON_ARGS[@]}"
popd >/dev/null

echo ""
printf '%s\n' "[ok] JSON -> ${WEBAPP_DATA} (manifest.latest=${REPORT_DATE})"
if [[ "$SERVE" -eq 1 ]]; then
  echo "Open: http://127.0.0.1:${SERVE_PORT}/"
  echo "Use http://, not file:// ; Ctrl+C to stop."
  cd "$WEBAPP_ROOT"
  exec python3 -m http.server "$SERVE_PORT"
else
  echo "Preview:"
  echo "  cd ${WEBAPP_ROOT} && python3 -m http.server ${SERVE_PORT}"
  echo "  Open http://127.0.0.1:${SERVE_PORT}/"
  echo "Ship data:"
  echo "  ./scripts/publish.sh --data-only --push"
fi
