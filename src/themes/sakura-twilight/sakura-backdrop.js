/**
 * Sakura Twilight — the far side of the lake.
 *
 * The mountain (a Blender-built cone whose vertex colours carry snow and relief), the
 * layered hills at its feet, and the cherry-lined far shore drawn as data sprites of the
 * grove trees. Every part is lit by the same moon and the same dying afterglow, and
 * dissolves into the same air, as the garden in front of it.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, atan, attribute, cameraPosition, color, dot, exp, float, instancedBufferAttribute, max, mix, normalWorld, normalize,
    positionLocal, positionWorld, pow, saturate, sin, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { SAKURA_FUJI, SAKURA_VIEWS } from './sakura-composition.js';
import { sakuraLand, sakuraTerrainHeight } from './sakura-terrain.js';

const cameraPositionNode = () => cameraPosition;

export class SakuraBackdrop {
    constructor({
        light, fuji, impostors, tier, rng = Math.random,
    }) {
        this.light = light;
        this.fuji = fuji;
        this.impostors = impostors;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SakuraFarShore';
        this.owned = [];
        this.count = 0;
        // The wave of lantern light three lines run along the far shore: world x, strength.
        this.uShore = uniform(new THREE.Vector2(0, 0));
    }

    /** `shore` is { position: -1..1 across the far shore, strength: 0..1 } (or nothing). */
    update(shore = null) {
        const strength = Number.isFinite(shore?.strength) ? Math.max(0, Math.min(1, shore.strength)) : 0;
        const position = Number.isFinite(shore?.position) ? shore.position : 0;
        this.uShore.value.set(position * 330, strength);
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        if (this.fuji?.geometry) {
            this.buildMountain();
            this.buildMountainCloud();
        }
        this.buildHills();
        if (this.impostors?.texture && this.impostors.tiles?.length) this.buildShoreTrees();
        return this;
    }

    buildMountain() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'SakuraMountain';
        const paint = attribute('color', 'vec4'); // snow, relief shade, height, -
        const world = positionWorld;
        const normal = normalize(normalWorld);
        const grain = light.noise(world.xz.mul(0.011)).g;
        // The snow reaches down the gullies in long fingers: noise drawn out down the fall
        // line, wrapped round the summit a whole number of times so it has no seam.
        const around = atan(positionLocal.x, positionLocal.z).div(Math.PI * 2);
        const fall = light.noise(vec2(around.mul(14), paint.b.mul(0.3))).g.mul(0.6)
            .add(light.noise(vec2(around.mul(37), paint.b.mul(0.9).add(0.4))).b.mul(0.4));
        const line = paint.r.add(fall.sub(0.5).mul(0.6)).add(grain.sub(0.5).mul(0.14));
        const snow = smoothstep(0.47, 0.56, line);
        const rock = mix(color(0x0c0d1f), color(0x1c1c38), grain).mul(paint.g.mul(0.7).add(0.3));
        // Snow in the gullies' shade is bluer than snow on the ribs between them.
        const drift = mix(color(0x8e98c4), color(0xeceeff), paint.g.mul(fall.mul(0.5).add(0.6)).min(1));
        const albedo = mix(rock, drift, snow);
        // Moon on the right flank, the last rose of the sunset on the left: alpenglow.
        const moonFacing = saturate(dot(normal, light.uMoonDir).mul(0.85).add(0.15));
        const west = normalize(vec3(light.uGlowDir.x, 0.25, light.uGlowDir.y));
        const rose = pow(saturate(dot(normal, west).mul(0.6).add(0.4)), 1.6);
        const lit = albedo.mul(light.uMoonColor).mul(moonFacing).mul(0.55)
            .add(albedo.mul(light.uAfterglow).mul(rose).mul(paint.b.mul(0.7).add(0.3)).mul(0.5))
            .add(albedo.mul(light.ambient(normal)).mul(1.6));
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        const mesh = new THREE.Mesh(this.fuji.geometry, material);
        mesh.name = 'SakuraMountain';
        mesh.position.set(SAKURA_FUJI.x, SAKURA_FUJI.y, SAKURA_FUJI.z);
        mesh.scale.setScalar(SAKURA_FUJI.height);
        // Turn the shoulder crater away so the classic clean cone faces the garden.
        mesh.rotation.y = 0.9;
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    /**
     * What the mountain wears, as the air decides (sakura-weather.js): a sea of cloud lying at its
     * waist, a cap of cloud standing over the summit (kasagumo) and the banner of snow a wind
     * streams off it. Two cards in one draw, shaded in their own frames: `sakuraCloud` is where a
     * fragment is on its card (0..1 across, 0..1 up) and which card it is (0 the sea, 1 the summit).
     */
    buildMountainCloud() {
        const { light } = this;
        const top = SAKURA_FUJI.y + SAKURA_FUJI.height;
        const summit = { width: 330, height: 88, z: SAKURA_FUJI.z + 34 };
        // The summit's card stands a little nearer than the summit, so the cap can hide its top:
        // where the eye sees the summit through that card is where the cap is hung.
        const eye = SAKURA_VIEWS.landscape.position;
        const near = (summit.z - eye[2]) / (SAKURA_FUJI.z - eye[2]);
        const seen = [eye[0] + (SAKURA_FUJI.x - eye[0]) * near, eye[1] + (top - eye[1]) * near];
        const cards = [
            // centre x, centre y, z, width, height, card
            [SAKURA_FUJI.x + 70, 55, SAKURA_FUJI.z + 124, 840, 52, 0],
            [seen[0] + 26, seen[1] + 2, summit.z, summit.width, summit.height, 1],
        ];
        // Where the summit stands on its card.
        const peak = [0.5 - 26 / summit.width, 0.5 - 2 / summit.height];
        const positions = [];
        const frames = [];
        const indices = [];
        cards.forEach(([x, y, z, width, height, card], index) => {
            [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
                positions.push(x + sx * width * 0.5, y + sy * height * 0.5, z);
                frames.push(sx * 0.5 + 0.5, sy * 0.5 + 0.5, card);
            });
            const base = index * 4;
            indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        });
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('sakuraCloud', new THREE.Float32BufferAttribute(frames, 3));
        geometry.setIndex(indices);
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        }));
        material.name = 'SakuraMountainCloud';
        const octaves = vec4(0.4, 0.3, 0.2, 0.1);
        material.colorNode = Fn(() => {
            const frame = attribute('sakuraCloud', 'vec3');
            const across = frame.x.toVar();
            const height = frame.y.toVar();
            const card = frame.z.toVar();
            const clock = light.uCloudClock;
            // (A branch that differs from pixel to pixel may hold no texture read: both cards
            // read the same two, each at its own place.)
            const broad = dot(light.noise(mix(
                vec2(across.mul(2.2).add(clock.mul(0.0011)), height.mul(0.5).add(0.13)),
                vec2(across.mul(1.5).sub(clock.mul(0.0036)), height.mul(1.1).add(0.57)),
                card,
            )), octaves).toVar();
            const fine = dot(light.noise(mix(
                vec2(across.mul(5.3).add(clock.mul(0.002)), height.mul(1.3).add(0.71)),
                vec2(across.mul(4.4).sub(clock.mul(0.02)), height.mul(3.2).add(0.2)),
                card,
            )), octaves).toVar();

            // -- The sea of cloud: a rolling top, lit where the moon rakes it, thin at its ends.
            const crest = broad.mul(0.62).add(fine.mul(0.2)).add(0.14).toVar();
            const sea = smoothstep(crest.sub(0.2), crest, height).oneMinus()
                .mul(smoothstep(0.0, 0.14, height))
                .mul(smoothstep(0.0, 0.16, across))
                .mul(smoothstep(0.84, 1.0, across).oneMinus())
                .mul(light.uSea);
            const seaLit = smoothstep(crest.sub(0.34), crest.sub(0.05), height);

            // -- The cap: two lenses stacked over the summit, their ends drooping round it.
            const lens = (cx, cy, rx, ry) => {
                const dx = across.sub(cx).div(rx);
                const dy = height.sub(cy).add(dx.mul(dx).mul(ry * 0.5)).div(ry);
                return smoothstep(0.3, 1.0, dx.mul(dx).add(dy.mul(dy)).add(broad.sub(0.5).mul(0.5))).oneMinus();
            };
            // (The lower one sits on the summit like a hat; the upper rides just clear of it.)
            const lower = lens(peak[0] + 0.012, peak[1] + 0.03, 0.2, 0.105);
            const upper = lens(peak[0] + 0.03, peak[1] + 0.2, 0.105, 0.045);
            const cap = max(lower, upper.mul(0.8)).mul(fine.mul(0.5).add(0.72)).mul(light.uCap);
            // Its crown takes the moon; its underside, round the summit, is in its own shade.
            const capLit = saturate(height.sub(peak[1] - 0.05).mul(5.5)).mul(0.75).add(0.25);

            // -- The banner: snow torn off the summit, streaming down the wind and fraying.
            const run = across.sub(peak[0] + 0.012).toVar();
            const line = height.sub(run.mul(0.22).add(peak[1] + 0.005));
            const spread = run.max(0).mul(0.46).add(0.028);
            const banner = exp(line.div(spread).pow2().negate())
                .mul(smoothstep(0.0, 0.02, run)).mul(smoothstep(0.12, 0.56, run).oneMinus())
                .mul(smoothstep(0.26, 0.6, fine.mul(0.7).add(broad.mul(0.3))).mul(0.7).add(0.3))
                .mul(light.uBanner)
                .toVar();

            const summitCloud = saturate(cap.add(banner));
            const amount = mix(sea, summitCloud, card).toVar();
            const lit = mix(seaLit, mix(capLit, float(0.9), saturate(banner.sub(cap))), card);
            const world = positionWorld;
            const view = normalize(world.sub(cameraPositionNode()));
            const moonward = saturate(dot(view, light.uMoonDir));
            // (The banner is snow in the moon's light, not cloud: it is the brightest thing up there.)
            const colour = mix(light.uCloudShade, light.uCloudLit, lit).mul(1.7)
                .add(light.uMoonColor.mul(lit.mul(0.085).add(pow(moonward, 4).mul(0.05))
                    .add(banner.mul(card).mul(0.2))))
                // The mountain stands where the sun went down: its cloud keeps the last of the rose.
                .add(light.uAfterglow.mul(lit.oneMinus().mul(0.12).add(0.05)));
            return vec4(light.haze(colour, { world, strength: 0.75 }), amount.mul(0.92));
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'SakuraMountainCloud';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 1;
        this.group.add(mesh);
    }

    /** Hills that close the horizon either side of the mountain. */
    buildHills() {
        const { light, rng } = this;
        const positions = [];
        const shades = [];
        const indices = [];
        [[-232, 17, 0.9, 760], [-300, 30, 0.72, 980], [-390, 44, 0.56, 1300]].forEach(([z, crest, shade, span]) => {
            const steps = 110;
            const base = positions.length / 3;
            const offsets = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
            for (let i = 0; i <= steps; i += 1) {
                const x = -span / 2 + (span * i) / steps;
                const top = crest * (0.55 + 0.26 * Math.sin(x * 0.0083 + offsets[0]) + 0.16 * Math.sin(x * 0.023 + offsets[1]))
                    + 1.8 * Math.sin(x * 0.13 + offsets[2]);
                positions.push(x, -4, z, x, Math.max(2, top), z);
                shades.push(shade, 0, shade, 1);
                if (i < steps) {
                    const a = base + i * 2;
                    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
                }
            }
        });
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(shades, 2));
        geometry.setIndex(indices);
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'SakuraHills';
        const world = positionWorld;
        // Wooded slopes: dark pines with drifts of cherry pink through them.
        const wood = mix(color(0x0a1016), color(0x151b2a), light.noise(world.xy.mul(0.017)).g);
        const blossom = smoothstep(0.56, 0.78, light.noise(world.xy.mul(vec2(0.013, 0.05))).b)
            .mul(smoothstep(0.1, 0.7, uv().y).oneMinus());
        const slope = mix(wood, color(0x5d3350), blossom.mul(0.6)).mul(uv().x);
        const lit = slope.mul(light.ambient(vec3(0, 0.7, 0.7)).mul(2.4).add(light.uMoonColor.mul(0.1)));
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        const hills = new THREE.Mesh(geometry, material);
        hills.name = 'SakuraHills';
        hills.frustumCulled = false;
        hills.matrixAutoUpdate = false;
        this.group.add(hills);
    }

    /** Far trees in priority order along the shores the modelled grove does not reach. */
    layout() {
        const { rng } = this;
        const cards = [];
        const { tiles } = this.impostors;
        const eye = SAKURA_VIEWS.landscape.position;
        for (let attempt = 0; cards.length < this.tier.farTrees && attempt < this.tier.farTrees * 12; attempt += 1) {
            // Two thirds line the far shore; the rest thicken the backs of the two points.
            const shore = rng() < 0.68;
            const x = shore ? (rng() * 2 - 1) * 330 : (rng() < 0.5 ? -1 : 1) * (44 + rng() * 52);
            const z = shore ? -156 - rng() ** 1.6 * 52 : -22 - rng() * 62;
            if (sakuraLand(x, z) > 2.5) {
                const tile = tiles[Math.floor(rng() * tiles.length) % tiles.length];
                cards.push({
                    x,
                    z,
                    y: sakuraTerrainHeight(x, z) - 0.2,
                    tile,
                    scale: (shore ? 1.25 : 1.05) + rng() * 0.6,
                    flip: rng() < 0.5,
                    tone: THREE.MathUtils.clamp(0.5 + Math.sin(x * 0.045 + z * 0.06) * 0.3 + (rng() - 0.5) * 0.44, 0, 1),
                    phase: rng(),
                    lamp: rng() < 0.36 ? 0.5 + rng() * 0.5 : 0,
                    yaw: Math.atan2(eye[0] - x, eye[2] - z),
                });
            }
        }
        return cards;
    }

    buildShoreTrees() {
        const { light, impostors } = this;
        const cards = this.layout();
        this.count = cards.length;
        if (!cards.length) return;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1, 1, 4));
        geometry.translate(0, 0.5, 0);
        const tileData = new Float32Array(cards.length * 4);
        const lookData = new Float32Array(cards.length * 4);
        const tile = instancedBufferAttribute(new THREE.InstancedBufferAttribute(tileData, 4)); // u0, du, tone, lamp
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // phase, height, -, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'SakuraFarShoreSprites';
        const st = uv();
        const data = texture(impostors.texture, vec2(tile.x.add(st.x.mul(tile.y)), st.y)); // shade, blossom, hue, cover
        const force = light.uWind.add(light.uGust);
        const sway = sin(light.uTime.mul(0.7).add(look.x.mul(6.283))).mul(st.y.mul(st.y)).mul(look.y).mul(0.009)
            .mul(force);
        material.positionNode = positionLocal.add(vec3(light.uWindDir.x.mul(sway), 0, light.uWindDir.z.mul(sway)));

        const world = positionWorld;
        const tone = saturate(tile.z.add(data.b.sub(0.5).mul(0.5)));
        const petal = mix(color(0xffe9ef), color(0xf28fb0), tone);
        const albedo = mix(color(0x120c0e), petal, data.g).mul(data.r.mul(0.85).add(0.15));
        // Festival lanterns under some of the far trees warm their lower boughs.
        // Three lines run a wave of lantern light along the shore: every tree it passes is lit
        // from beneath for a moment, the ones with lanterns of their own the most.
        const wave = varying(exp(positionWorld.x.sub(this.uShore.x).div(52).pow2().negate()).mul(this.uShore.y));
        const underlit = light.uLampColor.mul(tile.w.add(wave.mul(tile.w.mul(1.6).add(1.3))))
            .mul(smoothstep(0.05, 0.75, st.y).oneMinus())
            .mul(light.uLampGain).mul(0.16);
        const lit = albedo.mul(light.uMoonColor).mul(light.moonlight()).mul(0.42)
            .add(albedo.mul(light.ambient(vec3(0, 0.6, 0.8))).mul(2.3))
            .add(albedo.mul(underlit))
            .add(petal.mul(data.g).mul(data.r).mul(light.uGlow).mul(0.12));
        material.fragmentNode = Fn(() => {
            data.a.lessThan(0.5).discard();
            return vec4(light.haze(lit, { world }), 1);
        })();

        const mesh = new THREE.InstancedMesh(geometry, material, cards.length);
        mesh.name = 'SakuraFarShoreTrees';
        const dummy = new THREE.Object3D();
        cards.forEach((card, index) => {
            const width = card.tile.width * card.scale;
            const height = card.tile.height * card.scale;
            const sign = card.flip ? -1 : 1;
            // Stand the trunk, not the tile centre, on the placement.
            const shift = -card.tile.trunk * width * sign;
            dummy.position.set(card.x + Math.cos(card.yaw) * shift, card.y, card.z - Math.sin(card.yaw) * shift);
            dummy.rotation.set(0, card.yaw, 0);
            dummy.scale.set(width, height, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            const u0 = card.tile.x / impostors.atlasWidth;
            const du = card.tile.pixels / impostors.atlasWidth;
            tileData.set([card.flip ? u0 + du : u0, card.flip ? -du : du, card.tone, card.lamp], index * 4);
            lookData.set([card.phase, height, 0, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.cards = cards;
        this.group.add(mesh);
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
