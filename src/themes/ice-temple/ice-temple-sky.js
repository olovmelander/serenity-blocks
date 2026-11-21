/**
 * Ice Temple — the polar night: the dome (stars, the moon and its ice halo), the mountains
 * round the lake, and the aurora.
 *
 * The aurora is geometry: each curtain is a ribbon standing in the sky along a meandering path
 * (the path is a function of the clock, so the curtain folds and unfolds), a hundred metres and
 * more tall, drawn additively. Its rays sample the baked noise along the path; a ray
 * that burns brighter also reaches higher. Seen from below the folds overlap and add, which is
 * what makes a real curtain's bright knots. Being geometry, the curtains stand upside down in the
 * ice floor's mirror for free.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    acos,
    attribute,
    cameraPosition,
    cameraViewMatrix,
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
    sqrt,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    MOON,
    NAVE,
    TAU,
    itAtmosphere,
    itFxMaterial,
    itMoonDir,
    itPart,
    itSaturate,
    itSky,
    mulberry32,
} from './ice-temple-tsl.js';

const DOME_RADIUS = 1900;

/** Weather has no state to catch up after a seek. Its cycles are independent of the palette. */
export function setPolarWeather(out, time) {
    const squall = Math.max(0, 0.6 * Math.sin(time * 0.041 - 1.3) + 0.4 * Math.sin(time * 0.099 - 0.8));
    const haze = (0.5 + 0.5 * Math.sin(time * 0.052 + 1.4)) ** 2 * (1 - squall * 0.65);
    const fold = 0.5 + 0.33 * Math.sin(time * 0.066 + 0.4) + 0.17 * Math.sin(time * 0.119 - 0.2);
    out.set(squall, haze, fold, 1 - 0.52 * haze - 0.35 * squall);
}

