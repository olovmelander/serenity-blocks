"""Fall: the squirrel's near perches (a windfall, an old stump) and the limbs it runs on.

    blender --background --factory-startup --python scripts/blender/fall_perches.py -- \
        --out src/themes/fall/assets [--no-bake] [--limbs-only]

Grows the two perches with the grove's own skeleton and wood (fall_grove/perches.py), bakes their
bark occlusion and writes them as tree assets beside the grove's (old-windfall.glb, old-stump.glb,
recorded in asset-manifest.json), and writes squirrel-perches.json: the centre lines and radii of
every limb the squirrel runs on (the perches' own, and the boughs of the two great trees it uses, read
from the same seeded recipes the grove's GLBs were grown from) and the flat places it sits on.
"""

import json
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from fall_grove import perches, species  # noqa: E402


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--out" not in arguments:
        raise SystemExit("usage: blender -b --factory-startup --python fall_perches.py -- --out <dir>")
    out = Path(arguments[arguments.index("--out") + 1]).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    if "--limbs-only" not in arguments:
        grove = runpy.run_path(str(HERE / "fall_grove_assets.py"))
        manifest = grove["build_assets"](out, only=["trees"], recipes=list(perches.PERCH_RECIPES),
                                         bake="--no-bake" not in arguments)
        manifest_path = out / "asset-manifest.json"
        previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"assets": []}
        merged = {entry["file"]: entry for entry in previous.get("assets", [])}
        merged.update({entry["file"]: entry for entry in manifest["assets"]})
        previous["assets"] = [merged[name] for name in sorted(merged)]
        manifest_path.write_text(json.dumps(previous, indent=2) + "\n", encoding="utf-8", newline="\n")
    limbs = perches.perch_limbs(species.RECIPES)
    document = dict(
        generator="Serenity Blocks - Fall perches (scripts/blender/fall_perches.py)",
        note="Limb centre lines [x, y, z, radius] in each asset's own metres (y up, its base at the origin).",
        assets=limbs,
    )
    path = out / "squirrel-perches.json"
    path.write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print("[fall-perches] wrote %s (%d bytes): %s" % (
        path.name, path.stat().st_size,
        ", ".join("%s %d limbs" % (name, len(entry["limbs"])) for name, entry in limbs.items())), flush=True)


if __name__ == "__main__":
    main()
