#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
RUNTIME_REQUEST="${DATASET_STUDIO_RUNTIME:-auto}"
GRAPHICS="${DATASET_STUDIO_LINUX_GRAPHICS:-cpu-paint}"
CHECK_ONLY=0
SKIP_SYNC=0
ORIGINAL_TERMINAL_STATE=""

usage() {
  cat <<'EOF'
Dataset Annotation Studio Linux 开发版启动器

用法：
  ./启动开发版.sh [选项]

选项：
  --auto                 自动选择 Runtime（默认；有 NVIDIA CUDA 时优先 CUDA）
  --cuda                 强制使用 backend/.venv-cuda
  --cpu                  强制使用 backend/.venv-cpu
  --graphics MODE        cpu-paint（默认）| native | nvidia-sync | dmabuf-off | software
  --check-only           只检查并同步依赖，不启动应用
  --skip-sync            跳过 pnpm install 与 uv sync
  -h, --help             显示帮助

示例：
  ./启动开发版.sh
  ./启动开发版.sh --cuda --graphics native
  ./启动开发版.sh --cpu --graphics software
EOF
}

while (($#)); do
  case "$1" in
    --auto) RUNTIME_REQUEST="auto" ;;
    --cpu) RUNTIME_REQUEST="cpu" ;;
    --cuda) RUNTIME_REQUEST="cuda" ;;
    --graphics)
      shift
      [[ $# -gt 0 ]] || {
        echo "错误：--graphics 缺少模式。" >&2
        exit 2
      }
      GRAPHICS="$1"
      ;;
    --check-only) CHECK_ONLY=1 ;;
    --skip-sync) SKIP_SYNC=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "错误：未知参数 $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

case "$RUNTIME_REQUEST" in
  auto | cpu | cuda) ;;
  *)
    echo "错误：Runtime 只能是 auto、cpu 或 cuda。" >&2
    exit 2
    ;;
esac
case "$GRAPHICS" in
  default) GRAPHICS="native" ;;
  native | cpu-paint | nvidia-sync | dmabuf-off | software) ;;
  *)
    echo "错误：图形模式只能是 native、cpu-paint、nvidia-sync、dmabuf-off 或 software。" >&2
    exit 2
    ;;
esac

for command in node pnpm uv cargo rustc; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "错误：缺少命令 '$command'，请先安装对应开发工具。" >&2
    exit 1
  }
done

has_nvidia_cuda_device() {
  local device_ids

  command -v nvidia-smi >/dev/null 2>&1 || return 1
  device_ids="$(nvidia-smi --query-gpu=index --format=csv,noheader,nounits 2>/dev/null)" ||
    return 1
  grep -Eq '^[[:space:]]*[0-9]+[[:space:]]*$' <<<"$device_ids"
}

resolve_runtime() {
  if [[ "$RUNTIME_REQUEST" == "cpu" ]]; then
    printf 'cpu\n'
    return
  fi
  if has_nvidia_cuda_device; then
    printf 'cuda\n'
    return
  fi
  if [[ "$RUNTIME_REQUEST" == "cuda" ]]; then
    echo "错误：显式请求了 CUDA Runtime，但没有检测到可用的 NVIDIA CUDA 设备。" >&2
    echo "请检查 NVIDIA 驱动，或改用 --cpu。" >&2
    exit 1
  fi
  printf 'cpu\n'
}

select_dev_ports() {
  local ports_json
  local frontend_port
  local api_port
  local hmr_port

  ports_json="$(node "$ROOT/scripts/dev-ports.mjs" --json)"
  read -r frontend_port api_port hmr_port < <(
    node -e \
      'const selection = JSON.parse(process.argv[1]); console.log(selection.frontendPort, selection.apiPort, selection.hmrPort);' \
      "$ports_json"
  )
  [[ "$frontend_port" =~ ^[0-9]+$ && "$api_port" =~ ^[0-9]+$ ]] || {
    echo "错误：端口选择器返回了无效结果。" >&2
    exit 1
  }

  export DATASET_STUDIO_FRONTEND_PORT="$frontend_port"
  export DATASET_STUDIO_PORT="$api_port"
  export VITE_API_BASE_URL="http://127.0.0.1:$api_port"
  export DATASET_STUDIO_AUTO_PORTS=1
  if [[ "$hmr_port" == "null" ]]; then
    unset DATASET_STUDIO_HMR_PORT
  else
    export DATASET_STUDIO_HMR_PORT="$hmr_port"
  fi
  echo "[Dataset Studio] 可用开发端口：Vite $frontend_port，API $api_port"
}

