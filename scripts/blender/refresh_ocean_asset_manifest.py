"""Rebuild portable Ocean asset metadata from exported GLBs; no Blender required.

Run: python scripts/blender/refresh_ocean_asset_manifest.py
Use --check to verify the committed manifest without changing any files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct


DEFAULT_ASSET_DIR = Path(__file__).resolve().parents[2] / "src/themes/ocean/assets/blender-reef"
SOURCE_GROUPS = {
    "ocean_living_assets.py": {"jellyfish", "kelp"},
    "ocean_reef_assets.py": {
        "coral-fan", "coral-foliose", "coral-sponge", "coral-staghorn", "reef-buttress", "reef-outcrop",
    },
    "ocean_garden_assets.py": {
        "coral-rosette", "coral-antler", "anemone-lantern", "seaweed-spiral",
        "grass-meadow", "stone-ridge", "reef-arch", "pearl-cluster",
    },
    "ocean_fauna_assets.py": {
        "fish-prism-tang", "fish-sun-banner", "fish-ember-anthias", "fish-moon-sardine",
        "creature-manta", "creature-cuttlefish",
    },
}


def inspect_asset(path: Path) -> dict:
    source = next((filename for filename, ids in SOURCE_GROUPS.items() if path.stem in ids), None)
    if source is None:
        raise ValueError("Add authoring source attribution for asset: " + path.name)
    content = path.read_bytes()
    magic, version, size = struct.unpack_from("<III", content)
    if (magic, version, size) != (0x46546C67, 2, len(content)):
        raise ValueError("Invalid GLB header: " + path.name)
    length, kind = struct.unpack_from("<II", content, 12)
    if kind != 0x4E4F534A or 20 + length > len(content):
        raise ValueError("Invalid GLB JSON chunk: " + path.name)
    document = json.loads(content[20:20 + length])
    meshes = document["meshes"]
    if len(meshes) != 1 or len(meshes[0]["primitives"]) != 1 or len(document["materials"]) != 1:
        raise ValueError("Ocean assets must have one mesh, primitive and material: " + path.name)
    if document.get("textures") or document.get("images") or any(b.get("uri") for b in document["buffers"]):
        raise ValueError("Ocean assets must be texture-free and self-contained: " + path.name)
    mesh = meshes[0]
    primitive = mesh["primitives"][0]
    if primitive.get("mode", 4) != 4:
        raise ValueError("Ocean assets require triangle primitives: " + path.name)
    accessors = document["accessors"]
    position = accessors[primitive["attributes"]["POSITION"]]
    material = document["materials"][primitive.get("material", 0)]
    index_count = accessors[primitive["indices"]]["count"]
    if index_count % 3:
        raise ValueError("Incomplete triangle indices: " + path.name)
    animations = []
    for clip in document.get("animations", []):
        inputs = [accessors[sampler["input"]] for sampler in clip["samplers"]]
        start = min(accessor["min"][0] for accessor in inputs)
        end = max(accessor["max"][0] for accessor in inputs)
        animations.append({
            "name": clip["name"],
            "channels": sorted({channel["target"]["path"] for channel in clip["channels"]}),
            "startSeconds": start,
            "endSeconds": end,
            "loopSeconds": end - start,
        })
    return {
        "id": path.stem,
        "file": path.name,
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "meshCount": len(meshes),
        "primitiveCount": sum(len(mesh["primitives"]) for mesh in meshes),
        "materialCount": len(document["materials"]),
        "textureCount": len(document.get("textures", [])),
        "vertexCount": position["count"],
        "triangleCount": index_count // 3,
        "colorAttributeType": accessors[primitive["attributes"]["COLOR_0"]]["type"],
        "alphaMode": material.get("alphaMode", "OPAQUE"),
        "morphTargetCount": len(primitive.get("targets", [])),
        "shapeKeys": mesh.get("extras", {}).get("targetNames", []),
        "animations": animations,
        "bounds": {"min": position["min"], "max": position["max"]},
        "source": "scripts/blender/" + source,
    }


def build_manifest(asset_directory: Path) -> dict:
    assets = [inspect_asset(path) for path in sorted(asset_directory.glob("*.glb"))]
    if not assets:
        raise ValueError("No GLB assets found.")
    return {
        "schemaVersion": 1,
        "author": "Serenity Blocks original procedural Blender sculpture",
        "glTFUpAxis": "Y",
        "textureCount": 0,
        "boundsNote": "Bounds describe the rest POSITION accessor in glTF Y-up coordinates; morph bounds may extend farther.",
        "animationNote": "Loop period is endSeconds - startSeconds. Blender frame 1 creates a one-frame leading hold in GLTFLoader clip.duration.",
        "totals": {
            "files": len(assets),
            "bytes": sum(asset["bytes"] for asset in assets),
            "vertices": sum(asset["vertexCount"] for asset in assets),
            "triangles": sum(asset["triangleCount"] for asset in assets),
        },
        "assets": assets,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset-dir", type=Path, default=DEFAULT_ASSET_DIR)
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    manifest = build_manifest(arguments.asset_dir)
    output = arguments.asset_dir / "asset-manifest.json"
    if arguments.check:
        if not output.exists() or json.loads(output.read_text(encoding="utf-8")) != manifest:
            print("asset-manifest.json is stale; run this script without --check.")
            return 1
    else:
        output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["totals"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
