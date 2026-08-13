/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter — fox SNOW DEFORMATION field (AAA-style, right-sized for 3 known foxes).
 *
 * We already know the foxes' foot positions every frame, so we skip the whole AAA
 * capture-camera/depth-compare rig (that exists to *discover* contacts). What we keep from
 * the AC3 → Batman: Arkham Origins → Rise of the Tomb Raider lineage is everything
 * DOWNSTREAM of the capture: a persistent height field, accumulation + gradual replenish,
 * displaced snow ("berms"), and normals reconstructed by finite differences so the marks
 * actually SHADE. See docs/WINTER_FOX_PAW_TRAILS_AAA_PLAN_2026-07.md.
 *
 * The map is a small persistent CPU DataTexture covering a FIXED world rect snug to the
 * foxes' wander box (the camera is ~fixed, so no scrolling window is needed), sampled by the
 * snow ground's unlit colorNode. Channels:
 *
 *   R = SIGNED height   — 128 = undisturbed, <128 = pit, >128 = displaced berm.
 *                         Being signed is the enabling trick: the raised lip a paw throws out
 *                         of the hole is just positive height, so normals / AO / parallax all
 *                         fall out of ONE field with no special cases.
 *   G = hardness        — compaction accumulator. A lane walked repeatedly packs down: it gets
 *                         deeper, holds much longer, and loses its loose berms.
 *   B = age             — seconds since last disturbed (normalised). Drives the re-frost read:
 *                         fresh marks are sharp and matte, old ones soften and sparkle again.
 *   A = unused.
 *
 * Batman shipped this at 512² in 2 MB and noted it "doesn't need to be high-res — looks
 * better in lower resolutions"; we're at 512² / 1 MB, so resolution is not the constraint.
 * At our grazing camera the LANE is the read, not the toe beans.
 *
 * All marks go through one capsule brush (a paw is a zero-length capsule, a drag groove is a
 * long thin one, a body impression is a wide shallow one), so every mark gets a physically
 * consistent pit + displaced berm for free.
 *
 * Decay/upload work is skipped per 32×32 TILE, so an empty map costs nothing and a scene with
 * three thin trails costs a fraction of a full-map sweep.
 */
import * as THREE from 'three';
import { uniform } from 'three/tsl';

const NEUTRAL = 128; // signed-height zero (undisturbed snow)
const SPAN = 127; // height ±1.0 maps to ±SPAN around NEUTRAL
const TILE = 32; // decay/idle bookkeeping granularity (texels per side)
// Decay cadence. Deliberately slow: R is a Uint8, so each pass must move the height by at least
// one whole unit or truncation eats the change and the fade stalls (see update()). At ~2.5 Hz a
// pass moves several units, and since the field fades over tens of seconds it is imperceptible.
const DECAY_TICK = 0.4;
const UPLOAD_TICK = 0.05; // ~20 Hz — how fast a fresh stamp reaches the GPU

// Contact detail — see paw-trail-gpu.js. A clean analytic bevel is what reads
// as a decal; the wobbled rim + granulated berm is what reads as displaced snow.
const hash2 = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
};

function vnoise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

const rimWobble = (ang, seed) => Math.sin(ang * 3 + seed) * 0.5
    + Math.sin(ang * 7 + seed * 1.7) * 0.3
    + Math.sin(ang * 13 + seed * 0.6) * 0.2;

