/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — the sea.
 *
 * One fan of rings round the eye's foot, out to the horizon. The swell (SWELL in sunset-core.js)
 * moves it in the vertex stage as Gerstner waves, each train fading out where the mesh is too
 * coarse to carry it. The fragment rebuilds the slope from the same trains plus up to three
 * layers of ripples read from the water's noise, and keeps count of the slope it can no longer
 * resolve (the variance), because that is what draws the roads of light: the sun's (and the
 * moon's) image is the share of facets that mirror it, a few sharp sparks near the eye that
 * widen into a broad shimmering road toward the horizon.
 *
 * What it mirrors is the sky function itself (skyColour, along the mirror ray), with fewer
 * layers; the lanterns are mirrored by the same facet statistics as the sun, so each one stands
 * on a streak of its own light. A ring runs out from where a lantern is set down.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, atan, cameraPosition, clamp, cos, dot, exp, float, floor, int, length, log, max, min, mix,
    normalize, positionGeometry, positionWorld, sin, smoothstep, step, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    CHOP_ROWS, SEA_FAN, SEA_TIME, SWELL_CHOP, SWELL_ROWS, ringRadius, seaRingGap,
} from './sunset-core.js';
import {
    TUNE, glintLobe, hash22, horizonHaze, skyColour,
} from './sunset-tsl.js';

/**
 * A wave of light on the water (a clear): how far its front has run from where it began, `age`
 * seconds on. It gathers speed as it goes, so on screen it crosses the near sea and the far sea
 * at about the same pace and is at the horizon in four seconds.
 */
export const WAVE_LIFE = 4.6;
export function waveReach(age) {
    const s = Math.min(WAVE_LIFE, Math.max(0, age));
    return 5 * (Math.exp(s * 1.25) - 1) + s * 3;
}
/** A whirl of light (a twist) turns where it began for this long. */
export const WHIRL_LIFE = 5.5;

/** The fan of rings round the eye's foot (positions, a normal that faces up, the indices). */
export function buildSeaFan(rings, spokes) {
    const half = SEA_FAN.halfAngle * (Math.PI / 180);
    const positions = new Float32Array(rings * spokes * 3);
    for (let i = 0; i < rings; i += 1) {
        const r = ringRadius(i, rings);
        for (let j = 0; j < spokes; j += 1) {
            const a = -half + (2 * half * j) / (spokes - 1);
            const at = (i * spokes + j) * 3;
            positions[at] = r * Math.sin(a);
            positions[at + 1] = 0;
            positions[at + 2] = -r * Math.cos(a);
        }
    }
    const indices = new Uint32Array((rings - 1) * (spokes - 1) * 6);
    let k = 0;
    for (let i = 0; i < rings - 1; i += 1) {
        for (let j = 0; j < spokes - 1; j += 1) {
            const a = i * spokes + j;
            const b = a + spokes;
            // Wound so the face looks up (+y).
            indices[k++] = a;
            indices[k++] = a + 1;
            indices[k++] = b;
            indices[k++] = a + 1;
            indices[k++] = b + 1;
            indices[k++] = b;
        }
    }
    return { positions, indices };
}

