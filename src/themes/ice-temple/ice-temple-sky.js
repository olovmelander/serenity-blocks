/**
 * Ice Temple — the polar night: the dome (stars, the moon and its ice halo), the mountains
 * round the lake, and the aurora.
 *
 * The aurora is geometry: each curtain is a ribbon standing in the sky along a meandering path
 * (the path is a function of the clock, so the curtain folds and unfolds), a hundred metres and
 * more tall, drawn additively. Its rays are two fetches of the baked noise along the path; a ray
 * that burns brighter also reaches higher. Seen from below the folds overlap and add, which is
 * what makes a real curtain's bright knots. Being geometry, the curtains stand upside down in the
 * ice floor's mirror for free.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    acos,
    attribute,
    cameraPosition,
    clamp,
    cross,
    dot,
    exp,
    max,
    float,
    floor,
    fract,
    length,
    mix,
    normalize,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    NAVE,
    TAU,
    itAtmosphere,
    itFxMaterial,
    itHash21,
    itHash22,
    itMoonDir,
    itPart,
    itSaturate,
    itSky,
    mulberry32,
} from './ice-temple-tsl.js';

const DOME_RADIUS = 1900;

/** One layer of stars: a soft point in some of the cells of a grid laid over the sky. */
const starLayer = /* @__PURE__ */ Fn(([grid, time, keep]) => {
    const id = floor(grid);
    const h = itHash22(id);
    const centre = h.mul(0.7).add(0.15);
    const d = length(fract(grid).sub(centre));
    const pick = itHash21(id.add(41.0));
    const bright = pow(itHash21(id.add(7.0)), 5.0).mul(0.92).add(0.08);
    const radius = bright.mul(0.07).add(0.055);
    const twinkle = sin(time.mul(h.x.mul(2.4).add(0.7)).add(h.y.mul(TAU))).mul(0.3).add(0.7);
    const point = float(1.0).sub(smoothstep(0.0, radius, d));
    return vec2(point.mul(point).mul(bright).mul(twinkle).mul(step(keep, pick)), h.x);
}).setLayout({
    name: 'it_starLayer',
    type: 'vec2',
    inputs: [{ name: 'grid', type: 'vec2' }, { name: 'time', type: 'float' }, { name: 'keep', type: 'float' }],
});

/** The dome: the night's gradient, stars, the moon with the halo ice crystals draw round it. */
export function createSky(u) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    material.name = 'IceTempleSky';
    material.fog = false;
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const col = itSky(u, dir).toVar();

        // ── Stars ──
        const sp = dir.xz.div(dir.y.abs().add(0.42));
        const a = starLayer(sp.mul(64.0), u.time, float(0.62));
        const b = starLayer(sp.mul(141.0).add(vec2(13.7, 5.1)), u.time, float(0.5));
        const tintA = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.9, 0.78), step(0.72, a.y));
        const above = smoothstep(0.0, 0.12, dir.y);
        col.addAssign(tintA.mul(a.x).mul(2.6).add(vec3(0.8, 0.88, 1.0).mul(b.x).mul(0.8)).mul(above)
            .mul(u.ambient));

        // ── The moon ──
        const moonDir = itMoonDir();
        const m = dot(dir, moonDir);
        const ang = acos(clamp(m, -1.0, 1.0));
        const disc = float(1.0).sub(smoothstep(0.027, 0.031, ang));
        const face = u.noise(dir.xy.mul(6.0)).r.mul(0.32).add(0.78);
        const limb = float(1.0).sub(smoothstep(0.0, 0.031, ang).mul(0.3));
        const glow = exp(ang.mul(-22.0)).mul(0.55).add(exp(ang.mul(-5.5)).mul(0.07));
        // Diamond dust in the air: the 22° halo, faintly red on its inner edge.
        const ringD = ang.sub(0.384);
        const halo = exp(ringD.mul(ringD).mul(-2600.0)).mul(0.05)
            .add(exp(ringD.sub(0.02).mul(ringD.sub(0.02)).mul(-900.0)).mul(0.018));
        const haloTint = mix(vec3(1.0, 0.82, 0.74), vec3(0.8, 0.9, 1.0), smoothstep(-0.01, 0.02, ringD));
        col.addAssign(u.moonColor.mul(u.ambient).mul(disc.mul(face).mul(limb).mul(7.0).add(glow)));
        col.addAssign(haloTint.mul(u.moonColor).mul(u.ambient).mul(halo).mul(u.dustGain.mul(0.5).add(0.5)));

        return itAtmosphere(u, col, cameraPosition.add(dir.mul(1500.0)));
    })();
    const geometry = new THREE.SphereGeometry(DOME_RADIUS, 40, 20);
    // Drawn after everything solid: only the sky that shows is shaded.
    return itPart('IceTempleSky', geometry, material, 4, true);
}

