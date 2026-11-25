/**
 * Golden Forest — sky and air.
 *
 * The sky dome with its great low sun, the long bars of evening cloud and, when the air brings
 * it, a ceiling of high cloud lit from beneath; banks of mist lying on the water and wisps
 * smoking off it; and dust that only shows where the sun reaches it. All of it reads the shared
 * light rig, so the far shore dissolves into exactly the colour that is behind it and the motes
 * sparkle in the same shafts the shadow map carves. What the air does to it (how much cloud, how
 * thick the mist) is the rig's too: golden-forest-airs.js.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, cameraPosition, clamp, cos, dot, exp, float, instancedBufferAttribute, length, max, mix, normalize,
    positionLocal, positionWorld, pow, saturate, sin, smoothstep, sqrt, step, uv, vec2, vec3,
} from 'three/tsl';
import { goldenForestGroundHeight } from './golden-forest-terrain.js';

const TAU = Math.PI * 2;
/** Angular radius of the sun's disc: far larger than life, as the lake has always had it. */
export const GOLDEN_FOREST_SUN_RADIUS_DEGREES = 2.5;
// z of each mist bank (far to near), its height, and how thick it lies.
const MIST_BANKS = [
    [-232, 30, 0.6], [-176, 22, 0.52], [-128, 17, 0.46], [-88, 13, 0.4], [-52, 9, 0.34], [-24, 6, 0.26],
];
/**
 * The wisps smoking off the water: sheets lying just over the lake (their height in metres, how
 * fast their wisps drift, a phase), seen almost edge on, so their slow curls draw out along the
 * water. Two of them a little apart slide over one another as the eye breathes.
 */
const SMOKE_SHEETS = [[0.34, 1, 0], [0.95, 1.45, 5.3]];
/** The ceiling of high cloud: its scales in the sheet, and how far it is read toward the sun for its lit flanks. */
const DECK = Object.freeze({
    masses: 0.17, cells: 0.4, fine: 1.5, pace: 0.0021, stepMasses: 0.05, stepCells: 0.14,
});

