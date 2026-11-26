/**
 * Astral Weave — the sky behind the loom. Two draws:
 *
 *  - The deep field: one full-screen triangle pair. A river of nebula crosses the frame on a
 *    diagonal. A foreground lane of molecular dust divides its two gas banks. Oblique filaments
 *    trace the illuminated walls and a slower, distant star field shows through the breaks.
 *    All three layers share a baked noise tile. High spends one additional read inside the gas
 *    to resolve the ridges around its dark knots.
 *    The gas is LIT: by the hoop's heart (its colour follows the weave's heat, so the iris turns
 *    the nebula gold) and by two hot stars embedded in the free zones. One more read of the broad
 *    octave, a little toward the light, tells which way each cloud faces: faces turned to the
 *    light take a bright rim, faces turned away fall into their own shadow. Every clear sends a
 *    ring of light out through the gas.
 *    The pass writes the gas density into ALPHA (opaque, NoBlending; every other part adds with
 *    alpha 0), so the post can let the weave's bloom scatter where there is gas to scatter it.
 *  - The jewels: a few dozen instanced bright stars with diffraction spikes, authored for the
 *    side zones and the strips above and below the card.
 *
 * Everything is a function of the screen position (view units) plus a small parallax shift, so the
 * sky costs the same at any tilt of the loom and never swims against the card.
 *
 * Its colours are the mood's (astral-weave-moods.js), turned by the clock: the gas, the dark
 * between the stars, the lamps, the heart's cool light, the filaments and the cloud sheen.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    attribute,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
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
    TAU, awFxMaterial, awHash21, awHash22, awMax3, awQuadGeometry, mulberry32,
} from './astral-weave-tsl.js';

/** Per-tier sky budgets. `relief` spends one more fetch on the clouds' lit faces and shadows. */
export const SKY_TIERS = Object.freeze({
    Minimal: {
        fine: false, relief: false, knots: false, starLayers: 1, jewels: 10,
    },
    Low: {
        fine: false, relief: false, knots: false, starLayers: 1, jewels: 16,
    },
    Medium: {
        fine: true, relief: true, knots: false, starLayers: 2, jewels: 24,
    },
    High: {
        fine: true, relief: true, knots: true, starLayers: 2, jewels: 32,
    },
    Ultra: {
        fine: true, relief: true, knots: true, starLayers: 2, jewels: 40,
    },
    Extreme: {
        fine: true, relief: true, knots: true, starLayers: 2, jewels: 48,
    },
});

/** The river's axis (view units): it runs from the lower left to the upper right. */
const RIVER_ANGLE = 0.47;

/**
 * The two hot stars embedded in the gas, in FRAME units (x: −1..1 across the frame, y: −1..1 up
 * it), one in each free corner the river crosses. Portrait frames move them into the strips above
 * and below the card. Brightness is their light in the gas; tint is the star's own colour in the
 * first mood (the mood sets it live: uLampA, uLampB).
 */
export const LAMPS = Object.freeze([
    {
        landscape: [-0.76, -0.62], portrait: [-0.5, -0.82], light: 0.95, tint: [0.55, 0.86, 1.0],
    },
    {
        landscape: [0.8, 0.6], portrait: [0.55, 0.84], light: 0.8, tint: [0.92, 0.78, 1.0],
    },
]);

/** The lamps in view units (origin at the screen centre, y up, one unit = the view height). */
export function lampPositions(aspect, out = [0, 0, 0, 0]) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const key = a < 1 ? 'portrait' : 'landscape';
    LAMPS.forEach((lamp, i) => {
        out[i * 2] = lamp[key][0] * a * 0.5;
        out[i * 2 + 1] = lamp[key][1] * 0.5;
    });
    return out;
}

/** A lamp's falloff radius in view units (its light halves here). */
const LAMP_REACH = 0.24;

/**
 * How much a clear's shock ring flares a lamp as it passes: 1 at rest. `lampX/Y` and the loom are
 * in view units, `shock` = (front radius in hoop radii, gain), as the world feeds the sky.
 */
