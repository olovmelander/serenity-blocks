/** Shared linear-light node helpers. Texture/uniform readers are inline builders, never laid out. */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, int, abs, clamp, dot, exp, float, floor, fract, fwidth, length, max, min, mix, mod,
    normalize, screenUV, select, sin, smoothstep, texture, uniform, uniformArray, vec2, vec3,
} from 'three/tsl';
import {
    EVENT_ROWS, RECORD_WIDTH, RECORD_ROWS, DEG, PALETTE, hexToLinear, sunAt,
} from './painted-ages-core.js';

export * from './painted-ages-core.js';

export const paHash21 = Fn(([p]) => {
    const v = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
    v.addAssign(dot(v, v.yzx.add(33.33)));
    return fract(v.x.add(v.y).mul(v.z));
}).setLayout({ name: 'pa_hash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const paLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const paMax3 = (c) => max(c.r, max(c.g, c.b));
export const smoothTri = Fn(([p]) => {
    const t = abs(fract(p).sub(0.5)).mul(2);
    return t.mul(t).mul(float(3).sub(t.mul(2)));
}).setLayout({ name: 'pa_smoothTri', type: 'float', inputs: [{ name: 'p', type: 'float' }] });

export function createPaintedAgesUniforms() {
    const sun = sunAt(0);
    const rows = Array.from({ length: EVENT_ROWS.total }, () => new THREE.Vector4());
    return {
        time: uniform(0),
        ambientTime: uniform(0),
        aspect: uniform(16 / 9),
        resolution: uniform(new THREE.Vector2(1920, 1080)),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        eye: uniform(new THREE.Vector3(0, 140, 200)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camForward: uniform(new THREE.Vector3(0, -0.122, -0.992)),
        tanHalfFov: uniform(Math.tan(21 * DEG)),
        pixelAngle: uniform(0.001),
        sunDir: uniform(new THREE.Vector3(sun.x, sun.y, sun.z)),
        sunElevation: uniform(sun.elevation),
        sunAzimuth: uniform(sun.azimuth),
        wetGlobal: uniform(0),
        wetAge: uniform(0),
        wetOverride: uniform(-1),
        wetZones: uniform(0),
        curtainEdge: uniform(0),
        releasePeak: uniform(0),
        bow: uniform(0),
        perfect: uniform(0),
        perfectAge: uniform(1000),
        gameOver: uniform(0),
        recordHead: uniform(RECORD_ROWS - 1),
        datum: uniform(0),
        fold: uniform(0),
        tilt: uniform(0),
        tiltPrevious: uniform(0),
        tiltBlend: uniform(1),
        formation: uniform(0),
        reducedMotion: uniform(0),
        depositAge: uniform(1000),
        depositStep: uniform(0),
        depositBlend: uniform(0),
        flood: uniform(0),
        tuff: uniform(0),
        view: uniform(0, 'int'),
        boardCalm: uniform(new THREE.Vector4(0, 0, 0, 0)),
        boardLive: uniform(0),
        eventRows: rows,
        events: uniformArray(rows, 'vec4'),
        fanCount: uniform(0, 'int'),
        calmCount: uniform(0, 'int'),
        runCount: uniform(0, 'int'),
        bedCount: uniform(0, 'int'),
        hoodooCount: uniform(0, 'int'),
    };
}

export function createRecordTexture(record) {
    const tex = new THREE.DataTexture(record.data, RECORD_WIDTH, RECORD_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = 'painted-ages-strata-record';
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

/** A ray in the actual scene lens, also valid in a full-screen material. */
export function paViewRay(u) {
    const q = screenUV.mul(2).sub(1);
    return normalize(u.camForward.add(u.camRight.mul(q.x.mul(u.aspect).mul(u.tanHalfFov)))
        .sub(u.camUp.mul(q.y.mul(u.tanHalfFov))));
}

/** Distance orders rain from the Chevron Face toward the player; no lens-space rain. */
export function paWet(u, P, sunlit = float(0.5)) {
    const distance = max(P.z.negate(), 0);
    // Count the real rank distances, rather than seven equal slices of a ten-km view.
    const zone = float(7).sub(smoothstep(350, 800, distance)).sub(smoothstep(800, 1500, distance))
        .sub(smoothstep(1500, 2500, distance))
        .sub(smoothstep(2500, 4000, distance))
        .sub(smoothstep(4000, 6000, distance))
        .sub(smoothstep(6000, 10000, distance));
    const rainfall = smoothstep(zone.sub(0.8), zone, u.wetZones).mul(0.8);
    // The CPU's representative wetness decays at 52 seconds; undo only that decay and
    // replace it with the local surface's exact 35-second sun / 70-second shadow response.
    // Bound old ages before the correction, including an idle world's sentinel event time.
    const tau = mix(float(70), float(35), clamp(sunlit, 0, 1));
    const correction = exp(clamp(u.wetAge, 0, 240).mul(float(1 / 52).sub(float(1).div(tau))));
    const drying = u.wetGlobal.mul(correction);
    const wet = clamp(max(drying, rainfall), 0, 1).toVar();
    return select(u.wetOverride.greaterThanEqual(0), clamp(u.wetOverride, 0, 1), wet);
}

export function paSkyColour(u, direction) {
    const altitude = smoothstep(0, 0.175, max(direction.y, 0));
    const sky = mix(vec3(0.64, 0.79, 0.83), vec3(0.025, 0.095, 0.485), altitude);
    return mix(sky, vec3(0.16, 0.18, 0.29), u.gameOver.mul(0.6));
}

/** Bounded aerial perspective; wet ranks gain reach as rain removes dust from the air. */
export function paHaze(u, P, rgb, surfaceWet = null) {
    const distance = length(P.sub(u.eye));
    const wet = surfaceWet || paWet(u, P);
    // Clear upper air preserves the far face's mineral contrast. The denser dust belongs
    // to the low washes, with a cool path tint rather than a uniform white overlay.
    const highAir = smoothstep(60, 1500, P.y);
    const density = mix(float(1.16), float(0.62), highAir);
    const aerial = float(1).sub(exp(distance.mul(density).mul(mix(-0.000033, -0.00002, wet))));
    const valley = exp(max(P.y.add(20), 0).div(-85)).mul(0.1)
        .mul(smoothstep(600, 2200, distance)).mul(float(1).sub(wet.mul(0.65)));
    const airColour = mix(vec3(0.36, 0.4, 0.46), vec3(0.25, 0.39, 0.59), highAir);
    const distant = mix(rgb, airColour, clamp(aerial, 0, 0.4));
    return mix(distant, vec3(0.46, 0.36, 0.27), clamp(valley, 0, 0.1));
}

/**
 * Geological datum intersects the baked gullies: real rule-of-Vs, never painted screen bands.
 * The record's tiny nearest-filtered texture is analytically filtered toward per-bed means.
 */
export function strataAt(P, u, recordTexture, surfaceWet = null) {
    const far = smoothstep(3000, 7000, P.z.negate());
    const near = float(1).sub(smoothstep(1500, 2600, P.z.negate()));
    const wave = sin(P.x.mul(0.008).add(P.z.mul(0.0027))).mul(8)
        .add(sin(P.z.mul(0.015).add(P.x.mul(0.009))).mul(2.4));
    const folds = smoothTri(P.x.add(P.z.mul(0.5)).div(220)).sub(0.5).mul(u.fold).mul(7)
        .mul(near);
    // Match the bake's 35-degree strike: one resistant bed follows the long dip face,
    // while the steep scarp cuts through its neighboring contacts.
    const across = P.x.mul(0.819152).sub(P.z.mul(0.573576));
    const bedDip = mix(float(0.18), float(0.27), smoothstep(300, 3200, P.z.negate()));
    const dip = mix(across.mul(bedDip).negate(), P.z.mul(0.13).add(P.x.mul(0.055)), far);
    // Older formations retain their discontinuous tilt as the youngest record moves down-dip.
    const formationDepth = floor(max(P.z.negate(), 0).div(1600));
    const angular = P.x.mul(sin(u.tilt.mul(DEG).add(formationDepth.mul(0.04)))).mul(0.14);
    const chevronPhase = P.x.div(2100).add(sin(P.x.mul(0.00055)).mul(0.12));
    const chevron = float(1).sub(abs(fract(chevronPhase).mul(2).sub(1))).mul(130).mul(far);
    const geological = P.y.add(dip).add(wave).add(folds).sub(chevron);
    // The far face exposes one old package across neighboring flatirons. Advancing the
    // row by camera distance there painted a new stripe on every contour of every gully.
    const rank = max(floor(across.add(280).div(820)), 0);
    const archive = mix(rank.mul(18), float(180), far);
    const frontPhase = mix(mix(6.8, 8.8, smoothstep(-100, 100, P.x)), float(8), far);
    const bedAtAngle = (angle) => {
        const base = geological.add(angle).div(mix(28, 150, far));
        const variable = base.add(sin(base.mul(0.51)).mul(1.3)).add(sin(base.mul(0.157)).mul(1.1));
        return max(variable.negate().add(frontPhase).add(archive), 0);
    };
    const move = paKeepOut(u);
    const baseK = bedAtAngle(angular);
    const slide = near.mul(float(1).sub(u.reducedMotion)).mul(move);
    const k = baseK.add(u.datum.mul(slide));
    const footprint = max(fwidth(baseK), 0.0001).toVar();
    const wet = surfaceWet || paWet(u, P);
    // Texture readers stay inline. Only the narrow middle lamina carries a player's strongest
    // pigment: thick mineral body beds remain dominant, and distant rows average analytically.
    const readBed = (bedK) => {
        const row = mod(u.recordHead.sub(floor(bedK)).add(RECORD_ROWS * 10), RECORD_ROWS);
        const v = row.add(0.5).div(RECORD_ROWS);
        const phase = fract(bedK);
        const lamina = min(floor(clamp(phase.sub(0.12).div(0.32), 0, 0.999).mul(10)), 9);
        const raw = texture(recordTexture, vec2(lamina.add(0.5).div(RECORD_WIDTH), v)).level(0).rgb;
        const mean = texture(recordTexture, vec2(10.5 / RECORD_WIDTH, v)).level(0).rgb;
        const nextV = mod(row.sub(1).add(RECORD_ROWS), RECORD_ROWS).add(0.5).div(RECORD_ROWS);
        const nextMean = texture(recordTexture, vec2(10.5 / RECORD_WIDTH, nextV)).level(0).rgb;
        const rock = texture(recordTexture, vec2(13.5 / RECORD_WIDTH, v)).level(0).rgb;
        const parting = texture(recordTexture, vec2(11.5 / RECORD_WIDTH, v)).level(0).rgb;
        const metadata = texture(recordTexture, vec2(12.5 / RECORD_WIDTH, v)).level(0).rgb;
        const recorded = smoothstep(0.88, 0.98, metadata.b);
        const cellAA = smoothstep(0.025, 0.12, footprint);
        const cells = mix(raw, mean, max(cellAA, far.mul(0.8)));
        const body = mix(rock, mean, mix(0.32, 0.6, wet));
        const pigmentBand = smoothstep(0.12, 0.17, phase)
            .mul(float(1).sub(smoothstep(0.38, 0.44, phase)))
            .mul(float(1).sub(smoothstep(0.12, 0.45, footprint)));
        const recordedBed = mix(body, cells, pigmentBand.mul(mix(0.64, 0.78, wet)));
        const cream = smoothstep(0.91, 0.96, phase)
            .mul(float(1).sub(smoothstep(0.02, 0.09, footprint))).mul(0.58);
        const beds = mix(mix(cells, recordedBed, recorded), parting, cream);
        const meanBed = mix(mean, mix(body, mean, 0.18), recorded);
        const nextMineral = mix(nextMean, mix(rock, nextMean, mix(0.32, 0.6, wet)), recorded);
        const filtered = mix(beds, mix(meanBed, nextMineral, 0.5), smoothstep(0.4, 1.5, footprint));
        // Related beds share a broad mineral family. Only the untouched geological
        // substrate receives this cast; the player's ten recorded pigments keep their hue.
        const packagePhase = smoothTri(bedK.mul(0.105).add(metadata.g.mul(0.41)));
        const iron = mix(
            vec3(...hexToLinear(PALETTE.vermilion)),
            vec3(...hexToLinear(PALETTE.apricot)),
            smoothstep(0.08, 0.38, packagePhase),
        );
        const pale = mix(
            vec3(...hexToLinear(PALETTE.sage)),
            vec3(...hexToLinear(PALETTE.cream)),
            smoothstep(0.65, 0.92, packagePhase),
        );
        const packageColour = mix(iron, pale, smoothstep(0.4, 0.62, packagePhase));
        const substrate = mix(filtered, packageColour, float(1).sub(recorded).mul(mix(0.3, 0.46, far)));
        // Dry dust softens a pigment without replacing it with the formation's pale cast.
        // Broad, fixed weathering patches break up equal-colour beds across different hills.
        const weathering = sin(P.x.mul(0.0047).add(P.z.mul(0.0029)))
            .mul(sin(P.z.mul(0.0013).sub(P.x.mul(0.0021)))).mul(0.5).add(0.5);
        const dryCast = mix(float(0.12), float(0.21), weathering).mul(float(1).sub(wet));
        const mineralTint = mix(vec3(0.9, 0.95, 1.015), vec3(1.075, 1.01, 0.9), weathering);
        return mix(substrate, rock, dryCast).mul(mix(vec3(1), mineralTint, float(1).sub(wet).mul(0.75)));
    };
    const mineral = readBed(k).toVar();
    const crossfade = max(float(1).sub(near), u.reducedMotion).mul(move).toVar();
    If(u.depositBlend.greaterThan(0.0001).and(crossfade.greaterThan(0.0001)), () => {
        const pending = max(u.depositBlend, 0).toVar();
        const oldK = baseK.add(floor(pending));
        const previous = mix(readBed(oldK), readBed(oldK.add(1)), fract(pending));
        mineral.assign(mix(mineral, previous, crossfade));
    });
    // Reduced motion changes the static angle at once, then dissolves the old strata.
    // It never sweeps the geological coordinates through the intervening angles.
    If(u.reducedMotion.greaterThan(0.5).and(u.tiltBlend.lessThan(0.9999)), () => {
        const oldAngle = P.x.mul(sin(u.tiltPrevious.mul(DEG).add(formationDepth.mul(0.04)))).mul(0.14);
        const oldK = bedAtAngle(oldAngle);
        const previous = readBed(oldK).toVar();
        If(u.depositBlend.greaterThan(0.0001).and(crossfade.greaterThan(0.0001)), () => {
            const pending = max(u.depositBlend, 0).toVar();
            const pendingK = oldK.add(floor(pending));
            const beforeDeposit = mix(readBed(pendingK), readBed(pendingK.add(1)), fract(pending));
            previous.assign(mix(previous, beforeDeposit, crossfade));
        });
        mineral.assign(mix(previous, mineral, u.tiltBlend));
    });
    const saturation = mix(0.9, 1.1, wet);
    return max(mix(vec3(paLuma(mineral)), mineral, saturation).mul(mix(1, 0.66, wet)), vec3(0));
}

/** Premultiplied over; purely emissive pixels can return alpha zero. */
export function paFxMaterial(name) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    material.name = name;
    return material;
}

export function paPart(mesh, geometry = mesh.geometry, material = mesh.material) {
    return {
        mesh, geometry, material, dispose() { geometry.dispose(); material.dispose(); },
    };
}

/** One packed table protects every live card and HUD. One means the world is visible. */
export function paKeepOut(u) {
    const cover = float(0).toVar();
    Loop({
        start: int(0), end: u.calmCount, type: 'int', condition: '<', name: 'paCard',
    }, ({ paCard }) => {
        const rect = u.events.element(paCard.add(int(EVENT_ROWS.calm)));
        const x = smoothstep(rect.x.sub(0.008), rect.x, screenUV.x)
            .mul(float(1).sub(smoothstep(rect.z, rect.z.add(0.008), screenUV.x)));
        const y = smoothstep(rect.y.sub(0.008), rect.y, screenUV.y)
            .mul(float(1).sub(smoothstep(rect.w, rect.w.add(0.008), screenUV.y)));
        cover.assign(max(cover, x.mul(y)));
    });
    return float(1).sub(cover);
}
