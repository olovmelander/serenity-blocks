/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the hanging lanterns: warm jewels in the cool night.
 *
 * A Victorian hexagonal lantern hangs on a long chain from every second rib over each path:
 * a hexagonal cap rising to a ball finial, six panes of clear glass between slender corner posts,
 * a banded base tapering to a drop. Inside each a candle burns. The flame is not geometry: each
 * pane is shaded as the glass it is, and what the eye sees through it is computed in closed form
 * from the view ray: the flame (a teardrop of light, hottest and whitest low down, swaying and
 * flickering on its own seed), the candle's wax glowing under it where the ray passes the candle,
 * and the glass's own warm glow, brightest at the flame's height. A soft additive halo round
 * each flame (premultiplied, alpha untouched) lets the mist carry the light, and never shrinks
 * below a few pixels, so the far lanterns down the nave still read as a string of sparks.
 *
 * The frame is dark bronze, lit by the house's light (mgSurface: the moon, the sky, the other
 * lanterns) and by its own flame from inside: the eave's underside and the posts' inner edges
 * glow, and a warm glint runs on the edges that mirror the flame. Everything follows the night's
 * lantern colour and U.lanternGain (the chain burns them up; the hush before the Queen of the
 * Night all but puts them out).
 *
 * Three draw calls: the frames and chains (opaque), the panes (opaque, emissive), the halos.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float, fract, length,
    max, min, mix, normalWorldGeometry, normalize, positionGeometry, positionWorld, reflect, select, sin, smoothstep,
    texture, vec2,
    vec3, vec4,
} from 'three/tsl';
import { mgSurface } from './moonlit-greenhouse-tsl.js';
import { LANTERN_FLAME_DROP } from './moonlit-greenhouse-plan.js';
import {
    HouseMesh, footprint, glassGlow, lathe,
} from './moonlit-greenhouse-iron.js';

// ── Numbers ─────────────────────────────────────────────────────────────────────────────────

/**
 * The lantern, in metres from its flame's centre (LANTERN_FLAME_DROP under the plan's lantern
 * point, the same point the world lights the house from):
 *   paneR        the hexagon's corner radius at the panes; panes from paneFrom to paneTo
 *   base…        the base band and its taper to the drop
 *   eave…        the eave band, the roof up to the finial
 *   top          where the chain meets the finial
 *   flame        the flame's half-height and radius
 */
export const LANTERN = Object.freeze({
    flameDrop: LANTERN_FLAME_DROP,
    paneR: 0.118,
    paneFrom: -0.13,
    paneTo: 0.14,
    postR: 0.124,
    post: 0.0065,
    baseR: 0.136,
    baseFrom: -0.152,
    taperTo: -0.235,
    eaveR: 0.152,
    eaveTo: 0.162,
    roofTo: 0.272,
    top: 0.355,
    chain: 0.0075,
    flameH: 0.034,
    flameR: 0.0125,
    candleR: 0.0155,
    candleFrom: -0.12,
    candleTo: -0.026,
    halo: 0.62,
});

const SIX = 6;

/** The flame's centre for a plan lantern. */
export function flameOf(l) {
    return [l.x, l.y - LANTERN.flameDrop, l.z];
}

/**
 * A hexagonal "lathe" with flat faces: `profile` [r, y] bottom to top, turned to six corners
 * starting at `yaw`; each band of each face is its own flat quad.
 */
function hexLathe(mesh, cx, cy, cz, profile, yaw, values) {
    for (let j = 0; j + 1 < profile.length; j += 1) {
        const [r0, y0] = profile[j];
        const [r1, y1] = profile[j + 1];
        // The profile's outward normal in (r, y): (dy, −dr).
        const pr = y1 - y0;
        const py = -(r1 - r0);
        for (let k = 0; k < SIX; k += 1) {
            const a0 = yaw + (k / SIX) * Math.PI * 2;
            const a1 = yaw + ((k + 1) / SIX) * Math.PI * 2;
            const am = (a0 + a1) / 2;
            // The face's own normal: its plane's, tilted by the profile.
            const apothem = Math.cos(Math.PI / SIX);
            const n = [Math.cos(am) * pr, py * apothem, Math.sin(am) * pr];
            const pts = [
                [cx + r0 * Math.cos(a0), cy + y0, cz + r0 * Math.sin(a0)],
                [cx + r0 * Math.cos(a1), cy + y0, cz + r0 * Math.sin(a1)],
                [cx + r1 * Math.cos(a1), cy + y1, cz + r1 * Math.sin(a1)],
                [cx + r1 * Math.cos(a0), cy + y1, cz + r1 * Math.sin(a0)],
            ];
            if (Math.hypot(n[0], n[1], n[2]) < 1e-9) continue;
            const ids = pts.map((p) => mesh.vertex(p, n, values));
            mesh.quad(ids[0], ids[1], ids[2], ids[3]);
        }
    }
}

