/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Luminous Tides — the land behind the beach, in three depths: palms on the back beach leaning
 * out over the sand (luminous-tides-palms.js), the low jungle behind them along the dune foot, and
 * further back and up the slope the forest climbing to the headland's hill where the bay's far arm
 * comes round and goes down to the sea in rocks. Mist lies in the jungle's foot and between it and
 * the hill, so each depth stands clear of the one behind it.
 *
 * The jungle and the back forest are upright strips of quads following the shore (each stands on
 * ground the frame shows, so the trees are rooted). Their fragments draw rounded crowns: a line of
 * domes along the top and inside it a mass of overlapping round crowns, each shaded as the dome it
 * is by the night's light (landLight: the air from above, the far coast's warm glow on what turns
 * to it, the sea's blue fire low on the seaward faces, the sky wrapping the top edge), darker deep
 * in the canopy. Outside the silhouette they are transparent. The air between greys them.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, dot, exp, float, floor, fwidth, length, max, mix, normalize, positionWorld,
    select, sign, smoothstep, sqrt, texture, vec2, vec3, vec4,
} from 'three/tsl';
import {
    EYE, SHORE, fromShore, sandHeight, smooth,
} from './luminous-tides-core.js';
import {
    TUNE, hash22, horizonHaze, landHaze, landLight, shoreOf,
} from './luminous-tides-tsl.js';
import { createPalms } from './luminous-tides-palms.js';

/** The strips run from FROM to TO metres along the shore. */
export const LAND = Object.freeze({
    from: -40,
    to: 470,
    step: 2,
    /** The jungle's edge stands at the dune foot (the palms in front of it)… */
    line: SHORE.dunes - 0.5,
    /** …and comes down to the sea at the headland's tip. */
    tipFrom: 400,
    tipTo: 465,
    tipS: -5,
    /** The headland hill: where it rises and how high. */
    hillFrom: 230,
    hillTo: 380,
    hill: 19,
    /** The back forest and the hill stand this far behind the jungle's edge (metres inland), from here on. */
    back: 32,
    backFrom: 40,
});

/** Where the jungle's edge stands across the shore at `a` (s, metres). */
export function landLine(a) {
    return LAND.line + (LAND.tipS - LAND.line) * smooth(LAND.tipFrom, LAND.tipTo, a);
}

/** The headland's rise at `a` (metres over the forest's base). */
export function hillAt(a) {
    const rise = smooth(LAND.hillFrom, LAND.hillTo, a);
    const fall = smooth(LAND.tipFrom + 40, LAND.to, a);
    return LAND.hill * rise * (1 - fall * 0.85);
}

/**
 * An upright strip along the shore at `sAt(a)`, `top` metres tall: aLand = (a, height over the
 * sand, tangent xz) and aSpan, the strip's length as the eye sees it.
 *
 * The eye looks along the strip at a grazing angle, so a metre of it is a sliver on screen far off
 * and a crown laid out round in `a` stands as a tall flame. aSpan counts each metre by how much of
 * it faces the eye (the sine of the angle between the strip and the line of sight), so a crown
 * round in (aSpan, height) is round on screen, as a tree seen along a row of trees is.
 */