export function createSea({
    tier, U, skyNoise, seaNoise, seaVariance, rows, skyline = null,
}) {
    const fan = buildSeaFan(tier.seaRings, tier.seaSpokes);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(fan.positions, 3));
    const normals = new Float32Array(fan.positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(fan.indices, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SEA_FAN.far);

    const ringGap = seaRingGap(tier.seaRings);
    const n = SWELL_ROWS.length;
    const qOf = (row) => SWELL_CHOP / (row[2] * row[4] * n);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide, fog: false });
    material.name = 'sunset-sea';

    // ── The swell, in the vertex stage (from the fan's rest position) ──
    const rest = positionGeometry.xz;
    const swell = (withShift) => {
        const t = U.time.mul(SEA_TIME);
        const spacing = length(rest).mul(ringGap);
        let lift = float(0.0);
        let shift = vec2(0.0);
        for (let i = 0; i < n; i += 1) {
            const row = SWELL_ROWS[i];
            const L = (2 * Math.PI) / row[2];
            const keep = float(1.0).sub(smoothstep(L * 0.18, L * 0.42, spacing));
            const theta = dot(rest, vec2(row[0], row[1])).mul(row[2]).sub(t.mul(row[3])).add(row[5]);
            lift = lift.add(sin(theta).mul(row[4]).mul(keep));
            if (withShift) shift = shift.add(vec2(row[0], row[1]).mul(cos(theta).mul(row[4] * qOf(row))).mul(keep));
        }
        return { lift, shift };
    };
    const vCrest = varying(swell(false).lift, 'sunsetSeaCrest');
    material.positionNode = Fn(() => {
        const { lift, shift } = swell(true);
        return vec3(rest.x.add(shift.x), lift, rest.y.add(shift.y));
    })();

    // ── The fragment ──
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P);
        const dist = max(length(toEye), 1e-3).toVar();
        const V = toEye.div(dist).toVar();
        const grazing = max(V.y, 0.012);
        // A pixel's footprint along the view, metres: what the slope can still be resolved at.
        const foot = dist.mul(U.pixelAngle).div(grazing).toVar();
        const xz = P.xz.toVar();
        const t = U.time.mul(SEA_TIME);

        // The swell's slope, train by train; what a pixel cannot resolve goes into the variance.
        const slope = vec2(0.0).toVar();
        const variance = float(TUNE.glintFloor).toVar();
        for (let i = 0; i < n; i += 1) {
            const row = SWELL_ROWS[i];
            const L = (2 * Math.PI) / row[2];
            const seen = float(1.0).sub(smoothstep(L * 0.12, L * 0.45, foot));
            const theta = dot(xz, vec2(row[0], row[1])).mul(row[2]).sub(t.mul(row[3])).add(row[5]);
            const ak = row[4] * row[2];
            slope.addAssign(vec2(row[0], row[1]).mul(cos(theta).mul(ak).mul(seen)));
            variance.addAssign(float(0.5 * ak * ak).mul(float(1.0).sub(seen)));
        }

        // The wind's chop: short directional trains in the light only, their phases bent by a
        // slow warp (two smooth fields of the water's noise, read once) so they run in long,
        // broken crests and never lock into a lattice.
        const chopRows = CHOP_ROWS.slice(0, Math.max(0, tier.chop ?? 12));
        if (chopRows.length) {
            const warp = texture(seaNoise, xz.div(TUNE.chopWarpTile).add(vec2(0.31, 0.77))).ba.sub(0.5).mul(2.0)
                .toVar();
            chopRows.forEach((row) => {
                const L = (2 * Math.PI) / row[2];
                const seen = float(1.0).sub(smoothstep(L * 0.12, L * 0.45, foot));
                const theta = dot(xz, vec2(row[0], row[1])).mul(row[2]).sub(t.mul(row[3])).add(row[5])
                    .add(warp.x.mul(row[6]))
                    .add(warp.y.mul(row[7]));
                // (The wind's strength is the weather's: U.chop is 1 on the day the theme ships.)
                const s = U.chop.mul(row[4] * TUNE.chop);
                slope.addAssign(vec2(row[0], row[1]).mul(cos(theta).mul(s).mul(seen)));
                variance.addAssign(s.mul(s).mul(0.5).mul(float(1.0).sub(seen)));
            });
        }

        // Ripples from the noise: three scales, drifting with the breeze.
        const layers = Math.min(3, Math.max(1, tier.ripples));
        const drifts = [vec2(0.011, -0.017), vec2(-0.023, -0.031), vec2(0.043, -0.052)];
        for (let i = 0; i < layers; i += 1) {
            const tile = TUNE.rippleTile[i];
            const strength = TUNE.ripple[i];
            const at = xz.div(tile).add(drifts[i].mul(U.time)).add(vec2(i * 0.37, i * 0.71));
            const s = texture(seaNoise, at).rg.sub(0.5).mul(2.0 * strength);
            const seen = float(1.0).sub(smoothstep(tile / 90, tile / 6, foot));
            slope.addAssign(s.mul(seen));
            variance.addAssign(float(seaVariance * strength * strength * 0.5).mul(float(1.0).sub(seen)));
        }

        // Glitter: the facets a pixel cannot resolve do not shine evenly, they flash. Sparks a
        // pixel or two across on a lattice of the eye's own angles (a bearing and a dip, so they
        // are the same size on screen near and far), each flashing in its own time.
        const look = V.negate();
        const bearing = atan(look.x, look.z.negate());
        const dip = look.y.negate().div(max(length(look.xz), 1e-3));
        const sparks = (cellPixels, shift) => {
            const p = vec2(bearing, dip).div(U.pixelAngle.mul(cellPixels)).add(vec2(900.0 + shift, 60.0 + shift))
                .toVar();
            const cell = floor(p);
            const h = hash22(cell).toVar();
            const off = p.sub(cell.add(h.mul(0.5).add(0.25))).mul(cellPixels);
            const beat = sin(U.time.mul(h.x.mul(3.6).add(1.7)).add(h.y.mul(6.2832))).toVar();
            const b2 = beat.mul(beat);
            const flash = b2.mul(b2).mul(b2).mul(step(0.0, beat));
            return exp(dot(off, off).mul(-1.1)).mul(flash);
        };
        const glitter = sparks(3.1, 0.0).add(sparks(5.3, 37.0)).toVar();

        // Rings where lanterns were set down: a few crests running out, in the lantern's colour.
        // By night the water they stir answers with a cold light of its own.
        const seaFire = vec3(0.1, 0.75, 1.0);
        const ringLight = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(U.counts.x), type: 'int', condition: '<', name: 'ring',
        }, ({ ring }) => {
            const a = rows.rings.element(ring.mul(2));
            const b = rows.rings.element(ring.mul(2).add(1));
            const age = max(U.time.sub(a.z), 0.0);
            const offset = xz.sub(a.xy);
            const d = length(offset);
            const radius = age.mul(1.35).add(0.2);
            const x = d.sub(radius);
            const fade = exp(age.mul(-0.55)).mul(a.w).mul(smoothstep(0.0, 0.15, age));
            const env = exp(x.mul(x).mul(-1.6)).mul(fade);
            const wave = cos(x.mul(7.0));
            const dh = env.mul(sin(x.mul(7.0))).mul(-0.11);
            slope.addAssign(offset.div(max(d, 0.05)).mul(clamp(dh, -0.18, 0.18)));
            const stirred = mix(b.xyz, seaFire, U.seaFire.mul(0.55));
            ringLight.addAssign(stirred.mul(env.mul(max(wave, 0.0)).mul(b.w))
                .mul(glitter.mul(U.seaFire.mul(5.0)).add(1.0))
                .div(max(d.mul(0.4).add(1.0), 1.0)));
        });

        // Waves of light (a clear): a front racing out over the whole sea from where it began,
        // sheen and sparks in its own colour, a low swell under it. And whirls (a twist): arms of
        // light turning round where the lanterns rose. Row b's w says which: 0 a wave, otherwise
        // a whirl turning that way.
        const waveLight = vec3(0.0).toVar();
        const roused = float(0.0).toVar();
        Loop({
            start: int(0), end: int(U.counts.y), type: 'int', condition: '<', name: 'wave',
        }, ({ wave }) => {
            const a = rows.waves.element(wave.mul(2));
            const b = rows.waves.element(wave.mul(2).add(1));
            const age = max(U.time.sub(a.z), 0.0).toVar();
            const offset = xz.sub(a.xy).toVar();
            const d = length(offset).toVar();
            // The front, and what it leaves glittering behind it for a moment.
            const run = min(age, WAVE_LIFE);
            const reach = exp(run.mul(1.25)).sub(1.0).mul(5.0).add(run.mul(3.0));
            const width = reach.mul(0.17).add(0.7);
            const x = d.sub(reach).div(width).toVar();
            const alive = smoothstep(0.0, 0.12, age).mul(float(1.0).sub(smoothstep(WAVE_LIFE * 0.62, WAVE_LIFE, age)));
            const front = exp(min(x.mul(x), 30.0).negate());
            const wake = exp(max(x.negate(), 0.0).mul(-0.3)).mul(step(x, 0.0)).mul(0.34);
            const ring = front.add(wake).mul(alive);
            // The whirl: three arms winding in, turning.
            const around = atan(offset.y, offset.x);
            const wound = around.mul(3.0).sub(log(d.add(0.6)).mul(5.5)).add(age.mul(b.w.mul(4.6)));
            const arms = cos(wound).mul(0.5).add(0.5);
            const span = age.mul(2.2).add(5.5);
            const whirl = arms.mul(arms).mul(arms).mul(1.5).mul(exp(min(d.mul(d).div(span.mul(span)), 30.0).negate()))
                .mul(smoothstep(0.0, 0.5, age))
                .mul(float(1.0).sub(smoothstep(WHIRL_LIFE * 0.5, WHIRL_LIFE, age)));
            const isWhirl = step(0.5, abs(b.w));
            const env = mix(ring, whirl, isWhirl).mul(a.w).toVar();
            const heave = clamp(env.mul(x).mul(-0.09), -0.14, 0.14).mul(float(1.0).sub(isWhirl));
            slope.addAssign(offset.div(max(d, 0.05)).mul(heave));
            // (By night it is the sea's own fire: sparks, and only a breath of sheen under them.
            // An even sheen as strong as the day's lit the dark water like a floor.)
            waveLight.addAssign(b.xyz.mul(env.mul(glitter.mul(6.0).add(mix(float(0.6), float(0.16), U.seaFire)))));
            roused.addAssign(env);
        });

        const N = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
        const cosV = clamp(dot(V, N), 0.0, 1.0);
        const m = float(1.0).sub(cosV);
        const m2 = m.mul(m);
        const fresnel = float(0.02).add(m2.mul(m2).mul(m).mul(0.98)).toVar();

        // What the sea mirrors.
        const R0 = V.negate().reflect(N);
        // Rough water seen low mirrors the sky from higher up than a mirror would: the facets
        // the eye sees are the ones tipped toward it. So the far sea, where no wave is resolved,
        // shows the sky some degrees over the horizon, and stands a shade darker than the sky it
        // meets (as a real horizon does) instead of melting into it.
        const tipped = variance.sqrt().mul(TUNE.roughLift);
        const R = normalize(vec3(R0.x, max(R0.y, 0.004).add(tipped), R0.z)).toVar();
        const mirrored = skyColour(R, U, skyNoise, {
            slices: tier.mirror,
            fine: false,
            cirrus: tier.cirrus && tier.mirror > 0,
            bars: tier.mirror > 0,
            discs: false,
            stars: true,
            milky: false,
            towers: tier.towers && tier.mirror > 1,
        }).toVar();

        // The islands in the water: where the mirror ray comes down on land (the islands' skyline:
        // for each bearing from the place the sky sets, and from the place it rises, how high the
        // land stands and how far off) the sea shows the island's dark body, paled by the air
        // between, instead of the sky. The ripples that tip the ray tear its edge and draw it out
        // toward the eye, as they do the sun's road.
        if (skyline) {
            const rise = R.y.div(max(length(R.xz), 1e-3));
            const bearingR = atan(R.x, R.z.negate());
            const halfSpan = skyline.half * (Math.PI / 180);
            // Darkest at the island's foot and thinning toward its mirrored top: on water that
            // is never still an image is drawn out and loses itself as it nears the eye. (Cut
            // off hard at the mirrored outline it stood under each island like a pale box.)
            const land = (gate, v) => {
                const u = bearingR.sub(gate).div(halfSpan).mul(0.5).add(0.5);
                const s = texture(skyline.texture, vec2(clamp(u, 0.0, 1.0), v));
                const top = max(s.r.mul(skyline.tanMax), 1e-4);
                const under = clamp(float(1.0).sub(rise.div(top)), 0.0, 1.0);
                return vec2(under.mul(under.sqrt()).mul(s.b).mul(step(0.0, u)).mul(step(u, 1.0)), s.g);
            };
            const setLand = land(U.gates.x, 0.25).toVar();
            const riseLand = land(U.gates.y, 0.75).toVar();
            const onLand = max(setLand.x, riseLand.x);
            const away = mix(setLand.y, riseLand.y, step(setLand.x, riseLand.x)).mul(skyline.far);
            const shade = U.light.ambient.mul(0.11).add(U.light.cloudShade.mul(0.07));
            // (The air takes an island half as fast as it takes the sea: sunset-islands.js.)
            const aired = mix(shade, horizonHaze(R, U), float(1.0).sub(exp(away.div(U.hazeReach.mul(2.0)).negate())));
            mirrored.assign(mix(mirrored, aired, onLand.mul(0.92)));
        }

        // The water's own colour: dark looked down into, the backs of the swell lit through
        // where they stand between the eye and a low light.
        const { light } = U;
        const keyDir = normalize(mix(U.sun, U.moon, U.moonKey));
        const forward = max(dot(V.negate(), normalize(vec3(keyDir.x, 0.0, keyDir.z))), 0.0);
        const f2 = forward.mul(forward);
        const crest = smoothstep(-0.05, 0.35, vCrest);
        const body = light.seaDeep.add(light.seaScatter.mul(crest.mul(f2.mul(f2)).mul(1.4).add(0.35))).toVar();

        const water = body.mul(float(1.0).sub(fresnel)).add(mirrored.mul(fresnel)).toVar();

        // The roads: the share of facets that mirror the sun, and the moon.
        // (A share of each road is an even sheen; the rest flashes.)
        const roadBoost = U.glint.add(1.0).add(roused.mul(1.5));
        const flashing = glitter.mul(TUNE.sparkle).add(1.0 - TUNE.sparkleShare);
        const sunRoad = glintLobe(slope, variance, V, U.sun).x.mul(U.sunUp).mul(roadBoost);
        water.addAssign(light.sunGlint.mul(sunRoad).mul(flashing).mul(TUNE.glint));
        const moonRoad = glintLobe(slope, variance.mul(1.4), V, U.moon).x.mul(U.moonUp).mul(roused.add(1.0));
        water.addAssign(light.moonGlint.mul(moonRoad).mul(flashing).mul(TUNE.glint * 0.4));

        // The lanterns: each mirrored on a streak of its own light, and a pool of it on the water.
        const lit = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(U.counts.z), type: 'int', condition: '<', name: 'lamp',
        }, ({ lamp }) => {
            const a = rows.lamps.element(lamp.mul(2));
            const b = rows.lamps.element(lamp.mul(2).add(1));
            const toLamp = a.xyz.sub(P);
            const d2 = max(dot(toLamp, toLamp), 0.04);
            const Ld = toLamp.div(d2.sqrt());
            const streak = glintLobe(slope, variance.add(0.002), V, Ld).x;
            const pool = max(dot(N, Ld), 0.0).mul(0.014);
            lit.addAssign(b.xyz.mul(a.w).mul(streak.mul(0.06).add(pool)).div(d2));
        });
        water.addAssign(lit);
        water.addAssign(ringLight.mul(0.2));
        water.addAssign(waveLight.mul(0.38));

        // The air over the far sea.
        const haze = float(1.0).sub(exp(dist.div(U.hazeReach).negate())).toVar();
        const far = horizonHaze(V.negate(), U);
        const out = mix(water, far, haze.mul(min(haze.mul(1.4), 1.0)));
        return vec4(out, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sunset-sea';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
