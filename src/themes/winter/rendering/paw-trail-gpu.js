/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter — fox SNOW DEFORMATION field, GPU edition (snowflow_demo port).
 *
 * Same public API as paw-trail.js (the CPU original, kept as the ?trailCpu=1
 * fallback), but the persistent state now lives in two ping-ponged RGBA16F
 * storage textures relaxed by ONE compute pass — a port of snowflow_demo's
 * deformSim (MIT, github.com/Noniv/snowflow_demo):
 *
 *   R = depression depth 0..1      (pit)
 *   G = displaced berm mass 0..1   (lip)
 *   B = compaction 0..1            (hardness)
 *   A = age 0..1                   (refrost timer)
 *
 * Relaxation per banked step: 5-point Laplacian DIFFUSION (berms slump ~3×
 * faster than trench floors → trails soften from the edges inward),
 * mass-conserving berm→pit SLUMP (the lip falls back into the hole it came
 * out of), WIND INFILL from the upwind neighbour (tracks fill from one side,
 * like weather), and exponential decay. `dt` is BANKED and spent in ≥0.4 s
 * steps — fp16 cannot represent a per-frame decay this slow; snowflow's
 * comment on this is a masterclass and the reason retuning constants without
 * banking changes nothing.
 *
 * Stamping stays on the CPU (we know the foxes' feet exactly — no capture rig
 * needed): the capsule brush writes DELTAS into a small RGBA8 injection
 * buffer (R pitΔ, G lipΔ, B hardenΔ, A fresh-mask), uploaded at ~20 Hz and
 * consumed by the same compute pass. Saturating accumulation ("a lane walked
 * five times becomes a deeper, harder path") happens IN the shader against
 * live GPU state, so behaviour matches the CPU original.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, uniform, texture, textureStore, instanceIndex,
    int, uvec2, vec4, exp, max, min, clamp, mix, step,
} from 'three/tsl';

const UPLOAD_TICK = 0.05; // ~20 Hz — how fast a fresh stamp reaches the GPU
const BANK_STEP = 0.4; // seconds of relaxation per spend (fp16 safety)

// ── Contact detail (snowflow deformSim §splat) ──────────────────────────────
// "A clean analytic bevel at the trail edge is the tell that reads as decal;
// breaking the rim radius with angular noise and granulating the berm is what
// gives it the chunky displaced look." Both are cheap and both are load-bearing.
const hash2 = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
};

/** Smooth value noise, 0..1. */
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

/** Smooth, periodic angular wobble in -1..1 — breaks the rim's perfect circle. */
const rimWobble = (ang, seed) => Math.sin(ang * 3 + seed) * 0.5
    + Math.sin(ang * 7 + seed * 1.7) * 0.3
    + Math.sin(ang * 13 + seed * 0.6) * 0.2;

