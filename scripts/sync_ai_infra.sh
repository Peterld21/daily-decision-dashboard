#!/usr/bin/env bash
# ============================================================================
# sync_ai_infra.sh — 把 marco_analysis 产出的 AI Infra 总览页同步进 webapp/data/
#
#   只做「文件拷贝」，不拉数据、不跑分析。marco_analysis 的 6 步流水线
#   (run_dashboard_pipeline.sh) 跑完后，其 html_reports/ 下会有：
#       dashboard_unified.html           ← 统一总览（含内部 nav + iframe）
#       dashboard_card_matrix_real.html  ← 行业卡片矩阵
#       dashboard_bubble_chart_focused.html
#       dashboard_bubble_chart_real.html
#       dashboard_heatmap_real.html
#   本脚本把这 5 个文件同步到 webapp/data/ai_infra/，供站内「AI Infra」Tab
#   以同源 iframe 加载（dashboard_unified.html 内部再相对引用其余 4 个）。
#
# 用法：
#   ./scripts/sync_ai_infra.sh                 # 用默认源目录
#   AI_INFRA_SRC_DIR=/path/html_reports ./scripts/sync_ai_infra.sh
#
# 退出码：0 同步成功；1 源目录或必要文件缺失；2 目标不可写
# 兼容 macOS bash 3.2。
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
WEBAPP_ROOT="$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)"

# 读取与 publish 共用的配置（可在其中设 AI_INFRA_SRC_DIR）
CONFIG="${SCRIPT_DIR}/publish.config.sh"
if [[ -f "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG"
fi

# 默认源目录：与 webapp 同级的 marco_analysis/html_reports
AI_INFRA_SRC_DIR="${AI_INFRA_SRC_DIR:-${WEBAPP_ROOT%/webapp}/marco_analysis/html_reports}"
DEST_DIR="${WEBAPP_ROOT}/data/ai_infra"

FILES=(
  dashboard_unified.html
  dashboard_card_matrix_real.html
  dashboard_bubble_chart_focused.html
  dashboard_bubble_chart_real.html
  dashboard_heatmap_real.html
)

echo "── sync_ai_infra ──"
echo "  SRC  $AI_INFRA_SRC_DIR"
echo "  DEST $DEST_DIR"

if [[ ! -d "$AI_INFRA_SRC_DIR" ]]; then
  echo "  ✗ 源目录不存在，保留已有 data/ai_infra/：$AI_INFRA_SRC_DIR" >&2
  exit 1
fi

mkdir -p "$DEST_DIR" || { echo "  ✗ 无法创建 $DEST_DIR" >&2; exit 2; }

copied=0
missing=0
for f in "${FILES[@]}"; do
  if [[ -f "${AI_INFRA_SRC_DIR}/${f}" ]]; then
    cp "${AI_INFRA_SRC_DIR}/${f}" "${DEST_DIR}/${f}"
    copied=$((copied + 1))
  else
    echo "  ! 缺少源文件：${f}" >&2
    missing=$((missing + 1))
  fi
done

echo "  ✓ 已同步 ${copied} 个文件（缺失 ${missing}）"
if [[ $missing -gt 0 ]]; then
  echo "  ✗ AI Infra 同步不完整：${missing}/${#FILES[@]} 个必要文件缺失" >&2
  exit 1
fi
exit 0
