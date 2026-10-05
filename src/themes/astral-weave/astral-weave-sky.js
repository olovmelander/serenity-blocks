/**
 * Astral Weave — the sky behind the loom. Two draws:
 *
 *  - The deep field: one full-screen triangle pair. A river of nebula crosses the frame on a
 *    diagonal (teal heart, indigo body, rose edges, dark dust lanes cut through it), built from
 *    four fetches of the baked fBm texture with one domain warp; two hashed star layers sit behind
 *    it (denser inside the river, dimmed where the cloud is thick). The loom lights it: a soft
 *    wash around the hoop's heart, and every clear sends a ring of light out through the gas.
 *  - The jewels: a few dozen instanced bright stars with diffraction spikes, authored for the
 *    side zones and the strips above and below the card.
 *
 * Everything is a function of the screen position (view units) plus a small parallax shift, so the
 * sky costs the same at any tilt of the loom and never swims against the card.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    positionGeometry,
    pow,
    screenUV,
    sin,
    smoothstep,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import {
    TAU, awFxMaterial, awHash21, awHash22, awQuadGeometry, mulberry32,
} from './astral-weave-tsl.js';

/** Per-tier sky budgets. */
export const SKY_TIERS = Object.freeze({
    Minimal: { fine: false, starLayers: 1, jewels: 10 },
    Low: { fine: false, starLayers: 1, jewels: 16 },
    Medium: { fine: true, starLayers: 2, jewels: 24 },
    High: { fine: true, starLayers: 2, jewels: 32 },
    Ultra: { fine: true, starLayers: 2, jewels: 40 },
    Extreme: { fine: true, starLayers: 2, jewels: 48 },
});

/** The river's axis (view units): it runs from the lower left to the upper right. */
const RIVER_ANGLE = 0.47;

/** One hashed star layer: `scale` cells per view height, stars a pixel or two across. */
function starLayer(p, scale, uPxView, uTime, density) {
    const g = p.mul(scale);
    const cell = floor(g);
    const h = awHash22(cell);
    const d = fract(g).sub(0.5).sub(h.sub(0.5).mul(0.56));
    const pick = awHash21(cell.add(vec2(17.3, 91.7)));
    const mag = pow(smoothstep(0.5, 1.0, pick), float(3.0)).mul(density);
    const r = uPxView.mul(scale).mul(mix(float(0.7), float(1.25), mag));
    const core = exp(dot(d, d).div(r.mul(r)).negate());
    const twinkle = sin(uTime.mul(h.x.mul(2.4).add(0.7)).add(h.y.mul(TAU))).mul(0.3).add(0.7);
    const tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.86, 0.72), smoothstep(0.55, 1.0, h.y));
    return tint.mul(core.mul(mag).mul(twinkle));
}