/** A thin vertical square bar centred on (x, z) from y0 to y1, turned by `yaw`. */
function bar(mesh, x, z, y0, y1, half, yaw, values) {
    for (let k = 0; k < 4; k += 1) {
        const a = yaw + (k * Math.PI) / 2;
        const n = [Math.cos(a), 0, Math.sin(a)];
        const t = [-Math.sin(a), 0, Math.cos(a)];
        const c = [x + n[0] * half, z + n[2] * half];
        const pts = [
            [c[0] - t[0] * half, y0, c[1] - t[2] * half], [c[0] + t[0] * half, y0, c[1] + t[2] * half],
            [c[0] + t[0] * half, y1, c[1] + t[2] * half], [c[0] - t[0] * half, y1, c[1] - t[2] * half],
        ];
        const ids = pts.map((p) => mesh.vertex(p, n, values));
        mesh.quad(ids[0], ids[1], ids[2], ids[3]);
    }
}

/**
 * The lanterns' geometry for a plan: { body, panes, halos } as HouseMesh builders. Every vertex
 * carries aLamp = (flame centre, seed); the body's aKind = (kind 0 frame / 1 chain, metres along
 * the chain); the panes' aPane = (across 0..1, up 0..1); the halos' aCorner = (corner −1..1).
 */
