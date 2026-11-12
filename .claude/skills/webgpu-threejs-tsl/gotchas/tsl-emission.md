# TSL emission: where and when the builder writes your code

Read before writing any `Fn` with an `If`, a `Loop`, a `select` or an `.assign()`, and whenever a branch reads zeros, a loop adds nothing, a shader will not parse, or a term is computed twice. These are properties of the node builder itself, so they apply to every material in every theme.

## The model, and what r187 changed in it

A TSL expression is a node in a graph, not a statement. Nothing is written into the shader when
your JavaScript line runs; the builder writes a node's code when something that is being emitted
USES it. Three consequences follow, and one rule answers all of them.

```javascript
// The rule: inside the Fn, before the first If / Loop / select / .assign(), turn every value
// that more than one place reads into a variable, and read that variable everywhere.
material.colorNode = Fn(() => {
  const N = normalize(normalWorld).toVar();        // computed once, here, before any branch
  const leaf = normalize(N.add(vec3(0.0, 0.4, 0.0))).dot(sun).mul(0.5).add(0.5);
  const bark = N.dot(sun).max(0.0);
  return vec4(vec3(select(onLeaf, leaf, bark)), 1.0);
})();
```

What the builder wrote for that, and for the same code reading `normalWorld` directly in each
arm (both built with `WGSLNodeBuilder` on three 0.187.0, 2026-11-12):

```wgsl
// pinned                                     // not pinned
normalWorld = normalize( … );                 if ( aKind > 0.5 ) {
nodeVar0 = normalize( normalWorld );            normalWorld = normalize( … );   // computed here…
if ( aKind > 0.5 ) {                            nodeVar0 = … normalWorld …;
  nodeVar1 = … nodeVar0 …;                    } else {
} else {                                        normalWorld = normalize( … );   // …and again here
  nodeVar1 = … nodeVar0 …;                      nodeVar0 = … normalWorld …;
}                                             }
```

