/**
 * Nebula Flow — the stars drawn as sprites over the nursery.
 *
 *   field    the cavity's own stars: a few bright ones with a space telescope's diffraction
 *            spikes (three long lines at 60° and a short horizontal one), many faint points.
 *            Stars that stand behind a pillar are hidden (worked out on the CPU from the dust's
 *            shape whenever the stage is laid out); a few stand in front of everything.
 *   births   the board's stars: every lock kindles a little cluster in a pillar, one star per
 *            cell of the piece, in the piece's colour. Held in the dust it is a reddened ember
 *            with short spikes; a clear sets it free and it burns as a full star.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dot,
    exp,
    float,
    int,
    length,
    max,
    min,
    mix,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    BIRTH_CELL,
    BIRTH_ROWS,
    BIRTH_SLOTS,
    CONSTELLATION_HOLD,
    CONSTELLATION_MERGE,
    CONSTELLATION_TIGHT,
    KIND_GREAT,
    dustDistance,
    mulberry32,
} from './nebula-flow-core.js';
import {
    nfBirthLight, nfClip, nfGauss, nfLightMaterial, nfPart, nfQuadGeometry, nfSegment,
} from './nebula-flow-tsl.js';

/**
 * A space telescope's point-spread pattern at q (units of the sprite's half-size): a core, a
 * halo, three long spikes at 90°, 30° and 150°, and a short, faint horizontal one.
 */
export function spikes(q, sharp) {
    const r2 = dot(q, q);
    const core = exp(r2.mul(sharp).negate());
    const halo = exp(r2.mul(9.0).negate()).mul(0.22).add(float(0.04).div(r2.mul(160.0).add(1.0)));
    let rays = float(0);
    const lines = [[0, 1, 1.0], [0.866, 0.5, 0.85], [-0.866, 0.5, 0.85], [1, 0, 0.32]];
    lines.forEach(([dx, dy, w]) => {
        const along = abs(dot(q, vec2(dx, dy)));
        const perp = abs(dot(q, vec2(-dy, dx)));
        const len = dx === 1 ? 0.45 : 1.0;
        const fade = pow(clamp(float(1).sub(along.div(len)), 0, 1), 2.2);
        const thin = exp(perp.mul(perp).mul(9000.0).negate()).mul(0.8).add(exp(perp.mul(perp).mul(1200.0).negate()).mul(0.2));
        rays = rays.add(thin.mul(fade).mul(w).mul(float(0.35).div(along.mul(14.0).add(1.0)).add(0.65)));
    });
    return { core, halo, rays };
}

/** Screen corner for a sprite at a nursery-space centre with a half-size. */
const toClip = (u, centre, half) => nfClip(u, centre.add(positionGeometry.xy.mul(half)));

/**
 * The field stars. `count` per tier; laid out once from the seed (x as a share of the aspect so a
 * resize keeps them), hidden behind the pillars by `cover()` whenever the stage changes.
 */
export function createFieldStars(u, { count = 120, seed = 0x51a2 } = {}) {
    const rand = mulberry32(seed);
    const star = new Float32Array(count * 4);
    const look = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
        const m = rand() ** 4.5;
        star[i * 4] = rand() * 2 - 1;
        star[i * 4 + 1] = rand() * 2 - 1;
        star[i * 4 + 2] = m;
        star[i * 4 + 3] = rand();
        // (cover, in front of the dust, tint mix, twinkle rate)
        look[i * 4] = 1;
        look[i * 4 + 1] = rand() < 0.08 ? 1 : 0;
        look[i * 4 + 2] = rand();
        look[i * 4 + 3] = 0.4 + rand() * 1.4;
    }
    const geometry = nfQuadGeometry(count, {
        aStar: { array: star, size: 4 },
        aLook: { array: look, size: 4 },
    });
    const lookAttr = geometry.getAttribute('aLook');
    lookAttr.setUsage(THREE.DynamicDrawUsage);

    const material = nfLightMaterial();
    const aStar = attribute('aStar', 'vec4');
    const aLook = attribute('aLook', 'vec4');
    const mag = aStar.z;
    // half-size: about 5 px of a 1080-line frame for a faint star, up to 90 px for the brightest
    const halfSize = max(u.design.mul(mix(5.0, 80.0, mag.mul(mag))), u.texel.mul(2.5));
    // behind the dust, between the far stars' parallax and the gas's (the nursery pass reads the
    // dust at screen + cam, so a layer at depth k shows at its place − k·cam)
    const centre = vec2(aStar.x.mul(u.aspect), aStar.y).sub(u.cam.mul(aLook.y.mul(0.3).add(0.3)));
    material.vertexNode = toClip(u, centre, halfSize.mul(aLook.x.greaterThan(0.01).select(1, 0)));
    material.colorNode = vec4(0, 0, 0, 1);
    material.outputNode = Fn(() => {
        const q = positionGeometry.xy.toVar();
        const { core, halo, rays } = spikes(q, float(mix(900.0, 220.0, mag)));
        const tint = mix(mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.85, 1.0), aLook.z), u.starTint, 0.35);
        const twinkle = sin(u.time.mul(aLook.w).add(aStar.w.mul(40.0))).mul(0.12).add(0.94);
        const power = mix(0.6, 9.0, mag.mul(mag)).mul(aLook.x).mul(twinkle);
        const white = core.mul(1.6).add(halo).add(rays.mul(smoothstep(0.5, 0.9, mag)));
        const rgb = tint.mul(white).add(vec3(core.mul(0.8))).mul(power).mul(float(1).sub(u.hush.mul(0.6)));
        return vec4(rgb, 0);
    })();
    const part = nfPart('stars', geometry, material, 10);

    /** Hide the stars that stand behind the dust of this stage (no relief: a soft edge). */
    part.cover = (pillars, aspect) => {
        const arr = lookAttr.array;
        for (let i = 0; i < count; i += 1) {
            const front = arr[i * 4 + 1] > 0.5;
            const d = dustDistance(pillars, star[i * 4] * aspect, star[i * 4 + 1]);
            arr[i * 4] = front ? 1 : Math.min(1, Math.max(0, (d + 0.01) / 0.08));
        }
        lookAttr.needsUpdate = true;
    };
    part.count = count;
    return part;
}