export function lampFlare(lampX, lampY, loom, shockRadius, shockGain) {
    if (!(shockGain > 0)) return 1;
    const f = Math.hypot(lampX - loom.cx, lampY - loom.cy) / Math.max(loom.radius, 1e-3) - shockRadius;
    return 1 + Math.exp(-22 * f * f) * shockGain * 0.85;
}

/** One hashed star layer: `scale` cells per view height, stars a pixel or two across. */
function starLayer(p, scale, uPxView, uTime, density) {
    const g = p.mul(scale).add(256.0);
    const cell = floor(g).toVar();
    const h = awHash22(cell).toVar();
    const d = fract(g).sub(0.5).sub(h.sub(0.5).mul(0.56));
    const pick = awHash21(cell.add(vec2(17.0, 91.0)));
    const mag = pow(smoothstep(0.44, 1.0, pick), float(3.0)).toVar();
    const r = uPxView.mul(scale).mul(mix(float(0.52), float(1.05), mag));
    const core = exp(dot(d, d).div(r.mul(r)).negate());
    const twinkle = sin(uTime.mul(h.x.mul(0.9).add(0.3)).add(h.y.mul(TAU))).mul(0.17).add(0.83);
    const tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.86, 0.72), smoothstep(0.55, 1.0, h.y));
    return tint.mul(core.mul(mag).mul(twinkle).mul(density));
}