export function createPawTrail({
    origin = [-1200, -1880], // world XZ of texel (0,0)
    size = [2400, 2320], // world XZ extent the map covers
    res = 512, // texels per side
    // Refill: Batman's "subtract a small value each frame so snow gradually replenishes (since
    // it's snowing)". Ours is storm-coupled — a calm night keeps the story on the ground for
    // ~20 s, a full blizzard erases it in ~2 s.
    // `tau` = SECONDS TO COMPLETELY REFILL a full-depth mark (the refill is linear, see update()).
    tauCalm = 45.0,
    tauStorm = 3.5,
    hardTauMul = 2.8, // a packed lane persists this much longer than fresh powder
    bermTauPow = 1.7, // loose piled snow blows away faster than a pit refills
    ageTau = 14.0, // normalisation for the age channel (seconds)
    // Wind drift-in: real tracks don't fade uniformly, they fill from the windward side. A small
    // per-pass lerp toward the UPWIND neighbour smears the field downwind as it fades. This is
    // pure character — the refill above does not depend on it.
    windMix = 0.12,
    lake = null, // { cx, cz, halfX, halfZ } → suppress marks over the ice
} = {}) {
    const data = new Uint8Array(res * res * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = NEUTRAL; // start undisturbed, not "deep pit"
        data[i + 3] = 255; // A unused, but keep it opaque so no sampler path can zero the map
    }
    const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const upX = size[0] / res; // world units per texel
    const upZ = size[1] / res;
    const upAvg = (upX + upZ) * 0.5;

    const uOrigin = uniform(new THREE.Vector2(origin[0], origin[1]));
    const uInvSize = uniform(new THREE.Vector2(1 / size[0], 1 / size[1]));
    const uTexel = uniform(new THREE.Vector2(upX, upZ)); // world units per texel → gradient scale

    // Tile activity: only tiles holding something get decayed. Stamps dilate by one tile so the
    // wind smear and berm spill always have somewhere live to spread into.
    const tps = Math.ceil(res / TILE);
    const tileActive = new Uint8Array(tps * tps);
    let activeTiles = 0;
    const prevR = windMix > 0 ? new Uint8Array(res * res) : null;

    let accDt = 0; // refill-pass accumulator
    let uploadAcc = 0; // upload throttle (decoupled — see update())
    let dirty = false; // a stamp landed since the last upload
    let storm = 0; // 0 calm .. 1 blizzard
    let windX = 1;
    let windZ = 0;

    function markTiles(x0, y0, x1, y1) {
        const tx0 = Math.max(0, ((x0 / TILE) | 0) - 1);
        const ty0 = Math.max(0, ((y0 / TILE) | 0) - 1);
        const tx1 = Math.min(tps - 1, ((x1 / TILE) | 0) + 1);
        const ty1 = Math.min(tps - 1, ((y1 / TILE) | 0) + 1);
        for (let ty = ty0; ty <= ty1; ty += 1) {
            for (let tx = tx0; tx <= tx1; tx += 1) {
                const ti = ty * tps + tx;
                if (!tileActive[ti]) { tileActive[ti] = 1; activeTiles += 1; }
                dirty = true;
            }
        }
    }

    function overLake(wx, wz) {
        if (!lake) return false;
        const bx = Math.max(0, Math.abs(wx - (lake.cx ?? 0)) - lake.halfX);
        const bz = Math.max(0, Math.abs(wz - lake.cz) - lake.halfZ);
        return bx === 0 && bz === 0;
    }

    /**
     * The one brush every mark goes through: a capsule (segment + radius) pressed into the
     * snow, with the displaced volume piled into a ring just outside it.
     *
     * @param x0,z0,x1,z1  world-space segment ends (equal → a round print)
     * @param radius       world-space press radius
     * @param depth        pit depth, 0..1 (1 = a full-depth hole)
     * @param berm         height of the displaced lip, 0..1
     * @param bermDir      -1..1 — bias the lip along the heading (+ = thrown forward)
     * @param harden       0..1 — how much this mark packs the snow (drives persistence)
     * @param floorFrac    0..1 — fraction of the radius that is flat floor (a paw is a solid,
     *                     so it leaves a flat bottom with steep walls, not a smooth bowl)
     */
    function stampCapsule({
        x0, z0, x1 = x0, z1 = z0,
        radius, depth = 0.85, berm = 0.4, bermDir = 0, harden = 0.5, floorFrac = 0.55,
    }) {
        if (overLake((x0 + x1) * 0.5, (z0 + z1) * 0.5)) return; // marks read wrong on reflective ice
        const pad = Math.max(1.2, radius / upAvg); // press radius in texels
        const bw = 0.55; // berm ring width, as a fraction of pad
        // Segment in texel space.
        const ax = (x0 - origin[0]) / upX;
        const ay = (z0 - origin[1]) / upZ;
        const bx = (x1 - origin[0]) / upX;
        const by = (z1 - origin[1]) / upZ;
        const sx = bx - ax;
        const sy = by - ay;
        const segLen2 = sx * sx + sy * sy;
        // Heading (for the directional berm bias) — the segment, or the caller's implied one.
        const hl = Math.sqrt(segLen2) || 1;
        const hx = segLen2 > 1e-6 ? sx / hl : 0;
        const hy = segLen2 > 1e-6 ? sy / hl : 0;

        const reach = pad * (1 + bw) + 1;
        const ix0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
        const iy0 = Math.max(0, Math.floor(Math.min(ay, by) - reach));
        const ix1 = Math.min(res - 1, Math.ceil(Math.max(ax, bx) + reach));
        const iy1 = Math.min(res - 1, Math.ceil(Math.max(ay, by) + reach));
        if (ix1 < ix0 || iy1 < iy0) return;

        const seed = (Math.abs(ax * 0.137 + ay * 0.219) % 6.2831853);

        for (let y = iy0; y <= iy1; y += 1) {
            for (let x = ix0; x <= ix1; x += 1) {
                // Distance to the capsule's spine.
                const px = x - ax;
                const py = y - ay;
                const t = segLen2 > 1e-6
                    ? Math.max(0, Math.min(1, (px * sx + py * sy) / segLen2))
                    : 0;
                const dx = px - sx * t;
                const dy = py - sy * t;
                const dist = Math.sqrt(dx * dx + dy * dy);
                // Wobbled rim — the edge gives way irregularly, like snow.
                const ang = Math.atan2(dy, dx);
                const tn = (dist / pad) / (1 + 0.22 * rimWobble(ang, seed));
                if (tn > 1 + bw) continue;

                // Pit: flat floor out to floorFrac, then a steep smoothstep wall to the rim.
                let pit = 0;
                if (tn < 1) {
                    const q = Math.min(1, (1 - tn) / Math.max(1e-3, 1 - floorFrac));
                    pit = depth * q * q * (3 - 2 * q);
                }
                // Berm: the displaced volume, piled in a ring just outside the rim, biased
                // along the heading (the paw pushes snow out the way it travels) and
                // granulated so it reads as chunky broken snow rather than a smooth bead.
                let lip = 0;
                if (berm > 0 && tn > 1) {
                    const r = Math.sin(Math.PI * ((tn - 1) / bw));
                    if (r > 0) {
                        const along = dist > 1e-3 ? (dx * hx + dy * hy) / dist : 0;
                        const grain = 0.72 + 0.56 * vnoise2(x * 0.42 + seed, y * 0.42 - seed);
                        lip = berm * r * Math.max(0.25, 1 + bermDir * along) * grain;
                    }
                }
                if (pit <= 0.002 && lip <= 0.002) continue;

                const idx = (y * res + x) * 4;
                const cur = (data[idx] - NEUTRAL) / SPAN; // signed height, -1..1
                const curPit = cur < 0 ? -cur : 0;
                const curLip = cur > 0 ? cur : 0;
                const hard = data[idx + 1] / 255;
                // ACCUMULATE, don't max(): a lane walked five times becomes a deeper, harder,
                // more compacted path — that persistence is what makes a world feel lived in.
                // Saturating so it approaches (but never exceeds) a full-depth hole.
                const newPit = pit > 0 ? curPit + pit * (1 - curPit) : curPit;
                // Loose berms flatten as a lane gets packed down by repeat traffic.
                const newLip = Math.max(curLip, lip * (1 - hard * 0.6));
                const h = newLip - newPit;
                data[idx] = Math.max(1, Math.min(255, Math.round(NEUTRAL + h * SPAN)));
                if (pit > 0.002) {
                    data[idx + 1] = Math.min(255, data[idx + 1] + pit * harden * 255);
                    data[idx + 2] = 0; // freshly disturbed → age resets
                }
            }
        }
        markTiles(ix0, iy0, ix1, iy1);
    }

    // ── Mark vocabulary ──────────────────────────────────────────────────────
    // Arctic fox pads are round and heavily fur-covered, so real prints in snow are indistinct
    // ROUND dents with muffled toes — which is also all a 512² map can resolve. The fur is our
    // alibi: we lean into the round mark and spend the budget on the LANE.

    /** A single paw print. `scale` is the fox's RENDERED size (depth-scaled by the caller). */
    function stampPaw(wx, wz, ux, uz, scale = 190, depth = 0.85) {
        const r = scale * 0.1;
        stampCapsule({
            x0: wx - ux * r * 0.15,
            z0: wz - uz * r * 0.15,
            x1: wx + ux * r * 0.15,
            z1: wz + uz * r * 0.15,
            radius: r,
            depth,
            berm: 0.45,
            bermDir: 0.6,
            harden: 0.55,
            floorFrac: 0.5,
        });
    }

    /** The shallow groove a fox plows between prints in deep powder — this is the LANE read. */
    function stampDrag(x0, z0, x1, z1, scale = 190) {
        stampCapsule({
            x0, z0, x1, z1, radius: scale * 0.042, depth: 0.2, berm: 0.12, harden: 0.15, floorFrac: 0.3,
        });
    }

    /** Take-off scuff: snow smeared and kicked BACKWARD as the fox launches into a pounce. */
    function stampScuff(wx, wz, ux, uz, scale = 190) {
        const L = scale * 0.3;
        stampCapsule({
            x0: wx,
            z0: wz,
            x1: wx - ux * L,
            z1: wz - uz * L,
            radius: scale * 0.075,
            depth: 0.55,
            berm: 0.55,
            bermDir: -0.8,
            harden: 0.3,
            floorFrac: 0.35,
        });
    }

    /** Landing crater: the headfirst mousing dive punches a deep, high-lipped hole. */
    function stampCrater(wx, wz, ux, uz, scale = 190) {
        stampCapsule({
            x0: wx,
            z0: wz,
            x1: wx + ux * scale * 0.1,
            z1: wz + uz * scale * 0.1,
            radius: scale * 0.17,
            depth: 1.0,
            berm: 0.85,
            bermDir: 0.35,
            harden: 0.3,
            floorFrac: 0.4,
        });
        // Four splayed paw marks around the impact — the feet that broke the fall.
        for (let k = 0; k < 4; k += 1) {
            const a = (k / 4) * Math.PI * 2 + 0.6;
            const rr = scale * 0.17;
            stampPaw(wx + Math.cos(a) * rr, wz + Math.sin(a) * rr, ux, uz, scale * 0.85, 0.7);
        }
    }

    /** A fox curled asleep leaves a wide, soft body impression. */
    function stampBody(wx, wz, ux, uz, scale = 190, amount = 1) {
        const L = scale * 0.16;
        stampCapsule({
            x0: wx - ux * L,
            z0: wz - uz * L,
            x1: wx + ux * L,
            z1: wz + uz * L,
            radius: scale * 0.15,
            depth: 0.5 * amount,
            berm: 0.3 * amount,
            harden: 0.7,
            floorFrac: 0.6,
        });
    }

    /** Digging throws snow backward in a scattered fan. */
    function stampDig(wx, wz, ux, uz, scale = 190, seed = 0) {
        const a = (Math.sin(seed * 12.9898) * 43758.5453) % 1;
        const off = (a - 0.5) * scale * 0.12;
        stampCapsule({
            x0: wx + ux * scale * 0.1 + uz * off,
            z0: wz + uz * scale * 0.1 - ux * off,
            radius: scale * 0.06,
            depth: 0.6,
            berm: 0.7,
            bermDir: -0.9,
            harden: 0.2,
            floorFrac: 0.3,
        });
    }

    /** Back-compat alias for the original v1 call site. */
    const stamp = (wx, wz, ux, uz, modelScale = 190) => stampPaw(wx, wz, ux, uz, modelScale);

    /** Storm intensity 0..1 — a blizzard fills the tracks back in fast. */
    function setStorm(s) { storm = Math.max(0, Math.min(1, s || 0)); }
    /** Prevailing wind (world XZ) — tracks drift in from the windward side. */
    function setWind(vx, vz) {
        const l = Math.hypot(vx, vz);
        if (l > 1e-4) { windX = vx / l; windZ = vz / l; }
    }

    /** Refill the field toward undisturbed (framerate-independent). Call once per frame. */
    function update(dt) {
        if (activeTiles === 0) { accDt = 0; uploadAcc = 0; dirty = false; return; }
        accDt += dt;
        uploadAcc += dt;
        if (accDt < DECAY_TICK) {
            // The refill pass is slow, but a fresh print must still reach the GPU promptly — a
            // paw mark appearing 400 ms after the paw landed is very visible. So the UPLOAD
            // cadence is decoupled from the refill cadence and stays at ~20 Hz.
            if (dirty && uploadAcc >= UPLOAD_TICK) {
                texture.needsUpdate = true;
                dirty = false;
                uploadAcc = 0;
            }
            return;
        }
        const step = Math.min(1.0, accDt);
        accDt = 0;

        // LINEAR refill, not exponential — and deliberately so, on two counts.
        //
        // Physically it is the right model: Batman's slides say to "subtract a small value to
        // the heightmap to make snow gradually replenish (since it's snowing)". Snow falls at a
        // rate, so a hole fills at a rate; it does not asymptote.
        //
        // Numerically it is the only model that WORKS here. R is a Uint8 and assignment
        // truncates, so an exponential step of `|d| * (1 - k)` — 0.21 units at a 20 Hz tick with
        // tau ≈ 18 s — truncates straight back to the same byte and the fade stalls DEAD at ~90%
        // depth, forever. That was a real shipped bug, found by measuring a print's depth over
        // 15 s and watching it freeze. A linear rate over a slower DECAY_TICK moves several whole
        // units per pass, so it always terminates.
        //
        // `tau` now reads as: seconds to completely refill a full-depth mark.
        const tau = tauCalm + (tauStorm - tauCalm) * storm;
        const fillSoft = (SPAN / tau) * step; // height units refilled this pass
        const fillHard = fillSoft / hardTauMul; // a packed lane resists
        const bermMul = bermTauPow; // loose piled snow blows away faster than a pit refills
        const hardStep = (255 / (tau * hardTauMul * 2)) * step; // packing outlives the dent
        const ageStep = (step / ageTau) * 255;
        // Upwind neighbour offset in texels (the field drifts downwind as it fades).
        const wOffX = Math.round(-windX);
        const wOffY = Math.round(-windZ);
        const doWind = prevR && windMix > 0 && (wOffX !== 0 || wOffY !== 0);

        if (doWind) {
            for (let ty = 0; ty < tps; ty += 1) {
                for (let tx = 0; tx < tps; tx += 1) {
                    if (!tileActive[ty * tps + tx]) continue;
                    const x0 = tx * TILE;
                    const x1 = Math.min(res, x0 + TILE);
                    const y1 = Math.min(res, ty * TILE + TILE);
                    for (let y = ty * TILE; y < y1; y += 1) {
                        const row = y * res;
                        for (let x = x0; x < x1; x += 1) prevR[row + x] = data[(row + x) * 4];
                    }
                }
            }
        }

        for (let ty = 0; ty < tps; ty += 1) {
            for (let tx = 0; tx < tps; tx += 1) {
                const ti = ty * tps + tx;
                if (!tileActive[ti]) continue;
                const x0 = tx * TILE;
                const x1 = Math.min(res, x0 + TILE);
                const y0 = ty * TILE;
                const y1 = Math.min(res, y0 + TILE);
                let live = 0;
                for (let y = y0; y < y1; y += 1) {
                    const row = y * res;
                    for (let x = x0; x < x1; x += 1) {
                        const p = row + x;
                        const idx = p * 4;
                        const g = data[idx + 1];
                        let d = data[idx] - NEUTRAL;
                        if (d !== 0) {
                            const hard = g / 255;
                            // Packed lanes hold; loose berms go first.
                            const fill = fillSoft + (fillHard - fillSoft) * hard;
                            let nd = d < 0
                                ? Math.min(0, d + fill)
                                : Math.max(0, d - fill * bermMul);
                            if (doWind) {
                                const nx = x + wOffX;
                                const ny = y + wOffY;
                                if (nx >= 0 && nx < res && ny >= 0 && ny < res) {
                                    const up = prevR[ny * res + nx] - NEUTRAL;
                                    nd += (up - nd) * windMix;
                                }
                            }
                            d = nd;
                            // Snap the last fraction to 0 so a tile can actually go idle.
                            data[idx] = Math.abs(d) < 1 ? NEUTRAL : NEUTRAL + d;
                        }
                        if (g > 0) data[idx + 1] = Math.max(0, g - hardStep);
                        if (data[idx] !== NEUTRAL || data[idx + 1] > 0) {
                            live = 1;
                            if (data[idx + 2] < 255) {
                                data[idx + 2] = Math.min(255, data[idx + 2] + ageStep);
                            }
                        }
                    }
                }
                if (!live) { tileActive[ti] = 0; activeTiles -= 1; }
            }
        }
        texture.needsUpdate = true;
        dirty = false;
        uploadAcc = 0;
    }

    function dispose() {
        texture.dispose();
    }

    return {
        texture,
        uOrigin,
        uInvSize,
        uTexel,
        stamp,
        stampPaw,
        stampDrag,
        stampScuff,
        stampCrater,
        stampBody,
        stampDig,
        setStorm,
        setWind,
        update,
        dispose,
        get activeTiles() { return activeTiles; },
    };
}
