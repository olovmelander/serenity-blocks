/**
 * Summer — the things people made.
 *
 * The Falu-red cottage with its white corners on the promontory, the boathouse below it and
 * the pennant on its pole; the maypole on its mown ring, wound with birch leaves, hung
 * with two wreaths and flying ribbons; the roundpole fence, the jetty and the rowboat; and
 * the granite the ice left behind. The Blender meshes carry no materials: their vertex
 * colour says what each face is made of, and one shader here paints them all.
 *
 * The maypole is also the game's bouquet. Each of the seven kinds of flower on its wreaths
 * lights when a piece of that kind is first locked; when all seven burn, the whole pole
 * flares and the bouquet is thrown.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cos, cross, dot, float, fract, instancedBufferAttribute, mix, normalWorld,
    normalize, positionGeometry, positionLocal, positionWorld, pow, reflect, saturate, sin, step, uniform, uniformArray,
    uv, vec3, vec4,
} from 'three/tsl';
import { summerPropRecord } from './summer-assets.js';
import { summerPetalPalette } from './summer-petals.js';
import {
    SUMMER_PLACES, summerGroundHeight, summerShoreDistance,
} from './summer-terrain.js';

/** What a prop's faces are made of: the code stored in the green channel times eight. */
export const SUMMER_MATERIALS = Object.freeze({
    timber: 0, red: 1, white: 2, roof: 3, stone: 4, glass: 5, door: 6, garland: 7, flowers: 8,
});
const BOUQUET_KINDS = 7;
// The roundpole fence: a line across the meadow down to the shore, left of the maypole.
const FENCE_LINE = [[-27, 1.6], [-17.5, -2.4], [-10.6, -5.2], [-9.2, -8.2]];
const FENCE_SECTION = 3;
// Ribbons: where on the maypole, how long, and which colour (0 blue, 1 yellow).
const RIBBONS = [
    ['armLeft', 2.5, 0], ['armLeft', 2.1, 1], ['armRight', 2.5, 1], ['armRight', 2.1, 0], ['top', 3, 0],
    ['top', 2.6, 1],
];
const RIBBON_STEPS = 14;

const is = (code, material) => step(0.5, code.sub(material).abs()).oneMinus();

