/**
 * Sakura Twilight — the sky.
 *
 * One dome draws the whole vault: the afterglow gradient from the light rig, three sizes of
 * twinkling stars in their own colours, the river of heaven the dark hours show, and the moon
 * itself — a mottled disc with a soft corona and the wide ring a thin veil gives it.
 * `moon(direction)` is exported as a node so the lake can mirror the same disc.
 *
 * The cloud is the air's (sakura-weather.js), drawn from the side in the sky's own coordinates
 * (azimuth, height): a level eye looking out over a lake sees only the lowest part of the sky,
 * where a deck seen from below is squeezed into streaks. Banks form and melt as two layers of
 * one field slide through each other, their moonward edges silver and their hearts in shade;
 * high wisps trail on the slant; a mackerel field lies in small scales; a veil thins the stars
 * and opens the moon's ring. The dome is drawn last among the solid things, so only the sky that
 * shows is shaded.
 *
 * Over the vault lie the constellations: a few figures of bright stars whose lines draw
 * themselves in as a combo builds, and the shooting stars a four-line clear sets off — up to
 * three at once, each finishing its fall (a fever makes them a meteor shower). A back-to-back
 * opens the hazy moon's rainbow corona; a perfect clear and a fever brighten its aureole. On a
 * clear night a star falls by itself now and then, whether anyone is playing or not.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, atan, cameraPosition, cross, dot, exp, float, floor, fract, instancedBufferAttribute, length, max, mix,
    normalize, positionGeometry, positionWorld, pow, saturate, sin, smoothstep, step, uniform, uniformArray, uv, vec2,
    vec3, vec4,
} from 'three/tsl';

const TAU = Math.PI * 2;
/** Angular radius of the moon's disc in radians (far larger than life: this is a print). */
export const SAKURA_MOON_RADIUS = 0.062;
const DOME_RADIUS = 1500;
/** Shooting stars that can cross the sky at once (each runs its whole fall). */
export const SAKURA_SHOOTING_STARS = 3;
/** A star has burnt out by then (its streak fades as exp(-1.5 age)). */
const SHOOT_LIFE = 3;

/**
 * Figures drawn with straight lines between stars, in a frame around a centre direction:
 * `at` is [azimuth right of -Z, elevation] in degrees, points are offsets in degrees
 * (times `scale`). They sit in the sky the board card leaves open in the landscape framing.
 */
export const SAKURA_CONSTELLATIONS = Object.freeze([
    {
        name: 'The Fox',
        at: [-22, 19.5],
        scale: 0.42,
        points: [[-9, 1.5], [-5.5, 3.2], [-2.5, 2.2], [1.5, 2.6], [4.5, 4.8], [6.2, 7.6], [7.6, 4.4], [9.6, 2.6],
            [6.6, 1.8], [2, -0.6], [1.2, -4.2], [-3, -0.4], [-4.2, -4.2], [-11.6, 4.6], [-13.4, 8.6]],
        lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 3], [3, 9], [9, 10], [2, 11],
            [11, 12], [0, 13], [13, 14]],
    },
    {
        name: 'The Blossom',
        at: [-14, 18.6],
        scale: 0.45,
        points: [[0, 0], [0, 4.2], [4, 1.3], [2.5, -3.4], [-2.5, -3.4], [-4, 1.3]],
        lines: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [2, 3], [3, 4], [4, 5], [5, 1]],
    },
    {
        name: 'The Crane',
        at: [-32, 15.5],
        scale: 0.36,
        points: [[-8, -3], [-4, -0.6], [0, 0], [3.4, 2.4], [6, 5.6], [7.6, 4.6], [-1.6, 4.4], [-4.6, 7.6],
            [1.2, -4], [2.4, -7.6]],
        lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 7], [2, 8], [8, 9]],
    },
]);