/**
 * The mountains round the lake: two jagged ridges, far and farther, their moonward faces
 * catching the light.
 */
export function createMountains(u, seed = 5309) {
    const rand = mulberry32(seed);
    const position = [];
    const lit = [];
    const height = [];
    const moon = [Math.sin((-38 * Math.PI) / 180), 0.41, -Math.cos((-38 * Math.PI) / 180)];
    const ridge = (radius, low, high, segments, phase) => {
        // A ridge line: a range of separate peaks, each a spike with its own height and
        // breadth, and smaller teeth cut into their flanks.
        const peaks = Array.from({ length: Math.round(segments / 6) }, () => ({
            a: rand() * TAU, h: 0.3 + rand() ** 1.7 * 0.7, w: 0.07 + rand() * 0.14,
        }));
        const teeth = Array.from({ length: Math.round(segments / 2) }, () => ({
            a: rand() * TAU, h: 0.04 + rand() * 0.13, w: 0.015 + rand() * 0.035,
        }));
        const spike = (list, a, power) => {
            let best = 0;
            for (let i = 0; i < list.length; i++) {
                let d = Math.abs(a - list[i].a) % TAU;
                if (d > Math.PI) d = TAU - d;
                const k = Math.max(0, 1 - d / list[i].w);
                best = Math.max(best, list[i].h * k ** power);
            }
            return best;
        };
        const at = (a) => {
            const wrapped = ((a % TAU) + TAU) % TAU;
            const v = Math.min(1, spike(peaks, wrapped, 1.25) + spike(teeth, wrapped, 1));
            return low + (high - low) * v;
        };
        for (let i = 0; i < segments; i++) {
            const a0 = phase + (i / segments) * TAU;
            const a1 = phase + ((i + 1) / segments) * TAU;
            const h0 = at(a0);
            const h1 = at(a1);
            const c0 = [Math.sin(a0) * radius, Math.cos(a0) * -radius];
            const c1 = [Math.sin(a1) * radius, Math.cos(a1) * -radius];
            // The face between two ridge points: tilted toward the lake, and toward whichever
            // side the ridge falls away to.
            const tangent = [c1[0] - c0[0], c1[1] - c0[1]];
            const tl = Math.hypot(tangent[0], tangent[1]) || 1;
            const slope = (h1 - h0) / tl;
            const inward = [-(c0[0] + c1[0]) / (2 * radius), -(c0[1] + c1[1]) / (2 * radius)];
            const n = [
                inward[0] * 0.8 - (tangent[0] / tl) * slope * 1.5,
                0.55,
                inward[1] * 0.8 - (tangent[1] / tl) * slope * 1.5,
            ];
            const nl = Math.hypot(n[0], n[1], n[2]) || 1;
            const facing = Math.max(0, (n[0] * moon[0] + n[1] * moon[1] + n[2] * moon[2]) / nl);
            const quad = [
                [c0[0], -8, c0[1], 0], [c1[0], -8, c1[1], 0], [c1[0], h1, c1[1], 1],
                [c0[0], -8, c0[1], 0], [c1[0], h1, c1[1], 1], [c0[0], h0, c0[1], 1],
            ];
            for (let k = 0; k < 6; k++) {
                position.push(quad[k][0], quad[k][1], quad[k][2]);
                lit.push(facing);
                height.push(quad[k][3]);
            }
        }
    };
    ridge(NAVE.lakeRadius + 60, 14, 170, 180, 0.3);
    ridge(NAVE.lakeRadius + 330, 40, 330, 150, 1.1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('aLit', new THREE.Float32BufferAttribute(lit, 1));
    geometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(height, 1));

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'IceTempleMountains';
    material.fog = false;
    material.colorNode = Fn(() => {
        const p = positionWorld;
        const facing = attribute('aLit', 'float');
        const v = attribute('aHeight', 'float');
        const n = u.noise(vec2(p.x.add(p.z).mul(0.004), p.y.mul(0.012))).toVar();
        // Snow lies where the slope lets it; rock shows through lower down.
        const snow = smoothstep(0.25, 0.6, v.add(n.r.mul(0.5)).sub(0.2));
        const rock = vec3(0.006, 0.012, 0.024);
        const light = u.moonColor.mul(u.ambient).mul(facing).mul(0.34)
            .add(u.skyHorizon.mul(u.ambient).mul(1.2))
            .add(u.auroraA.mul(u.auroraGain).mul(0.02));
        const col = mix(rock, light.mul(n.g.mul(0.5).add(0.7)), snow.mul(0.9).add(0.05));
        return itAtmosphere(u, col, p);
    })();
    return itPart('IceTempleMountains', geometry, material, 3, true);
}