export class SummerHomestead {
    constructor({
        light, props, tier, rng = Math.random,
    }) {
        this.light = light;
        this.props = props;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SummerHomestead';
        this.owned = [];
        this.boat = null;
        this.boatRing = 5;
        // Vector4 defaults to w = 1: every lantern starts dark, before any frame has run.
        this.bouquetVectors = [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)];
        this.uBouquet = uniformArray(this.bouquetVectors);
        this.uFlash = uniform(0);
        this.uLamps = uniform(1);
        this.places = {};
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        if (!this.props?.meshes) return this;
        this.painted = this.createPaintMaterial(false);
        this.buildCottage();
        this.buildMaypole();
        this.buildWaterside();
        this.buildFence();
        this.buildBoulders();
        return this;
    }

    /** A prop's anchor point in the world, or null when the pack records none. */
    anchor(prop, key) {
        const record = summerPropRecord(prop);
        const local = record?.anchors?.[key];
        const place = this.places[prop];
        if (!place || !Array.isArray(local) || local.length < 3) return null;
        return new THREE.Vector3(local[0], local[1], local[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), place.yaw)
            .add(new THREE.Vector3(place.x, place.y, place.z));
    }

    /**
     * One shader for every prop. `lanterns` makes the flowers answer the bouquet (the
     * maypole); elsewhere they are simply flowers.
     */
    createPaintMaterial(lanterns) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = lanterns ? 'SummerMaypolePaint' : 'SummerPaint';
        const paint = attribute('color', 'vec4'); // tone, material code / 8, occlusion, wear
        const code = paint.g.mul(8).round();
        const tone = paint.r;
        const wear = paint.a;
        const world = positionWorld;
        const grain = light.noise(world.xz.mul(2.2).add(world.y.mul(3.1)));
        const M = SUMMER_MATERIALS;
        // Timber left to the weather goes silver; Falu red is matt and chalks where the sun
        // has had it longest.
        const timber = mix(color(0x3d352c), color(0xa39683), tone.mul(0.7).add(grain.b.mul(0.3)));
        const red = mix(
            mix(color(0x5a140c), color(0x9a2a1a), tone.mul(0.6).add(grain.g.mul(0.4))),
            color(0xb0604a),
            wear.mul(0.3),
        );
        const white = mix(color(0xcbc5b6), color(0xf5f1e7), tone);
        const tile = mix(
            mix(color(0x4c241a), color(0x8e4a2f), tone.mul(0.6).add(grain.r.mul(0.4))),
            color(0x4f5a2c),
            wear.mul(0.45),
        );
        const stone = mix(color(0x4c4842), color(0xa39b8e), tone.mul(0.6).add(grain.a.mul(0.4)));
        const door = mix(color(0x16382c), color(0x2b6048), tone);
        const garland = mix(color(0x10300a), color(0x3f7a1c), tone.mul(0.7).add(grain.g.mul(0.3)));
        const kind = tone.mul(BOUQUET_KINDS - 0.001).floor();
        const blossom = uniformArray(summerPetalPalette()).element(kind.toInt());
        let albedo = timber;
        albedo = mix(albedo, red, is(code, M.red));
        albedo = mix(albedo, white, is(code, M.white));
        albedo = mix(albedo, tile, is(code, M.roof));
        albedo = mix(albedo, stone, is(code, M.stone));
        albedo = mix(albedo, color(0x0b1418), is(code, M.glass));
        albedo = mix(albedo, door, is(code, M.door));
        albedo = mix(albedo, garland, is(code, M.garland));
        albedo = mix(albedo, blossom, is(code, M.flowers));
        const glass = is(code, M.glass);
        const leafy = saturate(is(code, M.garland).add(is(code, M.flowers)));

        const normal = normalize(normalWorld);
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const toward = dot(normal, light.uSunDir);
        // Leaves and petals are lit from either side; boards only from the front.
        const facing = mix(saturate(toward), toward.abs().mul(0.8).add(0.2), leafy);
        const rim = pow(saturate(dot(normal, view).abs()).oneMinus(), 3)
            .mul(saturate(dot(view, light.uSunDir).negate().mul(0.6).add(0.5)));
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 3).mul(leafy);
        const occlusion = paint.b.mul(0.85).add(0.15);
        let lit = albedo.mul(light.uSunColor).mul(facing.mul(0.36).add(rim.mul(0.22))).mul(sun)
            .add(pow(albedo, vec3(0.8)).mul(vec3(1.1, 1.3, 0.4)).mul(through.mul(0.16)).mul(light.uSunColor)
                .mul(sun))
            .add(albedo.mul(light.ambient(normal)).mul(occlusion));
        // Window glass shows the evening sky, and behind it a lamp is lit.
        const mirrored = light.sky(reflect(view.negate(), normal)).mul(0.55);
        const lamp = vec3(1.7, 0.92, 0.32).mul(this.uLamps).mul(grain.r.mul(0.5).add(0.6))
            .mul(light.uWarmth.mul(0.5).add(1));
        lit = mix(lit, mirrored.add(lamp), glass);
        if (lanterns) {
            // The seven kinds on the wreaths: each lights when its piece is first locked.
            const low = this.uBouquet.element(0);
            const high = this.uBouquet.element(1);
            const at = (slot, place) => step(0.5, slot.sub(place).abs()).oneMinus();
            const picked = low.x.mul(at(kind, 0)).add(low.y.mul(at(kind, 1))).add(low.z.mul(at(kind, 2)))
                .add(low.w.mul(at(kind, 3)))
                .add(high.x.mul(at(kind, 4)))
                .add(high.y.mul(at(kind, 5)))
                .add(high.z.mul(at(kind, 6)));
            const lantern = blossom.mul(picked.mul(2.6).add(this.uFlash.mul(2.4))).mul(is(code, M.flowers));
            // A finished bouquet lights the whole garland.
            const blaze = garland.mul(vec3(2.4, 2.2, 0.9)).mul(this.uFlash).mul(is(code, M.garland));
            lit = lit.add(lantern).add(blaze);
        }
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    /** Stand a prop in the world; `lift` raises it off the ground (the jetty stands on the water). */
    place(name, material, {
        x, z, yaw = 0, y = null, scale = 1,
    }) {
        const geometry = this.props.meshes[name];
        if (!geometry) return null;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `Summer ${name}`;
        const height = y ?? summerGroundHeight(x, z);
        mesh.position.set(x, height, z);
        mesh.rotation.set(0, yaw, 0);
        mesh.scale.setScalar(scale);
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.places[name] = {
            x, y: height, z, yaw,
        };
        return mesh;
    }

    buildCottage() {
        const { cottage, shed, flagpole } = SUMMER_PLACES;
        // Both stand on terraces the terrain levels for them, their plinths bedded in the turf.
        this.place('cottage', this.painted, { ...cottage, y: summerGroundHeight(cottage.x, cottage.z) - 0.05 });
        this.place('shed', this.painted, { ...shed, y: summerGroundHeight(shed.x, shed.z) - 0.04 });
        this.buildPennant(flagpole);
        this.buildSmoke();
    }

    /** Someone has the stove lit: a thread of smoke leaves the chimney and leans with the wind. */
    buildSmoke() {
        const { light } = this;
        const top = this.anchor('cottage', 'chimneyTop');
        if (!top) return;
        const puffs = 9;
        const seeds = new Float32Array(puffs);
        for (let i = 0; i < puffs; i += 1) seeds[i] = i / puffs;
        const seed = instancedBufferAttribute(new THREE.InstancedBufferAttribute(seeds, 1));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false,
        }));
        material.name = 'SummerChimneySmoke';
        const t = light.uTime;
        // Each puff is the same puff at a different age: it rises, widens, thins and is gone.
        const age = fract(t.mul(0.085).add(seed));
        const force = light.uWind.add(light.uGust.mul(1.2));
        const rise = age.mul(5.2);
        const lean = age.mul(age).mul(force.mul(5).add(0.6));
        const centre = vec3(top.x, top.y, top.z)
            .add(vec3(light.uWindDir.x.mul(lean), rise, light.uWindDir.z.mul(lean)))
            .add(vec3(sin(t.mul(0.7).add(seed.mul(40))), 0, cos(t.mul(0.6).add(seed.mul(23)))).mul(age.mul(0.22)));
        const toEye = normalize(cameraPosition.sub(centre));
        const right = normalize(cross(vec3(0, 1, 0), toEye));
        const up = cross(toEye, right);
        const size = age.mul(1.5).add(0.3);
        material.positionNode = centre.add(right.mul(positionGeometry.x.mul(size)))
            .add(up.mul(positionGeometry.y.mul(size)));
        const radius = uv().sub(0.5).length().mul(2);
        const soft = pow(saturate(float(1).sub(radius)), 1.6);
        const sunward = saturate(dot(toEye.negate(), light.uSunDir));
        // Wood smoke is blue in shade and catches the evening where the sun finds it.
        material.colorNode = light.uSkyLight.mul(1.5).add(light.uSunColor.mul(pow(sunward, 2).mul(0.22).add(0.05)));
        material.opacityNode = soft.mul(sin(age.mul(Math.PI))).mul(age.oneMinus()).mul(0.3);
        const smoke = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, puffs);
        smoke.name = 'Summer chimney smoke';
        smoke.frustumCulled = false;
        smoke.matrixAutoUpdate = false;
        smoke.castShadow = false;
        smoke.renderOrder = 12;
        this.group.add(smoke);
    }

    /** A white pole and the long blue-and-yellow pennant that flies when no flag is raised. */
    buildPennant({ x, z }) {
        const { light } = this;
        const foot = summerGroundHeight(x, z);
        const height = 7.6;
        const pole = new THREE.CylinderGeometry(0.035, 0.055, height, 8, 1);
        pole.translate(0, height / 2, 0);
        const poleMaterial = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        poleMaterial.name = 'SummerFlagpole';
        const normal = normalize(normalWorld);
        const lit = color(0xe8e4da).mul(light.uSunColor.mul(saturate(dot(normal, light.uSunDir)).mul(0.36))
            .mul(light.sunlight()).add(light.ambient(normal)));
        poleMaterial.fragmentNode = vec4(light.haze(lit, { world: positionWorld }), 1);
        const mast = new THREE.Mesh(this.own(pole), poleMaterial);
        mast.name = 'Summer flagpole';
        mast.position.set(x, foot, z);
        mast.castShadow = true;
        mast.frustumCulled = false;
        mast.updateMatrix();
        mast.matrixAutoUpdate = false;
        this.group.add(mast);
        this.addStreamers([{
            anchor: new THREE.Vector3(x, foot + height - 0.25, z),
            length: 3.1,
            width: 0.52,
            hue: 2,
            fly: 0.42,
            taper: 1,
        }], 'Summer pennant');
    }

    buildMaypole() {
        const { maypole } = SUMMER_PLACES;
        const material = this.createPaintMaterial(true);
        const pole = this.place('maypole', material, maypole);
        if (!pole) return;
        const streamers = RIBBONS.map(([key, length, hue], index) => {
            const anchor = this.anchor('maypole', key) || this.maypoleAnchors()[key];
            return {
                anchor: anchor.clone().add(new THREE.Vector3(0, -0.1, 0)),
                length,
                width: 0.075,
                hue,
                fly: 0.12,
                taper: 0,
                phase: index * 1.7,
            };
        });
        this.addStreamers(streamers, 'Summer maypole ribbons');
    }

    /** Where the bouquet is thrown from, when the pack records no anchors. */
    maypoleAnchors() {
        const { x, z, yaw } = SUMMER_PLACES.maypole;
        const foot = summerGroundHeight(x, z);
        const along = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        return {
            top: new THREE.Vector3(x, foot + 7.4, z),
            armLeft: new THREE.Vector3(x, foot + 5.6, z).addScaledVector(along, -1.7),
            armRight: new THREE.Vector3(x, foot + 5.6, z).addScaledVector(along, 1.7),
            wreathLeft: new THREE.Vector3(x, foot + 4.9, z).addScaledVector(along, -1.7),
            wreathRight: new THREE.Vector3(x, foot + 4.9, z).addScaledVector(along, 1.7),
        };
    }

    /** The top of the maypole and its two wreaths, for the petals the bouquet throws. */
    bouquetAnchors() {
        const fallback = this.maypoleAnchors();
        const read = (key) => this.anchor('maypole', key) || fallback[key];
        return { top: read('top'), wreaths: [read('wreathLeft'), read('wreathRight')] };
    }

    /**
     * Cloth in the wind: ribbons and the pennant. Each is a strip whose every vertex knows
     * its anchor; the vertex shader lets it hang when the air is still and stream when it
     * is not, with waves running down its length.
     */
    addStreamers(streamers, name) {
        const { light } = this;
        const positions = [];
        const uvs = [];
        const data = [];
        const indices = [];
        streamers.forEach(({
            anchor, length, width, hue, fly, taper, phase = 0,
        }) => {
            const base = positions.length / 3;
            for (let i = 0; i <= RIBBON_STEPS; i += 1) {
                const v = i / RIBBON_STEPS;
                for (let side = -1; side <= 1; side += 2) {
                    positions.push(anchor.x, anchor.y, anchor.z);
                    uvs.push(side * 0.5 * width * (1 - taper * v), v * length);
                    data.push(hue, fly, phase, v);
                }
                if (i < RIBBON_STEPS) {
                    const a = base + i * 2;
                    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
                }
            }
        });
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('cloth', new THREE.Float32BufferAttribute(data, 4));
        geometry.setIndex(indices);
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = name;
        const cloth = attribute('cloth', 'vec4'); // hue, how readily it flies, phase, place along it
        const st = uv(); // metres across, metres along
        const t = light.uTime;
        const front = saturate(this.light.uFront.y);
        const force = light.uWind.add(light.uGust.mul(1.4)).add(front).add(light.uGlow.mul(0.4));
        // Still air: it hangs. Wind: it streams, and the stronger the wind the flatter it flies.
        const lift = saturate(force.mul(0.85).add(cloth.y)).mul(1.38);
        const wind = normalize(vec3(light.uWindDir.x, 0, light.uWindDir.z));
        const sideways = normalize(cross(wind, vec3(0, 1, 0)));
        const along = wind.mul(sin(lift)).add(vec3(0, -1, 0).mul(cos(lift)));
        const ripple = sin(t.mul(5.4).sub(st.y.mul(4.2)).add(cloth.z)).mul(0.5)
            .add(sin(t.mul(8.3).sub(st.y.mul(7.1)).add(cloth.z.mul(2.3))).mul(0.25));
        const loose = cloth.w.mul(force.mul(0.6).add(0.35));
        // The strip's width stands in the plane the wind blows in, so it shows its face to
        // anyone the wind blows past; its waves run out of that plane.
        const edge = normalize(cross(along, sideways));
        material.positionNode = positionLocal
            .add(along.mul(st.y))
            .add(edge.mul(st.x))
            .add(sideways.mul(ripple.mul(loose).mul(0.16)))
            .add(vec3(0, sin(t.mul(3.1).add(cloth.z).add(st.y.mul(2))).mul(loose).mul(0.07), 0));
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        // Hue 0 is blue, 1 yellow, 2 the pennant: blue above, yellow below.
        const blue = color(0x1f5fc4);
        const yellow = color(0xffd028);
        const pennant = mix(yellow, blue, step(0, st.x));
        const tone = mix(mix(blue, yellow, saturate(cloth.x)), pennant, step(1.5, cloth.x));
        const sun = light.sunlight();
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 2.5);
        const shade = ripple.mul(0.18).add(0.82);
        const lit = tone.mul(shade).mul(light.uSunColor).mul(sun).mul(through.mul(0.3).add(0.22))
            .add(tone.mul(light.ambient(vec3(0, 0.6, 0.4))).mul(0.95))
            .add(tone.mul(light.uGlow.mul(0.25)));
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.group.add(mesh);
        return mesh;
    }

    buildWaterside() {
        const { jetty, boat } = SUMMER_PLACES;
        this.place('jetty', this.painted, { ...jetty, y: 0 });
        this.boat = this.place('rowboat', this.painted, { ...boat, y: 0 });
    }

    /** The roundpole fence, section by section along its line. */
    buildFence() {
        const geometry = this.props.meshes.fence;
        if (!geometry) return;
        const sections = [];
        for (let i = 0; i < FENCE_LINE.length - 1; i += 1) {
            const [ax, az] = FENCE_LINE[i];
            const [bx, bz] = FENCE_LINE[i + 1];
            const span = Math.hypot(bx - ax, bz - az);
            const count = Math.max(1, Math.round(span / FENCE_SECTION));
            for (let n = 0; n < count; n += 1) {
                const t = (n + 0.5) / count;
                const x = ax + (bx - ax) * t;
                const z = az + (bz - az) * t;
                if (summerShoreDistance(x, z) > 0.3) {
                    sections.push({
                        x, z, yaw: Math.atan2(-(bz - az), bx - ax), stretch: span / count / FENCE_SECTION,
                    });
                }
            }
        }
        if (!sections.length) return;
        const mesh = new THREE.InstancedMesh(geometry, this.painted, sections.length);
        mesh.name = 'Summer fence';
        const dummy = new THREE.Object3D();
        sections.forEach((section, index) => {
            dummy.position.set(section.x, summerGroundHeight(section.x, section.z) - 0.04, section.z);
            dummy.rotation.set(0, section.yaw, 0);
            dummy.scale.set(section.stretch, 1, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
    }

    buildBoulders() {
        const { rng, tier } = this;
        const names = ['boulder_a', 'boulder_b', 'boulder_c'].filter((name) => this.props.meshes[name]);
        if (!names.length) return;
        const buckets = names.map(() => []);
        const put = (x, z, size) => {
            const variant = Math.floor(rng() * names.length) % names.length;
            buckets[variant].push({
                x,
                z,
                y: summerGroundHeight(x, z) - size * 0.14,
                size,
                yaw: rng() * Math.PI * 2,
                squash: 0.7 + rng() * 0.4,
            });
        };
        // The stones that hold the picture's corners, then the scatter along the waterline.
        [[-5.4, 9.2, 0.46], [-7.2, 8, 0.22], [7.6, 7.2, 0.3], [9.6, -6.6, 0.26], [3.4, -8.9, 0.36], [-12.6, -9.4, 0.46],
            [-18.4, -62.6, 0.42], [13.4, -30.2, 0.38]].forEach(([x, z, size]) => put(x, z, size));
        const wanted = Math.max(0, tier.rocks - 8);
        for (let made = 0, attempt = 0; made < wanted && attempt < wanted * 16; attempt += 1) {
            const far = rng() < 0.3;
            const x = far ? 14 + rng() * 60 : (rng() * 2 - 1) * 44;
            const z = far ? -50 + rng() * 34 : -16 + rng() * 12;
            const shore = summerShoreDistance(x, z);
            if (shore > -2.2 && shore < 2.6) {
                put(x, z, 0.1 + rng() ** 2 * 0.36);
                made += 1;
            }
        }
        const dummy = new THREE.Object3D();
        buckets.forEach((stones, variant) => {
            if (!stones.length) return;
            const mesh = new THREE.InstancedMesh(this.props.meshes[names[variant]], this.painted, stones.length);
            mesh.name = `Summer ${names[variant]}`;
            stones.forEach((stone, index) => {
                dummy.position.set(stone.x, stone.y, stone.z);
                dummy.rotation.set(0, stone.yaw, 0);
                dummy.scale.set(stone.size, stone.size * stone.squash, stone.size);
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            this.group.add(mesh);
        });
    }

    /**
     * Light the lanterns the game has picked and ride the boat; returns a point for a
     * faint ring when the boat rocks, else null.
     */
    update(time, dt, frame = {}) {
        const bouquet = ArrayBuffer.isView(frame.bouquet) || Array.isArray(frame.bouquet) ? frame.bouquet : null;
        const level = (index) => (bouquet && Number.isFinite(bouquet[index])
            ? THREE.MathUtils.clamp(bouquet[index], 0, 1) : 0);
        this.bouquetVectors[0].set(level(0), level(1), level(2), level(3));
        this.bouquetVectors[1].set(level(4), level(5), level(6), 0);
        this.uFlash.value = Number.isFinite(frame.bouquetFlash) ? THREE.MathUtils.clamp(frame.bouquetFlash, 0, 1) : 0;
        const { boat } = this;
        if (!boat || !Number.isFinite(time)) return null;
        boat.position.y = Math.sin(time * 0.9) * 0.018;
        boat.rotation.set(
            Math.sin(time * 0.53 + 1) * 0.014,
            SUMMER_PLACES.boat.yaw + Math.sin(time * 0.21) * 0.02,
            Math.sin(time * 0.7) * 0.03,
        );
        boat.updateMatrix();
        this.boatRing -= Math.max(0, Number.isFinite(dt) ? dt : 0);
        if (this.boatRing > 0) return null;
        this.boatRing = 6.5;
        return boat.position;
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.boat = null;
    }
}