/** Round stars on a spherical lattice. Integrate their light when the buffer undersamples them. */
const starLayer = /* @__PURE__ */ Fn(([dir, scale, texel, time, keep]) => {
    const cell = floor(dir.mul(scale)).toVar();
    const p = fract(cell.add(256).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p.addAssign(dot(p, p.yxz.add(33.33)));
    const h = fract(p.xxy.add(p.yzz).mul(p.zyx)).toVar();
    const centre = normalize(cell.add(h.mul(0.52).add(0.24)));
    const d = length(dir.sub(centre));
    const bright = pow(h.z, 4.0).toVar();
    const radius = bright.mul(0.0009).add(0.00056);
    const width = max(radius, texel.mul(0.72));
    const off = d.div(width).toVar();
    const image = exp(off.mul(off).negate());
    const area = radius.div(width);
    const twinkle = sin(time.mul(h.x.mul(0.9).add(0.55)).add(h.y.mul(TAU))).mul(0.13).add(0.87);
    return vec2(image.mul(area.mul(area)).mul(bright.mul(2.1).add(0.16))
        .mul(twinkle).mul(step(keep, h.y)), h.x);
}).setLayout({
    name: 'it_starLayer',
    type: 'vec2',
    inputs: [
        { name: 'dir', type: 'vec3' }, { name: 'scale', type: 'float' }, { name: 'texel', type: 'float' },
        { name: 'time', type: 'float' }, { name: 'keep', type: 'float' },
    ],
});

/** The moon's angular radius (radians; about three and a half times the true moon, for the frame). */
const MOON_RADIUS = 0.029;

/** The dome: the night's gradient, stars, the moon with the halo ice crystals draw round it. */
export function createSky(u, starClouds = true) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    material.name = 'IceTempleSky';
    material.fog = false;
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const col = itSky(u, dir).toVar();

        // ── Stars ──
        const pixel = float(1).div(max(1, u.viewport.y.mul(u.projScale))).toVar();
        const band = dot(dir, vec3(0.46, 0.8, 0.384)).toVar();
        const belt = exp(band.mul(band).mul(-39)).toVar();
        const a = starLayer(dir, float(48), pixel, u.time, float(0.64));
        const b = starLayer(dir, float(115), pixel, u.time, float(0.93).sub(belt.mul(0.27)));
        const tintA = mix(vec3(0.65, 0.82, 1.0), vec3(1.0, 0.87, 0.72), a.y);
        const above = smoothstep(0.0, 0.14, dir.y).mul(u.ambient).mul(u.polarWeather.w).toVar();
        col.addAssign(tintA.mul(a.x).mul(2.5).add(vec3(0.79, 0.85, 1.0).mul(b.x).mul(0.6)).mul(above));
        if (starClouds) {
            const clouds = u.noise(vec2(dir.x.mul(0.64).sub(dir.z.mul(0.48)), band.mul(1.6))).toVar();
            const rift = band.sub(clouds.g.sub(0.5).mul(0.12));
            const mottling = smoothstep(0.29, 0.77, clouds.r);
            const dust = float(1).sub(exp(rift.mul(rift).mul(-1150)).mul(0.84));
            col.addAssign(vec3(0.055, 0.076, 0.13).mul(belt).mul(mottling).mul(dust)
                .mul(above));
        }

        // ── The moon ──
        const moonDir = itMoonDir();
        const m = dot(dir, moonDir);
        const ang = acos(clamp(m, -1.0, 1.0));
        // The disc is measured on the screen, not on the sky: near the corner of a wide lens a
        // round angle projects to an oval, and the moon stands near the corner.
        const vd = cameraViewMatrix.mul(vec4(dir, 0.0)).xyz;
        const vm = cameraViewMatrix.mul(vec4(moonDir, 0.0)).xyz;
        const sd = vd.xy.div(max(vd.z.negate(), 1e-3)).mul(u.projScale);
        const sm = vm.xy.div(max(vm.z.negate(), 1e-3)).mul(u.projScale);
        const R = u.projScale.mul(MOON_RADIUS);
        const q = sd.sub(sm).div(R).mul(step(0.0, vd.z.negate())).mul(step(0.0, vm.z.negate()))
            .add(vec2(9.0, 9.0).mul(float(1.0).sub(step(0.0, vd.z.negate()))))
            .toVar();
        const r = length(q).toVar();
        // A silver gibbous moon. Let the eye resolve the maria and a crater's lit southern rim.
        const aa = clamp(pixel.div(MOON_RADIUS), 0.015, 0.22);
        If(r.lessThan(1.22), () => {
            const disc = float(1).sub(smoothstep(float(1).sub(aa), float(1).add(aa), r));
            const z = sqrt(max(0, float(1).sub(r.mul(r))));
            const sun = max(0, dot(vec3(q, z), vec3(-0.36, 0.21, 0.91)));
            const rock = u.noise(q.mul(0.27).add(vec2(0.31, 0.57))).level(1).toVar();
            // Two connected basalt plains with highlands breaking through their shores.
            const coast = q.add(rock.rg.sub(0.5).mul(0.32));
            const north = length(coast.sub(vec2(-0.31, 0.31)).mul(vec2(1.7, 2.6)));
            const east = length(coast.sub(vec2(0.29, 0.10)).mul(vec2(2.35, 3.3)));
            const sea = float(1).sub(smoothstep(0.59, 1.03, north.min(east)));
            const crater = length(q.sub(vec2(-0.2, -0.37))).sub(0.14);
            const rim = float(1).sub(smoothstep(0.015, 0.075, crater.abs()));
            const face = float(1).sub(sea.mul(0.56)).add(rim.mul(0.19)).mul(rock.b.mul(0.22).add(0.86));
            const regolith = mix(vec3(0.67, 0.74, 0.88), vec3(1.0, 0.93, 0.79), sun);
            col.assign(mix(col, regolith.mul(face).mul(sun.mul(3.4).add(0.39)).mul(u.ambient), disc));
        });
        const rAng = r.mul(MOON_RADIUS);
        const glow = exp(rAng.mul(-22.0)).mul(0.23).add(exp(ang.mul(-5.5)).mul(0.043));
        // Diamond dust in the air: the 22° halo, faintly red on its inner edge.
        const ringD = ang.sub(0.384);
        const halo = exp(ringD.mul(ringD).mul(-3400.0)).mul(0.069)
            .add(exp(ringD.sub(0.02).mul(ringD.sub(0.02)).mul(-900.0)).mul(0.022));
        const haloTint = mix(vec3(1.0, 0.82, 0.74), vec3(0.8, 0.9, 1.0), smoothstep(-0.01, 0.02, ringD));
        const plateIce = u.polarWeather.y.mul(1.55).add(0.28);
        const moonDogs = exp(dir.y.sub(moonDir.y).abs().mul(-60)).mul(2.0).add(1.0);
        col.addAssign(u.moonColor.mul(u.ambient).mul(glow));
        col.addAssign(haloTint.mul(u.moonColor).mul(u.ambient).mul(halo).mul(plateIce)
            .mul(moonDogs));

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
    const moon = MOON.dir;
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
            // Serrations break up a peak's long, otherwise ruler-straight flank.
            const crest = Math.sin(119 * a + phase) * 0.042 + Math.sin(185 * a - phase * 2) * 0.028;
            return low + (high - low) * v * (0.96 + crest);
        };
        // The shoulder between crest and scree projects toward the lake. Its distance and
        // bearing wander, giving each peak a broken face down which snow can actually lie.
        const section = (a, h) => {
            const toe = radius * 0.89;
            const spur = a + 0.014 * Math.sin(a * 9 + phase);
            const shoulder = radius * (0.93 + 0.021 * Math.sin(17 * a + phase));
            return [
                [Math.sin(a) * toe, -8, -Math.cos(a) * toe, 0],
                [Math.sin(spur) * shoulder, h * (0.48 + 0.16 * Math.cos(a * 8)), -Math.cos(spur) * shoulder, 0.53],
                [Math.sin(a) * radius, h, -Math.cos(a) * radius, 1],
            ];
        };
        const face = (a, b, c) => {
            const ux = b[0] - a[0]; const uy = b[1] - a[1]; const
                uz = b[2] - a[2];
            const vx = c[0] - a[0]; const vy = c[1] - a[1]; const
                vz = c[2] - a[2];
            const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const
                nz = ux * vy - uy * vx;
            const magnitude = Math.hypot(nx, ny, nz) || 1;
            const facing = Math.max(0, (nx * moon[0] + ny * moon[1] + nz * moon[2]) / magnitude);
            for (const vertex of [a, b, c]) {
                position.push(vertex[0], vertex[1], vertex[2]);
                lit.push(facing);
                height.push(vertex[3]);
            }
        };
        const faces = segments * 3;
        let a = section(phase, at(phase));
        for (let i = 0; i < faces; i++) {
            const a1 = phase + ((i + 1) / faces) * TAU;
            const b = section(a1, at(a1));
            face(a[0], b[0], b[1]);
            face(a[0], b[1], a[1]);
            face(a[1], b[1], b[2]);
            face(a[1], b[2], a[2]);
            a = b;
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
        const n = u.noise(vec2(p.x.add(p.z).add(p.y.mul(0.44)).mul(0.011), p.y.mul(0.004))).toVar();
        const snowline = smoothstep(0.48, 0.73, v.add(n.r.mul(0.46)).add(facing.mul(0.2)));
        const gullies = smoothstep(0.28, 0.72, n.g).mul(0.77).add(0.23);
        const snow = snowline.mul(gullies);
        const rock = vec3(0.009, 0.015, 0.036).mul(u.ambient);
        const light = u.moonColor.mul(u.ambient).mul(facing.mul(0.37).add(v.mul(v).mul(0.075)))
            .add(u.skyHorizon.mul(u.ambient).mul(1.3))
            .add(u.auroraB.mul(u.auroraGain).mul(0.018));
        const col = mix(rock, light.mul(n.g.mul(0.48).add(0.64)), snow);
        return itAtmosphere(u, col, p);
    })();
    return itPart('IceTempleMountains', geometry, material, 3, true);
}

