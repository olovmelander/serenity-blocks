/**
 * Summer — sky and air.
 *
 * The sky of a summer's eve, seen low: the game looks out over the lake, so what the frame holds
 * is the band from the hills to about twenty-five degrees up, and that is where the clouds are
 * drawn. Two rows of cumulus stand on flat bases over the far shore and above it, seen from the
 * side and lit by the low sun behind them (a dark body, a burning rim); streaks of a high deck
 * and a veil of cirrus cross above; a mackerel field takes over when the air stands still; in
 * the white night noctilucent clouds glow over the place where the sun rests; and when the game
 * earns it the sun throws a fan of rays across all of it. The weather (summer-weather.js) says
 * how much of each there is, the hour of the night (summer-hours.js) what colour it is.
 *
 * Under the sky: the thin mist that lies on still water, pollen that only shows where the sun
 * reaches it, and the rain of a sun shower, every drop lit from behind. All of it reads the
 * shared light rig, so the far shore dissolves into exactly the colour that is behind it.
 */
import * as THREE from 'three/webgpu';
import {
    atan, cameraPosition, cos, cross, dot, exp, float, fract, instancedBufferAttribute, length, mix, normalize,
    positionGeometry, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { SUMMER_VIEWS, summerEye } from './summer-composition.js';
import { summerGroundHeight } from './summer-terrain.js';

const TAU = Math.PI * 2;
/** Angular radius of the sun's disc: larger than life, as a low sun always seems. */
export const SUMMER_SUN_RADIUS_DEGREES = 1.7;
// z of each mist bank (far to near), its height, and how thick it lies.
const MIST_BANKS = [
    [-262, 34, 0.5], [-196, 24, 0.44], [-140, 17, 0.38], [-96, 12, 0.3], [-58, 8, 0.24],
];
/**
 * The two rows of cumulus, far to near: the tangent of the elevation its bases stand at, how
 * high a full-grown cloud of the row reaches above them, tiles of the noise texture a radian
 * (a farther row is smaller), a seed, and how fast it travels against the sky's drift.
 */
const CUMULUS_ROWS = [
    {
        base: 0.105, reach: 0.17, scale: 4.2, seed: 0.37, pace: 14,
    },
    {
        base: 0.235, reach: 0.24, scale: 2.7, seed: 5.81, pace: 22,
    },
];
/** How tall the box of falling rain is, metres, and how far in front of the eye it reaches. */
const RAIN_HEIGHT = 13;
const RAIN_DEPTH = 46;

export class SummerAtmosphere {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SummerAir';
        this.owned = [];
        // The rain is drawn (at no strength) for the first frames, and for as long as the theme
        // builds hidden behind another, so its pipeline exists before the first shower.
        this.warmFrames = 4;
        this.warming = false;
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildSky();
        this.buildMist();
        this.buildMotes();
        this.buildRain();
        return this;
    }

    buildSky() {
        const { light, tier } = this;
        const detail = Number.isFinite(tier.sky) ? tier.sky : 2;
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, fog: false, depthWrite: false,
        }));
        material.name = 'SummerSkyDome';
        const direction = normalize(positionWorld.sub(cameraPosition));
        const sunward = saturate(dot(direction, light.uSunDir));
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const sunFlat = normalize(vec2(light.uSunDir.x, light.uSunDir.z));
        const toward = dot(flat, sunFlat).mul(0.5).add(0.5);
        // The sky as the eye lays it out: azimuth from straight ahead and the tangent of the
        // elevation. The clouds of the low sky are drawn in these, from the side.
        const azimuth = atan(direction.x, direction.z.negate().add(0.00001));
        const elevation = direction.y.div(length(vec2(direction.x, direction.z)).max(0.0001));
        const sunAzimuth = light.uSunSky.x;
        const sunElevation = light.uSunSky.y;
        const drift = light.uCloudDrift;
        const octaves = vec4(0.46, 0.29, 0.16, 0.09);
        // The hour's cloud colours, from the side of the sky away from the sun to the side toward it.
        const shade = mix(light.uCloudShadeAway, light.uCloudShadeToward, pow(toward, 1.3));
        const body = mix(light.uCloudBodyAway, light.uCloudBodyToward, pow(toward, 1.6));
        const gilt = mix(light.uCloudGiltAway, light.uCloudGiltToward, pow(toward, 2.2));
        const back = pow(toward, 2);

        // -- the high deck: a flat layer seen from below and far away ----------------------
        const plane = vec2(direction.x, direction.z).div(direction.y.max(0).add(0.14));
        const billow = (at) => {
            const broad = light.noise(at.mul(vec2(0.2, 0.34)).add(vec2(drift, 0.21)));
            const warped = at.mul(vec2(0.43, 0.7)).add(broad.rg.sub(0.5).mul(0.3)).add(vec2(drift.mul(1.7), 0.57));
            return dot(broad, octaves).mul(0.55).add(dot(light.noise(warped), octaves).mul(0.45));
        };
        const density = billow(plane);
        const lit = billow(plane.add(sunFlat.mul(0.22)));
        const deck = smoothstep(0.03, 0.13, direction.y)
            .mul(smoothstep(0.34, 0.8, direction.y).oneMinus().mul(0.85).add(0.15));
        const crisp = light.noise(plane.mul(vec2(1.9, 3.1)).add(vec2(drift.mul(3), 0.13)));
        // The weather opens and closes the deck: its threshold slides with the cover.
        const deckLine = float(0.615).sub(light.uSky.w.mul(0.12));
        const cover = smoothstep(deckLine, deckLine.add(0.055), density.add(crisp.b.sub(0.5).mul(0.05))
            .add(crisp.a.sub(0.5).mul(0.03))).mul(deck);
        const edge = saturate(density.sub(lit).mul(9).add(0.42));
        const thin = float(1).sub(smoothstep(deckLine.add(0.005), deckLine.add(0.13), density));
        const streaks = mix(
            mix(shade, body, smoothstep(0.1, 0.6, edge)),
            gilt,
            saturate(smoothstep(0.55, 1, edge).mul(0.8).add(thin.mul(pow(toward, 3)).mul(0.7))),
        );
        // High cirrus: long streaks that keep the last rose of the day.
        const veil = light.noise(plane.mul(vec2(0.05, 0.5)).add(vec2(drift.mul(0.4), 0.7)));
        const cirrus = smoothstep(0.56, 0.84, veil.r.mul(0.6).add(veil.b.mul(0.4)))
            .mul(smoothstep(0.12, 0.45, direction.y)).mul(light.uSky2.y.mul(0.36));

        let sky = light.sky(direction);
        let hidden = float(0);
        // -- noctilucent clouds: the white night's own, over the place where the sun rests ---
        if (detail >= 1) {
            const away = azimuth.sub(sunAzimuth);
            const wisp = light.noise(vec2(azimuth.mul(1.9).add(drift.mul(9)), elevation.mul(7.5))
                .add(veil.rg.sub(0.5).mul(0.22)));
            const ripple = sin(azimuth.mul(74).add(elevation.mul(190)).add(wisp.r.mul(9))).mul(0.5).add(0.5);
            // A delicate thing: thin wisps in a low band, brightest over the sun and gone a
            // quarter of the sky to either side of it.
            const band = smoothstep(0.03, 0.11, elevation).mul(smoothstep(0.16, 0.4, elevation).oneMinus());
            const shining = smoothstep(0.5, 0.78, wisp.g.mul(0.55).add(wisp.b.mul(0.45)))
                .mul(ripple.mul(0.6).add(0.4)).mul(band).mul(exp(away.mul(away).mul(-2.6)))
                .mul(light.uSky2.w);
            sky = sky.add(vec3(0.34, 0.62, 1.05).mul(shining.mul(0.5)));
        }
        sky = mix(sky, mix(light.uCirrusAway, light.uCirrusToward, pow(toward, 2)), cirrus.mul(cover.oneMinus()));
        // -- the mackerel field: ripples of high cloud the low sun lights from underneath ----
        if (detail >= 1) {
            // A fleece of small cloudlets, closely packed with thin gaps of sky between them, laid
            // on the cloud's own plane (so they close up toward the horizon as the real ones do).
            // A slow noise bends the plane so the fleece is ordered in loose rows, never a lattice,
            // and the field as a whole comes and goes in patches.
            const bend = light.noise(plane.mul(vec2(0.11, 0.19)).add(vec2(drift.mul(0.8), 0.4)));
            const laid = plane.add(bend.rg.sub(0.5).mul(0.5)).add(vec2(drift.mul(6), 0));
            const tufts = light.noise(laid.mul(1.14));
            const rows = sin(laid.x.mul(9).add(laid.y.mul(27))).mul(0.5).add(0.5);
            const cells = tufts.b.mul(0.5).add(tufts.g.mul(0.3)).add(tufts.a.mul(0.2)).add(rows.sub(0.5).mul(0.3));
            const field = smoothstep(0.42, 0.62, bend.r.mul(0.5).add(veil.g.mul(0.5)).add(light.uSky2.x.mul(0.12)));
            const mackerel = smoothstep(0.43, 0.55, cells).mul(field)
                .mul(smoothstep(0.05, 0.2, direction.y)).mul(light.uSky2.x);
            const core = smoothstep(0.52, 0.72, cells);
            // Lit from underneath by the low sun: a bright fleece toward it, with a grey heart.
            const fleece = mix(mix(body, gilt, back.mul(0.6).add(0.3)), shade, core.mul(back.mul(0.45).add(0.2)));
            sky = mix(sky, fleece, mackerel.mul(0.78));
            hidden = hidden.max(mackerel.mul(0.45));
        }
        sky = mix(sky, streaks.mul(light.uWarmth.mul(0.12).add(1)), cover.mul(0.94));
        hidden = hidden.max(cover);

        // -- cumulus, seen from the side ----------------------------------------------------
        // A row is a line of clouds standing on one flat base: where along the horizon they mass
        // is one slow noise, their billows a finer one, and a cloud ends where its billows no
        // longer outweigh the height above the base. The same field read a step toward the sun
        // says which side of a billow is lit.
        const toSun = normalize(vec2(sunAzimuth.sub(azimuth), sunElevation.sub(elevation)).add(vec2(0.0001, 0)));
        const cumulus = (row, amount, tall) => {
            const along = azimuth.mul(row.scale).add(drift.mul(row.pace)).add(row.seed);
            const up = elevation.mul(row.scale);
            const lift = elevation.sub(row.base).div(tall.mul(row.reach).add(0.02));
            const massing = light.noise(vec2(along.mul(0.22), row.seed * 0.613));
            const mass = massing.r.mul(0.7).add(massing.g.mul(0.3));
            const at = vec2(along, up).mul(0.5);
            const broad = light.noise(at);
            let shape = dot(broad, octaves);
            if (detail >= 2) {
                const fine = light.noise(at.mul(3.4).add(broad.rg.sub(0.5).mul(0.24)));
                shape = shape.mul(0.7).add(dot(fine, octaves).mul(0.3));
            }
            const lee = dot(light.noise(at.add(toSun.mul(0.05))), octaves);
            const line = float(0.74).sub(amount.mul(0.44));
            const field = mass.sub(line).mul(5.5).add(shape.sub(0.5).mul(2.1)).sub(lift.max(0).mul(1.5));
            const cloud = smoothstep(0.0, 0.085, field).mul(smoothstep(-0.1, 0.03, lift));
            // Deep in the cloud, on its sunward billows, or at its thin edge.
            const deep = smoothstep(0.05, 0.75, field);
            const facing = saturate(dot(broad, octaves).sub(lee).mul(9).add(0.42));
            const sunlit = smoothstep(0.22, 0.72, facing);
            const rim = float(1).sub(smoothstep(0.0, 0.3, field));
            const under = float(1).sub(smoothstep(0.0, 0.5, lift));
            // The billows themselves: every hollow between two of them is a little darker.
            const relief = shape.sub(0.5).mul(1.6).add(0.92);
            // Away from the sun a cloud is lit from the front: a peach body with cream billows.
            // Toward the sun it stands against the light: a shaded heart inside a burning rim.
            const lighted = mix(shade, body, sunlit.mul(0.8).add(0.2).mul(deep.mul(back).mul(0.55).oneMinus()));
            const gilded = saturate(sunlit.mul(sunlit).mul(back.mul(0.4).oneMinus()).mul(0.8)
                .mul(deep.mul(0.4).oneMinus()).add(rim.mul(back).mul(0.95)));
            const tone = mix(mix(lighted, shade, under.mul(0.62)), gilt, gilded).mul(relief);
            return { cloud, tone };
        };
        const far = cumulus(CUMULUS_ROWS[0], light.uSky.x, light.uSky.y);
        sky = mix(sky, far.tone.mul(light.uWarmth.mul(0.12).add(1)), far.cloud.mul(0.95));
        hidden = hidden.max(far.cloud);
        if (detail >= 1) {
            const near = cumulus(CUMULUS_ROWS[1], light.uSky.z, light.uSky.y.mul(0.8).add(0.2));
            sky = mix(sky, near.tone.mul(light.uWarmth.mul(0.12).add(1)), near.cloud.mul(0.95));
            hidden = hidden.max(near.cloud);
        }

        // -- the sun --------------------------------------------------------------------------
        // A clean disc and a soft glare, dimmed where a cloud crosses it; and, when the weather
        // or the game calls for it, a fan of rays about it: sampled round a circle, so the fan
        // has no seam, and turning slowly.
        const offset = vec2(azimuth.sub(sunAzimuth), elevation.sub(sunElevation));
        const span = length(offset);
        const spoke = light.noise(offset.div(span.max(0.0001)).mul(0.9)
            .add(vec2(0.37, light.uTime.mul(0.0045))));
        const fan = pow(spoke.g.mul(0.78).add(spoke.b.mul(0.22)), 2.6).mul(3.6)
            .mul(exp(span.mul(-2.3))).mul(smoothstep(0.035, 0.14, span));
        const rays = fan.mul(light.uSky2.z.mul(0.3).add(light.uSunburst.mul(1.7)))
            .mul(hidden.mul(0.55).oneMinus());
        const radius = Math.cos(THREE.MathUtils.degToRad(SUMMER_SUN_RADIUS_DEGREES));
        const disc = smoothstep(radius - 0.00009, radius + 0.00008, sunward);
        const glare = pow(sunward, 1700).mul(0.6).add(pow(sunward, 260).mul(0.14));
        material.colorNode = sky.add(light.uSunColor.mul(disc.mul(3.4).add(glare))
            .mul(hidden.mul(0.6).oneMinus()).mul(light.uWarmth.mul(0.25).add(1)))
            .add(light.uSunColor.mul(rays.mul(0.22)));
        const dome = new THREE.Mesh(this.own(new THREE.SphereGeometry(3200, 48, 24)), material);
        dome.name = 'SummerSky';
        dome.renderOrder = -100;
        dome.frustumCulled = false;
        dome.matrixAutoUpdate = false;
        this.sky = dome;
        this.group.add(dome);
    }

    /** Thin evening mist on the lake; where the sun finds it, it turns to gold. */
    buildMist() {
        const { light } = this;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        geometry.translate(0, 0.5, 0);
        MIST_BANKS.slice(0, this.tier.mist).forEach(([z, height, thickness], index) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            }));
            material.name = `SummerMistBank ${index}`;
            const st = uv();
            const world = positionWorld;
            const scroll = light.uTime.mul(0.004 + index * 0.0012);
            const broad = vec2(world.x.mul(0.006).add(scroll), st.y.mul(0.45).add(index * 0.37));
            const billow = light.noise(broad).r.mul(0.6)
                .add(light.noise(vec2(world.x.mul(0.019).sub(scroll.mul(1.6)), st.y.mul(1.2))).g.mul(0.4));
            // Thickest on the water, gone by the top of the card; no edge at either side.
            const band = exp(st.y.mul(-3.6)).mul(smoothstep(0.6, 1, st.y).oneMinus());
            const sides = smoothstep(0, 0.12, st.x).mul(smoothstep(0, 0.12, st.x.oneMinus()));
            const sun = light.sunlight({ cloud: false });
            const direction = normalize(world.sub(cameraPosition));
            const sunward = saturate(dot(direction, light.uSunDir));
            material.colorNode = light.uHazeCool.mul(1.2)
                .add(light.uHazeWarm.mul(sun).mul(pow(sunward, 2).mul(1.2).add(0.14)))
                .add(light.uHazeWarm.mul(light.uWarmth).mul(0.1));
            // The weather thickens the banks when mist rises off the water, and fills their gaps.
            const risen = light.uAir.x;
            material.opacityNode = smoothstep(float(0.36).sub(risen.mul(0.2)), 0.84, billow).mul(band).mul(sides)
                .mul(risen.mul(1.5).add(1)).mul(thickness * 0.6).min(0.92);
            const mist = new THREE.Mesh(geometry, material);
            mist.position.set(0, -0.05, z);
            mist.scale.set(460 + -z * 3.2, height, 1);
            mist.name = `SummerMistBank ${index}`;
            mist.renderOrder = 10 + index;
            mist.frustumCulled = false;
            mist.updateMatrix();
            mist.matrixAutoUpdate = false;
            this.group.add(mist);
        });
    }

    /** Pollen and midges: invisible in shade, a slow sparkle wherever the sun crosses them. */
    buildMotes() {
        const { light, rng } = this;
        const count = this.tier.motes;
        if (!(count > 0)) return;
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const z = 13 - rng() ** 1.5 * 46;
            const x = (rng() * 2 - 1) * (7 + (13 - z) * 0.75);
            data.set([x, Math.max(0, summerGroundHeight(x, z)) + 0.25 + rng() ** 1.6 * 7.5, z, rng()], i * 4);
        }
        const mote = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'SummerPollen';
        const t = light.uTime;
        const phase = mote.w.mul(TAU);
        const drift = vec3(
            sin(t.mul(0.23).add(phase)).mul(0.7).add(light.uWindDir.x.mul(light.uGust).mul(1.2)),
            sin(t.mul(0.17).add(phase.mul(2.3))).mul(0.45),
            cos(t.mul(0.19).add(phase.mul(1.7))).mul(0.6),
        );
        const size = mote.w.mul(0.035).add(0.022);
        material.positionNode = positionLocal.mul(size).add(mote.xyz).add(drift);
        const disc = saturate(float(1).sub(length(uv().sub(0.5)).mul(2)));
        const twinkle = sin(t.mul(mote.w.mul(2).add(1.3)).add(phase.mul(7))).mul(0.4).add(0.6);
        material.colorNode = light.uSunColor.mul(0.42).add(light.uHazeWarm.mul(light.uGlow));
        material.opacityNode = disc.pow2().mul(twinkle)
            .mul(light.sunlight({ cloud: false }).mul(0.9).add(light.uGlow.mul(0.3)));
        const motes = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        motes.name = 'SummerPollen';
        // Specks this small do not survive the mirror's half-size, rippled image.
        motes.userData.unmirrored = true;
        motes.renderOrder = 30;
        motes.frustumCulled = false;
        motes.matrixAutoUpdate = false;
        this.motes = motes;
        this.group.add(motes);
    }

    /**
     * The rain of a sun shower: fine streaks falling through the air in front of the eye, each a
     * sliver that the sun behind it lights like a thread of glass. They are a box of drops that
     * fall and come round; the weather says how many of them show (none at all, most of the time:
     * the mesh is hidden then, not merely transparent).
     */
    buildRain() {
        const { light, rng } = this;
        const count = Math.round((this.tier.motes || 0) * 1.7);
        if (!(count > 0)) return;
        const [eyeX, , eyeZ] = summerEye(SUMMER_VIEWS.landscape);
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const depth = 2.5 + rng() ** 1.4 * RAIN_DEPTH;
            const side = (rng() * 2 - 1) * (2.5 + depth * 0.62);
            data.set([eyeX + side, rng(), eyeZ - depth, rng()], i * 4);
        }
        const drop = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4)); // x, phase, z, seed
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'SummerRain';
        const t = light.uTime;
        // Each drop falls the height of the box in a little over a second and comes round.
        const fall = fract(t.mul(drop.w.mul(0.16).add(0.74)).add(drop.y)).oneMinus();
        const slant = vec3(light.uWindDir.x, 0, light.uWindDir.z).mul(light.uWind.mul(0.34).add(0.04));
        const down = normalize(vec3(0, -1, 0).add(slant));
        const head = vec3(drop.x, fall.mul(RAIN_HEIGHT), drop.z).add(slant.mul(fall.mul(RAIN_HEIGHT).negate()));
        const toEye = cameraPosition.sub(head);
        const range = length(toEye);
        const side = normalize(cross(down, toEye));
        // A streak keeps about a pixel of width however far off it falls.
        const width = range.mul(0.0011).add(0.004);
        const long = drop.w.mul(0.3).add(0.42);
        material.positionNode = head.add(side.mul(positionGeometry.x.mul(width)))
            .add(down.mul(positionGeometry.y.mul(long)));
        const st = uv();
        const view = toEye.div(range.max(0.001)).negate();
        const against = pow(saturate(dot(view, light.uSunDir)), 5);
        // Only a share of the drops fall in a light shower; all of them at its height.
        const falling = smoothstep(drop.w, drop.w.add(0.2), light.uAir.y.mul(1.2));
        const thread = saturate(float(1).sub(st.x.sub(0.5).abs().mul(2))).mul(sin(st.y.mul(Math.PI)));
        material.colorNode = light.uSunColor.mul(against.mul(1.5).add(0.1)).add(light.uSkyLight.mul(0.5));
        material.opacityNode = thread.mul(falling).mul(smoothstep(1.2, 4, range)).mul(0.5);
        const rain = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        rain.name = 'SummerRain';
        rain.userData.unmirrored = true;
        rain.renderOrder = 34;
        rain.frustumCulled = false;
        rain.matrixAutoUpdate = false;
        rain.visible = false;
        this.rain = rain;
        this.group.add(rain);
    }

    /** One frame: the rain is in the scene only while it falls (or while its pipeline is warmed). */
    update() {
        if (this.warmFrames > 0) this.warmFrames -= 1;
        if (this.rain) {
            this.rain.visible = this.light.uAir.value.y > 0.004 || this.warmFrames > 0 || this.warming === true;
        }
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.rain = null;
    }
}