export class GoldenForestAtmosphere {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestAir';
        this.owned = [];
        /** The sheets of smoke on the water: not for the lake's mirror (they lie on it). */
        this.smoke = [];
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildSky();
        this.buildMist();
        this.buildSmoke();
        this.buildMotes();
        return this;
    }

    buildSky() {
        const { light, tier } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, fog: false, depthWrite: false,
        }));
        material.name = 'GoldenForestSkyDome';
        const sinRadius = Math.sin(THREE.MathUtils.degToRad(GOLDEN_FOREST_SUN_RADIUS_DEGREES));
        // The ceiling's second reading toward the sun (which flank of a cell is lit) is two texture
        // reads of its own: the lighter tiers draw the ceiling without it.
        const flankDeck = tier.post === true;
        material.colorNode = Fn(() => {
            const direction = normalize(positionWorld.sub(cameraPosition)).toVar();
            const el = direction.y.max(0).toVar();
            const cosSun = dot(direction, light.uSunDir).toVar();
            const sunward = saturate(cosSun).toVar();
            const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0))).toVar();
            const sunFlat = normalize(vec2(light.uSunDir.x, light.uSunDir.z)).toVar();
            const toward = dot(flat, sunFlat).mul(0.5).add(0.5).toVar();
            const col = light.sky(direction).toVar();
            // How much cloud lies over the sun's disc here.
            const veil = float(0).toVar();

            // Bars of evening cloud: long along the horizon, thin, and sliding very slowly.
            const plane = vec2(direction.x, direction.z).div(el.add(0.11)).toVar();
            const drift = light.uCloudClock.mul(0.0011).toVar();
            const density = light.noise(plane.mul(vec2(0.043, 0.15)).add(vec2(drift, 0))).g.mul(0.55)
                .add(light.noise(plane.mul(vec2(0.1, 0.4)).sub(vec2(drift.mul(1.7), 0.3))).b.mul(0.3))
                .add(light.noise(plane.mul(vec2(0.29, 0.86)).add(vec2(drift.mul(2.6), 0.1))).a.mul(0.15))
                .toVar();
            // (The air sets how many bars there are: as the lake was built at rest, a few in a clear evening.)
            const low = light.uBars.mul(-0.2).add(0.74).toVar();
            // Bars crowd the low sky and open up overhead, where the dusk blue shows between them.
            const cover = smoothstep(low, low.add(0.12), density).mul(smoothstep(0.015, 0.16, direction.y))
                .mul(smoothstep(0.62, 0.18, direction.y).mul(0.75).add(0.25))
                .mul(smoothstep(0.0, 0.12, light.uBars))
                .toVar();
            // Their thin edges catch the sun from below and burn; their bodies are ember-brown near the
            // sun and turn a dusky mauve away from it and higher up, where the sky is cooler.
            const edge = float(1).sub(smoothstep(low.sub(0.02), low.add(0.22), density));
            // (The hour sets each of these: golden-forest-moods.js.)
            const warmBody = mix(light.uCloudEmber, light.uCloudGlow, toward.oneMinus().mul(0.5).add(0.15)).toVar();
            const coolBody = mix(light.uCloudDusk, light.uCloudHigh, smoothstep(0.08, 0.5, direction.y)).toVar();
            const body = mix(coolBody, warmBody, smoothstep(0.35, 0.85, toward));
            const cloud = mix(body, light.uCloudGilt, edge.mul(pow(toward, 1.6)).mul(light.uWarmth.mul(0.3).add(1)));
            col.assign(mix(col, cloud, cover.mul(0.86)));
            veil.assign(cover.mul(0.45));

            // The ceiling: a sheet of high cloud over the upper sky, open along the horizon, with the
            // low sun shining up through the slot onto its underside. Drawn in its own level sheet,
            // so its cells lie in long lenses toward the horizon as a ceiling seen from under its
            // edge does: broad masses, cells bent by them, fine tatters bent by the cells, each
            // drifting at its own pace so the field forms and melts as it goes. The same field read
            // a step toward the sun says which flank of a cell is lit: toward the sun the ceiling
            // is fire with dark hearts, away from it rose over mauve.
            If(light.uDeck.greaterThan(0.01).and(direction.y.greaterThan(0.004)), () => {
                const sheet = vec2(direction.x, direction.z).div(el.add(0.12)).toVar();
                const wind = vec2(light.uWindDir.x, light.uWindDir.z).toVar();
                const pace = light.uCloudClock.mul(DECK.pace).toVar();
                const p0 = sheet.mul(DECK.masses).sub(wind.mul(pace)).add(vec2(7.1, 3.3)).toVar();
                const big = light.noise(p0).toVar();
                const p1 = sheet.mul(DECK.cells).sub(wind.mul(pace.mul(2.6))).add(big.gb.sub(0.5).mul(0.3))
                    .add(vec2(3.7, 1.9))
                    .toVar();
                const cells = light.noise(p1).toVar();
                const p2 = sheet.mul(DECK.fine).sub(wind.mul(pace.mul(6.5))).add(cells.gb.sub(0.5).mul(0.22));
                const tatter = light.noise(p2).g.toVar();
                const field = big.r.mul(0.4).add(cells.g.mul(0.4)).add(tatter.mul(0.2)).toVar();
                // (A ceiling: at full cover four fifths of the sheet is cloud and the dusk shows in the rest.)
                const lo = mix(float(0.78), float(0.33), light.uDeck).toVar();
                const dense = smoothstep(lo, lo.add(0.085), field).toVar();
                const heart = smoothstep(lo.add(0.1), lo.add(0.34), field).toVar();
                // The slot: the ceiling ends some way above the horizon, its edge frayed by its own masses.
                const slot = smoothstep(0.0, 0.05, el.sub(big.g.mul(0.07).add(0.04)));
                const deck = dense.mul(slot).mul(smoothstep(0.0, 0.25, light.uDeck)).toVar();
                // Where the field thins toward the sun, this point is on a sunward flank.
                let flank = float(0.25);
                if (flankDeck) {
                    const field2 = light.noise(p0.add(sunFlat.mul(DECK.stepMasses))).r.mul(0.4)
                        .add(light.noise(p1.add(sunFlat.mul(DECK.stepCells))).g.mul(0.4))
                        .add(tatter.mul(0.2));
                    flank = clamp(field.sub(field2).mul(7), -0.6, 1.4);
                }
                // A ceiling lit from beneath: every cloudlet's thin rim glows, ember and gold toward
                // the sun and rose round from it, and its thick heart is dusk. With four fifths of
                // the sheet in cloud that is a mackerel sky on fire. (Two traps: hearts the colour
                // of the dusk under a THIN cover leave only a scatter of pale flecks; and a glow
                // past about 1 in the linear scale prints as white cream, not as fire.)
                const near = pow(sunward, 5);
                const round = toward.mul(toward).toVar();
                const under = mix(coolBody.mul(1.25).add(light.uSkyMid.mul(0.5)), light.uCloudGlow.mul(1.1), round)
                    .add(light.uCloudGilt.mul(near.mul(0.1)));
                const fire = light.uCloudGilt.mul(near.mul(0.2).add(mix(float(0.025), float(0.17), round)))
                    .mul(light.uWarmth.mul(0.25).add(1));
                const lit = fire.mul(flank.add(0.4).max(0)).mul(mix(float(1.2), float(0.25), heart));
                const dusk = coolBody.mul(0.8).add(under.mul(0.16));
                // (Without the second reading no flank is lit, and a dark heart inside a glowing rim
                // is a ringed blob: the lighter tiers keep their hearts nearly as light as their rims.)
                const deckColour = mix(under, dusk, heart.mul(flankDeck ? 0.88 : 0.4)).add(lit);
                col.assign(mix(col, deckColour, deck.mul(0.94)));
                veil.assign(max(veil, deck.mul(mix(float(0.35), float(0.8), heart))));
            });

            // The sun: an orb of molten gold, white at its heart and deepening to ember at its limb,
            // with a hot rim of glare, dimmed where cloud crosses it.
            const offAxis = sqrt(max(float(1).sub(cosSun.mul(cosSun)), 0)).div(sinRadius);
            const disc = smoothstep(1.0, 0.965, offAxis).mul(step(0.5, cosSun));
            const depth = sqrt(max(float(1).sub(offAxis.mul(offAxis)), 0));
            const orb = mix(vec3(1.0, 0.46, 0.2), vec3(1), smoothstep(0.0, 0.8, depth)).mul(depth.mul(0.7).add(0.3));
            // A perfect clear crowns the treetops: the glare opens into a wide corona (uFlare).
            const glare = pow(sunward, 1400).mul(0.7).add(pow(sunward, 190).mul(light.uFlare.mul(0.5).add(0.2)))
                .add(pow(sunward, 36).mul(light.uFlare.mul(0.1)));
            return col.add(light.uSunColor.mul(orb.mul(disc).mul(3).add(glare))
                .mul(veil.oneMinus()).mul(light.uWarmth.mul(0.25).add(1)));
        })();
        const dome = new THREE.Mesh(this.own(new THREE.SphereGeometry(3000, 48, 24)), material);
        dome.name = 'GoldenForestSky';
        dome.renderOrder = -100;
        dome.frustumCulled = false;
        dome.matrixAutoUpdate = false;
        this.sky = dome;
        this.group.add(dome);
    }

    /** Banks of mist lying on the lake; where the sun finds them they turn to gold. */
    buildMist() {
        const { light } = this;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        geometry.translate(0, 0.5, 0);
        MIST_BANKS.slice(0, this.tier.mist).forEach(([z, height, thickness], index) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            }));
            material.name = `GoldenForestMistBank ${index}`;
            const st = uv();
            const world = positionWorld;
            const scroll = light.uTime.mul(0.004 + index * 0.0012);
            // The banks billow as they drift: the broad shapes one way, the finer the other, and
            // both slowly upward, so a bank changes shape rather than only sliding.
            const rise = light.uTime.mul(0.0045);
            const broad = vec2(world.x.mul(0.006).add(scroll), st.y.mul(0.45).add(index * 0.37).sub(rise));
            const billow = light.noise(broad).r.mul(0.6)
                .add(light.noise(vec2(world.x.mul(0.019).sub(scroll.mul(1.6)), st.y.mul(1.2).sub(rise.mul(2.2)))).g
                    .mul(0.4));
            // Thickest on the water, gone by the top of the card; no edge at either side.
            const band = exp(st.y.mul(-3.4)).mul(smoothstep(1, 0.6, st.y));
            const sides = smoothstep(0, 0.12, st.x).mul(smoothstep(0, 0.12, st.x.oneMinus()));
            const sun = light.sunlight();
            const direction = normalize(world.sub(cameraPosition));
            const sunward = saturate(dot(direction, light.uSunDir));
            material.colorNode = light.uHazeCool.mul(1.25)
                .add(light.uHazeWarm.mul(sun).mul(pow(sunward, 2).mul(1.3).add(0.16)))
                .add(light.uHazeWarm.mul(light.uWarmth).mul(0.1));
            // The air sets how thick the banks lie (a mist fills them in and stands them taller);
            // the rising wind of hot play lifts them off the water (uClearAir).
            const fill = light.uMist.sub(1).mul(0.16);
            material.opacityNode = smoothstep(float(0.3).sub(fill), float(0.78).sub(fill), billow).mul(band).mul(sides)
                .mul(thickness)
                .mul(light.uMist)
                .mul(light.uClearAir.mul(-0.55).add(1))
                .min(0.94);
            material.positionNode = positionLocal.mul(vec3(1, light.uMist.mul(0.3).add(0.7), 1));
            const mist = new THREE.Mesh(geometry, material);
            mist.position.set(0, -0.05, z);
            mist.scale.set(420 + -z * 3.2, height, 1);
            mist.name = `GoldenForestMistBank ${index}`;
            mist.renderOrder = 10 + index;
            mist.frustumCulled = false;
            mist.updateMatrix();
            mist.matrixAutoUpdate = false;
            this.group.add(mist);
        });
    }

    /**
     * Wisps smoking off the water: level sheets just over the lake, seen almost edge on. Their
     * curls come from one noise bent by another, each drifting at its own pace, so the wisps
     * form, lean with the breeze and melt; they stand thickest in a mist and are gone in a wind.
     */
    buildSmoke() {
        const { light } = this;
        const sheets = SMOKE_SHEETS.slice(0, this.tier.smoke || 0);
        if (!sheets.length) return;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        geometry.rotateX(-Math.PI / 2);
        sheets.forEach(([height, pace, phase], index) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            }));
            material.name = `GoldenForestWaterSmoke ${index}`;
            const world = positionWorld;
            const wind = vec2(light.uWindDir.x, light.uWindDir.z);
            const drift = wind.mul(light.uTime.mul(0.011 * pace));
            const broad = light.noise(world.xz.mul(0.0085).sub(drift.mul(0.4)).add(vec2(phase, phase * 0.37)));
            const curl = light.noise(world.xz.mul(vec2(0.021, 0.034)).sub(drift).add(broad.gb.sub(0.5).mul(0.42))
                .add(vec2(phase * 1.7, 0.2)));
            const wisps = smoothstep(0.42, 0.78, broad.r.mul(0.45).add(curl.g.mul(0.55)));
            const offset = world.sub(cameraPosition);
            const range = length(offset);
            const direction = offset.div(max(range, 0.001));
            // No edge near the eye, none at the sheet's rim, and nothing over the bank at your feet.
            const reach = smoothstep(16, 44, range).mul(smoothstep(330, 180, range));
            const sunward = saturate(dot(direction, light.uSunDir));
            // (No shadow lookup: the open water these wisps lie on is in the sun, and two sheets of nine
            // taps a pixel over a third of the frame is the dearest thing a wisp could ask for.)
            material.colorNode = light.uHazeCool.mul(1.2)
                .add(light.uHazeWarm.mul(pow(sunward, 2).mul(1.5).add(0.2)).mul(0.85))
                .add(light.uHazeWarm.mul(light.uWarmth).mul(0.1));
            material.opacityNode = wisps.mul(reach).mul(light.uSmoke).mul(0.5)
                .mul(light.uClearAir.mul(-0.7).add(1))
                .mul(light.uGust.mul(-0.4).add(1).max(0));
            const sheet = new THREE.Mesh(geometry, material);
            sheet.position.set(0, height, -150);
            sheet.scale.set(620, 1, 330);
            sheet.name = `GoldenForestWaterSmoke ${index}`;
            // Over the water and the reeds' feet, under the mist banks.
            sheet.renderOrder = 6 + index;
            sheet.frustumCulled = false;
            sheet.updateMatrix();
            sheet.matrixAutoUpdate = false;
            this.smoke.push(sheet);
            this.group.add(sheet);
        });
    }

    /** The sheets of smoke lie on the water: the lake's mirror would only show their undersides. */
    keepOutOfMirror(layer) {
        this.smoke.forEach((sheet) => sheet.layers.disable(layer));
    }

    /** Dust and midges: invisible in shade, a slow sparkle wherever a shaft crosses them. */
    buildMotes() {
        const { light, rng } = this;
        const count = this.tier.motes;
        if (!(count > 0)) return;
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const z = 12 - rng() ** 1.4 * 62;
            const x = (rng() * 2 - 1) * (9 + (12 - z) * 0.7);
            data.set([x, Math.max(0, goldenForestGroundHeight(x, z)) + 0.3 + rng() * 9, z, rng()], i * 4);
        }
        const mote = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'GoldenForestSunMotes';
        const t = light.uTime;
        const phase = mote.w.mul(TAU);
        const drift = vec3(
            sin(t.mul(0.23).add(phase)).mul(0.7).add(light.uWindDir.x.mul(light.uGust).mul(1.2)),
            sin(t.mul(0.17).add(phase.mul(2.3))).mul(0.45),
            cos(t.mul(0.19).add(phase.mul(1.7))).mul(0.6),
        );
        const size = mote.w.mul(0.05).add(0.035);
        material.positionNode = positionLocal.mul(size).add(mote.xyz).add(drift);
        const disc = saturate(float(1).sub(length(uv().sub(0.5)).mul(2)));
        const twinkle = sin(t.mul(mote.w.mul(2).add(1.3)).add(phase.mul(7))).mul(0.4).add(0.6);
        material.colorNode = light.uSunColor.mul(0.5).add(light.uHazeWarm.mul(light.uGlow));
        material.opacityNode = disc.pow2().mul(twinkle).mul(light.sunlight().mul(0.95).add(light.uGlow.mul(0.35)));
        const motes = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        motes.name = 'GoldenForestSunMotes';
        motes.renderOrder = 30;
        motes.frustumCulled = false;
        motes.matrixAutoUpdate = false;
        this.motes = motes;
        this.group.add(motes);
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.smoke.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
