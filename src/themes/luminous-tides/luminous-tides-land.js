/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Luminous Tides — the land behind the beach: a dark tree line of palms and low jungle along the
 * top of the sand, curving away with the bay to the headland at its far arm, where the land rises
 * into a forested hill and comes down to the sea in rocks.
 *
 * One upright strip of quads following the back of the beach (it stands on the sand the frame
 * shows, so the trees are rooted). Its fragment draws the silhouette: a bumpy canopy, palms above
 * it (each a curved trunk and a crown of drooping fronds), the hill. Outside the silhouette it is
 * transparent. Seen against the night it is nearly black; the air between greys it with distance.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, exp, float, floor, fwidth, length, max, mix, normalize, positionWorld,
    sin, smoothstep, texture, vec2, vec4,
} from 'three/tsl';
import {
    SHORE, fromShore, sandHeight, smooth,
} from './luminous-tides-core.js';
import { TUNE, hash22, horizonHaze } from './luminous-tides-tsl.js';

/** The strip runs from FROM to TO metres along the shore. */
export const LAND = Object.freeze({
    from: -40,
    to: 470,
    step: 2,
    /** The tree line stands a little behind the dune foot… */
    line: SHORE.dunes + 2.5,
    /** …and comes down to the sea at the headland's tip. */
    tipFrom: 400,
    tipTo: 465,
    tipS: -5,
    /** The headland hill: where it rises and how high. */
    hillFrom: 230,
    hillTo: 380,
    hill: 17,
    /** Palms stand along the beach up to here, this far apart on average. */
    palmsTo: 420,
    palmGap: 6.4,
});

/** Where the tree line stands across the shore at `a` (s, metres). */
export function landLine(a) {
    return LAND.line + (LAND.tipS - LAND.line) * smooth(LAND.tipFrom, LAND.tipTo, a);
}

/** The headland's rise at `a` (metres over the canopy's base). */
export function hillAt(a) {
    const rise = smooth(LAND.hillFrom, LAND.hillTo, a);
    const fall = smooth(LAND.tipFrom + 40, LAND.to, a);
    return LAND.hill * rise * (1 - fall * 0.85);
}