export function createSky(shared, quality = 'High') {
    const tier = SKY_TIERS[quality] || SKY_TIERS.High;
    const {
        uTime, uAspect, uViewport, uSkyShift, uLoom, uHeat, uEnergy, uShock, uCore, noiseTex,
    } = shared;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.name = 'astral-weave-deep-field';
    material.fog = false;
    material.vertexNode = vec4(positionGeometry.xy, 0.9995, 1.0);

    material.colorNode = Fn(() => {
        // View units: origin at the screen centre, y up, one unit = the view height.
        const view = vec2(screenUV.x.sub(0.5).mul(uAspect), float(0.5).sub(screenUV.y)).toVar();
        const p = view.add(uSkyShift).toVar();
        const uPxView = float(1.0).div(uViewport.y);

        // ── The river of nebula ──
        const along = vec2(Math.cos(RIVER_ANGLE), Math.sin(RIVER_ANGLE));
        const across = vec2(-Math.sin(RIVER_ANGLE), Math.cos(RIVER_ANGLE));
        const a = dot(p, along);
        const drift = vec2(uTime.mul(0.0031), uTime.mul(-0.0017));
        const warpN = texture(noiseTex, p.mul(0.31).add(drift.mul(0.6)).add(vec2(0.13, 0.71))).level(0);
        const q = p.add(warpN.xy.sub(0.5).mul(0.34)).toVar();
        const broad = texture(noiseTex, q.mul(0.52).add(drift).add(vec2(0.37, 0.19))).level(0).toVar();
        const detail = texture(noiseTex, q.mul(1.46).sub(drift.mul(1.7)).add(vec2(0.61, 0.05))).level(0).toVar();
        const c = dot(q, across).sub(sin(a.mul(2.3).add(0.5)).mul(0.11)).add(0.04);
        const width = broad.w.mul(0.2).add(0.27);
        const band = exp(c.mul(c).div(width.mul(width)).negate()).toVar();
        const density = broad.x.mul(0.58).add(detail.y.mul(0.42)).toVar();
        if (tier.fine) {
            const fine = texture(noiseTex, q.mul(3.9).add(drift.mul(2.3)).add(vec2(0.83, 0.47))).level(0);
            density.assign(density.mul(0.84).add(fine.z.mul(0.16)));
        }
        const cloud = smoothstep(0.4, 0.8, density.add(band.mul(0.3)).sub(0.08)).mul(band.mul(0.82).add(0.18)).toVar();
        // Filaments: the ridges of the detail octave, only where the river runs.
        const ridge = float(1.0).sub(abs(detail.x.mul(2.0).sub(1.0)));
        const filament = pow(ridge, float(5.0)).mul(band).mul(smoothstep(0.35, 0.7, broad.x));
        // Dust lanes cut the gas.
        const lane = smoothstep(0.52, 0.72, detail.w.mul(0.62).add(broad.z.mul(0.38))).mul(band);
        cloud.mulAssign(float(1.0).sub(lane.mul(0.78)));

        const hueT = broad.z.mul(0.62).add(a.mul(0.2)).add(detail.z.mul(0.2)).add(0.08);
        const teal = vec3(0.012, 0.21, 0.27);
        const indigo = vec3(0.07, 0.055, 0.33);
        const rose = vec3(0.36, 0.05, 0.2);
        const gas = mix(mix(teal, indigo, smoothstep(0.34, 0.56, hueT)), rose, smoothstep(0.56, 0.82, hueT)).toVar();
        // The combo temperature warms the gas a little; it never turns the sky to fire.
        gas.assign(mix(gas, vec3(0.42, 0.17, 0.06), uHeat.mul(0.3).mul(smoothstep(0.3, 0.9, density))));
        const sky = vec3(0.0035, 0.0055, 0.015).add(vec3(0.004, 0.006, 0.02).mul(band)).toVar();
        sky.addAssign(gas.mul(cloud).mul(0.5));
        sky.addAssign(mix(vec3(0.3, 0.62, 0.8), vec3(0.8, 0.42, 0.62), smoothstep(0.4, 0.8, hueT))
            .mul(filament).mul(0.2));
        sky.addAssign(vec3(0.55, 0.7, 0.9).mul(pow(cloud, float(3.0))).mul(0.1));

        // ── Stars ──
        const veil = float(1.0).sub(cloud.mul(0.55));
        const sp = view.add(uSkyShift.mul(0.6));
        const stars = starLayer(sp, float(44.0), uPxView, uTime, band.mul(1.1).add(0.5)).mul(0.9).toVar();
        if (tier.starLayers > 1) {
            stars.addAssign(starLayer(sp.add(vec2(3.7, 1.9)), float(15.0), uPxView, uTime, float(1.0)).mul(1.6));
        }
        sky.addAssign(stars.mul(veil).mul(uEnergy.mul(0.25).add(1.0)));

        // ── The loom's light in the gas ──
        const lp = view.sub(uLoom.xy);
        const lr = length(lp).div(max(uLoom.z, 1e-3));
        // The hoop is a lens of darker glass: the weave reads against it.
        sky.mulAssign(mix(float(0.52), float(1.0), smoothstep(0.86, 1.04, lr)));
        const glowTint = mix(vec3(0.3, 0.5, 0.95), vec3(1.0, 0.56, 0.2), uHeat);
        const wash = exp(lr.mul(-2.3)).mul(0.055).add(exp(lr.mul(lr).mul(-9.0)).mul(0.05));
        sky.addAssign(glowTint.mul(wash).mul(uCore).mul(cloud.mul(1.6).add(0.55)));
        // A clear's shock ring: a thin front of excited gas travelling out from the hoop's heart.
        const front = lr.sub(uShock.x);
        const ring = exp(front.mul(front).mul(-150.0)).mul(uShock.y);
        sky.addAssign(mix(gas.mul(2.4), glowTint, 0.4).mul(ring).mul(cloud.mul(1.5).add(0.08)).mul(0.75));

        return vec4(sky, 1.0);
    })();

    const field = new THREE.Mesh(geometry, material);
    field.name = 'astral-weave-deep-field';
    field.frustumCulled = false;
    field.renderOrder = -100;

    // ── The jewels ──
    const count = tier.jewels;
    const rand = mulberry32(2718);
    const place = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        // Authored for the free zones: reject the card column, lean toward the corners.
        let x = 0;
        let y = 0;
        for (let guard = 0; guard < 12; guard++) {
            x = rand() * 2 - 1;
            y = rand() * 2 - 1;
            if (Math.abs(x) > 0.2 || Math.abs(y) > 0.88) break;
        }
        place[i * 4] = x;
        place[i * 4 + 1] = y;
        place[i * 4 + 2] = i < 6 ? 0.75 + rand() * 0.25 : rand() ** 2.2 * 0.6 + 0.08;
        place[i * 4 + 3] = rand();
    }
    const jewelGeometry = awQuadGeometry(count, 1618, {
        aPlace: new THREE.InstancedBufferAttribute(place, 4),
    });
    const jewelMaterial = awFxMaterial('astral-weave-jewels');
    const seed = attribute('aSeed', 'vec4');
    const spot = attribute('aPlace', 'vec4');
    const sizePx = mix(float(9.0), float(46.0), spot.z).mul(uViewport.y.div(1080.0));
    // Clip-space placement (x spans the frame at any aspect), nudged by the parallax shift.
    const centre = spot.xy.add(uSkyShift.mul(vec2(float(2.0).div(uAspect), 2.0)).mul(1.4));
    const corner = centre.add(positionGeometry.xy.mul(sizePx).mul(2.0).div(uViewport));
    jewelMaterial.vertexNode = vec4(corner, 0.999, 1.0);
    jewelMaterial.colorNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const vSeed = vertexStage(seed);
        const vSpot = vertexStage(spot);
        const r = length(st);
        const core = exp(r.mul(r).mul(-60.0)).mul(5.0).add(exp(r.mul(-7.0)).mul(0.3));
        // Four-point diffraction: long thin arms, plus a short diagonal pair on the bright ones.
        const arm = (v) => exp(abs(v.y).mul(-70.0)).mul(exp(abs(v.x).mul(-4.6)));
        const d = vec2(st.x.add(st.y), st.x.sub(st.y)).mul(0.7071);
        const spikes = arm(st).add(arm(st.yx)).mul(0.9).add(arm(d).add(arm(d.yx)).mul(0.2).mul(vSpot.z));
        const tw = sin(uTime.mul(vSeed.x.mul(1.7).add(0.5)).add(vSeed.y.mul(TAU))).mul(0.22).add(0.78);
        const tint = mix(
            mix(vec3(0.62, 0.8, 1.0), vec3(1.0, 0.95, 0.9), smoothstep(0.3, 0.7, vSeed.z)),
            vec3(1.0, 0.72, 0.5),
            smoothstep(0.8, 1.0, vSeed.z),
        );
        const edge = float(1.0).sub(smoothstep(0.7, 1.0, r));
        const k = core.add(spikes).mul(edge).mul(tw).mul(vSpot.z.mul(0.9).add(0.25))
            .mul(uEnergy.mul(0.3).add(1.0));
        return vec4(tint.mul(k), 0.0);
    })();
    const jewels = new THREE.Mesh(jewelGeometry, jewelMaterial);
    jewels.name = 'astral-weave-jewels';
    jewels.frustumCulled = false;
    jewels.renderOrder = -90;

    return {
        field,
        jewels,
        tier,
        dispose() {
            geometry.dispose();
            material.dispose();
            jewelGeometry.dispose();
            jewelMaterial.dispose();
        },
    };
}

/** The river's unit axis in view units (for tests and for placing things along it). */
export const RIVER_AXIS = Object.freeze({ x: Math.cos(RIVER_ANGLE), y: Math.sin(RIVER_ANGLE) });