export function createSky(shared, quality = 'High') {
    const tier = SKY_TIERS[quality] || SKY_TIERS.High;
    const {
        uTime, uAspect, uViewport, uParallax, uLoom, uLamps, uLampFlare, uHeat, uEnergy, uShockR, uShockG,
        uCore, noiseTex, uMood,
    } = shared;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.name = 'astral-weave-deep-field';
    material.fog = false;
    // Write density directly to alpha. The output pass uses it as the gas scattering the loom's bloom.
    material.blending = THREE.NoBlending;
    material.vertexNode = vec4(positionGeometry.xy, 0.9995, 1.0);

    const [l1, l2] = LAMPS;
    const lampTint1 = uMood.lampA;
    const lampTint2 = uMood.lampB;

    material.fragmentNode = Fn(() => {
        // View units: origin at the screen centre, y up, one unit = the view height.
        const view = vec2(screenUV.x.sub(0.5).mul(uAspect), float(0.5).sub(screenUV.y)).toVar();
        const p = view.add(uParallax.mul(0.65)).toVar();
        const uPxView = float(1.0).div(uViewport.y);
        const pxScale = uViewport.y.div(1080.0);

        // ── The river of nebula ──
        // The same river runs between the two lamps on a tall screen.
        const landscape = smoothstep(0.63, 1.2, uAspect);
        const wideAxis = vec2(Math.cos(RIVER_ANGLE), Math.sin(RIVER_ANGLE));
        const along = normalize(mix(vec2(0.35, 0.937), wideAxis, landscape)).toVar();
        const across = vec2(along.y.negate(), along.x);
        const a = dot(p, along).toVar();
        const drift = vec2(uTime.mul(0.0013), uTime.mul(-0.00085));
        const tide = sin(uTime.mul(0.043)).toVar();
        const warpN = texture(noiseTex, p.mul(0.29).add(drift.mul(0.6)).add(vec2(0.13, 0.71))).level(0).toVar();
        const q = p.add(warpN.xy.sub(0.5).mul(0.29)).toVar();
        const broadAt = (at) => at.mul(0.52).add(drift).add(vec2(0.37, 0.19));
        const broad = texture(noiseTex, broadAt(q)).level(0).toVar();
        // The large arc stays in the frame for a long run. Its banks breathe about their axis
        // while the small features flow through them. Stretch the texture along the gas stream.
        const bend = sin(a.mul(4.1).add(0.68).add(tide.mul(0.5))).mul(0.092)
            .add(sin(a.mul(7.2).sub(tide.mul(0.34))).mul(0.025));
        const acrossGas = dot(q, across).sub(bend).toVar();
        const detailUv = vec2(a.mul(0.97), acrossGas.mul(2.8)).add(broad.xy.sub(0.5).mul(0.18));
        const detail = texture(noiseTex, detailUv.sub(drift.mul(1.7)).add(vec2(0.61, 0.05))).level(0).toVar();
        const width = broad.w.mul(0.09).add(0.168);
        const band = exp(acrossGas.mul(acrossGas).div(width.mul(width)).negate()).toVar();
        const grain = detail.y.mul(0.58).add(broad.x.mul(0.42)).toVar();
        let fineRidge = float(0.0);
        let fineBody = float(0.5);
        if (tier.fine) {
            const fineUv = vec2(a.mul(3.3), acrossGas.mul(6.4)).add(detail.xw.sub(0.5).mul(0.29));
            const fine = texture(noiseTex, fineUv.add(drift.mul(2.3)).add(vec2(0.83, 0.47))).level(0).toVar();
            fineRidge = pow(float(1.0).sub(abs(fine.x.mul(2.0).sub(1.0))), 8.0);
            fineBody = fine.y;
            grain.assign(grain.mul(0.82).add(fine.z.mul(0.18)));
        }
        // A sinuous foreground dust lane with a scalloped silhouette and asymmetrically lit
        // walls. Bright rims survive only on the dense flanks; light leaks into the breaks.
        const laneOffset = sin(a.mul(5.5).add(1.4).sub(tide.mul(0.52))).mul(0.052);
        const signedWall = acrossGas.sub(laneOffset).add(detail.w.sub(0.5).mul(0.059)).toVar();
        const laneWidth = broad.z.mul(0.06).add(0.009);
        const wall = abs(signedWall).sub(laneWidth).toVar();
        const lane = float(1.0).sub(smoothstep(-0.014, 0.019, wall))
            .mul(smoothstep(0.24, 0.61, broad.y.add(detail.z.mul(0.12)))).toVar();
        const edge = exp(abs(wall.sub(0.012)).mul(-58.0)).mul(smoothstep(0.32, 0.68, grain)).toVar();
        const cloud = smoothstep(0.33, 0.72, grain).mul(band)
            .mul(float(1.0).sub(lane.mul(0.94))).toVar();
        // Only the banks pay for their little globules. Stretch the high-frequency field much
        // less than the material flowing around it so dense knots interrupt the long ribbons.
        const knotLight = float(0.0).toVar();
        if (tier.knots) {
            If(cloud.greaterThan(0.055), () => {
                const knotUv = vec2(a.mul(7.3), acrossGas.mul(10.0)).add(detail.zw.sub(0.5).mul(0.55));
                const grainlet = texture(noiseTex, knotUv.sub(drift).add(vec2(0.23, 0.79))).level(0).toVar();
                const body = fineBody.mul(0.54).add(grainlet.y.mul(0.46)).toVar();
                const exposure = smoothstep(0.055, 0.32, cloud).toVar();
                const crest = exp(abs(body.sub(0.51)).mul(-28.0)).mul(smoothstep(0.33, 0.72, grainlet.w));
                knotLight.assign(crest.mul(exposure).mul(cloud));
                cloud.mulAssign(float(1.0).sub(smoothstep(0.48, 0.63, body).mul(exposure).mul(0.78)));
            });
        }
        const fibre = pow(float(1.0).sub(abs(detail.x.mul(2.0).sub(1.0))), 9.0);
        const filament = fibre.mul(0.48).add(fineRidge.mul(0.19)).mul(cloud)
            .add(edge.mul(0.67).mul(band))
            .toVar();
        const hueT = broad.z.mul(0.3).add(a.mul(0.41)).add(detail.z.mul(0.13)).add(fineBody.sub(0.5).mul(0.28))
            .add(signedWall.mul(0.47))
            .add(0.32)
            .toVar();
        // The mood's gas: heart, body and edges (teal, indigo and rose in the first mood).
        const { gasA, gasB, gasC } = uMood;
        const gas = mix(mix(gasA, gasB, smoothstep(0.34, 0.56, hueT)), gasC, smoothstep(0.56, 0.82, hueT)).toVar();
        // The combo temperature warms the gas a little; it never turns the sky to fire.
        gas.assign(mix(gas, vec3(0.42, 0.17, 0.06), uHeat.mul(0.3).mul(smoothstep(0.3, 0.9, grain))));

        // ── The lights in the gas: the hoop's heart and the two embedded stars ──
        const glowTint = mix(uMood.glow, vec3(1.0, 0.56, 0.2), uHeat).toVar();
        const toHeart = uLoom.xy.sub(view);
        const dHeart = max(length(toHeart), 1e-3);
        const lr = dHeart.div(max(uLoom.z, 1e-3)).toVar();
        // uCore rises with the weave's energy and heat: the heart's light follows it, capped so the
        // lit gas always stays darker than a hot weave (the iris must read against the sky).
        const iHeart = min(uCore, 0.95).mul(0.42).div(lr.mul(lr).mul(0.7).add(1.0)).toVar();
        // The lamps sit fixed in the frame (parallax only): the gas drifts past them.
        const lampAt1 = uLamps.xy.sub(uParallax);
        const lampAt2 = uLamps.zw.sub(uParallax);
        const toL1 = lampAt1.sub(view);
        const toL2 = lampAt2.sub(view);
        const d1 = max(length(toL1), 1e-3).toVar();
        const d2 = max(length(toL2), 1e-3).toVar();
        // uLampFlare: a clear's shock ring flares each lamp as it passes (the world sets it).
        const lampLight = (light, flare, d) => float(light).mul(flare)
            .div(d.mul(d).div(LAMP_REACH * LAMP_REACH).add(1.0));
        const i1 = lampLight(l1.light, uLampFlare.x, d1).toVar();
        const i2 = lampLight(l2.light, uLampFlare.y, d2).toVar();
        const lightSum = iHeart.add(i1).add(i2).toVar();
        const lightHue = glowTint.mul(iHeart).add(lampTint1.mul(i1)).add(lampTint2.mul(i2))
            .div(max(lightSum, 1e-4))
            .toVar();

        // Which way each cloud faces: the broad octave read again a little toward the light. Gas
        // that thins toward the light is its lit face; gas that thickens toward it is in shadow.
        let rim = float(0.3);
        let shade = float(0.0);
        if (tier.relief) {
            const dirL = normalize(toHeart.div(dHeart).mul(iHeart).add(toL1.div(d1).mul(i1)).add(toL2.div(d2).mul(i2))
                .add(vec2(1e-5, 2e-5)));
            const ahead = texture(noiseTex, broadAt(q.add(dirL.mul(0.045)))).level(0);
            const relief = broad.x.sub(ahead.x).toVar();
            rim = smoothstep(0.0, 0.06, relief);
            shade = smoothstep(0.0, 0.08, relief.negate());
        }

        const sky = uMood.space.add(uMood.band.mul(band.mul(0.8).add(broad.w.mul(0.12)))).toVar();
        // The gas's own glow, darker on the faces turned from the light.
        sky.addAssign(gas.mul(cloud).mul(0.4).mul(float(1.0).sub(shade.mul(0.45))));
        // Lit gas: its own hue, raised and drawn a little toward the light's colour, brightest on
        // the faces the light reaches. A hot weave's light colours what it lights: the iris and a
        // long chain warm the nebula round the loom toward gold.
        // Hues are scaled to the lit gas's own brightness, so warming it never whitens it, and the
        // warming takes the long way round (teal → rose → gold): teal and gold meet in grey-green.
        const ownGas = gas.mul(2.8).toVar();
        const own = awMax3(ownGas).toVar();
        const towardLight = lightHue.mul(own.div(max(awMax3(lightHue), 1e-3))).toVar();
        const warmed = ownGas.toVar();
        If(uHeat.greaterThan(0.002), () => {
            const heartShare = iHeart.div(max(lightSum, 1e-4));
            const warmth = uHeat.mul(smoothstep(0.08, 0.5, heartShare)).toVar();
            // Toward a deep amber, not the weave's own gold: the gold threads stay the brightest.
            // Chains warm it to rose; only the iris and the longest chains carry it on to amber.
            warmed.assign(mix(
                mix(ownGas, vec3(1.0, 0.16, 0.5).mul(own), smoothstep(0.0, 0.45, warmth)),
                vec3(1.0, 0.38, 0.1).mul(own),
                smoothstep(0.62, 0.95, warmth),
            ));
        });
        const litGas = mix(warmed, towardLight, float(0.16).mul(float(1.0).sub(uHeat.mul(0.6))));
        sky.addAssign(litGas.mul(lightSum).mul(cloud).mul(rim.mul(1.65).add(0.25))
            .mul(float(1.0).sub(shade.mul(0.65))));
        sky.addAssign(mix(uMood.filamentA, uMood.filamentB, smoothstep(0.4, 0.8, hueT))
            .mul(filament).mul(lightSum.mul(0.46).add(0.09)));
        if (tier.knots) {
            const rimTint = mix(uMood.highlight, uMood.lampB, 0.24);
            sky.addAssign(rimTint.mul(knotLight).mul(lightSum.mul(0.36).add(0.15)));
        }
        sky.addAssign(uMood.highlight.mul(pow(cloud, float(3.0))).mul(0.08));

        // ── Stars ──
        const veil = float(1.0).sub(cloud.mul(0.47)).sub(lane.mul(0.88));
        const sp = view.add(uParallax.mul(0.22));
        const nursery = smoothstep(0.36, 0.7, broad.y).mul(band).toVar();
        const stars = starLayer(sp, float(58.0), uPxView, uTime, nursery.mul(1.48).add(0.27)).toVar();
        if (tier.starLayers > 1) {
            stars.addAssign(starLayer(
                view.add(uParallax.mul(0.57)).add(vec2(3.7, 1.9)),
                float(19.0),
                uPxView,
                uTime,
                float(1.12),
            ));
        }
        sky.addAssign(stars.mul(max(veil, 0.0)).mul(uEnergy.mul(0.25).add(1.0)).mul(uMood.stars));

        // ── The lamps themselves: hot stars in a haze of their own light ──
        const lampStar = (toL, d, tint, gain) => {
            // Its own glow in the thin dust round it, even where there is no gas to light.
            sky.addAssign(tint.mul(exp(d.mul(-7.0)).mul(0.035).add(exp(d.mul(d).mul(-140.0)).mul(0.07))).mul(gain));
            // The star and its spikes, only near it (a coherent branch: almost no pixel pays).
            If(d.lessThan(uPxView.mul(pxScale).mul(110.0)), () => {
                const v = toL.div(uPxView).div(pxScale); // pixels at 1080p
                const r2 = dot(v, v);
                const arm = (w) => exp(abs(w.y).mul(-0.9)).mul(exp(abs(w.x).mul(-0.045)));
                const star = exp(r2.mul(-0.1)).mul(10.0).add(exp(r2.mul(-0.01)).mul(1.1))
                    .add(arm(v).add(arm(v.yx)).mul(0.6));
                sky.addAssign(tint.mul(star).mul(gain));
            });
        };
        lampStar(toL1, d1, lampTint1, uLampFlare.x.mul(l1.light));
        lampStar(toL2, d2, lampTint2, uLampFlare.y.mul(l2.light));

        // ── The loom's light in the gas ──
        // The hoop is a lens of darker glass: the weave reads against it.
        sky.mulAssign(mix(float(0.28), float(1.0), smoothstep(0.32, 1.1, lr)));
        const wash = exp(lr.mul(-2.3)).mul(0.04).add(exp(lr.mul(lr).mul(-9.0)).mul(0.04));
        sky.addAssign(glowTint.mul(wash).mul(uCore).mul(cloud.mul(1.4).add(0.45)));
        // The clears' shock rings: thin fronts of excited gas travelling out from the hoop's heart,
        // up to four at once (a chain sends them out nested, a cascade's deeper waves faster).
        const front = vec4(lr).sub(uShockR);
        const ring = dot(exp(front.mul(front).mul(-150.0)), uShockG);
        const ringTint = mix(gas.mul(2.4), glowTint, 0.4);
        sky.addAssign(ringTint.mul(ring.mul(shared.uShockLight)).mul(cloud.mul(1.5).add(0.08)).mul(0.75));

        // Alpha carries the gas (and a breath of interstellar haze) for the post's scattering.
        return vec4(sky, clamp(cloud.mul(0.9).add(band.mul(0.1)), 0.0, 1.0));
    })();

    const field = new THREE.Mesh(geometry, material);
    field.name = 'astral-weave-deep-field';
    field.frustumCulled = false;
    field.renderOrder = -100;

    // ── The jewels ──
    const count = tier.jewels;
    const rand = mulberry32(2718);
    const place = new Float32Array(count * 4);
    // Two sparse open clusters anchor the dark diagonals across from the embedded lamps.
    // Their close doubles give the eye a scale between the isolated giants and the dust.
    const clusters = [
        [-0.67, 0.41], [-0.71, 0.46], [-0.645, 0.425], [-0.59, 0.5], [-0.76, 0.39],
        [0.64, -0.43], [0.68, -0.4], [0.72, -0.52], [0.62, -0.5],
    ];
    for (let i = 0; i < count; i++) {
        // Authored for the free zones: reject the card column, lean toward the corners.
        let x = 0;
        let y = 0;
        for (let guard = 0; guard < 12; guard++) {
            x = rand() * 2 - 1;
            y = rand() * 2 - 1;
            if (Math.abs(x) > 0.2 || Math.abs(y) > 0.88) break;
        }
        place[i * 4] = clusters[i]?.[0] ?? x;
        place[i * 4 + 1] = clusters[i]?.[1] ?? y;
        place[i * 4 + 2] = i === 0 || i === 5 ? 0.92 : rand() ** 2.2 * 0.72 + 0.12;
        place[i * 4 + 3] = rand();
    }
    const jewelGeometry = awQuadGeometry(count, 1618, {
        aPlace: new THREE.InstancedBufferAttribute(place, 4),
    });
    const jewelMaterial = awFxMaterial('astral-weave-jewels');
    const seed = attribute('aSeed', 'vec4');
    const spot = attribute('aPlace', 'vec4');
    const sizePx = mix(float(8.0), float(52.0), spot.z).mul(uViewport.y.div(1080.0));
    // Clip-space placement (x spans the frame at any aspect), nudged by the camera's parallax only:
    // the sky's slow time drift would carry these authored stars off the frame in a long session.
    const centre = spot.xy.sub(uParallax.mul(vec2(float(2.0).div(uAspect), 2.0)).mul(0.9));
    const corner = centre.add(positionGeometry.xy.mul(sizePx).mul(2.0).div(uViewport));
    jewelMaterial.vertexNode = vec4(corner, 0.999, 1.0);
    jewelMaterial.colorNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const vSeed = vertexStage(seed);
        const vSpot = vertexStage(spot);
        const r = length(st);
        const core = exp(r.mul(r).mul(-88.0)).mul(5.0).add(exp(r.mul(-8.5)).mul(0.23));
        // Four-point diffraction: long thin arms, plus a short diagonal pair on the bright ones.
        const arm = (v) => exp(abs(v.y).mul(-70.0)).mul(exp(abs(v.x).mul(-4.6)));
        const d = vec2(st.x.add(st.y), st.x.sub(st.y)).mul(0.7071);
        const spikes = arm(st).add(arm(st.yx)).mul(0.9).add(arm(d).add(arm(d.yx)).mul(0.2).mul(vSpot.z));
        const tw = sin(uTime.mul(vSeed.x.mul(1.5).add(0.3)).add(vSeed.y.mul(TAU))).mul(0.15).add(0.85);
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

/** The river's landscape axis in view units. Portrait bends the river up toward its lamps. */
export const RIVER_AXIS = Object.freeze({ x: Math.cos(RIVER_ANGLE), y: Math.sin(RIVER_ANGLE) });
