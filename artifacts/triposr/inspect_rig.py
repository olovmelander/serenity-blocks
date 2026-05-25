"""Dump bone hierarchy + skinning summary for a rigged GLB.

Usage:
    python artifacts/triposr/inspect_rig.py path/to/rigged.glb

Helps verify that a UniRig output has a usable spine/tail chain before
wiring it into the runtime.
"""

import sys
from pathlib import Path
from pygltflib import GLTF2


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: python inspect_rig.py <rigged.glb>")
    path = Path(sys.argv[1])
    if not path.is_file():
        sys.exit(f"File not found: {path}")

    gltf = GLTF2().load(str(path))
    nodes = gltf.nodes or []
    skins = gltf.skins or []
    animations = gltf.animations or []

    print(f"File: {path}")
    print(f"Nodes: {len(nodes)}")
    print(f"Skins: {len(skins)}")
    print(f"Animations: {len(animations)}")
    for clip in animations:
        print(f"  - clip: {clip.name!r} channels={len(clip.channels)}")

    if not skins:
        print("\n[!] No skins found — the file is not rigged.")
        return

    for i, skin in enumerate(skins):
        joint_ids = skin.joints or []
        print(f"\nSkin {i}: {len(joint_ids)} joints")
        print("  Bone hierarchy (depth-first from skeleton root):")
        root_id = skin.skeleton if skin.skeleton is not None else joint_ids[0]
        joint_set = set(joint_ids)

        def walk(node_id, depth):
            node = nodes[node_id]
            tag = "*" if node_id in joint_set else " "
            name = node.name or f"<node {node_id}>"
            t = node.translation or [0, 0, 0]
            print(f"  {tag} {'  ' * depth}{name}  t=({t[0]:+.3f},{t[1]:+.3f},{t[2]:+.3f})")
            for child in node.children or []:
                walk(child, depth + 1)

        walk(root_id, 0)


if __name__ == "__main__":
    main()