export function createLand({ tier, U, skyNoise }) {
    const columns = Math.floor((LAND.to - LAND.from) / LAND.step) + 1;
    const positions = new Float32Array(columns * 2 * 3);
    const local = new Float32Array(columns * 2 * 2);
    const at = { x: 0, z: 0 };
    for (let i = 0; i < columns; i += 1) {
        const a = LAND.from + i * LAND.step;
        const s = landLine(a);
        fromShore(a, s, at);
        const base = sandHeight(s);
        const top = hillAt(a) + 24;
        for (let r = 0; r < 2; r += 1) {
            const k = i * 2 + r;
            const y = r === 0 ? base - 1.5 : base + top;
            positions[k * 3] = at.x;
            positions[k * 3 + 1] = y;
            positions[k * 3 + 2] = at.z;
            local[k * 2] = a;
            local[k * 2 + 1] = y - base;
        }
    }
    const indices = [];
    for (let i = 0; i < columns - 1; i += 1) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aLand', new THREE.BufferAttribute(local, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
        fog: false,
    });
    material.name = 'luminous-tides-land';
    const aLand = attribute('aLand', 'vec2');
    const palmDensity = tier.palms;

    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.fragmentNode = Fn(() => {
        const a = aLand.x.toVar();
        const h = aLand.y.toVar();
        // The canopy: low jungle, bumpy, a little taller toward the hill; the hill under it.
        const rise = smoothstep(LAND.hillFrom, LAND.hillTo, a);
        const fall = smoothstep(LAND.tipFrom + 40, LAND.to, a);
        const hill = rise.mul(float(1.0).sub(fall.mul(0.85))).mul(LAND.hill);
        const n1 = texture(skyNoise, vec2(a.mul(0.011), 0.21), 0.0).r;
        const n2 = texture(skyNoise, vec2(a.mul(0.047), 0.53), 0.0).g;
        const n3 = texture(skyNoise, vec2(a.mul(0.19), 0.77), 0.0).a;
        const canopy = hill.mul(n1.mul(0.55).add(0.7)).add(n1.mul(3.6)).add(n2.mul(2.2).add(hill.mul(0.12).mul(n3)))
            .add(n3.mul(1.1))
            .add(3.2)
            .toVar();
        // The rocks at the headland's tip: lower, blunt.
        const tip = smoothstep(LAND.tipFrom + 60, LAND.to, a);
        canopy.assign(mix(canopy, canopy.mul(0.55).add(n3.mul(1.5)), tip.mul(0.6)));
        const cover = smoothstep(fwidth(h).mul(1.2), fwidth(h).mul(-1.2), h.sub(canopy)).toVar();

        // The palms: in cells along the beach, each a curved trunk and a crown of fronds.
        const gap = LAND.palmGap / Math.max(0.3, palmDensity);
        const cell = floor(a.div(gap)).toVar();
        const palms = float(0.0).toVar();
        for (let o = -1; o <= 1; o += 1) {
            const c = cell.add(o);
            const r = hash22(vec2(c, 5.7)).toVar();
            const r2 = hash22(vec2(c, 19.3)).toVar();
            const exists = smoothstep(0.18, 0.2, r2.y).mul(smoothstep(LAND.palmsTo, LAND.palmsTo - 40, c.mul(gap)));
            const foot = c.add(r.x.mul(0.6).add(0.2)).mul(gap);
            const tall = r.y.mul(8.0).add(11.0);
            const lean = r2.x.sub(0.5).mul(0.5);
            const bend = r2.x.sub(0.5).mul(1.6);
            // The trunk.
            const u = clamp(h.div(tall), 0.0, 1.0);
            const trunkX = foot.add(lean.mul(h)).add(bend.mul(u.mul(u)));
            const width = mix(float(0.52), float(0.28), u);
            const dx = abs(a.sub(trunkX));
            const px = max(fwidth(a), 0.02);
            const trunk = smoothstep(width.mul(0.5).add(px), width.mul(0.5).sub(px), dx)
                .mul(smoothstep(-0.1, 0.1, h)).mul(smoothstep(tall.add(0.2), tall.sub(0.2), h));
            // The crown: nine fronds drooping from the top of the trunk.
            const cx = foot.add(lean.mul(tall)).add(bend);
            const toP = vec2(a.sub(cx), h.sub(tall)).toVar();
            const crown = float(0.0).toVar();
            for (let j = 0; j < 9; j += 1) {
                const phi = (j / 9) * Math.PI * 2 + 0.3;
                const dirX = cos(r.x.mul(0.6).add(phi));
                const dirY = sin(r.x.mul(0.6).add(phi)).mul(0.55).add(0.25);
                const dir = normalize(vec2(dirX, dirY));
                const len = r2.y.mul(1.5).add(4.2);
                const along = toP.x.mul(dir.x).add(toP.y.mul(dir.y));
                const v = clamp(along.div(len), 0.0, 1.0);
                // Each frond falls away toward its tip.
                const droopY = v.mul(v).mul(len).mul(0.55);
                const perp = toP.x.mul(dir.y.negate()).add(toP.y.mul(dir.x)).add(droopY.mul(dir.x));
                const half = sin(v.mul(Math.PI)).mul(0.42).add(0.04)
                    .mul(abs(sin(along.mul(13.0))).mul(0.35).add(0.65));
                const inFrond = smoothstep(half.add(px), half.sub(px), abs(perp))
                    .mul(smoothstep(-0.2, 0.15, along)).mul(smoothstep(len.add(0.1), len.sub(0.4), along));
                crown.assign(max(crown, inFrond));
            }
            palms.assign(max(palms, max(trunk, crown).mul(exists)));
        }
        const alpha = max(cover, palms).toVar();

        // Nearly black against the night, a breath of the sky's own light on it, greyed by the air.
        const P = positionWorld;
        const toEye = cameraPosition.sub(P);
        const dist = length(toEye);
        const V = toEye.div(max(dist, 1e-3));
        const air = horizonHaze(V.negate(), U);
        const body = air.mul(0.16).add(U.light.glow.mul(0.004).mul(U.glowPower));
        const haze = float(1.0).sub(exp(dist.div(-TUNE.hazeReach * 0.32))).mul(0.85)
            .add(float(1.0).sub(exp(dist.mul(U.haze).mul(-0.012))).mul(0.5))
            .min(0.95);
        const colour = mix(body, air, haze);
        return vec4(colour.mul(alpha), alpha);
    })();
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.alphaTest = 0.02;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'luminous-tides-land';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