function skyDirection(azimuth, elevation, target = new THREE.Vector3()) {
    const a = THREE.MathUtils.degToRad(azimuth);
    const e = THREE.MathUtils.degToRad(elevation);
    return target.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/**
 * The river of heaven: a great circle that rises from behind the mountain's left shoulder and
 * climbs to the right over the top of the sky, through the open sky of both framings.
 * [azimuth right of -Z, elevation] in degrees for the two points that set it.
 */
export const SAKURA_GALAXY = Object.freeze({ from: [-40, 5], to: [2, 42] });
const GALAXY_FROM = skyDirection(SAKURA_GALAXY.from[0], SAKURA_GALAXY.from[1]);
const GALAXY_TO = skyDirection(SAKURA_GALAXY.to[0], SAKURA_GALAXY.to[1]);
const GALAXY_NORMAL = new THREE.Vector3().crossVectors(GALAXY_FROM, GALAXY_TO).normalize();
const GALAXY_MIDDLE = GALAXY_FROM.clone().add(GALAXY_TO).normalize();
// Along the band from its middle (the sine of the angle: a cosine stands still there, and draws
// the band's clouds out into rays).
const GALAXY_ALONG = new THREE.Vector3().crossVectors(GALAXY_NORMAL, GALAXY_MIDDLE).normalize();
/** The cloud field's scale in (azimuth, height): banks some sixteen degrees long and six tall. */
const CLOUD_SCALE = Object.freeze([0.9, 2.3]);
/** One read of the shared noise as four octaves (its channels hold 4, 8, 16 and 32 cells). */
const OCTAVES = [0.4, 0.3, 0.2, 0.1];

/** A cheap 3D -> 1 hash for star cells. */
function hash3(cell) {
    return fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
}

export class SakuraSky {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SakuraSky';
        this.owned = [];
        // How far the constellation lines have drawn (0..1) and how brightly they burn.
        this.uDraw = uniform(0);
        this.uFigures = uniform(0);
        this.uMoonGlow = uniform(0);
        // The rainbow rings round the hazy moon a back-to-back opens (0 closed .. 1.6).
        this.uCorona = uniform(0);
        // Shooting stars: start x, start y (on the sky plane), birth, strength; and each one's
        // direction (x, y on the plane).
        this.shotData = Array.from({ length: SAKURA_SHOOTING_STARS }, () => new THREE.Vector4(0, 0, -100, 0));
        this.shotDirData = Array.from({ length: SAKURA_SHOOTING_STARS }, () => new THREE.Vector4(-0.92, -0.4, 0, 0));
        this.uShots = uniformArray(this.shotData, 'vec4');
        this.uShotDirs = uniformArray(this.shotDirData, 'vec4');
        this.lastShot = 0;
        this.shootCount = 0;
        // The night's own falling stars: when the next is due, on chances of their own (the
        // garden's shared sequence is left alone).
        this.ownChance = 0x51a7;
        this.ambientAt = null;
        this.ownStar = false;
    }

    /** A chance of the sky's own (a small seeded generator: the same night from the same start). */
    chance() {
        this.ownChance = (Math.imul(this.ownChance, 1664525) + 1013904223) >>> 0;
        return this.ownChance / 4294967296;
    }

    /** The most recent shooting star's slot (start x, start y, birth, strength). */
    get uShoot() {
        return { value: this.shotData[this.lastShot] };
    }

    /** The most recent shooting star's direction on the sky plane (x, y). */
    get uShootDir() {
        return { value: this.shotDirData[this.lastShot] };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildDome();
        this.buildConstellations();
        return this;
    }

    /** The moon's disc, corona and ring seen along a unit direction. */
    moon(direction) {
        if (!this.moonFn) this.moonFn = this.createMoon();
        return this.moonFn(direction);
    }

    createMoon() {
        const { light } = this;
        return Fn(([direction]) => {
            const axis = light.uMoonDir;
            const right = normalize(cross(vec3(0, 1, 0), axis));
            const up = cross(axis, right);
            const offset = direction.sub(axis.mul(dot(direction, axis)));
            const disc = vec2(dot(offset, right), dot(offset, up)).div(SAKURA_MOON_RADIUS).toVar();
            const radius = length(disc).toVar();
            const facing = saturate(dot(direction, axis)).toVar();
            const inside = smoothstep(0.97, 1.0, radius).oneMinus().mul(smoothstep(0.5, 0.9, facing)).toVar();
            // (A veil of cloud softens the disc: its seas sink into the glow.)
            const veil = light.uVeil;
            const body = vec3(0).toVar();
            // The disc is a small part of the sky: its seas are read only there. (A branch that
            // differs from pixel to pixel may hold no texture read that picks its own level; the
            // disc is drawn larger than the noise, so its first level is the right one.)
            If(radius.lessThan(1.02).and(facing.greaterThan(0.5)), () => {
                const read = (coordinate) => light.noise(coordinate).level(0);
                // (The noise is a square lattice: read straight, the seas broke along its grid, a
                // straight edge down the middle of the disc. Each read is turned its own way and
                // the seas' place is pulled about by a broad read first.)
                const turned = (point, angle) => vec2(
                    point.x.mul(Math.cos(angle)).sub(point.y.mul(Math.sin(angle))),
                    point.x.mul(Math.sin(angle)).add(point.y.mul(Math.cos(angle))),
                );
                const pull = read(turned(disc, 0.6).mul(0.19).add(vec2(0.27, 0.71))).rg.sub(0.5);
                const place = disc.add(pull.mul(0.36)).toVar();
                // Seas and highlands from two octaves of the shared noise, pocked by craters. The
                // disc is kept below the tone curve's shoulder so its seas still read; the glow is
                // the halo's.
                const seas = read(turned(place, 1.1).mul(0.27).add(vec2(0.37, 0.61))).g.mul(0.62)
                    .add(read(turned(place, 2.3).mul(0.5).add(vec2(0.11, 0.83))).b.mul(0.38));
                const craters = read(turned(disc, 0.4).mul(1.7)).b.mul(0.6)
                    .add(read(turned(disc, 1.9).mul(3.9).add(0.3)).a.mul(0.4));
                const surface = mix(float(0.5), float(1.0), smoothstep(0.4, 0.6, seas))
                    .mul(craters.mul(0.3).add(0.85));
                const limb = pow(saturate(float(1).sub(radius.mul(radius))), 0.28);
                // A low moon is warm at its lower limb, where it looks through more air.
                const tint = mix(vec3(1.0, 0.86, 0.78), vec3(0.92, 0.97, 1.08), saturate(disc.y.mul(0.5).add(0.62)));
                body.assign(tint.mul(mix(surface, float(0.82), veil.mul(0.6))).mul(limb.mul(0.45).add(0.55)).mul(1.42));
            });
            const angle = radius.mul(SAKURA_MOON_RADIUS);
            // Oborozuki, the hazy moon of spring: a bright aureole in the thin cloud round the
            // disc and the faint rings of its corona, red-brown, then blue-green, then rose.
            const out = radius.sub(1).max(0);
            const aureole = exp(out.mul(-2.4)).mul(veil.mul(0.5).add(0.5))
                .add(exp(angle.mul(-26)).mul(0.3))
                .add(exp(angle.mul(-7)).mul(veil.mul(0.2).add(0.07)));
            const band = (at, width) => exp(radius.sub(at).div(width).pow2().negate());
            const corona = vec3(1.0, 0.55, 0.42).mul(band(2.5, 0.42)).mul(0.055)
                .add(vec3(0.42, 0.78, 1.0).mul(band(3.35, 0.4)).mul(0.034))
                .add(vec3(1.0, 0.5, 0.75).mul(band(4.15, 0.45)).mul(0.02));
            const glow = this.uMoonGlow.mul(0.9).add(1);
            // A back-to-back opens the corona: its three rings burn several times as bright. A veil
            // of cloud opens it too, wide and soft, for as long as the air is hazy.
            const around = light.uMoonColor.mul(aureole).mul(0.62)
                .add(corona.mul(this.uCorona.mul(2.7).add(veil.mul(1.6)).add(0.45)));
            return body.mul(inside).add(around.mul(inside.oneMinus()).mul(glow).mul(step(0.2, facing)));
        });
    }

    /**
     * Stars seen along a unit direction (their light, in their own colours): two sizes and a dust
     * of faint ones, each twinkling. `dust` (0..1) thickens the faint ones: the river of heaven.
     */
    stars(direction, dust = float(0)) {
        const { light } = this;
        let total = vec3(0);
        const layers = [[150, 0.07, 1.0, 9], [70, 0.045, 2.6, 9], [260, 0.15, 0.42, 3.5]];
        layers.forEach(([scale, size, gain, rarity], layer) => {
            const cellPoint = direction.mul(scale);
            const cell = floor(cellPoint);
            const seed = hash3(cell.add(layer * 17.3));
            const centre = vec3(seed, fract(seed.mul(57.31)), fract(seed.mul(113.7))).mul(0.6).add(0.2);
            const distance = length(fract(cellPoint).sub(centre));
            const magnitude = pow(fract(seed.mul(7.13)), rarity);
            const twinkle = sin(light.uTime.mul(fract(seed.mul(3.7)).mul(2.6).add(0.9)).add(seed.mul(TAU)))
                .mul(0.3).add(0.7);
            // Most are blue-white; one in a few burns gold, a rare one rose.
            const warmth = fract(seed.mul(19.19));
            const tint = mix(
                mix(vec3(0.78, 0.88, 1.28), vec3(1.3, 1.02, 0.78), smoothstep(0.62, 0.8, warmth)),
                vec3(1.3, 0.8, 0.92),
                smoothstep(0.93, 0.97, warmth),
            );
            const amount = layer === 2 ? dust.mul(4).add(1).mul(gain) : float(gain);
            total = total.add(tint.mul(smoothstep(0, size, distance).oneMinus().mul(magnitude).mul(twinkle)
                .mul(amount)));
        });
        return total;
    }

    buildDome() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, fog: false, depthWrite: false,
        }));
        material.name = 'SakuraSkyDome';
        const octaves = vec4(...OCTAVES);
        const scale = vec2(...CLOUD_SCALE);
        material.colorNode = Fn(() => {
            const direction = normalize(positionWorld.sub(cameraPosition)).toVar();
            const up = direction.y.toVar();
            const azimuth = atan(direction.x, direction.z.negate()).toVar();
            const sky = light.sky(direction).toVar();
            const moonward = saturate(dot(direction, light.uMoonDir)).toVar();
            const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
            const toward = dot(flat, light.uGlowDir).mul(0.5).add(0.5).toVar();
            const lowness = pow(saturate(up).oneMinus(), 3).toVar();
            const clock = light.uCloudClock;
            const veil = light.uVeil;

            // -- The banks: one field read twice, the second finer and quicker, so a bank changes
            // shape as it travels; the finer read also pulls the broad one about, so no bank is
            // a round puff. They mass toward the horizon, where the eye looks along the sky.
            const place = vec2(azimuth, up).mul(scale).toVar();
            const travel = vec2(clock.mul(-0.0024), clock.mul(0.0003)).toVar();
            const second = light.noise(place.mul(2.3).add(vec2(clock.mul(-0.0074), clock.mul(-0.0008)))
                .add(vec2(0.37, 0.61))).toVar();
            const torn = place.add(travel).add(second.rg.sub(0.5).mul(vec2(0.055, 0.028))).toVar();
            const first = light.noise(torn).toVar();
            const body = dot(first, octaves).toVar();
            const field = body.mul(0.66).add(dot(second, octaves).mul(0.34))
                .add(smoothstep(0.08, 0.55, up).oneMinus().mul(0.05)).toVar();
            const edge = mix(float(0.7), float(0.41), light.uCloud).toVar();
            // (A sky with hardly any cloud has none in banks: a lone bank is a blot.)
            const bank = smoothstep(edge, edge.add(0.085), field).mul(smoothstep(0.0, 0.06, up))
                .mul(smoothstep(0.1, 0.3, light.uCloud)).toVar();
            // The same field a step toward the moon says which side of a bank is lit.
            const moonSide = normalize(light.uMoonAzEl.sub(vec2(azimuth, up)).mul(scale).add(vec2(0.0001, 0)));
            const lee = dot(light.noise(torn.add(moonSide.mul(0.028))), octaves).toVar();
            const silver = saturate(body.sub(lee).mul(6)).toVar();
            const heart = smoothstep(0.4, 1.0, bank).mul(saturate(lee.sub(body).mul(4.5).add(0.6))).toVar();

            // -- High wisps on the slant, as the garden always had.
            const strand = light.noise(vec2(
                azimuth.mul(0.3).add(up.mul(0.8)).add(clock.mul(-0.0009)),
                up.mul(3.2).sub(azimuth.mul(0.42)).add(0.2),
            ));
            const wisp = smoothstep(0.5, 0.8, strand.g.mul(0.58).add(strand.b.mul(0.42)))
                .mul(smoothstep(0.03, 0.22, up)).mul(light.uWisps).toVar();

            // -- The mackerel field: small scales in the middle sky, where the banks leave room.
            const scales = float(0).toVar();
            If(light.uMackerel.greaterThan(0.01), () => {
                const ripple = light.noise(vec2(
                    azimuth.mul(2.4).add(clock.mul(-0.0022)),
                    up.mul(4.4).add(azimuth.mul(0.7)),
                ));
                const cells = smoothstep(0.4, 0.68, ripple.b.mul(0.56).add(ripple.a.mul(0.44)));
                const region = smoothstep(0.4, 0.62, first.r.mul(0.55).add(second.g.mul(0.45)))
                    .mul(smoothstep(0.09, 0.22, up)).mul(smoothstep(0.7, 0.95, up).oneMinus());
                scales.assign(cells.mul(region).mul(light.uMackerel));
            });

            const thin = wisp.mul(0.45).add(scales.mul(0.7)).toVar();
            const cover = saturate(bank.mul(0.92).add(thin)).toVar();
            // A bank's heart is in shade and its moonward edge silver; thin cloud is lit through,
            // and all of it near the moon stands in its glow.
            const tone = saturate(silver.mul(0.6).add(0.42).sub(heart.mul(0.46)).add(thin.mul(0.45))
                .add(second.a.sub(0.5).mul(0.16)));
            const near = pow(moonward, 5).mul(0.16).add(pow(moonward, 40).mul(0.4));
            const cloud = mix(light.uCloudShade, light.uCloudLit, tone)
                .add(light.uAfterglow.mul(pow(toward, 2).mul(lowness).mul(0.5)))
                .add(light.uMoonColor.mul(silver.mul(bank).mul(heart.oneMinus()).mul(0.07)
                    .add(heart.oneMinus().mul(0.018))
                    .add(near.mul(heart.mul(0.6).oneMinus()))))
                .toVar();
            // Low on the sky a cloud stands in the same air as the far shore.
            cloud.assign(mix(cloud, sky, pow(saturate(up).oneMinus(), 9).mul(0.7)));

            // -- The river of heaven, where the hour is dark and the air clear enough to show it.
            const river = vec3(0).toVar();
            const dust = float(0).toVar();
            If(light.uGalaxy.greaterThan(0.01), () => {
                const off = dot(direction, vec3(GALAXY_NORMAL.x, GALAXY_NORMAL.y, GALAXY_NORMAL.z)).toVar();
                const along = dot(direction, vec3(GALAXY_ALONG.x, GALAXY_ALONG.y, GALAXY_ALONG.z));
                const band = vec2(along, off).toVar();
                // Its star clouds, mottled at every size from five degrees down to under one.
                const mottle = dot(light.noise(band.mul(3.1).add(vec2(0.21, 0.43))), vec4(0.34, 0.3, 0.22, 0.14)).toVar();
                const lie = light.noise(band.mul(1.5).add(vec2(0.7, 0.13))).toVar();
                const core = exp(off.div(0.15).pow2().negate()).toVar();
                const wide = exp(off.div(0.34).pow2().negate());
                // The dark rift wanders along the middle of the band in patches: here broad, there
                // pinched shut.
                const rift = exp(off.sub(0.01).add(lie.r.sub(0.5).mul(0.12))
                    .div(lie.g.mul(0.07).add(0.022)).pow2()
                    .negate())
                    .mul(smoothstep(0.34, 0.6, lie.b.mul(0.6).add(mottle.mul(0.4)))).toVar();
                const seen = light.uGalaxy.mul(smoothstep(0.03, 0.3, up))
                    .mul(pow(moonward, 6).mul(0.9).oneMinus()).toVar();
                const knots = smoothstep(0.38, 0.7, mottle).toVar();
                const glow = core.mul(knots.mul(1.5).add(0.2)).add(wide.mul(0.16)).mul(rift.mul(0.88).oneMinus());
                river.assign(mix(vec3(0.5, 0.58, 1.0), vec3(1.0, 0.84, 0.74), core.mul(knots))
                    .mul(glow).mul(seen).mul(0.066));
                dust.assign(core.mul(seen).mul(rift.oneMinus()).mul(knots.add(0.35)));
            });

            // (How many stars show is the hour's and the air's: few in the afterglow and at dawn
            // and under a veil, the most in a clear deep night.)
            const clear = cover.mul(0.85).oneMinus().mul(veil.mul(0.3).oneMinus()).toVar();
            const starlight = this.stars(direction, dust).mul(light.uStars).mul(smoothstep(0.02, 0.3, up))
                .mul(pow(moonward, 12).mul(0.85).oneMinus())
                .mul(pow(toward, 3).mul(lowness).oneMinus());
            // Shooting stars: each a short bright streak sliding along a line on the sky plane.
            const plane = vec2(direction.x.mul(0.6), direction.z).div(up.add(0.2)).toVar();
            const streak = float(0).toVar();
            for (let index = 0; index < SAKURA_SHOOTING_STARS; index += 1) {
                const shot = this.uShots.element(index);
                const way = this.uShotDirs.element(index).xy;
                const shootAge = light.uTime.sub(shot.z);
                const head = shot.xy.add(way.mul(shootAge.mul(2.6)));
                const along = dot(plane.sub(head), way);
                const across = length(plane.sub(head).sub(way.mul(along)));
                streak.addAssign(smoothstep(0, 0.012, across).oneMinus().mul(smoothstep(-0.9, 0, along))
                    .mul(step(along, 0))
                    .mul(saturate(shootAge.mul(6)))
                    .mul(exp(shootAge.mul(-1.5)))
                    .mul(shot.w));
            }
            // A veil is a thin lit sheet over the vault, brightest round the moon.
            const sheet = light.uCloudLit.mul(veil).mul(pow(moonward, 3).mul(1.3).add(0.3));
            const beyond = sky.add(sheet)
                .add(starlight.mul(1.5).add(river).mul(clear))
                .add(this.moon(direction).mul(cover.mul(0.6).oneMinus()));
            return mix(beyond, cloud, saturate(bank.mul(0.9).add(thin.mul(0.62))))
                .add(vec3(1.5, 1.6, 2.2).mul(streak).mul(smoothstep(0.02, 0.2, up)));
        })();
        const dome = new THREE.Mesh(this.own(new THREE.SphereGeometry(DOME_RADIUS, 48, 24)), material);
        dome.name = 'SakuraSkyDome';
        // Last among the solid things (they write depth, the dome only tests it): the sky behind
        // the trees, the mountain and the lake is never shaded.
        dome.renderOrder = 50;
        dome.frustumCulled = false;
        dome.matrixAutoUpdate = false;
        this.dome = dome;
        this.group.add(dome);
    }

    /** Figure stars as soft sprites and their lines as thin quads that draw in along their length. */
    buildConstellations() {
        const starOffsets = [];
        const starLook = [];
        const linePositions = [];
        const lineUv = [];
        const lineIndices = [];
        const centre = new THREE.Vector3();
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const side = new THREE.Vector3();
        const distance = DOME_RADIUS * 0.92;
        let scale = 1;
        const place = (target, point) => target.copy(centre)
            .addScaledVector(right, Math.tan(THREE.MathUtils.degToRad(point[0] * scale)))
            .addScaledVector(up, Math.tan(THREE.MathUtils.degToRad(point[1] * scale)))
            .normalize()
            .multiplyScalar(distance);
        let lineTotal = 0;
        SAKURA_CONSTELLATIONS.forEach((figure) => { lineTotal += figure.lines.length; });
        let drawn = 0;
        SAKURA_CONSTELLATIONS.forEach((figure, figureIndex) => {
            skyDirection(figure.at[0], figure.at[1], centre);
            scale = figure.scale ?? 1;
            right.crossVectors(centre, new THREE.Vector3(0, 1, 0)).normalize();
            up.crossVectors(right, centre).normalize();
            figure.points.forEach((point, index) => {
                place(a, point);
                starOffsets.push(a.x, a.y, a.z);
                starLook.push(0.7 + ((index * 37 + figureIndex * 11) % 10) * 0.05, figureIndex, this.rng(), 0);
            });
            figure.lines.forEach(([from, to]) => {
                place(a, figure.points[from]);
                place(b, figure.points[to]);
                // Stop short of each star so the line reads as a thread between jewels.
                const gap = 0.14;
                const start = a.clone().lerp(b, gap);
                const end = a.clone().lerp(b, 1 - gap);
                side.crossVectors(end.clone().sub(start), start).normalize().multiplyScalar(distance * 0.0011);
                const base = linePositions.length / 3;
                [[start, -1], [start, 1], [end, -1], [end, 1]].forEach(([point, sign], corner) => {
                    linePositions.push(point.x + side.x * sign, point.y + side.y * sign, point.z + side.z * sign);
                    // across (-1..1), and where this end falls in the order the figures are drawn
                    lineUv.push(sign, (drawn + (corner < 2 ? 0 : 1)) / lineTotal);
                });
                lineIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
                drawn += 1;
            });
        });
        const { light } = this;
        // Lines.
        const lineGeometry = this.own(new THREE.BufferGeometry());
        lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
        lineGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(lineUv, 2));
        lineGeometry.setIndex(lineIndices);
        const lineMaterial = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }));
        lineMaterial.name = 'SakuraConstellationLines';
        const st = uv();
        const reveal = smoothstep(st.y.sub(0.02), st.y.add(0.02), this.uDraw);
        const edge = saturate(float(1).sub(st.x.abs()));
        lineMaterial.colorNode = vec3(0.75, 0.9, 1.5).mul(reveal).mul(edge).mul(this.uFigures)
            .mul(1.7);
        const lines = new THREE.Mesh(lineGeometry, lineMaterial);
        lines.name = 'SakuraConstellationLines';
        lines.frustumCulled = false;
        lines.matrixAutoUpdate = false;
        lines.renderOrder = -90;
        this.group.add(lines);
        // Stars: always faintly there, flaring as their figure is traced.
        const starGeometry = this.own(new THREE.PlaneGeometry(1, 1));
        const starCount = starOffsets.length / 3;
        const offset = instancedBufferAttribute(new THREE.InstancedBufferAttribute(new Float32Array(starOffsets), 3));
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(new Float32Array(starLook), 4));
        const starMaterial = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        starMaterial.name = 'SakuraConstellationStars';
        const toEye = normalize(cameraPosition.sub(offset));
        const spriteRight = normalize(cross(vec3(0, 1, 0), toEye));
        const spriteUp = cross(toEye, spriteRight);
        const size = look.x.mul(this.uFigures.mul(1.4).add(1)).mul(distance * 0.011);
        starMaterial.positionNode = offset.add(spriteRight.mul(positionGeometry.x.mul(size)))
            .add(spriteUp.mul(positionGeometry.y.mul(size)));
        const reach = length(uv().sub(0.5)).mul(2);
        const core = exp(reach.mul(reach).mul(-26)).add(exp(reach.mul(-5)).mul(0.16)).mul(saturate(float(1).sub(reach)));
        const cross4 = max(exp(uv().x.sub(0.5).abs().mul(-90)), exp(uv().y.sub(0.5).abs().mul(-90)))
            .mul(saturate(float(1).sub(reach))).mul(0.5);
        const twinkle = sin(light.uTime.mul(look.z.mul(2).add(1.3)).add(look.z.mul(TAU))).mul(0.2).add(0.8);
        starMaterial.colorNode = vec3(0.85, 0.95, 1.5).mul(core.add(cross4.mul(this.uFigures)))
            .mul(twinkle).mul(this.uFigures.mul(2.4).add(0.7));
        const stars = new THREE.InstancedMesh(starGeometry, starMaterial, starCount);
        stars.name = 'SakuraConstellationStars';
        stars.frustumCulled = false;
        stars.matrixAutoUpdate = false;
        stars.renderOrder = -89;
        this.group.add(stars);
    }

    /**
     * Send one shooting star across the upper sky. It takes a slot whose star has burnt out, else
     * the one with the least light left, so a second star never cuts the first mid-fall. A star the
     * game sent is placed by the garden's chances; one the night sends by itself (`ownStar`) by the
     * sky's own, so the garden's sequence does not depend on whether a star happened to fall.
     */
    shoot(strength = 1) {
        const rng = this.ownStar ? () => this.chance() : this.rng;
        const now = this.light.uTime.value;
        let slot = 0;
        let least = Infinity;
        for (let turn = 1; turn <= SAKURA_SHOOTING_STARS; turn += 1) {
            const index = (this.lastShot + turn) % SAKURA_SHOOTING_STARS;
            const shot = this.shotData[index];
            const age = now - shot.z;
            const left = age >= SHOOT_LIFE || age < 0 ? 0 : shot.w * Math.exp(-1.5 * age);
            if (left < least) {
                least = left;
                slot = index;
            }
        }
        this.shootCount += 1;
        this.lastShot = slot;
        const leftward = this.shootCount % 2 === 0;
        this.shotData[slot].set((leftward ? 0.5 : -0.9) + rng() * 0.5, -1.1 - rng() * 0.9, now, strength);
        const dx = leftward ? -0.86 : 0.86;
        const dy = 0.34 + rng() * 0.2;
        const norm = Math.hypot(dx, dy);
        this.shotDirData[slot].set(dx / norm, dy / norm, 0, 0);
    }

    /**
     * The frame's sky: how far the figures are drawn and how they burn, the moon's glow (its own
     * flare, a fever's and a perfect clear's crown) and the back-to-back corona.
     */
    update(frame = {}) {
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const ranged = (value, top) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, top) : 0);
        this.uDraw.value = clamp01(frame.constellation);
        this.uFigures.value = clamp01(frame.figures);
        this.uMoonGlow.value = Math.min(1.6, Math.max(clamp01(frame.moon), 0.35 * clamp01(frame.fever))
            + 0.55 * ranged(frame.crown, 1.3));
        this.uCorona.value = ranged(frame.corona, 1.6);
        // A star falls by itself every quarter minute or so, when the sky is clear enough to show
        // one and the garden is awake. (A clock that went back, a seek, starts the wait again.)
        const { light } = this;
        const now = light.uTime.value;
        // (The first is due nine seconds after the sky is made, reset or finds its clock put back.)
        if (this.ambientAt === null || now < this.ambientAt - 60) this.ambientAt = now + 9;
        if (now >= this.ambientAt) {
            const open = light.uStars.value > 0.55 && light.uCloud.value < 0.45 && light.uVeil.value < 0.5;
            if (open && !(frame.hush > 0.5)) {
                this.ownStar = true;
                try {
                    this.shoot(0.4 + this.chance() * 0.35);
                } finally {
                    this.ownStar = false;
                }
            }
            this.ambientAt = now + 13 + this.chance() * 26;
        }
    }

    reset() {
        this.shotData.forEach((shot) => shot.set(0, 0, -100, 0));
        this.ownChance = 0x51a7;
        this.ambientAt = null;
        this.lastShot = 0;
        this.uDraw.value = 0;
        this.uFigures.value = 0;
        this.uMoonGlow.value = 0;
        this.uCorona.value = 0;
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