export function buildLanternMeshes(plan) {
    const L = LANTERN;
    const body = new HouseMesh({ aLamp: 4, aKind: 4 });
    const panes = new HouseMesh({ aLamp: 4, aPane: 4 });
    const halos = new HouseMesh({ aLamp: 4, aCorner: 4 });
    plan.lanterns.forEach((l) => {
        const [fx, fy, fz] = flameOf(l);
        const { seed } = l;
        const lamp = [fx, fy, fz, seed];
        const frame = { aLamp: lamp, aKind: [0, 0, 0, 0] };
        // A corner toward the eye reads as a solid; each lantern turned a little its own way.
        const yaw = Math.PI / 2 + (seed - 0.5) * 0.5;
        // The base: band, taper, drop.
        hexLathe(body, fx, fy, fz, [
            [L.baseR, L.baseFrom], [L.baseR, L.paneFrom], [L.paneR, L.paneFrom + 0.004],
        ], yaw, frame);
        hexLathe(body, fx, fy, fz, [[0.02, L.taperTo], [L.baseR, L.baseFrom]], yaw, frame);
        lathe(body, fx, fz, [
            [0.0, fy + L.taperTo - 0.07, true], [0.008, fy + L.taperTo - 0.066], [0.016, fy + L.taperTo - 0.052],
            [0.018, fy + L.taperTo - 0.036], [0.01, fy + L.taperTo - 0.022], [0.012, fy + L.taperTo - 0.01],
            [0.022, fy + L.taperTo, true],
        ], 10, { values: () => frame });
        // The eave and the roof.
        hexLathe(body, fx, fy, fz, [
            [L.paneR, L.paneTo - 0.004], [L.eaveR, L.paneTo], [L.eaveR, L.eaveTo], [L.eaveR - 0.012, L.eaveTo + 0.006],
            [0.03, L.roofTo],
        ], yaw, frame);
        // The finial: a ball on a neck, with the chain's shackle.
        lathe(body, fx, fz, [
            [0.03, fy + L.roofTo, true], [0.012, fy + L.roofTo + 0.012], [0.018, fy + L.roofTo + 0.022],
            [0.026, fy + L.roofTo + 0.038], [0.022, fy + L.roofTo + 0.055], [0.01, fy + L.roofTo + 0.066],
            [0.006, fy + L.top, true],
        ], 10, { values: () => frame });
        // Corner posts.
        for (let k = 0; k < SIX; k += 1) {
            const a = yaw + (k / SIX) * Math.PI * 2;
            bar(
                body,
                fx + L.postR * Math.cos(a),
                fz + L.postR * Math.sin(a),
                fy + L.paneFrom - 0.004,
                fy + L.paneTo + 0.002,
                L.post,
                a,
                frame,
            );
        }
        // The chain up to the rib.
        const { top } = l;
        const bottom = fy + L.top;
        for (let k = 0; k < 4; k += 1) {
            const a = (k * Math.PI) / 2 + seed;
            const n = [Math.cos(a), 0, Math.sin(a)];
            const t = [-Math.sin(a), 0, Math.cos(a)];
            const c = [fx + n[0] * L.chain, fz + n[2] * L.chain];
            const h = L.chain;
            const pts = [
                [c[0] - t[0] * h, bottom, c[1] - t[2] * h], [c[0] + t[0] * h, bottom, c[1] + t[2] * h],
                [c[0] + t[0] * h, top, c[1] + t[2] * h], [c[0] - t[0] * h, top, c[1] - t[2] * h],
            ];
            const ids = pts.map((p) => body.vertex(p, n, { aLamp: lamp, aKind: [1, p[1] - bottom, 0, 0] }));
            body.quad(ids[0], ids[1], ids[2], ids[3]);
        }
        // The panes.
        for (let k = 0; k < SIX; k += 1) {
            const a0 = yaw + (k / SIX) * Math.PI * 2;
            const a1 = yaw + ((k + 1) / SIX) * Math.PI * 2;
            const am = (a0 + a1) / 2;
            const n = [Math.cos(am), 0, Math.sin(am)];
            const r = L.paneR;
            const pts = [
                [fx + r * Math.cos(a0), fy + L.paneFrom, fz + r * Math.sin(a0), 0, 0],
                [fx + r * Math.cos(a1), fy + L.paneFrom, fz + r * Math.sin(a1), 1, 0],
                [fx + r * Math.cos(a1), fy + L.paneTo, fz + r * Math.sin(a1), 1, 1],
                [fx + r * Math.cos(a0), fy + L.paneTo, fz + r * Math.sin(a0), 0, 1],
            ];
            const ids = pts.map((p) => panes.vertex([p[0], p[1], p[2]], n, { aLamp: lamp, aPane: [p[3], p[4], k, 0] }));
            panes.quad(ids[0], ids[1], ids[2], ids[3]);
        }
        // The halo: a quad the vertex stage turns to the camera.
        const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => halos.vertex([fx, fy, fz], [0, 0, 1], {
            aLamp: lamp, aCorner: [u, v, 0, 0],
        }));
        halos.index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    });
    return { body, panes, halos };
}

// ── Shading ─────────────────────────────────────────────────────────────────────────────────

/** A candle's flicker from the clock and the lantern's seed (≈1, a few per cent either way). */
function flickerOf(U, seed) {
    const t = U.time;
    return float(1.0)
        .add(sin(t.mul(seed.mul(3.0).add(7.1)).add(seed.mul(40.0))).mul(0.05))
        .add(sin(t.mul(13.3).add(seed.mul(9.0))).mul(0.03))
        .add(sin(t.mul(seed.mul(5.0).add(27.0)).add(seed.mul(17.0))).mul(0.018));
}

/**
 * The lanterns part. ctx = { U, noise, plan }.
 */
