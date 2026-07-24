#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
RUNTIME="${DATASET_STUDIO_RUNTIME:-cpu}"
GRAPHICS="${DATASET_STUDIO_LINUX_GRAPHICS:-native}"
CHECK_ONLY=0
SKIP_SYNC=0

usage() {
  cat <<'EOF'
Dataset Annotation Studio Linux 开发版启动器

用法：
  ./启动开发版.sh [选项]

选项：
  --cpu                  使用 CPU Runtime（默认）
  --cuda                 使用 CUDA Runtime，同时启用 CUDA 图片缩放
  --graphics MODE        native | nvidia-sync | dmabuf-off | software
  --check-only           只检查并同步依赖，不启动应用
  --skip-sync            跳过 pnpm install 与 uv sync
  -h, --help             显示帮助

示例：
  ./启动开发版.sh --cuda
  ./启动开发版.sh --cuda --graphics dmabuf-off
  ./启动开发版.sh --cpu --graphics software
EOF
}

while (($#)); do
  case "$1" in
    --cpu) RUNTIME="cpu" ;;
    --cuda) RUNTIME="cuda" ;;
    --graphics)
      shift
      [[ $# -gt 0 ]] || { echo "错误：--graphics 缺少模式。" >&2; exit 2; }
      GRAPHICS="$1"
      ;;
    --check-only) CHECK_ONLY=1 ;;
    --skip-sync) SKIP_SYNC=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "错误：未知参数 $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$RUNTIME" in cpu|cuda) ;; *) echo "错误：Runtime 只能是 cpu 或 cuda。" >&2; exit 2 ;; esac
case "$GRAPHICS" in native|nvidia-sync|dmabuf-off|software) ;;
  *) echo "错误：图形模式只能是 native、nvidia-sync、dmabuf-off 或 software。" >&2; exit 2 ;;
esac

for command in pnpm uv cargo rustc; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "错误：缺少命令 '$command'，请先安装对应开发工具。" >&2
    exit 1
  }
done

cd "$ROOT"

if [[ $SKIP_SYNC -eq 0 ]]; then
  echo "[Dataset Studio] 检查前端依赖……"
  pnpm install --frozen-lockfile --prefer-offline --reporter=append-only

  echo "[Dataset Studio] 同步 Python $RUNTIME Runtime……"
  uv sync --project "$BACKEND" --extra "$RUNTIME" --all-groups --locked --exact
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  echo "[Dataset Studio] 开发环境检查通过（runtime=$RUNTIME, graphics=$GRAPHICS）。"
  exit 0
fi

if command -v flock >/dev/null 2>&1; then
  LOCK_ROOT="${XDG_RUNTIME_DIR:-/tmp}"
  exec 9>"$LOCK_ROOT/dataset-annotation-studio-dev.lock"
  flock -n 9 || {
    echo "错误：已有 Dataset Studio 开发会话正在运行。" >&2
    exit 1
  }
fi

if [[ "$GRAPHICS" == "native" ]]; then
  unset DATASET_STUDIO_LINUX_GRAPHICS
else
  export DATASET_STUDIO_LINUX_GRAPHICS="$GRAPHICS"
fi
export DATASET_STUDIO_RUNTIME="$RUNTIME"

echo "[Dataset Studio] 启动开发版"
echo "  Runtime: $RUNTIME"
echo "  图形模式: $GRAPHICS"
if [[ "$RUNTIME" == "cuda" ]]; then
  echo "  图片预处理: CUDA Lanczos 缩放 + CPU 编码（失败自动回退 CPU）"
  exec pnpm dev:cuda
else
  echo "  图片预处理: CPU 缩放 + CPU 编码"
  exec pnpm dev
fi
