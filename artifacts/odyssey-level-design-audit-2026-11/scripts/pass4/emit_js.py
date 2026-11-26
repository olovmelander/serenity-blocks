"""Emit the public-id Odyssey retune from its measured proposal. Run with --check to verify the generated file."""
import argparse
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parents[3] / 'src/core/odyssey/data/level-design-2026-11.js'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true')
parser.add_argument('--output', type=Path, default=OUTPUT)
args = parser.parse_args()
proposal = json.loads((HERE / 'proposal.json').read_text(encoding='utf-8'))


def describe(b):
    t, x = b['type'], b.get('target')
    if t == 'no-singles':
        return 'No single-line clears'
    if t == 'max-cascade-depth':
        return f'Trigger a {x}-wave chain'
    if t == 'cascade':
        return f'Trigger {x} cascades'
    if t == 'quad-count':
        return f"Clear {x} Quad{'s' if x != 1 else ''}"
    if t == 'pieces':
        return f'Finish within {x} pieces'
    if t == 'time':
        return f'Finish in under {x} seconds'
    raise ValueError(t)


IDENT = re.compile(r'^[A-Za-z_$][A-Za-z0-9_$]*$')


def js(v, ind=0):
    pad, pad2 = '    ' * ind, '    ' * (ind + 1)
    if isinstance(v, dict):
        if not v:
            return '{}'
        items = [f"{k if IDENT.match(k) else repr(k)}: {js(x, ind + 1)}" for k, x in v.items()]
        one = '{ ' + ', '.join(items) + ' }'
        # the repo's object-curly-newline rule breaks objects of 4+ properties onto their own lines
        if len(one) + len(pad) < 100 and '\n' not in one and len(items) < 4:
            return one
        return '{\n' + ''.join(f'{pad2}{it},\n' for it in items) + pad + '}'
    if isinstance(v, list):
        if not v:
            return '[]'
        items = [js(x, ind + 1) for x in v]
        one = '[' + ', '.join(items) + ']'
        if len(one) + len(pad) < 100 and '\n' not in one:
            return one
        return '[\n' + ''.join(f'{pad2}{it},\n' for it in items) + pad + ']'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if v is None:
        return 'null'
    if isinstance(v, str):
        return "'" + v.replace('\\', '\\\\').replace("'", "\\'") + "'"
    return json.dumps(v)


entries = []
for orb_id, entry in sorted(proposal.items(), key=lambda item: int(item[0])):
    override = entry['override']
    for bonus in override.get('victory', {}).get('bonuses', []):
        bonus['description'] = describe(bonus)
    entries.append((int(orb_id), entry['reason'], override))

lines = [
    "/**",
    " * Odyssey level design retune (docs/ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md, through pass 4).",
    " *",
    " * Keyed by public orb ID after campaign assembly. Edit proposal.json and run emit_js.py under",
    " * artifacts/odyssey-level-design-audit-2026-11/scripts/pass4/ to regenerate this file.",
    " *",
    " * Merge rules match the benchmark's proposal scenario: objects merge, and star tiers, bonus lists, modifier",
    " * lists and rival overrides replace whole. Design rules R1-R9 are asserted by",
    " * tests/unit/odyssey-campaign-design-rules.test.js.",
    " */",
    "",
    "import { formatOdysseyRival } from './duel-rules.js';",
    "",
    "const REPLACE_KEYS = new Set(['one', 'two', 'three', 'bonuses', 'active', 'botOverrides']);",
    "",
    "function deepFreeze(value) {",
    "    if (value && typeof value === 'object') {",
    "        Object.values(value).forEach(deepFreeze);",
    "        Object.freeze(value);",
    "    }",
    "    return value;",
    "}",
    "",
    "export const ODYSSEY_LEVEL_DESIGN_2026_11 = deepFreeze({",
]
for i, why, o in entries:
    words = why.split()
    wrapped, cur = [], ''
    for w in words:
        if len(cur) + len(w) + 1 > 108:
            wrapped.append(cur)
            cur = w
        else:
            cur = f'{cur} {w}'.strip()
    wrapped.append(cur)
    for wl in wrapped:
        lines.append(f'    // {wl}')
    lines.append(f'    {i}: {js(o, 1)},')
lines += [
    "});",
    "",
    "function mergeRetune(base, override) {",
    "    const merged = { ...base };",
    "    for (const [key, value] of Object.entries(override)) {",
    "        const baseValue = base?.[key];",
    "        if (REPLACE_KEYS.has(key) || !value || typeof value !== 'object' || Array.isArray(value)",
    "            || !baseValue || typeof baseValue !== 'object' || Array.isArray(baseValue)) {",
    "            merged[key] = structuredClone(value);",
    "        } else {",
    "            merged[key] = mergeRetune(baseValue, value);",
    "        }",
    "    }",
    "    return merged;",
    "}",
    "",
    "// R9: every solo well draws a three-piece preview, so its data says three (the authored 3-6 was never read).",
    "function withThreePreviews(level) {",
    "    if (level.mechanics?.versus || level.mechanics?.pieces?.previewCount === 3) return level;",
    "    return { ...level, mechanics: { ...level.mechanics, pieces: { ...level.mechanics.pieces, previewCount: 3 } } };",
    "}",
    "",
    "// The rival's subtitle names its tier of the versus play.",
    "function withRivalSubtitle(level) {",
    "    const versus = level.mechanics?.versus;",
    "    if (!versus) return level;",
    "    const subtitle = formatOdysseyRival(versus.botName, versus.botDifficulty);",
    "    if (level.metadata?.subtitle === subtitle) return level;",
    "    return { ...level, metadata: { ...level.metadata, subtitle } };",
    "}",
    "",
    "/** The assembled campaign with the retune applied; orbs without an entry keep their rules. */",
    "export function applyOdysseyLevelDesign(levels) {",
    "    return levels.map((level) => {",
    "        const retune = ODYSSEY_LEVEL_DESIGN_2026_11[level.id];",
    "        return withRivalSubtitle(withThreePreviews(retune ? mergeRetune(level, retune) : level));",
    "    });",
    "}",
    "",
]
content = '\n'.join(lines).encode('utf-8')
if args.check:
    if args.output.read_bytes() != content:
        parser.exit(1, f'{args.output} differs from the measured proposal\n')
else:
    args.output.write_bytes(content)
