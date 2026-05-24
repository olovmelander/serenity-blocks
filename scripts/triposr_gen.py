#!/usr/bin/env python3
"""
Generate a 3D asset from an input image using TripoSR.

Run via the shell wrapper:
    scripts/triposr-gen.sh --image input.png --out src/themes/ocean/assets/fauna/new-fish.glb

The wrapper delegates to the official TripoSR checkout and copies the generated
mesh to the requested output path.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


DEFAULT_TRIPOSR_REPO = Path(
    os.environ.get("TRIPOSR_REPO", str(Path.home() / "tools" / "TripoSR"))
).resolve()


def parse_args():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--image", required=True, type=Path, help="Input image path.")
    parser.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Output mesh path. Supported suffixes: .glb, .obj.",
    )
    parser.add_argument(
        "--triposr-repo",
        default=DEFAULT_TRIPOSR_REPO,
        type=Path,
        help=f"TripoSR checkout path (default: {DEFAULT_TRIPOSR_REPO}).",
    )
    parser.add_argument(
        "--device",
        default=os.environ.get("TRIPOSR_DEVICE", "cuda:0"),
        help="Torch device for TripoSR (default: cuda:0; TripoSR falls back to CPU).",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("TRIPOSR_MODEL", "stabilityai/TripoSR"),
        help="HF model repo or local model path (default: stabilityai/TripoSR).",
    )
    parser.add_argument(
        "--chunk-size",
        default=8192,
        type=int,
        help="Surface extraction chunk size. Lower values use less VRAM.",
    )
    parser.add_argument(
        "--mc-resolution",
        default=256,
        type=int,
        help="Marching cubes resolution (default: 256).",
    )
    parser.add_argument(
        "--no-remove-bg",
        action="store_true",
        help="Skip TripoSR background removal.",
    )
    parser.add_argument(
        "--foreground-ratio",
        default=0.85,
        type=float,
        help="Foreground resize ratio when background removal is enabled.",
    )
    parser.add_argument(
        "--bake-texture",
        action="store_true",
        help="Bake a texture atlas instead of vertex colors.",
    )
    parser.add_argument(
        "--texture-resolution",
        default=2048,
        type=int,
        help="Texture atlas resolution for --bake-texture.",
    )
    parser.add_argument(
        "--render",
        action="store_true",
        help="Ask TripoSR to save a preview render video in the working output.",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        help="Optional directory to keep TripoSR intermediates. Defaults to a temp dir.",
    )
    return parser.parse_args()


def checked_path(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        sys.exit(f"{label} not found: {resolved}")
    return resolved


def run_triposr(args, work_dir: Path) -> Path:
    repo = checked_path(args.triposr_repo, "TripoSR repo")
    run_py = repo / "run.py"
    if not run_py.is_file():
        sys.exit(f"TripoSR run.py not found at {run_py}")

    image = checked_path(args.image, "Input image")
    out = args.out.expanduser().resolve()
    fmt = out.suffix.lower().lstrip(".")
    if fmt not in {"glb", "obj"}:
        sys.exit(f"Unsupported output format: {out.suffix}. Use .glb or .obj.")

    cmd = [
        sys.executable,
        str(run_py),
        str(image),
        "--output-dir",
        str(work_dir),
        "--model-save-format",
        fmt,
        "--device",
        args.device,
        "--pretrained-model-name-or-path",
        args.model,
        "--chunk-size",
        str(args.chunk_size),
        "--mc-resolution",
        str(args.mc_resolution),
        "--foreground-ratio",
        str(args.foreground_ratio),
    ]
    if args.no_remove_bg:
        cmd.append("--no-remove-bg")
    if args.bake_texture:
        cmd.extend(
            ["--bake-texture", "--texture-resolution", str(args.texture_resolution)]
        )
    if args.render:
        cmd.append("--render")

    (work_dir / "0").mkdir(parents=True, exist_ok=True)
    print(f"[triposr] repo: {repo}")
    print(f"[triposr] writing intermediates to: {work_dir}")
    subprocess.run(cmd, cwd=repo, check=True)

    generated = work_dir / "0" / f"mesh.{fmt}"
    if not generated.is_file():
        sys.exit(f"TripoSR finished but did not write expected mesh: {generated}")

    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(generated, out)

    texture = work_dir / "0" / "texture.png"
    if args.bake_texture and texture.is_file():
        texture_out = out.with_name(f"{out.stem}-texture.png")
        shutil.copy2(texture, texture_out)
        print(f"[triposr] wrote texture {texture_out}")

    return out


def main():
    args = parse_args()
    if args.work_dir:
        work_dir = args.work_dir.expanduser().resolve()
        work_dir.mkdir(parents=True, exist_ok=True)
        out = run_triposr(args, work_dir)
    else:
        with tempfile.TemporaryDirectory(prefix="triposr-") as tmp:
            out = run_triposr(args, Path(tmp))
    print(f"[triposr] wrote {out}")


if __name__ == "__main__":
    main()
