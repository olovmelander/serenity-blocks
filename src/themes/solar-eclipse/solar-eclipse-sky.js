/**
 * Solar Eclipse — the dome: the air at totality, the planets and stars it lets out, the black
 * sun (solar-eclipse-sun.js), the far shore, and the salt mirror that gives it all back.
 *
 * One dome round the lens; every pixel reads the scene in its own direction, so nothing is
 * marched and nothing is drawn twice. Below the horizon the water (solar-eclipse-mirror.js)
 * turns the direction over: the pixel then draws the sky the mirror sends the eye on to, and the
 * water's own light on top. Composited back to front:
 *
 *   the air      the dark of the shadow overhead, the band of light low all round (the sky
 *                beyond the moon's shadow is still in sunlight) and its bright rim at the horizon
 *   the points   the planets that come out at totality, and the faint stars a long exposure
 *                (a chain) brings out
 *   the sun      behind the moon: corona, prominences, chromosphere; the moon over them; in front
 *                of it the bead necklace and the diamond's glare
 *   the clouds   a broken deck low over the far shore: dark where the moon's shadow covers it,
 *                burning where it reaches out into the sunlight beyond
 *   the shore    six crest lines standing on the horizon, farthest first: each darker than the
 *                air behind it, mist banked along its foot, its crest rimmed by the light behind;
 *                the farthest range stands outside the shadow and glows, the volcano stands
 *                over the water on the right
 *   the water    Fresnel over the salt's floor, the salt under the film, the crust's dry ridges
 *                catching the light of the horizon, the diamond's glitter path
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    asin,
    atan,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    log2,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BRIGHT_POINTS, CLOUDS, CLOUDS_TOP, DEG, RANGES, RIDGE_SPAN, UMBRA, cloudRowSpan,
} from './solar-eclipse-core.js';
import {
    crestU, noiseAt, seGauss, seHash21, seLuma, sized, sunPlane,
} from './solar-eclipse-tsl.js';
import { drawSun } from './solar-eclipse-sun.js';
import { bandsAt, glintAt, waterAt } from './solar-eclipse-mirror.js';

/** Per range, in RANGES order (farthest first): how much air stands between it and the lens. */
const AERIAL = Object.freeze([0.66, 0.46, 0.27, 0.17, 0.07, 0.02]);
/** The mist along each range's foot: (how far up it reaches in radians, how thick). */
const MIST = Object.freeze([[0.003, 0.3], [0.004, 0.34], [0.006, 0.3], [0.006, 0.26], [0.004, 0.2], [0.003, 0.1]]);
/** The light behind each crest, a thin rim. */
const RIM = Object.freeze([1.0, 0.6, 0.42, 0.24, 0.12, 0.05]);

/** A bright point's colour from its temperature: 0 ember … 0.5 white … 1 blue. */
const pointColour = (temp) => {
    const warm = [1.0, 0.72, 0.46];
    const white = [1.0, 0.97, 0.93];
    const blue = [0.7, 0.82, 1.0];
    const k = temp < 0.5 ? temp / 0.5 : (temp - 0.5) / 0.5;
    const a = temp < 0.5 ? warm : white;
    const b = temp < 0.5 ? white : blue;
    return vec3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
};

