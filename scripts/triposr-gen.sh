#!/usr/bin/env bash
# Thin wrapper so the TripoSR Python script runs with the right interpreter,
# CUDA toolkit paths, and repository checkout regardless of the active shell.
set -euo pipefail

PYBIN="${TRIPOSR_PYTHON:-$HOME/miniconda3/envs/hunyuan3d/bin/python}"
ENV_DIR="$(cd "$(dirname "$PYBIN")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PATH="$(dirname "$PYBIN"):$PATH"
export CUDA_HOME="${CUDA_HOME:-$ENV_DIR}"
export CUDAToolkit_ROOT="${CUDAToolkit_ROOT:-$CUDA_HOME}"

exec "$PYBIN" "$SCRIPT_DIR/triposr_gen.py" "$@"
