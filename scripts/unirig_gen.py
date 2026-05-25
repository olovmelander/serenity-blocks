#!/usr/bin/env python3
"""
Auto-rig a 3D mesh with UniRig (skeleton + skinning weights, no animation).

Run via the shell wrapper:
    scripts/unirig-gen.sh \
        --input src/themes/ocean/assets/fauna/reef-seahorse-triposr.glb \
        --out   src/themes/ocean/assets/fauna/reef-seahorse-triposr-rigged.glb

The wrapper delegates to the official UniRig checkout
(https://github.com/VAST-AI-Research/UniRig), running its three inference
stages in sequence inside a temp dir:

    1. generate_skeleton.sh  — predicts the bone hierarchy
    2. generate_skin.sh      — predicts per-vertex skinning weights
    3. merge.sh              — bakes skeleton + skin back onto the original
                               mesh and writes the requested output file

UniRig outputs a RIG ONLY; it does not author animation clips. Drive the
resulting bones procedurally in JS (see ocean-reef-dweller-system.js) or
hand-author clips in Blender as a follow-up.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Optional imports: only needed for the colour-transfer post-process.
try:
    import numpy as np
    import trimesh
    from scipy.spatial import cKDTree
    _HAVE_COLOR_DEPS = True
except ImportError:
    _HAVE_COLOR_DEPS = False


DEFAULT_UNIRIG_REPO = Path(
    os.environ.get("UNIRIG_REPO", str(Path.home() / "tools" / "UniRig"))
).resolve()


def parse_args():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--input", required=True, type=Path,
                        help="Input mesh path (.glb / .obj / .fbx / .vrm).")
    parser.add_argument("--out", required=True, type=Path,
                        help="Output rigged mesh path. Supported: .glb, .fbx.")
    parser.add_argument(
        "--unirig-repo",
        default=DEFAULT_UNIRIG_REPO,
        type=Path,
        help=f"UniRig checkout path (default: {DEFAULT_UNIRIG_REPO}).",
    )
    parser.add_argument(
        "--device",
        default=os.environ.get("UNIRIG_DEVICE", "cuda:0"),
        help="Torch device for UniRig (default: cuda:0).",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        help="Optional directory to keep UniRig intermediates. Defaults to a temp dir.",
    )
    parser.add_argument(
        "--keep-intermediates",
        action="store_true",
        help="If --work-dir is set, leave skeleton/skin FBX files in place after merge.",
    )
    parser.add_argument(
        "--no-color-transfer",
        action="store_true",
        help=(
            "Skip the post-process step that copies vertex colours from the "
            "original mesh onto the rigged output. The FBX roundtrip inside "
            "UniRig changes the colour encoding (UNSIGNED_BYTE -> "
            "UNSIGNED_SHORT) which Three.js renders darker, so by default we "
            "rewrite the rigged GLB with the source's vertex colours via "
            "nearest-neighbour lookup."
        ),
    )
    return parser.parse_args()


def checked_path(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        sys.exit(f"{label} not found: {resolved}")
    return resolved


def run_stage(label: str, script: Path, repo: Path, extra: list[str]) -> None:
    if not script.is_file():
        sys.exit(f"UniRig {label} script not found at {script}")
    cmd = ["bash", str(script), *extra]
    print(f"[unirig] [{label}] $ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=repo, check=True)


def _scene_to_mesh(loaded):
    """Flatten a trimesh Scene to a single mesh while preserving vertex colours."""
    if hasattr(loaded, "to_geometry"):
        return loaded.to_geometry()
    if hasattr(loaded, "dump"):
        return loaded.dump(concatenate=True)
    return loaded


def transfer_vertex_colors(source_path: Path, rigged_path: Path) -> None:
    """Copy per-vertex colours from `source_path` onto the mesh in `rigged_path`.

    UniRig's FBX roundtrip splits shared vertices and re-encodes COLOR_0 as
    UNSIGNED_SHORT, which Three.js renders darker than the source's
    UNSIGNED_BYTE encoding. We sidestep the encoding problem entirely by
    rewriting the rigged GLB with the source's colours, looked up via
    nearest-neighbour in 3D space.

    The rigged GLB's skeleton, skinning weights, and topology are preserved.
    """
    if not _HAVE_COLOR_DEPS:
        print("[unirig] [color-transfer] SKIPPED: numpy/trimesh/scipy not installed.")
        return

    src_scene = trimesh.load(str(source_path))
    src_mesh = _scene_to_mesh(src_scene)
    src_colors = getattr(src_mesh.visual, "vertex_colors", None)
    if src_colors is None or len(src_colors) == 0:
        print("[unirig] [color-transfer] SKIPPED: source mesh has no vertex colours.")
        return

    # Re-load the rigged file as a full glTF so we preserve skin/joint data
    # when writing it back. trimesh's GLB writer loses skinning, so we use
    # pygltflib for the rewrite.
    try:
        import pygltflib
        from pygltflib import BufferFormat
    except ImportError:
        print("[unirig] [color-transfer] SKIPPED: pygltflib not installed (pip install pygltflib).")
        return

    rigged_scene = trimesh.load(str(rigged_path))
    rigged_mesh = _scene_to_mesh(rigged_scene)
    if len(rigged_mesh.vertices) == 0:
        print("[unirig] [color-transfer] SKIPPED: rigged mesh has no vertices.")
        return

    # Nearest-neighbour from each rigged vertex to a source vertex.
    tree = cKDTree(np.asarray(src_mesh.vertices))
    _, idx = tree.query(np.asarray(rigged_mesh.vertices), k=1)
    new_colors = np.asarray(src_colors)[idx]  # (N_rigged, 4) uint8

    # Now write the new colours into the rigged glTF's COLOR_0 accessor,
    # re-encoded as UNSIGNED_BYTE (matches the source encoding so Three.js
    # treats it as sRGB just like the original).
    g = pygltflib.GLTF2().load(str(rigged_path))
    g.convert_buffers(BufferFormat.BINARYBLOB)  # ensure single binary buffer

    # Find the COLOR_0 accessor in mesh 0 primitive 0 (the only mesh).
    prim = g.meshes[0].primitives[0]
    color_accessor_id = getattr(prim.attributes, "COLOR_0", None)
    if color_accessor_id is None:
        print("[unirig] [color-transfer] SKIPPED: rigged GLB has no COLOR_0 attribute.")
        return

    # Encode as uint8 VEC4 normalized, the same as TripoSR's source.
    color_bytes = new_colors.astype(np.uint8).tobytes()

    # Replace the entire binary blob: keep the existing buffer view layout
    # but overwrite the colour bytes. To do this cleanly we replace the
    # whole accessor's view with a new one appended to the buffer.
    blob = g.binary_blob() or b""
    new_view_offset = len(blob)
    blob = blob + color_bytes
    # Pad to 4-byte alignment.
    pad = (-len(blob)) % 4
    if pad:
        blob = blob + b"\x00" * pad
    g.set_binary_blob(blob)

    new_buffer_view = pygltflib.BufferView(
        buffer=0,
        byteOffset=new_view_offset,
        byteLength=len(color_bytes),
        target=pygltflib.ARRAY_BUFFER,
    )
    g.bufferViews.append(new_buffer_view)
    new_view_id = len(g.bufferViews) - 1

    # Update the colour accessor in place: same count, new bufferView, uint8 normalized.
    acc = g.accessors[color_accessor_id]
    acc.bufferView = new_view_id
    acc.byteOffset = 0
    acc.componentType = pygltflib.UNSIGNED_BYTE  # 5121
    acc.type = "VEC4"
    acc.normalized = True
    acc.count = len(new_colors)
    acc.min = None
    acc.max = None

    # The buffer length grew — keep buffer length in sync.
    g.buffers[0].byteLength = len(blob)

    g.save(str(rigged_path))
    mean = new_colors.astype(np.float32).mean(axis=0).round(1).tolist()
    print(f"[unirig] [color-transfer] OK: rewrote {len(new_colors)} vertex colours "
          f"(uint8 sRGB, mean RGBA={mean}).")


def run_unirig(args, work_dir: Path) -> Path:
    repo = checked_path(args.unirig_repo, "UniRig repo")
    inference_dir = repo / "launch" / "inference"
    skeleton_sh = inference_dir / "generate_skeleton.sh"
    skin_sh = inference_dir / "generate_skin.sh"
    merge_sh = inference_dir / "merge.sh"

    input_mesh = checked_path(args.input, "Input mesh")
    out = args.out.expanduser().resolve()
    out_suffix = out.suffix.lower()
    if out_suffix not in {".glb", ".fbx"}:
        sys.exit(f"Unsupported output format: {out.suffix}. Use .glb or .fbx.")

    skeleton_fbx = work_dir / "skeleton.fbx"
    skin_fbx = work_dir / "skin.fbx"

    print(f"[unirig] repo:   {repo}")
    print(f"[unirig] input:  {input_mesh}")
    print(f"[unirig] work:   {work_dir}")
    print(f"[unirig] device: {args.device}")

    run_stage(
        "skeleton", skeleton_sh, repo,
        ["--input", str(input_mesh), "--output", str(skeleton_fbx)],
    )
    if not skeleton_fbx.is_file():
        sys.exit(f"Skeleton stage finished but did not write: {skeleton_fbx}")

    run_stage(
        "skin", skin_sh, repo,
        ["--input", str(skeleton_fbx), "--output", str(skin_fbx)],
    )
    if not skin_fbx.is_file():
        sys.exit(f"Skin stage finished but did not write: {skin_fbx}")

    out.parent.mkdir(parents=True, exist_ok=True)
    run_stage(
        "merge", merge_sh, repo,
        ["--source", str(skin_fbx), "--target", str(input_mesh), "--output", str(out)],
    )
    if not out.is_file():
        sys.exit(f"Merge stage finished but did not write: {out}")

    if not args.no_color_transfer:
        transfer_vertex_colors(input_mesh, out)

    size_kb = out.stat().st_size / 1024
    print(f"[unirig] wrote {out} ({size_kb:.1f} KB)")
    return out


def main():
    args = parse_args()
    if args.work_dir:
        work_dir = args.work_dir.expanduser().resolve()
        work_dir.mkdir(parents=True, exist_ok=True)
        out = run_unirig(args, work_dir)
        if not args.keep_intermediates:
            for name in ("skeleton.fbx", "skin.fbx"):
                p = work_dir / name
                if p.is_file():
                    p.unlink()
    else:
        with tempfile.TemporaryDirectory(prefix="unirig-") as tmp:
            out = run_unirig(args, Path(tmp))
    print(f"[unirig] done → {out}")


if __name__ == "__main__":
    main()
