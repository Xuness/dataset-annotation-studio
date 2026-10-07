#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export CARGO_HOME="$ROOT/.rust/cargo"
export RUSTUP_HOME="$ROOT/.rust/rustup"
export PATH="$CARGO_HOME/bin:$PATH"
cd "$ROOT"

if [[ "$(uname -s)" != Linux ]]; then
  echo "错误：此安装脚本仅用于 Linux 项目内 Rust 工具链。" >&2
  exit 1
fi

if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
  for command in curl sha256sum; do
    command -v "$command" >/dev/null || {
      echo "错误：安装项目 Rust 工具链需要 $command。" >&2
      exit 1
    }
  done
  case "$(uname -m)" in
    x86_64) host="x86_64-unknown-linux-gnu" ;;
    aarch64) host="aarch64-unknown-linux-gnu" ;;
    *) echo "错误：未支持的 Rust 安装架构：$(uname -m)" >&2; exit 1 ;;
  esac
  download_dir="$ROOT/.rust/downloads"
  mkdir -p "$download_dir"
  url="https://static.rust-lang.org/rustup/dist/$host/rustup-init"
  echo "[Dataset Studio] 安装项目内 rustup，不修改系统 Rust 或 shell 配置。"
  if [[ ! -f "$download_dir/rustup-init" ]]; then
    curl --fail --show-error --location --retry 2 --connect-timeout 15 --max-time 900 \
      "$url" --output "$download_dir/rustup-init.partial"
    mv "$download_dir/rustup-init.partial" "$download_dir/rustup-init"
  fi
  curl --fail --show-error --location --retry 2 --connect-timeout 15 --max-time 60 \
    "$url.sha256" --output "$download_dir/rustup-init.sha256"
  (cd "$download_dir" && sha256sum --check rustup-init.sha256)
  chmod +x "$download_dir/rustup-init"
  RUSTUP_INIT_SKIP_PATH_CHECK=yes "$download_dir/rustup-init" \
    -y --no-modify-path --profile minimal --default-toolchain none
fi

# rustup reads the pinned project toolchain and installs its declared components.
"$CARGO_HOME/bin/rustup" toolchain install --no-self-update --no-update
"$CARGO_HOME/bin/rustup" show active-toolchain
"$CARGO_HOME/bin/rustc" -vV
"$CARGO_HOME/bin/cargo" -V
"$CARGO_HOME/bin/rustfmt" -V