export function stripGeometry(from, to, sAt, topAt) {
    const columns = Math.floor((to - from) / LAND.step) + 1;
    const positions = new Float32Array(columns * 2 * 3);
    const local = new Float32Array(columns * 2 * 4);
    const span = new Float32Array(columns * 2);
    const at = { x: 0, z: 0 };
    const ahead = { x: 0, z: 0 };
    let seen = 0;
    for (let i = 0; i < columns; i += 1) {
        const a = from + i * LAND.step;
        const s = sAt(a);
        fromShore(a, s, at);
        fromShore(a + 0.5, sAt(a + 0.5), ahead);
        const tl = Math.hypot(ahead.x - at.x, ahead.z - at.z) || 1;
        const tx = (ahead.x - at.x) / tl;
        const tz = (ahead.z - at.z) / tl;
        const ex = at.x - EYE.x;
        const ez = at.z - EYE.z;
        const el = Math.hypot(ex, ez) || 1;
        if (i > 0) seen += LAND.step * Math.max(0.02, Math.abs(tx * ez - tz * ex) / el);
        const base = sandHeight(s);
        const top = topAt(a);
        for (let r = 0; r < 2; r += 1) {
            const k = i * 2 + r;
            const y = r === 0 ? base - 1.5 : base + top;
            positions[k * 3] = at.x;
            positions[k * 3 + 1] = y;
            positions[k * 3 + 2] = at.z;
            local[k * 4] = a;
            local[k * 4 + 1] = y - base;
            local[k * 4 + 2] = tx;
            local[k * 4 + 3] = tz;
            span[k] = seen;
        }
    }
    const indices = [];
    for (let i = 0; i < columns - 1; i += 1) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aLand', new THREE.BufferAttribute(local, 4));
    geometry.setAttribute('aSpan', new THREE.BufferAttribute(span, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * The highest of the round crowns standing over `a` (cells `width` apart, their tops scattered
 * `rise` metres over `mean`): vec4(its top at a, its centre a, its centre height, its radius).
 */
function crownOver(a, mean, width, rise, salt) {
    const cell = floor(a.div(width)).toVar();
    const best = vec4(-100.0, 0.0, 0.0, 1.0).toVar();
    for (let o = -1; o <= 1; o += 1) {
        const c = cell.add(o);
        const r = hash22(vec2(c, salt)).toVar();
        const ca = c.add(0.5).add(r.x.sub(0.5).mul(0.7)).mul(width);
        const rad = r.y.mul(0.45).add(0.6).mul(width);
        const ch = mean.add(r.x.mul(rise)).sub(rad.mul(0.5));
        const dx = a.sub(ca);
        const room = rad.mul(rad).sub(dx.mul(dx));
        const dome = select(room.greaterThan(0.0), ch.add(sqrt(max(room, 0.0))), float(-100.0));
        best.assign(select(dome.greaterThan(best.x), vec4(dome, ca, ch, rad), best));
    }
    return best;
}

/**
 * Inside the canopy, the round crown nearest the eye at (a, h) in a field of overlapping crowns
 * (cells `width` across): vec3(its dome's slope along, its slope up, how far it bulges 0..1).
 */
function crownWithin(a, h, width, salt) {
    const p = vec2(a, h.mul(1.3)).div(width).toVar();
    const cell = floor(p).toVar();
    const best = vec3(0.0, 0.0, 0.0).toVar();
    for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
            const c = cell.add(vec2(ox, oy));
            const r = hash22(c.add(vec2(salt, salt * 1.7))).toVar();
            const q = p.sub(c.add(r.mul(0.8).add(0.1))).div(r.x.mul(0.3).add(0.7)).toVar();
            const room = float(1.0).sub(dot(q, q));
            const bulge = sqrt(max(room, 0.0)).mul(r.y.mul(0.35).add(0.65));
            best.assign(select(bulge.greaterThan(best.z), vec3(q.x, q.y, bulge), best));
        }
    }
    return best;
}

/**
 * One depth of the land as a material. `far` is the back forest and the hill: bigger crowns, the
 * hill under them, more air and more mist.
 */
function landMaterial({ U, skyNoise, far }) {
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
        fog: false,
    });
    material.name = far ? 'luminous-tides-land-back' : 'luminous-tides-land';
    const aLand = attribute('aLand', 'vec4');
    const aSpan = attribute('aSpan', 'float');
    const width = far ? 7.0 : 5.0;

    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.fragmentNode = Fn(() => {
        const a = aLand.x.toVar();
        const h = aLand.y.toVar();
        // Crowns are laid out along the strip as the eye sees it (round on screen); the land's
        // own shape (its height, the hill, the tip) along the shore.
        const w = aSpan.toVar();
        // The canopy's mean height: low jungle, swelling and dipping along the shore; behind it
        // the forest on the hill.
        const n1 = texture(skyNoise, vec2(a.mul(0.011), far ? 0.31 : 0.21), 0.0).r;
        const n2 = texture(skyNoise, vec2(a.mul(0.047), far ? 0.63 : 0.53), 0.0).g;
        const mean = n1.mul(3.8).add(n2.mul(2.2)).add(far ? 4.6 : 4.2).toVar();
        if (far) {
            const rise = smoothstep(LAND.hillFrom, LAND.hillTo, a);
            const fall = smoothstep(LAND.tipFrom + 40, LAND.to, a);
            mean.addAssign(rise.mul(float(1.0).sub(fall.mul(0.85))).mul(LAND.hill).mul(n1.mul(0.4).add(0.8)));
        }
        // The rocks at the headland's tip: lower, blunt.
        const tip = smoothstep(LAND.tipFrom + 45, LAND.to, a);
        mean.assign(mix(mean, mean.mul(0.5), tip.mul(0.7)));

        // The top: big crowns, small ones between them, never lower than the mass under them.
        const big = crownOver(w, mean, width, 3.4, far ? 41.3 : 5.7).toVar();
        const small = crownOver(w, mean.sub(0.8), width * 0.45, 1.8, far ? 63.1 : 19.3).toVar();
        const lead = select(big.x.greaterThan(small.x), big, small).toVar();
        const top = max(lead.x, mean.sub(1.6));
        // Leaves: clumps a metre or so across break the crowns' edges and dapple them inside
        // (filtered by distance: far off they blend to their mean).
        const leaves = texture(skyNoise, vec2(w.mul(0.85), h.mul(0.85).add(far ? 0.4 : 0.0))).a.toVar();
        const fw = fwidth(h).mul(1.2);
        const cover = smoothstep(fw, fw.negate(), h.sub(top).add(leaves.sub(0.5).mul(1.3))).toVar();

        // The shape the light sees: near the top, the dome that makes the edge; deeper in, the
        // crowns of the mass, darker the deeper.
        const depth = max(top.sub(h), 0.0).toVar();
        const edgeQ = vec2(w.sub(lead.y), h.sub(lead.z)).div(lead.w).toVar();
        const edgeN = vec3(edgeQ.x, edgeQ.y, sqrt(max(float(1.0).sub(dot(edgeQ, edgeQ)), 0.04)));
        const inner = crownWithin(w, h, width * 0.62, far ? 7.1 : 3.3).toVar();
        const innerN = vec3(inner.x, inner.y, max(inner.z, 0.2));
        const nearTop = smoothstep(width * 0.75, 0.0, depth).toVar();
        const local = normalize(mix(innerN, edgeN, nearTop)).toVar();
        const hollow = mix(smoothstep(0.0, 0.55, inner.z).mul(0.7).add(0.3), float(1.0), nearTop);
        const deep = exp(depth.mul(-0.22)).mul(0.75).add(0.25);
        const mottle = texture(skyNoise, vec2(w.mul(0.23), h.mul(0.23)), 0.0).b.mul(0.7).add(0.65);
        const dapple = leaves.mul(1.1).add(0.45);
        const shade = hollow.mul(deep).mul(mottle);
        const albedo = vec3(0.16, 0.24, 0.15).mul(shade).mul(dapple);

        const P = positionWorld;
        const toEye = cameraPosition.sub(P);
        const dist = length(toEye);
        const V = toEye.div(max(dist, 1e-3)).toVar();
        // A crown is a round thing whichever way it is seen: its dome is turned to the eye. Across
        // the picture is the level line square to the sight line, signed the way the strip runs.
        const toward = normalize(vec3(V.x, 0.0, V.z)).toVar();
        const across = vec3(toward.z.negate(), 0.0, toward.x).toVar();
        const runs = sign(dot(across, vec3(aLand.z, 0.0, aLand.w)));
        const side = across.mul(runs).mul(local.x);
        const N = normalize(side.add(vec3(0.0, local.y, 0.0)).add(toward.mul(local.z))).toVar();
        const reach = shoreOf(P.xz).y.negate();
        const lit = landLight(N, V, albedo, h, reach, nearTop.mul(far ? 0.6 : 1.0), U);

        // Mist pools in the foot of the trees, lit by the air and a breath of the sea's light.
        const air = horizonHaze(V.negate(), U).toVar();
        const mistColour = air.mul(1.1).add(U.light.glow.mul(U.glowPower).mul(0.012));
        const mist = exp(h.div(far ? -6.5 : -2.4)).mul(TUNE.landMist * (far ? 1.15 : 0.8)).min(0.9);
        const misted = mix(lit, mistColour, mist);
        const haze = landHaze(dist, U);
        const aired = far ? float(1.0).sub(float(1.0).sub(haze).mul(0.72)) : haze;
        const colour = mix(misted, air, aired);
        return vec4(colour.mul(cover), cover);
    })();
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.alphaTest = 0.02;
    return material;
}

export function createLand({ tier, U, skyNoise }) {
    // The jungle along the dune foot.
    const geometry = stripGeometry(LAND.from, LAND.to, landLine, () => 19);
    const material = landMaterial({ U, skyNoise, far: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'luminous-tides-land';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;

    // Behind it and up the slope, the forest and the headland's hill.
    const backLine = (a) => landLine(a) - LAND.back;
    const backGeometry = stripGeometry(LAND.backFrom, LAND.to, backLine, (a) => hillAt(a) * 1.25 + 22);
    const backMaterial = landMaterial({ U, skyNoise, far: true });
    const back = new THREE.Mesh(backGeometry, backMaterial);
    back.name = 'luminous-tides-land-back';
    back.frustumCulled = false;
    back.renderOrder = 19;
    mesh.add(back);

    // In front of it, the palms.
    const palms = createPalms({
        tier, U, lineAt: landLine, lineKey: `dune${LAND.line}`,
    });
    mesh.add(palms.mesh);

    return {
        mesh,
        palms: palms.plan,
        dispose() {
            palms.dispose();
            back.removeFromParent();
            backGeometry.dispose();
            backMaterial.dispose();
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