1. **Order.** A value is computed where it is first used. `const ds = t.sub(prev); prev.assign(t);
   sum.addAssign(ds)` emits the subtraction AFTER the assignment, so `ds` is 0 (#200). Still true
   on r187 (the probe emitted `nodeVar0 = t; nodeVar1 = nodeVar1 + ( t - nodeVar0 )`).
2. **Repetition.** A value read in several branches, loop bodies or call sites is written again
   in each: a noise tap or a laid-out call's swizzle read twice runs twice (#215, #228). Still
   true on r187, and it is now what an unpinned shared value costs.
3. **Zero in the other branch (r185 and r186).** Up to r186 the builder assigned a shared
   variable only at its first build site, so every other branch read the zero it was declared
   with: bark black beside correct leaves, a regime that goes flat, a jet that never draws (#68,
   #171, #205, #209, #212, #239). **r187 does not do this in any of those rows' shapes**: probed
   on 2026-11-12 with a module-level `.toVar()` read in both arms of an `If`/`Else`, a
   module-level expression, a value shared by two graph roots (`colorNode` and `opacityNode`),
   two `varying(Fn())`s sharing a per-instance value, a nested `select` reading `normalWorld`, a
   module-level constant direction, and a pin made in `maskNode`: each was assigned again in
   every scope that read it, and `unassignedReads` found nothing. The rows stay as the record of
   why the pin and the gate exist, and because a larger graph may still find a shape these
   probes did not.
4. **No flow at all.** An `If` at module level throws (`Cannot read properties of null (reading
   'If')`), and a `Loop` built while a material is constructed, outside any `Fn`, is dropped
   without a word: the shader has no `for` and the result is the loop's initial value (#230).
   Still true on r187.

**Which fix when two rows differ.** Pin at the top of the `Fn` that holds the branch and read the
pinned variable in every arm (#212, #171): that is the rule above. A pin made in another slot's
graph (`maskNode` for a value `colorNode` reads) did not count on r186 (#205); when several
slots need one value, build it in each slot's `Fn` through a small factory (#209), or hand it
over in a varying of your own (#205).

**To see what your own graph emits**, with no GPU:

```javascript
// a scratch test under tests/unit/, run with: npx vitest run tests/unit/<name>.test.js
import * as THREE from 'three/webgpu';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const { fragment, heard, thrown } = build(THREE.WGSLNodeBuilder, mesh);   // also THREE.GLSLNodeBuilder
console.log(thrown ?? heard, unassignedReads(fragment), fragment.split('@fragment')[1]);
```

One gotcha per line; the number is the row's permanent id (cited elsewhere as "gotcha #NN"). Rows numbered below 300 were numbered before these files existed and keep their numbers, in no order. A NEW row goes at the END of this table and takes the next free number in **300–399**. To search: `node .claude/skills/webgpu-threejs-tsl/scripts/gotcha.mjs <words>` (`README.md` in this folder).

| # | Symptom | Cause | Fix |
|---|---|---|---|
| #64 | `X is not defined` in effect code | TSL functions are not globals | Import every identifier from `'three/tsl'` (incl. `Fn`, `If`, `Loop`) |
| #74 | Oscillation stuck in upper half | `oscSine` already returns 0..1 | Drop the `.mul(0.5).add(0.5)` remap |
| #69 | Shader module fails to compile at all | `smoothstep(a, a, x)` — **EQUAL** edges are a hard WGSL error ("called with 'low' equal to 'high'"), killing the whole module so the material never draws | Keep the edges distinct |
| #70 | JS-side mask is 0 | `THREE.MathUtils.smoothstep(x, min, max)` (the **JS** helper) really does return 0 on reversed edges — `if (x <= min) return 0` | Invert the ramp: `1 - smoothstep(lo, hi, x)` |
| #167 | `Error while parsing WGSL: expected ')'` at a column deep inside one very long generated line; the material never draws (the GLSL fallback fails the same way) | A JavaScript unary minus applied to a TSL node (`x.mul(-sharp)` where `sharp` is `float(…)`): JS coerces the node object to a number, NaN, and the builder prints the literal `NaN.0` into the shader | Negate nodes in TSL (`.negate()`, `.mul(-1)`), never with `-`. Catch it before a browser does: build every material through `WGSLNodeBuilder` and `GLSLNodeBuilder` in a Node test and fail on `/\bNaN\b\|\bInfinity\b/` in the output. Found on Moonlit Greenhouse (2026-10-11), `starLayer` in `src/themes/moonlit-greenhouse/moonlit-greenhouse-tsl.js`; gate in `tests/unit/moonlit-greenhouse-shaders.test.js` |
| #213 | A WebGL2 (or WebGPU) shader fails to compile with `'object' : variable expected` / `syntax error` near `[object Object]`, though every node built without a warning in Node; or the build itself throws `THREE.TSL: bNode.getNodeType is not a function` (the string reached a node's input: Spring's first, bulb-field land shader, `ditchW + fwLc`, 2026-10-18) | A plain JS `+` between a number and a TSL node (`EYE.x + x`, `EYE.y - 140 + cyc.mul(h)`) is string concatenation: the node is stringified and `"0[object Object]"` lands in the generated code | Put the node first and use its methods: `x.add(EYE.x)`, `cyc.mul(h).add(EYE.y - 140)`. Grep the generated GLSL/WGSL for `object Object` in a build check (the word `object` alone is the uniform block's name). Found on Pyrestorm's motes (2026-10-13), only by a SwiftShader WebGL2 capture |
| #67 | Conditional write silently ignored | JS variable reassignment inside `If()` — TSL can't see `x = x.add(1)` | `.toVar()` + `.assign()`, or `select()` — see `docs/core-concepts.md` § Control Flow |
| #200 | A `Loop` that integrates over steps adds nothing (a march returns black; debug colours show the step length is 0) | An expression node is emitted where it is USED, not where it is written: `const ds = t.sub(prevT); prevT.assign(t); sum.addAssign(x.mul(ds))` emits the subtraction after the assignment, so it reads the new `prevT` (`ds = 0`) | Pin every value the assignment would change as a var BEFORE the assignment: `const t = (...).toVar(); const ds = t.sub(prevT).toVar(); prevT.assign(t);`. Found on Grainfields' light in the air (2026-10-18), `src/themes/grainfields/grainfields-post.js` `buildAir` |
| #68 | A branch reads ZEROS from shared nodes (uniform `If`/`Else` regimes: one side fine, other flat/grey) | The WGSL builder hoists var **declarations** to function scope but emits each **assignment at the node's first build site**; a `.toVar()` created *outside* any `Fn` (no active stack) gets its assignment emitted inside whichever branch builds it first — the other branch reads the zero-initialised declaration. Also poisons later graph roots (`opacityNode` after `colorNode`) that reuse the var | Root-pin: at the top of the `Fn`, before any `If`, call bare `.toVar()` on every shared node (`toStack()` runs at creation, so each call is a real root statement) — and READ those vars afterwards: a pin nothing reads is never emitted (#171). Found via Odyssey water's regime branch: submerged frames zeroed `wN`/`depth` — Snell ceiling went flat, sea went transparent |
| #171 | A shared node reads zero on one side of a select although gotcha #68 was followed: bare `.toVar()` calls at the top of the `Fn` on nodes built OUTSIDE it, and the WGSL still assigns the node's var inside one branch only | A `.toVar()` that nothing reads is never emitted, so it pins nothing: the shared node's first real build site is still inside the branch. Found when an ambient star's `ageFire` (built at module level, read inside `isAmbient.select(...)`) stayed 0, and the star's jets never drew | Build the shared values INSIDE the `Fn` as vars and read those vars everywhere (a small factory called once per stage: `const { ageFire, isAmbient } = jetStar(u, aJet)` with `.toVar()` on each value), as `volcanic.js` reads its `L.*` vars. A check that catches it: walk the WGSL `fn` bodies and flag a `nodeVarN` read where no assignment has certainly run (one in both arms of an `if`/`else` counts; one in a lone `if` or a loop does not) — `unassignedReads` in `tests/unit/nebula-flow-shaders.test.js`. Found on Nebula Flow's jets (2026-10-11), `jetStar` in `src/themes/nebula-flow/nebula-flow-fx.js` |
| #205 | One kind of fragment in a material shades black (NaN) while the rest is fine — e.g. the bark of a tree whose leaves render, with no console error | three's own `normalWorld` is a shared `.toVar('normalWorld')`, and TSL emits a var's assignment where it is first BUILT. A `select(cond, a, b)` whose branches hold built expressions is emitted as an if/else, so when `normalWorld` is first read inside one branch (`select(onLeaf, leafNormalFrom(normalWorld), normalWorld)`) the other branch reads the zeroed var, normalises it to NaN, and every term that touches it (rim, wrap) goes NaN; a `clamp` downstream hides it as plain shade. Pinning it in `maskNode` did not help (the mask is built inside the discard's own flow) | Do not read three's shared normal/position vars first inside a `select` branch: hand the value to the fragment in your own varying (assign `normalLocal` to a `varyingProperty` in the `positionNode`) and read that. Bisect with `select(x.equal(x), ok, magenta)` per term. Found on the Odyssey forest's leaf cards (2026-10-26), `vForestCrownN` in `src/rendering/odyssey/world/odyssey-world-renderer.js` |
| #212 | One part of a merged mesh shades correctly and every other part (picked by a kind attribute through a `select` chain) comes out black, with no error; a debug colour added to the other branches does not show either | three assigns its normal builtins (`normalViewGeometry`, `normalView`) where they are FIRST built. A colour graph that reads `normalWorld` (or a node built from it) inside each branch of a kind `select` gets them assigned in the first branch only; every other branch normalises an unassigned zero, gets NaN, and the output clamps to black | Pin the normal (and the view vector) as vars at the top of the `Fn`, before any branch: `const N = normalize(normalWorld).toVar()`. The `unassignedReads` check catches it once it also tracks `normalViewGeometry\|normalView\|normalWorld`, not only `nodeVarN` (`VAR_NAMES` in `tests/unit/synthwave-sunset-shaders.test.js`). Found on Synthwave Sunset's coaster (2026-10-20), `createCoasterMaterial` in `src/themes/synthwave-sunset/synthwave-sunset-coaster.js` |
| #209 | A per-instance value feeds two `varying(Fn(() => …)())`s that each run a `Loop` (held colours, rings), and the second one's result is computed at the wrong place whenever the first loop runs zero times | The value was ONE node built outside both `Fn`s; the builder made it a var and emitted its assignment at its first use, inside the first varying's loop body. With that loop empty (no colour held) the second varying read the zero it was declared with | Build the value inside each `Fn` (a factory: `const rootXZ = () => vec2(…).toVar()`), so each stage pins its own. The `unassignedReads` gate catches it (`tests/unit/ocean-shaders.test.js`); it also found the Ocean's large animals' `part`/`sgn`/`root` assigned in one body plan's branch only, so three plans never moved their fins (2026-10-21) |
| #239 | A shader gate reports a var read before it is assigned, and the var is a CONSTANT direction (`vec3(…).normalize()` at module level) | A module-level node with an operation in it is a node like any other: WGSL gives it a var assigned where it is first built (inside one branch, a drop's lens), and every other path reads the zero it was declared with. A constant looks safe, so nobody pins it | Fold constants in JavaScript (`vec3(x / len, y / len, z / len)`): a literal is never a var. Found by the `unassignedReads` gate on Fluid Dreams' key light, `KEY_DIR` in `src/themes/fluid-dreams/fluid-dreams-liquid.js` (2026-10-20) |
| #230 | A material's per-pixel loop (a shadow loop over a `uniformArray` of casters) has no effect at all: the shader builds without a word, the WGSL has no `for` and no call to the loop's laid-out helper, and its result is the loop's initial value | The `Loop` (and the `.toVar()`s it assigns) was built at material-construction time outside any `Fn`, so there was no active stack to emit it into; only the expressions read afterwards were emitted, with the vars at their initial values | Build the whole colour graph inside `material.colorNode = Fn(() => { … return vec4(…); })()` (or `fragmentNode`), and gate it: dump the WGSL in a Node test and check the loop and the helper are there (`tests/unit/sunbraid-shaders.test.js` asserts the land's fragment is over 10 KB and each laid-out `sb_*` helper is emitted). Found on Sunbraid (2026-10-20), `sunbraid-land.js` |
| #215 | A ray-march's fragment shader is two or three times the size you expect and compiles slowly (a software renderer takes seconds) | A TSL node read inside several `If` / loop scopes is re-emitted in each scope: Pyrestorm's plume density (three noise taps and a Newton solve) appeared three times per use, nine in all | Return such a value `.toVar()` where it is made (and pin every per-ray value before the loop), then count the texture taps in the dumped WGSL: the fragment fell from ≈ 30 KB to ≈ 17 KB (one tap loop) or ≈ 28 KB (three uses inline). Found 2026-10-13 |
| #228 | A soft-shadow (or any) loop costs twice what its step count says; the WGSL shows the same laid-out `Fn` called twice in one loop body | A swizzle of a call's result read twice without `.toVar()` (`const hs = field(p).x` used in `sh.assign(min(sh, hs…))` and `st.addAssign(max(hs, …))`) is emitted at EACH read, call included: Kaleidosonic's Extreme shadow ran the whole fractal 36 times a pixel instead of 18. (The same call returning a float, read twice, was shared: do not rely on either) | `.toVar()` every value read more than once, and gate it: count the helper's calls per site in the dumped WGSL (`calls the field once a site` in `tests/unit/kaleidosonic-shaders.test.js`, 2026-10-19) |
| #89 | `THREE.TSL: TypeError: Cannot read properties of undefined (reading 'addToStack') "VarNode.build()"` on the **WebGL2 backend only**; the mesh never draws | A `select()` whose branch holds another `select()` (e.g. `select(alive, clip(...), CULLED)` where `clip` itself selects) with `Fn` calls such as `hash()` inside. The GLSL builder resolves the inner conditional's type through `flowBuildStage`, where there is no base stack for the call's implicit var. The WGSL builder builds the same graph without complaint, so a WebGPU-only check misses it | Fold the conditions into ONE `select(a.and(b), value, fallback)` and build `value` as a `.toVar()` inside a `Fn` first. Precedent: `streakClip` in `src/themes/black-hole/black-hole-matter.js` |
| #177 | WGSL rejects a `mix(vec3, vec3(select(...)), float)` even though the JavaScript graph looks vector-valued | In r186, a single-argument `vec3(SelectNode)` can collapse to a scalar during type inference | Spell the vector as `vec3(value, value, value)` when the scalar comes from a selection. Compile both backends: Painted Ages' filmic shoulder exposed this in `painted-ages-post.js` (2026-10-12). |

**See also:** laid-out `Fn`s, `Loop` and uniform tables: `tsl-functions-loops.md` · NaN from a zeroed normal: `numerics.md` · failures that only the WebGL2 backend shows: `backends-capture.md` (#216, #254)

## Correction kept on record: reversed-edge `smoothstep` in a shader is fine

> **CORRECTED 2026-08-13.** This table used to claim `smoothstep(hi, lo, x)` returns 0 in WGSL.
> It does not. TSL emits the WGSL builtin verbatim (no entry in `WGSLNodeBuilder`'s polyfill or
> method tables, so `getMethod` falls through to the literal name), and a GPU probe on
> Dawn/Chrome 151 compiled it clean and returned a **descending ramp exactly equal to
> `1 − smoothstep(lo, hi, x)`** at all 32 sampled values. The false rule came from conflating
> three real things: the **JS** `THREE.MathUtils.smoothstep` (which does early-out to 0, #70),
> the **equal-edge** compile error (#69), and a since-removed Tint validation error on const
> reversed edges (three.js #30593, fixed by gpuweb #4981). Shipped counter-examples: the wisps'
> soft edge, `smoothstep(1.0, 0.75, d)` in `src/themes/lunara/lunara-fx.js` and
> `src/themes/halcyon-apex/halcyon-apex-fx.js`. Prefer forward edges for readability; do not
> "fix" a working reversed one on this rule's say-so.