export function createLanterns({ U, noise, plan }) {
    const built = buildLanternMeshes(plan);
    const group = new THREE.Group();
    group.name = 'moonlit-greenhouse-lanterns';
    const geometries = [];
    const materials = [];
    const { night } = U;
    const lamp = attribute('aLamp', 'vec4');
    const flame = lamp.xyz;
    const seed = lamp.w;

    // ── The frames and the chains.
    {
        const geometry = built.body.geometry();
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'moonlit-greenhouse-lantern-frames';
        const K = attribute('aKind', 'vec4');
        material.colorNode = Fn(() => {
            const p = positionWorld;
            const foot = footprint(p);
            const n = normalWorldGeometry.toVar();
            const isChain = K.x.greaterThan(0.5);
            // The chain's links: each a ring turned a quarter from the last.
            const link = fract(K.y.div(0.042));
            const linkShade = smoothstep(0.0, 0.18, link).mul(float(1.0).sub(smoothstep(0.82, 1.0, link)))
                .mul(0.6)
                .add(0.4);
            const bronze = vec3(0.06, 0.044, 0.022);
            const iron = vec3(0.028, 0.03, 0.03);
            const albedo = select(isChain, iron.mul(linkShade), bronze);
            const base = mgSurface(p, n, albedo, U, { soft: foot });
            // Its own flame, from inside: wrapped, falling off fast.
            const toF = flame.sub(p);
            const d2 = dot(toF, toF);
            const l = toF.div(max(d2, 1e-6).sqrt());
            const warm = night.lantern.mul(U.lanternGain).mul(flickerOf(U, seed));
            const wrap = clamp(dot(n, l).mul(0.7).add(0.3), 0.0, 1.0);
            const inner = warm.mul(albedo).mul(wrap).mul(6.0).div(d2.mul(70.0).add(1.0));
            // Edges that mirror the flame, and the vault's glow at grazing angles.
            const v = normalize(p.sub(cameraPosition));
            const r = reflect(v, n);
            const cosV = clamp(dot(n, v).negate(), 0.0, 1.0);
            const f1 = float(1.0).sub(cosV);
            const fres = f1.mul(f1).mul(f1).mul(0.6).add(0.06);
            const rl = clamp(dot(r, l), 0.0, 1.0);
            const r2 = rl.mul(rl);
            const r4 = r2.mul(r2);
            const glint = warm.mul(r4.mul(r4).mul(r4)).mul(0.9).div(d2.mul(30.0).add(1.0));
            const sheen = glassGlow(r, U).mul(fres).mul(0.6);
            return vec4(base.add(inner).add(glint.mul(select(isChain, float(0.2), float(1.0)))).add(sheen), 1.0);
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'moonlit-greenhouse-lantern-frames';
        mesh.frustumCulled = false;
        mesh.renderOrder = 9;
        group.add(mesh);
        geometries.push(geometry);
        materials.push(material);
    }

    // ── The panes, and what shows through them.
    {
        const geometry = built.panes.geometry();
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'moonlit-greenhouse-lantern-panes';
        const P = attribute('aPane', 'vec4');
        material.colorNode = Fn(() => {
            const p = positionWorld;
            const d = normalize(p.sub(cameraPosition));
            const L = LANTERN;
            const fl = flickerOf(U, seed);
            const warm = night.lantern.mul(U.lanternGain).mul(fl);
            const t = U.time;
            // The flame: the view ray's nearest pass by its centre, in a teardrop's measure.
            const toF = flame.sub(p);
            const along = max(dot(toF, d), 0.0);
            const off = p.add(d.mul(along)).sub(flame);
            const sway = sin(t.mul(seed.mul(2.0).add(6.3)).add(seed.mul(31.0))).mul(0.0022);
            // A chain or a clear burns the lanterns up: the flame stands taller.
            const tall = clamp(U.lanternGain, 0.3, 2.0).mul(0.22).add(0.78);
            const h = clamp(off.y.div(tall.mul(L.flameH)).mul(0.5).add(0.45), 0.0, 1.0);
            const ox = off.x.sub(sway.mul(h));
            const rho = length(vec2(ox, off.z));
            const taper = float(1.0).sub(h.mul(0.82)).mul(smoothstep(0.0, 0.22, h).mul(0.6).add(0.4));
            const width = taper.mul(L.flameR).add(0.0012);
            const height = smoothstep(-0.05, 0.08, h).mul(float(1.0).sub(smoothstep(0.82, 1.0, h)));
            const body = exp(rho.div(width).mul(rho.div(width)).negate()).mul(height);
            const core = exp(rho.div(width.mul(0.5)).mul(rho.div(width.mul(0.5))).negate())
                .mul(smoothstep(-0.02, 0.2, h)).mul(float(1.0).sub(smoothstep(0.35, 0.7, h)));
            const glowAir = exp(length(off).div(0.05).negate()).mul(0.35);
            const flameLight = warm.mul(body.mul(7.0).add(glowAir))
                .add(vec3(1.0, 0.93, 0.78).mul(core).mul(U.lanternGain).mul(fl)
                    .mul(5.0));
            // The candle: where the ray passes its axis within its radius, below the flame.
            const dxz = d.xz;
            const k = dot(flame.xz.sub(p.xz), dxz).div(max(dot(dxz, dxz), 1e-5));
            const nearXZ = length(p.xz.add(dxz.mul(k)).sub(flame.xz));
            const yAt = p.y.add(d.y.mul(k)).sub(flame.y);
            const inCandle = float(1.0).sub(smoothstep(L.candleR * 0.8, L.candleR, nearXZ))
                .mul(smoothstep(L.candleFrom - 0.004, L.candleFrom, yAt))
                .mul(float(1.0).sub(smoothstep(L.candleTo, L.candleTo + 0.004, yAt)));
            const waxGlow = smoothstep(L.candleFrom, L.candleTo + 0.01, yAt).mul(0.8).add(0.25);
            const candle = mix(vec3(1.0, 0.9, 0.72), night.lantern, 0.4).mul(U.lanternGain).mul(fl)
                .mul(waxGlow)
                .mul(0.6)
                .mul(inCandle);
            // The glass: old and a little seeded, glowing warm, brightest at the flame's height.
            const ripple = texture(noise, vec2(P.x.add(P.z.mul(0.37)).add(seed), P.y.mul(1.6)).mul(0.9)).w;
            const level = exp(P.y.sub(0.55).div(0.32).mul(P.y.sub(0.55).div(0.32)).negate()).mul(0.55).add(0.16);
            const rim = smoothstep(0.42, 0.5, abs(P.x.sub(0.5))).add(smoothstep(0.42, 0.5, abs(P.y.sub(0.5))));
            const edge = min(rim, 1.0);
            const glass = warm.mul(level.mul(ripple.mul(0.5).add(0.75)).add(edge.mul(0.25))).mul(0.55);
            // A trace of the night on the glass's face: the vault's glow at grazing angles.
            const n = normalWorldGeometry;
            const cosV = clamp(dot(n, d).negate(), 0.0, 1.0);
            const f1 = float(1.0).sub(cosV);
            const sky = glassGlow(reflect(d, n), U).mul(f1.mul(f1).mul(0.8).add(0.04));
            const inside = flameLight.mul(float(1.0).sub(inCandle.mul(0.9))).add(candle);
            return vec4(glass.add(inside.mul(0.92)).add(sky), 1.0);
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'moonlit-greenhouse-lantern-panes';
        mesh.frustumCulled = false;
        mesh.renderOrder = 9;
        group.add(mesh);
        geometries.push(geometry);
        materials.push(material);
    }

    // ── The halos in the air.
    {
        const geometry = built.halos.geometry();
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            premultipliedAlpha: true,
            fog: false,
        });
        material.name = 'moonlit-greenhouse-lantern-halos';
        const C = attribute('aCorner', 'vec4');
        material.vertexNode = Fn(() => {
            const view = cameraViewMatrix.mul(vec4(positionGeometry, 1.0)).toVar();
            const depth = max(view.z.negate(), 0.05);
            const swell = clamp(U.lanternGain, 0.2, 2.2).mul(0.25).add(0.75);
            const radius = max(swell.mul(LANTERN.halo), depth.mul(U.pixelAngle).mul(9.0));
            // Toward the camera, so the glow lies over the lantern's own glass.
            const at = vec3(view.xy.add(C.xy.mul(radius)), view.z.add(0.26));
            return cameraProjectionMatrix.mul(vec4(at, 1.0));
        })();
        material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        material.outputNode = Fn(() => {
            const r2 = dot(C.xy, C.xy);
            const glow = exp(r2.mul(-4.5)).mul(0.5).add(exp(r2.mul(-26.0)).mul(0.9))
                .mul(float(1.0).sub(smoothstep(0.75, 1.0, r2)));
            const warm = night.lantern.mul(U.lanternGain).mul(flickerOf(U, seed));
            return vec4(warm.mul(glow).mul(0.3).mul(float(1.0).sub(U.hush.mul(0.6))), 0.0);
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'moonlit-greenhouse-lantern-halos';
        mesh.frustumCulled = false;
        mesh.renderOrder = 61;
        group.add(mesh);
        geometries.push(geometry);
        materials.push(material);
    }

    return {
        mesh: group,
        count: plan.lanterns.length,
        dispose() {
            group.removeFromParent();
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
            geometries.length = 0;
            materials.length = 0;
        },
    };
}