export function createPawTrailGpu({
    renderer,
    origin = [-1200, -1880],
    size = [2400, 2320],
    res = 1024,
    tauCalm = 45.0,
    tauStorm = 3.5,
    hardTauMul = 2.8,
    ageTau = 14.0,
} = {}) {
    // ── GPU state: ping-pong fp16 ────────────────────────────────────────────
    const makeState = () => {
        const t = new THREE.StorageTexture(res, res);
        t.type = THREE.HalfFloatType;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        return t;
    };
    const texA = makeState();
    const texB = makeState();

    // ── CPU→GPU injection buffer (deltas only) ───────────────────────────────
    const inject = new Uint8Array(res * res * 4);
    const injectTex = new THREE.DataTexture(inject, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
    injectTex.minFilter = THREE.NearestFilter;
    injectTex.magFilter = THREE.NearestFilter;
    injectTex.colorSpace = THREE.NoColorSpace;
    injectTex.flipY = false;
    injectTex.generateMipmaps = false;

    const upX = size[0] / res;
    const upZ = size[1] / res;
    const upAvg = (upX + upZ) * 0.5;

    const uOrigin = uniform(new THREE.Vector2(origin[0], origin[1]));
    const uInvSize = uniform(new THREE.Vector2(1 / size[0], 1 / size[1]));
    const uTexel = uniform(new THREE.Vector2(upX, upZ));

    // Sim uniforms. uRate = 400/tau makes snowflow's "/400 at rate 1" constants
    // read directly as "fully gone in ~tau seconds".
    const uDt = uniform(0);
    const uRate = uniform(400 / tauCalm);
    const uWindOff = uniform(new THREE.Vector2(-1, 0)); // upwind offset, texels
    const uInjectOn = uniform(0);

    // Which half of the ping-pong currently holds the fresh state. Declared up
    // here because makeNode() below closes over it (a later `let` would put it
    // in the temporal dead zone).
    let readIsA = true;

    // Nodes the ground material samples through; ALL are repointed after each
    // ping-pong swap. The vertex stage needs its own instance, hence the factory.
    const textureNode = texture(texA);
    const readNodes = [textureNode];
    const makeNode = () => {
        const n = texture(readIsA ? texA : texB);
        readNodes.push(n);
        return n;
    };
    const injectNode = texture(injectTex);

    // ── The relax + inject pass (built once per direction) ──────────────────
    const makePass = (src, dst) => Fn(() => {
        const xi = int(instanceIndex.mod(res));
        const yi = int(instanceIndex.div(res));
        const coord = uvec2(xi, yi);
        const srcNode = texture(src);
        const ld = (x, y) => srcNode.load(uvec2(
            x.clamp(0, res - 1),
            y.clamp(0, res - 1),
        ));

        const c = ld(xi, yi);
        const xl = ld(xi.sub(1), yi);
        const xr = ld(xi.add(1), yi);
        const zd = ld(xi, yi.sub(1));
        const zu = ld(xi, yi.add(1));

        const dep0 = c.r;
        const lip0 = c.g;
        const hard0 = c.b;
        const age0 = c.a;
        const k = uRate.mul(uDt);

        // Diffusion — explicit 5-point Laplacian; coefficients must stay under
        // 0.25 or it rings. Berms diffuse ~3× faster than trench floors.
        const kDep = min(0.22, k.mul(0.004));
        const kLip = min(0.22, k.mul(0.012));
        const lapDep = xl.r.add(xr.r).add(zd.r).add(zu.r).sub(dep0.mul(4.0));
        const lapLip = xl.g.add(xr.g).add(zd.g).add(zu.g).sub(lip0.mul(4.0));
        const dep1 = dep0.add(lapDep.mul(kDep));
        const lip1 = lip0.add(lapLip.mul(kLip));

        // Wind infill — pull a little of the UPWIND neighbour across, so a
        // trail fills from the windward side instead of dissolving uniformly.
        const uw = ld(xi.add(int(uWindOff.x)), yi.add(int(uWindOff.y)));
        const kAdv = min(0.2, k.mul(0.002));
        const dep2 = mix(dep1, uw.r, kAdv.mul(0.6));
        const lip2 = mix(lip1, uw.g, kAdv);

        // Slump — piled mass falls back into the hole it came out of.
        // min() keeps it mass-conserving: an isolated berm has to diffuse.
        const slump = min(lip2, dep2).mul(min(0.6, k.mul(0.002)));
        const dep3 = dep2.sub(slump);
        const lip3 = lip2.sub(slump);

        // Decay — banked-dt exponential; berms go ~1.6× faster, packing
        // outlives the dent. Snap the last sliver to zero so the field truly
        // empties (exponentials never reach it on their own).
        const dep4 = dep3.mul(exp(uDt.mul(uRate).div(-400.0)));
        const lip4 = lip3.mul(exp(uDt.mul(uRate).mul(1.6).div(-400.0)));
        const hard1 = hard0.mul(exp(uDt.mul(uRate).div(-400.0 * hardTauMul)));
        const age1 = min(1.0, age0.add(uDt.div(ageTau)));

        // Injection — CPU-authored capsule deltas, saturating against LIVE
        // state (repeat traffic deepens + hardens; packed lanes flatten lips).
        const inj = injectNode.load(coord).mul(uInjectOn);
        const dep5 = dep4.add(inj.r.mul(dep4.oneMinus()));
        const lip5 = max(lip4, inj.g.mul(hard1.mul(0.6).oneMinus()));
        const hard2 = min(1.0, hard1.add(inj.b));
        const age2 = min(age1, inj.a.oneMinus());

        // Snap the last residue to true zero AFTER injection — exponentials
        // never get there on their own, and a fp16 sliver would hold the whole
        // field "active" forever.
        const alive = step(0.003, dep5.add(lip5).add(hard2));
        textureStore(dst, coord, vec4(
            clamp(dep5, 0.0, 1.0).mul(alive),
            clamp(lip5, 0.0, 1.0).mul(alive),
            clamp(hard2, 0.0, 1.0).mul(alive),
            clamp(age2, 0.0, 1.0).mul(alive),
        ));
    })().compute(res * res);

    const passAB = makePass(texA, texB);
    const passBA = makePass(texB, texA);

    // ── CPU stamping (deltas) ────────────────────────────────────────────────
    let dirty = false;
    let dirtyX0 = res;
    let dirtyY0 = res;
    let dirtyX1 = -1;
    let dirtyY1 = -1;
    let uploadAcc = 0;
    let bank = 0;
    let activeFor = 0; // seconds of relaxation still owed to a non-empty field
    let storm = 0;

    const markDirty = (x0, y0, x1, y1) => {
        dirty = true;
        dirtyX0 = Math.min(dirtyX0, x0);
        dirtyY0 = Math.min(dirtyY0, y0);
        dirtyX1 = Math.max(dirtyX1, x1);
        dirtyY1 = Math.max(dirtyY1, y1);
        // The field now holds marks: keep relaxing for ~2 calm lifetimes.
        activeFor = Math.max(activeFor, tauCalm * 2.5);
    };

    const clearDirtyRect = () => {
        for (let y = dirtyY0; y <= dirtyY1; y += 1) {
            inject.fill(0, (y * res + dirtyX0) * 4, (y * res + dirtyX1 + 1) * 4);
        }
        dirty = false;
        dirtyX0 = res; dirtyY0 = res; dirtyX1 = -1; dirtyY1 = -1;
    };

    /** Same capsule brush as the CPU original, writing saturating DELTAS. */
    function stampCapsule({
        x0, z0, x1 = x0, z1 = z0,
        radius, depth = 0.85, berm = 0.4, bermDir = 0, harden = 0.5, floorFrac = 0.55,
    }) {
        const pad = Math.max(1.2, radius / upAvg);
        const bw = 0.55;
        const ax = (x0 - origin[0]) / upX;
        const ay = (z0 - origin[1]) / upZ;
        const bx = (x1 - origin[0]) / upX;
        const by = (z1 - origin[1]) / upZ;
        const sx = bx - ax;
        const sy = by - ay;
        const segLen2 = sx * sx + sy * sy;
        const hl = Math.sqrt(segLen2) || 1;
        const hx = segLen2 > 1e-6 ? sx / hl : 0;
        const hy = segLen2 > 1e-6 ? sy / hl : 0;

        const reach = pad * (1 + bw) + 1;
        const ix0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
        const iy0 = Math.max(0, Math.floor(Math.min(ay, by) - reach));
        const ix1 = Math.min(res - 1, Math.ceil(Math.max(ax, bx) + reach));
        const iy1 = Math.min(res - 1, Math.ceil(Math.max(ay, by) + reach));
        if (ix1 < ix0 || iy1 < iy0) return;

        // Per-mark seed: same brush at the same spot always breaks up the same
        // way, so a re-stamped lane accumulates coherently instead of shimmering.
        const seed = (Math.abs(ax * 0.137 + ay * 0.219) % 6.2831853);

        for (let y = iy0; y <= iy1; y += 1) {
            for (let x = ix0; x <= ix1; x += 1) {
                const px = x - ax;
                const py = y - ay;
                const t = segLen2 > 1e-6
                    ? Math.max(0, Math.min(1, (px * sx + py * sy) / segLen2))
                    : 0;
                const dx = px - sx * t;
                const dy = py - sy * t;
                const dist = Math.sqrt(dx * dx + dy * dy);
                // Break the rim's perfect circle with smooth angular noise, so
                // the edge reads as snow giving way rather than as a stencil.
                const ang = Math.atan2(dy, dx);
                const tn = (dist / pad) / (1 + 0.22 * rimWobble(ang, seed));
                if (tn > 1 + bw) continue;

                let pit = 0;
                if (tn < 1) {
                    const q = Math.min(1, (1 - tn) / Math.max(1e-3, 1 - floorFrac));
                    pit = depth * q * q * (3 - 2 * q);
                }
                let lip = 0;
                if (berm > 0 && tn > 1) {
                    const r = Math.sin(Math.PI * ((tn - 1) / bw));
                    if (r > 0) {
                        const along = dist > 1e-3 ? (dx * hx + dy * hy) / dist : 0;
                        // Granulate the displaced mass — broken snow has crystal
                        // faces pointing everywhere, and that chunkiness at the
                        // trail edge is most of the "displaced volume" read.
                        const grain = 0.72 + 0.56 * vnoise2(x * 0.42 + seed, y * 0.42 - seed);
                        lip = berm * r * Math.max(0.25, 1 + bermDir * along) * grain;
                    }
                }
                if (pit <= 0.002 && lip <= 0.002) continue;

                const idx = (y * res + x) * 4;
                // Sequential-saturating within the injection window; the shader
                // saturates once more against live GPU state.
                const curPitD = inject[idx] / 255;
                const newPitD = pit > 0 ? curPitD + pit * (1 - curPitD) : curPitD;
                inject[idx] = Math.min(255, Math.round(newPitD * 255));
                inject[idx + 1] = Math.max(inject[idx + 1], Math.min(255, Math.round(lip * 255)));
                if (pit > 0.002) {
                    inject[idx + 2] = Math.min(255, inject[idx + 2] + Math.round(pit * harden * 255));
                    inject[idx + 3] = 255; // fresh — resets age in the shader
                }
            }
        }
        markDirty(ix0, iy0, ix1, iy1);
    }

    // ── Mark vocabulary (identical to the CPU original) ──────────────────────
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

    function stampDrag(x0, z0, x1, z1, scale = 190) {
        stampCapsule({
            x0, z0, x1, z1, radius: scale * 0.042, depth: 0.2, berm: 0.12, harden: 0.15, floorFrac: 0.3,
        });
    }

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
        for (let kk = 0; kk < 4; kk += 1) {
            const a = (kk / 4) * Math.PI * 2 + 0.6;
            const rr = scale * 0.17;
            stampPaw(wx + Math.cos(a) * rr, wz + Math.sin(a) * rr, ux, uz, scale * 0.85, 0.7);
        }
    }

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

    const stamp = (wx, wz, ux, uz, modelScale = 190) => stampPaw(wx, wz, ux, uz, modelScale);

    function setStorm(s) {
        storm = Math.max(0, Math.min(1, s || 0));
        uRate.value = 400 / (tauCalm + (tauStorm - tauCalm) * storm);
    }

    function setWind(vx, vz) {
        const l = Math.hypot(vx, vz);
        if (l > 1e-4) {
            // Upwind neighbour, in texels (≥1 so the advection always moves).
            uWindOff.value.set(
                Math.round((-vx / l) * 1.6) || -Math.sign(vx) || -1,
                Math.round((-vz / l) * 1.6) || 0,
            );
        }
    }

    let dispatchCount = 0;

    /** Bank relaxation time; dispatch when a bank is due or stamps arrived. */
    function update(dt) {
        uploadAcc += dt;
        if (activeFor > 0) {
            bank += dt;
            activeFor = Math.max(0, activeFor - dt);
        }
        const wantInject = dirty && uploadAcc >= UPLOAD_TICK;
        const wantRelax = bank >= BANK_STEP;
        if (!wantInject && !wantRelax) return;

        uDt.value = wantRelax ? Math.min(1.0, bank) : 0;
        if (wantRelax) bank = 0;
        if (wantInject) {
            injectTex.needsUpdate = true;
            uInjectOn.value = 1;
        } else {
            uInjectOn.value = 0;
        }
        renderer.compute(readIsA ? passAB : passBA);
        readIsA = !readIsA;
        const fresh = readIsA ? texA : texB;
        for (let i = 0; i < readNodes.length; i += 1) readNodes[i].value = fresh;
        dispatchCount += 1;
        if (wantInject) {
            clearDirtyRect();
            uploadAcc = 0;
        }
        uInjectOn.value = 0;
    }

    function dispose() {
        texA.dispose();
        texB.dispose();
        injectTex.dispose();
    }

    return {
        texture: texA, // legacy handle; prefer textureNode
        textureNode,
        makeNode,
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
        get activeTiles() { return activeFor > 0 ? 1 : 0; },
        get dispatches() { return dispatchCount; },
    };
}