/**
 * The board's stars: one sprite per birth slot. At ignition the piece's cells stand as four
 * stars in its own shape, joined by lines of light (a constellation); they draw together into one
 * star, which wears the cluster's spikes. Held in the dust it is a reddened ember with short
 * spikes; a clear sets it free and it burns as a full star.
 */
export function createBirths(u) {
    const slot = new Float32Array(BIRTH_SLOTS);
    for (let i = 0; i < BIRTH_SLOTS; i += 1) slot[i] = i;
    const geometry = nfQuadGeometry(BIRTH_SLOTS, { aSlot: { array: slot, size: 1 } });
    const material = nfLightMaterial();
    const base = int(attribute('aSlot', 'float').add(0.5)).mul(BIRTH_ROWS);
    const A = u.births.element(base);
    const C = u.births.element(base.add(1));
    const E = u.births.element(base.add(2));
    const age = u.time.sub(A.z);
    const live = A.w.greaterThan(0.001).and(age.greaterThan(0));
    const light = nfBirthLight(age, E.y, C.w).mul(A.w);
    const freed = E.y.greaterThanEqual(0).and(age.greaterThan(E.y));
    const great = C.w.greaterThan(KIND_GREAT - 0.5).and(C.w.lessThan(KIND_GREAT + 0.5));
    // the constellation draws together into one star
    const shrink = mix(1.0, CONSTELLATION_TIGHT, smoothstep(CONSTELLATION_HOLD, CONSTELLATION_MERGE, age));
    const spread = float(BIRTH_CELL).mul(E.z).mul(shrink);
    // a freed or great star wears long spikes; one still in the dust only short ones
    // ignition: the new star flares with long spikes for a moment
    const flare = exp(age.div(0.45).negate()).mul(0.22);
    // the great star's spikes settle from the frame's width to a bright star's over a few seconds
    const greatReach = exp(age.div(5.0).negate()).mul(3.2).add(1.3);
    const reach = mix(0.06, 0.18, freed.select(1, 0)).mul(great.select(greatReach, 1.0)).add(flare).mul(E.z)
        .mul(min(float(1.6), pow(light.add(0.05), 0.5)));
    const half = max(reach, spread.mul(2.4)).mul(live.select(1, 0));
    // in the dust's frame: the nursery pass shows the dust at its place − cam
    material.vertexNode = toClip(u, A.xy.sub(u.cam), max(half, float(0)));
    material.colorNode = vec4(0, 0, 0, 1);
    material.outputNode = Fn(() => {
        const q = positionGeometry.xy.toVar();
        const h = max(half, 1e-4);
        // the cells, in units of the sprite
        const c0 = u.births.element(base.add(3));
        const c1 = u.births.element(base.add(4));
        const cellR = spread.div(h);
        const at = [c0.xy, c0.zw, c1.xy, c1.zw];
        const cells = float(0).toVar();
        at.forEach((c) => {
            const d = length(q.sub(c.mul(cellR)));
            const core = float(BIRTH_CELL * 0.11).mul(E.z).div(h);
            cells.addAssign(nfGauss(d.div(core)).add(nfGauss(d.div(core.mul(3.5))).mul(0.18)));
        });
        // the constellation's lines: between cells one apart, fading as they draw together
        const lines = float(0).toVar();
        const lineW = float(0.0028).div(h);
        for (let i = 0; i < 4; i += 1) {
            for (let j = i + 1; j < 4; j += 1) {
                const gap = length(at[i].sub(at[j]));
                const adjacent = smoothstep(1.3, 1.05, gap);
                const seg = nfSegment(q, at[i].mul(cellR), at[j].mul(cellR));
                lines.addAssign(nfGauss(seg.x.div(lineW)).mul(adjacent));
            }
        }
        const lineFade = float(1).sub(smoothstep(0.15, CONSTELLATION_HOLD + 0.5, age));
        const { core, halo, rays } = spikes(q.mul(h.div(max(reach, 1e-4))), float(260.0));
        const merged = smoothstep(CONSTELLATION_HOLD, CONSTELLATION_MERGE, age);
        const embedded = freed.or(great).select(0, 1);
        // the piece's colour, white-hot where it is brightest; held in the dust it reddens
        const hot = C.rgb.mul(mix(1.0, 0.6, embedded)).add(vec3(1.0, 0.32, 0.16).mul(embedded.mul(0.4)));
        const white = cells.mul(1.3).add(lines.mul(lineFade).mul(0.55))
            .add(core.mul(0.6).add(halo.mul(0.7)).add(rays.mul(mix(1.0, 0.3, embedded))).mul(merged.mul(0.8).add(0.2)));
        const rgb = mix(hot, vec3(1), clamp(cells.mul(0.45).add(core.mul(merged).mul(0.4)), 0, 0.8)).mul(white);
        return vec4(rgb.mul(light).mul(u.iris), 0);
    })();
    return nfPart('births', geometry, material, 12);
}