RUNTIME="$(resolve_runtime)"
ENVIRONMENT_DIR="$BACKEND/.venv-$RUNTIME"
export UV_PROJECT_ENVIRONMENT="$ENVIRONMENT_DIR"
export DATASET_STUDIO_RUNTIME="$RUNTIME"
export DATASET_STUDIO_SOURCE_ROOT="$ROOT"

cd "$ROOT"

echo "[Dataset Studio] Runtime：$RUNTIME"
echo "[Dataset Studio] Python 环境：$ENVIRONMENT_DIR"
if [[ "$RUNTIME_REQUEST" == "auto" && "$RUNTIME" == "cpu" ]]; then
  echo "[Dataset Studio] 未检测到 NVIDIA CUDA 设备，使用独立 CPU Runtime。"
fi

if [[ $CHECK_ONLY -eq 0 ]]; then
  if command -v flock >/dev/null 2>&1; then
    LOCK_ROOT="${XDG_RUNTIME_DIR:-/tmp}"
    LOCK_ID="$(printf '%s' "$ROOT" | cksum | awk '{print $1}')"
    exec 9>"$LOCK_ROOT/dataset-annotation-studio-dev-$LOCK_ID.lock"
    flock -n 9 || {
      echo "错误：当前源码目录已有 Dataset Studio 开发会话正在运行。" >&2
      exit 1
    }
  fi
fi

if [[ $CHECK_ONLY -eq 0 ]]; then
  select_dev_ports
fi

if [[ $SKIP_SYNC -eq 0 ]]; then
  echo "[Dataset Studio] 检查前端依赖……"
  pnpm install --frozen-lockfile --prefer-offline --reporter=append-only

  echo "[Dataset Studio] 同步 Python $RUNTIME Runtime……"
  uv sync \
    --project "$BACKEND" \
    --extra "$RUNTIME" \
    --all-groups \
    --locked \
    --exact
fi

