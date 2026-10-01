"""Render original biodiversity models in two isolated Blender inspection scenes."""
from pathlib import Path
import runpy


def render_expansion():
    script = Path(__file__).with_name("ocean_atelier_preview.py")
    namespace = runpy.run_path(str(script))
    render = namespace["render_atelier"]
    settings = render.__globals__
    settings["FRAME_WIDTH"] = 21.2
    destination = script.resolve().parents[2] / "reports" / "ocean-blender" / "full-atelier"
    families = (
        ("Fauna", (
            ("fish-prism-tang", "PRISM TANG"), ("fish-sun-banner", "SUN BANNER"),
            ("fish-ember-anthias", "EMBER ANTHIAS"), ("fish-moon-sardine", "MOON SARDINE"),
            ("creature-manta", "VELVET MANTA"), ("creature-cuttlefish", "PEARL CUTTLEFISH"),
        )),
        ("Gardens", (
            ("coral-rosette", "CRIMSON ROSETTE"), ("coral-antler", "COBALT ANTLER"),
            ("anemone-lantern", "LANTERN ANEMONE"), ("seaweed-spiral", "SPIRAL SEAWEED"),
            ("grass-meadow", "GOLDEN MEADOW"), ("stone-ridge", "SLATE RIDGE"),
            ("reef-arch", "TIDAL ARCH"), ("pearl-cluster", "PEARL POLYPS"),
        )),
    )
    results = []
    for family, assets in families:
        settings["OWNER"] = "serenity-ocean-" + family.lower() + "-preview-v1"
        settings["SCENE_NAME"] = "Serenity Ocean - " + family + " Atelier"
        settings["COLLECTION_NAME"] = "Serenity Ocean - " + family + " Preview"
        settings["ASSETS"] = tuple(
            (asset, title, -5.85 + (index % 4) * 3.9, 2.65 if index < 4 else -2.45,
             3.1, 2.9, -0.12)
            for index, (asset, title) in enumerate(assets)
        )
        results.append(render(output_dir=destination / family.lower(), save_blend=family == "Gardens"))
    return {"previews": results}
