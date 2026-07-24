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

resolve_python_environment_dir() {
  local environment_dir="${UV_PROJECT_ENVIRONMENT:-$BACKEND/.venv}"
  if [[ "$environment_dir" != /* ]]; then
    environment_dir="$ROOT/$environment_dir"
  fi
  printf '%s\n' "$environment_dir"
}

validate_backend_entrypoints() {
  local environment_dir
  local entrypoint
  local -a missing_entrypoints=()

  environment_dir="$(resolve_python_environment_dir)"
  for entrypoint in dataset-studio-api dataset-studio-worker; do
    if [[ ! -x "$environment_dir/bin/$entrypoint" ]]; then
      missing_entrypoints+=("$entrypoint")
    fi
  done
  if ((${#missing_entrypoints[@]} > 0)); then
    echo "错误：当前 Python 环境缺少 Dataset Studio 后端入口：${missing_entrypoints[*]}" >&2
    echo "  Python 环境: $environment_dir" >&2
    if [[ $SKIP_SYNC -eq 1 ]]; then
      echo "  你使用了 --skip-sync；该选项不会安装项目本身或后端依赖。" >&2
      echo "  请先执行：UV_PROJECT_ENVIRONMENT=\"$environment_dir\" uv pip install -e backend" >&2
      echo "  或去掉 --skip-sync，让启动器执行 uv sync。" >&2
    else
      echo "  请重新执行 uv sync --project backend --extra $RUNTIME --all-groups --locked --exact。" >&2
    fi
    exit 1
  fi
}

configure_cuda_library_path() {
  local environment_dir="$(resolve_python_environment_dir)"
  local python_bin
  local site_packages=""
  local cuda_site
  local lib_dir
  local joined_paths=""
  local -a cuda_library_dirs=()

  python_bin="$environment_dir/bin/python"

  # Prefer the selected uv environment so this also works with an isolated
  # CUDA test environment (for example backend/.venv-cuda-test). If the
  # configured path is unavailable, ask uv which project environment it uses.
  if [[ -x "$python_bin" ]]; then
    site_packages="$($python_bin -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])' 2>/dev/null || true)"
  fi
  if [[ -z "$site_packages" ]]; then
    site_packages="$(uv run --project "$BACKEND" --extra cuda --no-sync python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])' 2>/dev/null || true)"
  fi

  cuda_site="$site_packages/nvidia"
  for lib_dir in \
    "$cuda_site/cublas/lib" \
    "$cuda_site/cudnn/lib" \
    "$cuda_site/cuda_runtime/lib" \
    "$cuda_site/cuda_nvrtc/lib" \
    "$cuda_site/nvjitlink/lib" \
    "$cuda_site/cufft/lib" \
    "$cuda_site/curand/lib"; do
    if [[ -d "$lib_dir" ]]; then
      cuda_library_dirs+=("$lib_dir")
    fi
  done

  if ((${#cuda_library_dirs[@]} > 0)); then
    joined_paths="$(IFS=:; echo "${cuda_library_dirs[*]}")"
    if [[ -n "${LD_LIBRARY_PATH:-}" ]]; then
      export LD_LIBRARY_PATH="$joined_paths:$LD_LIBRARY_PATH"
    else
      export LD_LIBRARY_PATH="$joined_paths"
    fi
    echo "  CUDA 动态库: 已加入 NVIDIA Python 包路径（${#cuda_library_dirs[@]} 个目录）"
  else
    echo "  警告：未找到 NVIDIA Python 动态库目录，ONNX Runtime CUDA 可能无法加载。" >&2
    echo "  请确认 CUDA extra 已安装，或手动设置 LD_LIBRARY_PATH。" >&2
  fi
}

if [[ "$RUNTIME" == "cuda" ]]; then
  configure_cuda_library_path
fi
validate_backend_entrypoints

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