export function createSky({
    u, noise, ranges, tier,
}) {
    const geometry = new THREE.SphereGeometry(6000, 32, 16);
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });

    const env = { u, noise, tier };

    material.fragmentNode = Fn(() => {
        const view = normalize(positionWorld.sub(cameraPosition)).toVar();

        // ── The water: below the horizon, the sky the mirror sends the eye on to ──
        const d = view.toVar();
        const wet = float(0.0).toVar();
        const mirror = float(1.0).toVar();
        const salt = float(0.0).toVar();
        const glint = float(0.0).toVar();
        const banded = float(1.0).toVar();
        If(view.y.lessThan(0.0), () => {
            const w = waterAt(env, view);
            d.assign(w.look);
            wet.assign(1.0);
            mirror.assign(w.mirror);
            // Where the water gives the sun back the crust lies sunk under the film: its ridges
            // never draw veins across the black sun's reflection.
            const sunk = smoothstep(0.986, 0.9975, dot(w.look, u.sunDir));
            salt.assign(w.salt.mul(float(1.0).sub(sunk.mul(0.9))));
            banded.assign(bandsAt(env, w.g));
            If(u.glint.w.greaterThan(0.001), () => {
                glint.assign(glintAt(env, view, w.n, w.g, w.foot));
            });
        });

        const alt = asin(clamp(d.y, -1.0, 1.0)).toVar();
        const az = atan(d.x, d.z.negate()).toVar();
        const up = max(alt, 0.0);

        // ── The air at totality ──
        // The lens does not stand in the middle of the moon's shadow: toward its nearest edge the
        // band of light burns brighter and climbs higher, and under the sun the air is darkest.
        const side = cos(az.sub(u.umbraAz)).toVar();
        const bright = side.mul(UMBRA.lean).add(1.0).toVar();
        const tall = side.mul(0.3).add(1.0).toVar();
        const sky = mix(u.mid, u.zenith, smoothstep(0.03, 0.34, up)).toVar();
        sky.addAssign(u.horizon.mul(exp(up.div(tall.mul(-0.085)))).mul(bright));
        sky.addAssign(u.glow.mul(exp(up.div(u.glowHeight.mul(tall)).negate())).mul(bright));
        // Where the warm band gives way to the dark, its light pales toward blue.
        const pale = mix(vec3(seLuma(u.glow)), u.glow, 0.4).mul(vec3(0.75, 0.95, 1.25));
        const belt = up.sub(u.glowHeight.mul(tall).mul(2.0)).div(u.glowHeight.mul(tall).mul(1.8));
        sky.addAssign(pale.mul(seGauss(belt)).mul(bright.mul(0.2)));
        // The moment the diamond burns, daylight floods back into the air.
        sky.addAssign(mix(u.horizon.mul(1.6), vec3(0.09, 0.13, 0.22), smoothstep(0.0, 0.3, up)).mul(u.daylight));

        const plane = sunPlane(u, d).toVar();

        // ── The planets, placed off the sun ──
        const pointLight = vec3(0.0).toVar();
        const spot = sized(u, 1.15, 0.9).div(u.sunTan);
        BRIGHT_POINTS.forEach(([x, y, power, temp], index) => {
            const at = vec2(Math.tan(x * DEG), Math.tan(y * DEG)).div(u.sunTan);
            const dd = plane.xy.sub(at).div(spot);
            const twinkle = sin(u.time.mul(1.7 + index * 0.37).add(index * 2.1)).mul(0.08).add(0.92);
            const shine = exp(dd.dot(dd).negate()).mul(power).mul(twinkle);
            pointLight.addAssign(pointColour(temp).mul(shine));
        });
        const night = float(1.0).sub(u.daylight);
        sky.addAssign(pointLight.mul(u.starPower).mul(u.exposure.mul(0.5).add(0.55)).mul(0.6).mul(night));

        // ── The faint stars a long exposure brings out ──
        if (tier.stars) {
            If(alt.greaterThan(0.0).and(u.exposure.greaterThan(0.02)), () => {
                const cell = 0.016;
                const g = vec2(az.mul(cos(alt)), alt).div(cell);
                const id = floor(g);
                const at = fract(g).sub(0.5);
                const place = vec2(seHash21(id.add(3.1)), seHash21(id.add(9.7))).sub(0.5).mul(0.6);
                const away = at.sub(place).mul(cell);
                const rad = sized(u, 0.85, 0.7);
                const h = seHash21(id.add(41.3));
                const lit = step(seHash21(id.add(77.7)), u.exposure.mul(0.42));
                const shine = exp(away.dot(away).div(rad.mul(rad)).negate()).mul(h.mul(h).mul(0.7).add(0.06)).mul(lit);
                sky.addAssign(vec3(0.86, 0.92, 1.0).mul(shine).mul(u.starPower).mul(float(1.0).sub(u.daylight)));
            });
        }

        // ── The black sun ──
        const behind = vec3(0.0).toVar();
        const front = vec3(0.0).toVar();
        const cover = float(0.0).toVar();
        const face = vec3(0.0).toVar();
        const spikes = vec3(0.0).toVar();
        If(plane.z.greaterThan(0.2), () => {
            drawSun({ u, noise, tier }, plane.xy, {
                behind, cover, face, front, spikes,
            });
        });
        sky.addAssign(behind);
        sky.assign(mix(sky, face, cover));

        // ── The clouds: rows of heaped cloud low over the far shore, farthest first ──
        // Each row is the face it turns to the lens, read in (bearing, height above its base), so
        // its heaps keep their shape however low they stand. Beyond the moon's shadow a row is in
        // sunlight and burns from the top down; nearer it is a dark body whose base the band of
        // light all round lights from below.
        if (tier.clouds) {
            If(alt.greaterThan(cloudRowSpan(CLOUDS.rows[0]).base - 0.004).and(alt.lessThan(CLOUDS_TOP)), () => {
                // Shared by every row, so pinned here: a node first built inside one row's branch
                // would be assigned there alone, and the other rows would read zero.
                // The shadow ends nearest toward the bright side.
                const edgeKm = float(1.0).sub(side.mul(UMBRA.lean)).mul(CLOUDS.shadowEdge).toVar();
                // No cloud ever crosses the black sun: its disc stays the darkest thing in the sky.
                const clear = smoothstep(1.04, 1.35, length(plane.xy)).toVar();
                const airBehind = sky.toVar();
                const shade = u.ridge.mul(1.8).add(u.mid.mul(0.8)).add(u.horizon.mul(0.16)).toVar();
                CLOUDS.rows.forEach((row, k) => {
                    const span = cloudRowSpan(row);
                    If(alt.greaterThan(span.base - 0.003).and(alt.lessThan(span.top)), () => {
                        // Noise units per radian: one heap is a cell of R's coarsest octave.
                        const unit = row.lump * 4;
                        const per = row.distance / unit;
                        const lod = clamp(log2(max(u.texel.mul(per * 256), 1.0)), 0.0, 6.0);
                        const x = az.mul(per).add(u.time.mul(row.wind / unit)).add(0.11 + k * 0.37);
                        // Height above the row's base (km); the base wavers a little heap to heap.
                        const waver = noiseAt(noise, vec2(x.mul(0.21), 0.13 + k * 0.29), lod).g.sub(0.5);
                        const h = alt.mul(row.distance).sub(CLOUDS.base).sub(waver.mul(row.depth * 0.3)).toVar();
                        // Read a little squashed: heaps a little wider than they are tall.
                        const y = h.div(unit).mul(row.squash).add(k * 0.53);
                        const mass = noiseAt(noise, vec2(x, y), lod).r;
                        // A little higher in the heap: where it thins upward is a top, where it
                        // thickens an underside.
                        const above = noiseAt(noise, vec2(x, y.add(0.045)), lod).r;
                        const tuftAt = vec2(x.mul(2.1).add(0.4), y.mul(2.1).sub(u.time.mul(0.0015)));
                        const tuft = noiseAt(noise, tuftAt, clamp(lod.add(1.0), 0.0, 6.0)).b;
                        const n = mass.mul(0.76).add(tuft.mul(0.26)).toVar();
                        // Broad gaps along the row: whole reaches of the band stand clear.
                        const gap = noiseAt(noise, vec2(x.mul(0.09).add(k * 0.71), 0.62), lod).b;
                        const rise = clamp(h.div(row.depth), 0.0, 1.6).toVar();
                        // A flat base and a heaped top: the threshold climbs with the height.
                        const thr = pow(rise, 1.6).mul(0.26)
                            .add(float(1.0).sub(smoothstep(0.25, 0.52, gap)).mul(0.3))
                            .add(0.42 - (row.cover - 0.5) * 0.35)
                            .toVar();
                        const pxKm = u.texel.mul(row.distance);
                        const inside = smoothstep(thr, thr.add(0.11), n);
                        const ragged = h.add(tuft.sub(0.5).mul(row.depth * 0.1));
                        const based = smoothstep(pxKm.mul(-1.2), pxKm.mul(1.2), ragged);
                        const cloud = inside.mul(based).mul(clear).mul(CLOUDS.opacity).toVar();
                        If(cloud.greaterThan(0.002), () => {
                            const thick = smoothstep(thr, thr.add(0.24), n);
                            const turn = clamp(mass.sub(above).mul(22.0), -1.0, 1.0);
                            const top = smoothstep(0.0, 0.7, turn);
                            const bottom = smoothstep(0.0, 0.7, turn.negate()).mul(0.7).add(0.3);
                            const lit = smoothstep(edgeKm.mul(0.85), edgeKm.mul(1.18), float(row.distance));
                            // In sunlight: lit from above, the tops brightest; the creases take
                            // the cool light of the sky, not a darker orange.
                            const sunward = top.mul(0.6).add(clamp(rise, 0.0, 1.0).mul(0.4)).toVar();
                            const crease = u.horizon.mul(0.7).add(u.mid.mul(1.4)).add(u.glow.mul(0.05));
                            const burn = mix(crease, u.alpen.mul(u.alpenPower).mul(0.85), sunward)
                                .mul(float(1.0).sub(thick.mul(0.2)));
                            // In the shadow: a dark body, its undersides lit from below by the band
                            // of light all round.
                            const under = u.glow.mul(0.2).mul(bottom).mul(exp(max(h, 0.0).div(-row.depth * 0.35)));
                            const colour = mix(shade.mul(top.mul(0.3).add(0.85)).add(under), burn, lit).toVar();
                            // Thin cloud lets the light behind it through.
                            colour.assign(mix(colour, airBehind, thick.oneMinus().mul(0.35)));
                            colour.assign(mix(colour, airBehind, row.aerial));
                            colour.addAssign(u.haze.mul(u.daylight.mul(0.8)));
                            sky.assign(mix(sky, colour, cloud));
                        });
                    });
                });
            });
        }

        // ── The ranges, farthest first ──
        const top = RANGES.reduce((m, r) => Math.max(m, r.base + r.amp * 1.4, r.cone ? r.cone.peak : -1), -1);
        If(alt.lessThan(top + 0.004), () => {
            const uu = crestU(az, RIDGE_SPAN);
            const row0 = texture(ranges, vec2(uu, 0.25)).level(0);
            const row1 = texture(ranges, vec2(uu, 0.75)).level(0);
            const crests = [row0.x, row0.y, row0.z, row0.w, row1.x, row1.y];
            const fuzz = u.texel.mul(0.75);
            // The air beyond the shadow, as it lies between the ranges.
            const farAir = mix(u.haze, u.glow, 0.42).mul(0.82).toVar();
            const daylit = u.daylight.mul(0.6);
            for (let k = 0; k < RANGES.length; k += 1) {
                const below = crests[k].sub(alt);
                const inside = smoothstep(fuzz.negate(), fuzz, below);
                const body = mix(u.ridge, farAir, AERIAL[k]).toVar();
                // The near ranges stand under the dark of the shadow: a little of its blue.
                body.addAssign(u.mid.mul((k / (RANGES.length - 1)) * 0.5));
                // Mist rising from its foot, banked where the valleys hold it.
                const [reach, thick] = MIST[k];
                let banks = float(1.0);
                if (tier.mist) {
                    // Banks that roll along the valley and thin as they climb.
                    const roll = u.time.mul(0.002 * (k + 1));
                    const bankAt = vec2(az.mul(3.1 + k * 0.9).add(roll), below.mul(26.0).add(k * 0.17));
                    banks = noiseAt(noise, bankAt, 1.5).r
                        .mul(1.5).add(0.25);
                }
                const mistColour = mix(u.haze, u.mid.mul(3.2).add(u.haze.mul(0.25)), k / (RANGES.length - 1));
                const thins = float(1.0).sub(smoothstep(reach, reach * 4.0, below).mul(0.6));
                body.addAssign(mistColour.mul(smoothstep(0.0, reach, below).mul(thick).mul(banks)).mul(thins));
                // The light behind its crest, a thin rim.
                const rimWidth = u.texel.mul(1.1).add(0.0002 + k * 0.0001);
                // Bounded before it is masked: far above the crest the exponent would overflow, and
                // mix(sky, Inf, 0) is NaN.
                const rim = exp(max(below, 0.0).div(rimWidth).negate());
                body.addAssign(u.alpen.mul(u.alpenPower).mul(rim).mul(RIM[k] * 0.32));
                if (k === 0) {
                    // The sunlit range: its snow catches the light outside the shadow, brightest
                    // on the faces that turn toward it, cut by couloirs.
                    const slope = row1.z;
                    const facing = smoothstep(-0.8, 0.8, slope.negate()).mul(0.6).add(0.4);
                    let snow = float(0.75);
                    if (tier.faces) {
                        const couloir = noiseAt(noise, vec2(az.mul(11.0), below.mul(70.0).add(0.3)), 0.5).b;
                        snow = smoothstep(0.4, 0.78, couloir).mul(0.7).add(0.25);
                    }
                    const band = smoothstep(0.0, 0.002, below).mul(exp(max(below, 0.0).div(-0.01)));
                    body.addAssign(u.alpen.mul(u.alpenPower).mul(facing).mul(snow).mul(band)
                        .mul(0.14));
                }
                body.addAssign(u.haze.mul(daylit).mul(AERIAL[k] + 0.25));
                sky.assign(mix(sky, body, inside));
            }
        });

        // Glare sits on the lens, in front of everything; the starburst is the lens's own, so
        // the mirror never shows it.
        sky.addAssign(front);
        sky.addAssign(spikes.mul(float(1.0).sub(wet)));

        // ── The water's own light ──
        If(wet.greaterThan(0.5), () => {
            // The light the salt gathers from the whole sky: the dark overhead, the band all
            // round, a little of the glow; daylight when the diamond burns.
            const ambient = u.mid.mul(1.3)
                .add(u.horizon.mul(0.8))
                .add(u.glow.mul(0.05))
                .add(u.haze.mul(u.daylight.mul(1.4)))
                .mul(banded);
            const film = ambient.mul(float(1.0).sub(mirror)).mul(0.22);
            sky.assign(sky.mul(mirror).add(film));
            sky.assign(mix(sky, ambient.mul(0.95), salt));
            sky.addAssign(vec3(1.0, 0.93, 0.8).mul(glint).mul(float(1.0).sub(salt)));
            // A breath of mist lies on the far water, lit by the band of light all round.
            const lying = exp(view.y.div(0.011)).mul(0.55).add(exp(view.y.div(0.003)).mul(0.45));
            const mist = mix(u.haze, u.glow, 0.3).mul(bright).mul(0.32);
            sky.assign(mix(sky, sky.add(mist), lying));
        });
        return vec4(sky, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.name = 'solar-eclipse-sky';

    return {
        object: mesh,
        update(camera) {
            mesh.position.copy(camera.position);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