validate_backend_entrypoints() {
  local entrypoint
  local -a missing_entrypoints=()

  for entrypoint in dataset-studio-api dataset-studio-worker; do
    if [[ ! -x "$ENVIRONMENT_DIR/bin/$entrypoint" ]]; then
      missing_entrypoints+=("$entrypoint")
    fi
  done
  if ((${#missing_entrypoints[@]} == 0)); then
    return
  fi

  echo "错误：Python $RUNTIME 环境缺少后端入口：${missing_entrypoints[*]}" >&2
  echo "  Python 环境: $ENVIRONMENT_DIR" >&2
  if [[ $SKIP_SYNC -eq 1 ]]; then
    echo "  当前使用了 --skip-sync；请去掉该参数完成依赖同步。" >&2
  else
    echo "  请重新同步该运行时环境。" >&2
  fi
  exit 1
}

configure_cuda_library_path() {
  local python_bin="$ENVIRONMENT_DIR/bin/python"
  local site_packages=""
  local cuda_site
  local lib_dir
  local joined_paths
  local -a cuda_library_dirs=()

  if [[ -x "$python_bin" ]]; then
    site_packages="$(
      "$python_bin" -c \
        'import sysconfig; print(sysconfig.get_paths()["purelib"])' 2>/dev/null || true
    )"
  fi

  cuda_site="$site_packages/nvidia"
  for lib_dir in \
    "$cuda_site/cublas/lib" \
    "$cuda_site/cudnn/lib" \
    "$cuda_site/cuda_runtime/lib" \
    "$cuda_site/cuda_nvrtc/lib" \
    "$cuda_site/nvjitlink/lib" \
    "$cuda_site/cufft/lib" \
    "$cuda_site/curand/lib" \
    "$cuda_site/nvjpeg/lib" \
    "$cuda_site/nvimgcodec" \
    "$cuda_site/nvimgcodec/extensions"; do
    if [[ -d "$lib_dir" ]]; then
      cuda_library_dirs+=("$lib_dir")
    fi
  done

  if ((${#cuda_library_dirs[@]} == 0)); then
    echo "错误：未找到 NVIDIA Python 动态库目录，CUDA Runtime 不完整。" >&2
    echo "  Python 环境: $ENVIRONMENT_DIR" >&2
    exit 1
  fi

  joined_paths="$(IFS=:; echo "${cuda_library_dirs[*]}")"
  if [[ -n "${LD_LIBRARY_PATH:-}" ]]; then
    export LD_LIBRARY_PATH="$joined_paths:$LD_LIBRARY_PATH"
  else
    export LD_LIBRARY_PATH="$joined_paths"
  fi
  echo "[Dataset Studio] 已加入 ${#cuda_library_dirs[@]} 个 NVIDIA 动态库目录。"
}

restore_terminal() {
  local exit_status=$?

  if [[ -t 0 || -t 1 ]]; then
    if [[ -n "$ORIGINAL_TERMINAL_STATE" ]]; then
      stty "$ORIGINAL_TERMINAL_STATE" 2>/dev/null </dev/tty || true
    else
      stty sane 2>/dev/null </dev/tty || true
    fi
    printf \
      '\033[0m\033[?25h\033[?1l\033>\033[<u\033[=0u\033[>4;0m\r\n[Dataset Studio] 开发会话已结束，终端状态已恢复。\r\n' \
      2>/dev/null >/dev/tty || true
  fi

  return "$exit_status"
}

exit_for_signal() {
  local exit_status="$1"

  trap - HUP INT TERM
  exit "$exit_status"
}

validate_cuda_runtime() {
  local python_bin="$ENVIRONMENT_DIR/bin/python"

  if ! "$python_bin" -c '
import warnings

warnings.filterwarnings(
    "ignore",
    message=r"CUDA path could not be detected\..*",
    category=UserWarning,
)
import cupy as cp
import onnxruntime as ort

providers = ort.get_available_providers()
if "CUDAExecutionProvider" not in providers:
    raise SystemExit(
        "ONNX Runtime 未提供 CUDAExecutionProvider：" + ", ".join(providers)
    )
if cp.cuda.runtime.getDeviceCount() < 1:
    raise SystemExit("CuPy 没有检测到 CUDA 设备。")
with cp.cuda.Device(0):
    value = int(cp.arange(16, dtype=cp.int32).sum().get())
if value != 120:
    raise SystemExit(f"CuPy CUDA 探针结果异常：{value}")
'; then
    echo "错误：CUDA Runtime 探测失败。请检查驱动和锁定依赖，或显式使用 --cpu。" >&2
    exit 1
  fi
}

validate_backend_entrypoints
if [[ "$RUNTIME" == "cuda" ]]; then
  configure_cuda_library_path
  validate_cuda_runtime
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  echo "[Dataset Studio] 开发环境检查通过（runtime=$RUNTIME, graphics=$GRAPHICS）。"
  exit 0
fi

if [[ "$GRAPHICS" == "native" ]]; then
  unset DATASET_STUDIO_LINUX_GRAPHICS
else
  export DATASET_STUDIO_LINUX_GRAPHICS="$GRAPHICS"
fi

echo "[Dataset Studio] 启动开发版"
echo "  Runtime: $RUNTIME"
echo "  图形模式: $GRAPHICS"
if [[ -t 0 || -t 1 ]]; then
  ORIGINAL_TERMINAL_STATE="$(stty -g 2>/dev/null </dev/tty || true)"
fi
trap restore_terminal EXIT
trap 'exit_for_signal 129' HUP
trap 'exit_for_signal 130' INT
trap 'exit_for_signal 143' TERM
if [[ "$RUNTIME" == "cuda" ]]; then
  echo "  图片预处理: CUDA 编解码/缩放可用，不支持的图片或加速失败会逐项回退 CPU"
  pnpm dev
else
  echo "  图片预处理: CPU"
  pnpm dev:cpu
fi
