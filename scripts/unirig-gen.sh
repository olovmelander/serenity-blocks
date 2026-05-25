#!/usr/bin/env bash
# Thin wrapper so the UniRig Python driver runs with the right interpreter,
# CUDA toolkit paths, and repository checkout regardless of the active shell.
#
# Usage:
#   scripts/unirig-gen.sh \
#     --input src/themes/ocean/assets/fauna/reef-seahorse-triposr.glb \
#     --out   src/themes/ocean/assets/fauna/reef-seahorse-triposr-rigged.glb
#
# Override the Python interpreter (and therefore the conda env) with:
#   UNIRIG_PYTHON=/path/to/python scripts/unirig-gen.sh ...
set -euo pipefail

PYBIN="${UNIRIG_PYTHON:-$HOME/miniconda3/envs/unirig/bin/python}"
ENV_DIR="$(cd "$(dirname "$PYBIN")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PATH="$(dirname "$PYBIN"):$PATH"
export CUDA_HOME="${CUDA_HOME:-$ENV_DIR}"
export CUDAToolkit_ROOT="${CUDAToolkit_ROOT:-$CUDA_HOME}"

exec "$PYBIN" "$SCRIPT_DIR/unirig_gen.py" "$@"