/** Curtains: [start, end, height, wave(amp1, freq1, amp2, freq2), phase, speed, gain]. */
const CURTAINS = Object.freeze([
    [[-560, 81, -540], [560, 171, -430], 202, [81, 7.5, 38, 17], 0.3, 1.0, 1.0],
    [[-440, 115, -300], [400, 54, -390], 151, [66, 9.5, 30, 21], 2.1, 1.25, 0.92],
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
    // The aurora keeps its own clock: it dances faster as play heats (the world sets it).
    const t = u.auroraClock.mul(misc.z);
    const along = end.sub(start);
    const across = normalize(cross(vec3(0.0, 1.0, 0.0), along));
    // The path meanders, and its meanders travel: the curtain folds and unfolds.
    const meander = sin(s.mul(wave.y).add(t.mul(0.09)).add(misc.y)).mul(wave.x)
        .add(sin(s.mul(wave.w).sub(t.mul(0.13)).add(misc.y.mul(2.3))).mul(wave.z))
        .add(sin(s.mul(wave.w.mul(2.7)).add(t.mul(0.21)).add(misc.y.mul(4.1))).mul(wave.z.mul(0.28)));
    const fold = u.polarWeather.z;
    const billow = sin(s.mul(10.5).add(misc.y).sub(t.mul(0.041)));
    const detail = sin(s.mul(22).add(misc.y.mul(2.85)).sub(t.mul(0.047)));
    const lift = sin(s.mul(5.8).sub(t.mul(0.034)).add(misc.y.mul(1.6))).mul(35.0)
        .add(billow.mul(fold.mul(28.0).add(15.0)))
        .add(detail.mul(fold.mul(20.0).add(11.0)));
    // Carry the hem back along its own path in each tight fold; from the lake the
    // near and far sides of a fold overlap in a bright knot, with open sky on either side.
    const pleat = detail.mul(fold.mul(0.041).add(0.043)).mul(s.mul(float(1).sub(s)).mul(4));
    const tall = misc.x.mul(sin(s.mul(11.0).add(misc.y.mul(3.0)).add(t.mul(0.05))).mul(0.24).add(0.86));
    // Field lines lean together while the foot of each curtain bends in a different direction.
    const slope = vec3(v.mul(tall).mul(-0.18), lift.add(v.mul(tall)), v.mul(tall).mul(0.13));
    const path = start.add(along.mul(s.add(pleat))).add(across.mul(meander.mul(fold.mul(0.55).add(0.68))));
    material.positionNode = path.add(slope);

    const vS = varying(s, 'itAuroraS');
    const vV = varying(v, 'itAuroraV');
    const vMisc = varying(misc, 'itAuroraMisc');
    material.colorNode = Fn(() => {
        const flow = u.auroraClock.mul(vMisc.z).mul(0.008).toVar();
        const lanes = vMisc.y.mul(0.137).toVar();
        const foldPeak = sin(vS.mul(16.5).add(vMisc.y.mul(1.4)).sub(flow.mul(4.8))).mul(0.5).add(0.5).toVar();
        const line = vS.add(vV.mul(vV).mul(foldPeak.sub(0.45)).mul(0.02)).toVar();
        // Three scales of ray along the curtain: the knots, the rays, the hair-fine striations.
        const coarse = u.noise(vec2(vS.mul(2.45).add(flow), lanes)).r.toVar();
        const mid = u.noise(vec2(line.mul(12.5).sub(flow.mul(1.65)), lanes.add(0.31))).g.toVar();
        const fine = total > 2
            ? u.noise(vec2(line.mul(49).add(flow.mul(2.3)), lanes.add(0.67))).b
            : mid;
        // (Rays with dark lanes between them: a curtain is drawn in light and dark, not a glow.)
        const ray = pow(itSaturate(coarse.mul(1.55).sub(0.3)), 1.8)
            .mul(mid.mul(1.0).add(0.22))
            .mul(fine.mul(0.9).add(0.55))
            .toVar();
        // The lower border is sharp, bright and ragged: every ray hangs to its own depth.
        const vv = vV.sub(0.055).sub(coarse.sub(0.5).mul(0.09)).sub(mid.sub(0.5).mul(0.029)).toVar();
        const rise = smoothstep(0.0, 0.025, vv);
        // A ray that burns brighter also reaches higher, far above the border, and none reaches
        // the ribbon's own top.
        const reach = itSaturate(ray.mul(1.5));
        const fall = exp(max(vv, 0.0).mul(mix(float(7.0), float(1.25), reach)).negate());
        const top = float(1.0).sub(smoothstep(0.55, 1.0, vV));
        // Curtains come and go along their length.
        const ends = smoothstep(0.0, 0.1, vS).mul(float(1.0).sub(smoothstep(0.9, 1.0, vS)));
        const swell = sin(vS.mul(6.0).add(u.auroraClock.mul(0.11)).add(vMisc.y)).mul(0.5).add(0.5);
        // Colour with height: the border's colour, the body's above it, and up the tall rays the
        // fringe's (green, then cyan, then violet on the first level).
        const body = mix(u.auroraA, u.auroraB, smoothstep(0.0, 0.27, vv).mul(0.75).add(0.16));
        const colour = mix(body, u.auroraC, smoothstep(0.16, 0.64, vv).mul(0.92)).toVar();
        // The hem: a thin line where the curtain is brightest, burning toward white in its knots.
        const hem = exp(max(vv, 0.0).mul(-70.0)).mul(rise).mul(ray.mul(1.3).add(0.2));
        colour.assign(mix(colour, vec3(0.86, 1.0, 0.94), itSaturate(hem.mul(ray).mul(1.2)).mul(0.45)));
        // Light runs along the border in waves.
        const run = sin(vS.mul(38.0).sub(u.auroraClock.mul(0.9).mul(vMisc.z.add(0.6))).add(vMisc.y.mul(5.0)))
            .mul(0.5)
            .add(0.5);
        const fan = foldPeak.mul(foldPeak).mul(u.polarWeather.z).toVar();
        const volume = ray.mul(fan.mul(2.3).add(1.75)).add(0.038);
        const border = hem.mul(run.mul(0.48).add(0.7)).mul(fan.add(0.63));
        const k = rise.mul(fall).mul(top).mul(volume).add(border)
            .mul(ends)
            .mul(swell.mul(0.7).add(0.3))
            .mul(smoothstep(0.06, 0.73, foldPeak).mul(0.64).add(0.36))
            .mul(vMisc.w)
            .mul(u.auroraGain);
        return vec4(colour.mul(k).mul(0.72), 0.0);
    })();
    const part = itPart('IceTempleAurora', geometry, material, 5, true);
    part.count = total;
    return part;
}