/** Curtains: [start, end, height, wave(amp1, freq1, amp2, freq2), phase, speed, gain]. */
const CURTAINS = Object.freeze([
    [[-560, 96, -540], [560, 112, -430], 170, [64, 7.5, 30, 17], 0.3, 1.0, 1.0],
    [[-440, 68, -300], [400, 86, -390], 125, [52, 9.5, 24, 21], 2.1, 1.25, 0.9],
    [[-300, 118, -440], [170, 132, 170], 118, [46, 8.0, 20, 19], 4.4, 0.85, 0.8],
    [[330, 108, -400], [-130, 126, 190], 104, [40, 9.0, 18, 23], 1.2, 1.1, 0.72],
    [[-620, 150, -260], [620, 140, -640], 190, [80, 6.0, 34, 15], 5.6, 0.7, 0.6],
]);

const CURTAIN_SEGMENTS = 220;

/**
 * @param {object} u
 * @param {number} [count]  curtains (1..5)
 */
export function createAurora(u, count = 4) {
    const total = Math.max(1, Math.min(CURTAINS.length, count));
    const position = [];
    const uvs = [];
    const aStart = [];
    const aEnd = [];
    const aWave = [];
    const aMisc = [];
    const index = [];
    for (let c = 0; c < total; c++) {
        const [start, end, height, wave, phase, speed, gain] = CURTAINS[c];
        const first = position.length / 3;
        for (let i = 0; i <= CURTAIN_SEGMENTS; i++) {
            for (let j = 0; j < 2; j++) {
                position.push(0, 0, 0);
                uvs.push(i / CURTAIN_SEGMENTS, j);
                aStart.push(start[0], start[1], start[2]);
                aEnd.push(end[0], end[1], end[2]);
                aWave.push(wave[0], wave[1], wave[2], wave[3]);
                aMisc.push(height, phase, speed, gain);
            }
            if (i < CURTAIN_SEGMENTS) {
                const a = first + i * 2;
                index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aStart', new THREE.Float32BufferAttribute(aStart, 3));
    geometry.setAttribute('aEnd', new THREE.Float32BufferAttribute(aEnd, 3));
    geometry.setAttribute('aWave', new THREE.Float32BufferAttribute(aWave, 4));
    geometry.setAttribute('aMisc', new THREE.Float32BufferAttribute(aMisc, 4));

    const material = itFxMaterial('IceTempleAurora');
    const start = attribute('aStart', 'vec3');
    const end = attribute('aEnd', 'vec3');
    const wave = attribute('aWave', 'vec4');
    const misc = attribute('aMisc', 'vec4');
    const s = uv().x;
    const v = uv().y;
    const t = u.time.mul(misc.z);
    const along = end.sub(start);
    const across = normalize(cross(vec3(0.0, 1.0, 0.0), along));
    // The path meanders, and its meanders travel: the curtain folds and unfolds.
    const meander = sin(s.mul(wave.y).add(t.mul(0.09)).add(misc.y)).mul(wave.x)
        .add(sin(s.mul(wave.w).sub(t.mul(0.13)).add(misc.y.mul(2.3))).mul(wave.z))
        .add(sin(s.mul(wave.w.mul(2.7)).add(t.mul(0.21)).add(misc.y.mul(4.1))).mul(wave.z.mul(0.28)));
    const tall = misc.x.mul(sin(s.mul(11.0).add(misc.y.mul(3.0)).add(t.mul(0.05))).mul(0.18).add(0.9));
    material.positionNode = start.add(along.mul(s)).add(across.mul(meander)).add(vec3(0.0, 1.0, 0.0).mul(v.mul(tall)));

    const vS = varying(s, 'itAuroraS');
    const vV = varying(v, 'itAuroraV');
    const vMisc = varying(misc, 'itAuroraMisc');
    material.colorNode = Fn(() => {
        const flow = u.time.mul(vMisc.z).mul(0.011);
        const lanes = vMisc.y.mul(0.137);
        // Three scales of ray along the curtain: the knots, the rays, the hair-fine striations.
        const coarse = u.noise(vec2(vS.mul(4.2).add(flow), lanes)).r;
        const mid = u.noise(vec2(vS.mul(19.0).sub(flow.mul(2.2)), lanes.add(0.31))).g;
        const fine = u.noise(vec2(vS.mul(71.0).add(flow.mul(4.0)), lanes.add(0.67))).b;
        const ray = pow(itSaturate(coarse.mul(1.4).sub(0.22)), 1.6)
            .mul(mid.mul(0.9).add(0.3))
            .mul(fine.mul(0.9).add(0.55))
            .toVar();
        // The lower border is sharp, bright and ragged: every ray hangs to its own depth.
        const vv = vV.add(mid.sub(0.5).mul(0.05)).sub(0.012);
        const rise = smoothstep(0.0, 0.03, vv);
        // A ray that burns brighter also reaches higher; none reaches the ribbon's own top.
        const fall = exp(max(vv, 0.0).mul(mix(float(8.5), float(2.4), itSaturate(ray.mul(1.4)))).negate());
        const top = float(1.0).sub(smoothstep(0.5, 1.0, vV));
        // Curtains come and go along their length.
        const ends = smoothstep(0.0, 0.1, vS).mul(float(1.0).sub(smoothstep(0.9, 1.0, vS)));
        const swell = sin(vS.mul(6.0).add(u.time.mul(0.11)).add(vMisc.y)).mul(0.5).add(0.5);
        const body = mix(u.auroraA, u.auroraB, smoothstep(0.02, 0.3, vV));
        const colour = mix(body, u.auroraC, smoothstep(0.28, 0.85, vV).mul(0.6));
        const k = rise.mul(fall).mul(top).mul(ray.mul(2.3).add(0.09)).mul(ends)
            .mul(swell.mul(0.7).add(0.3))
            .mul(vMisc.w)
            .mul(u.auroraGain);
        return vec4(colour.mul(k).mul(0.72), 0.0);
    })();
    const part = itPart('IceTempleAurora', geometry, material, 5, true);
    part.count = total;
    return part;
}
