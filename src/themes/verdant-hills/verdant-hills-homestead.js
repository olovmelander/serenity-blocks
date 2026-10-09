/**
 * Verdant Hills — the things people made.
 *
 * The limewashed tower mill on the next hill with its tarred cap turned into the wind and
 * its four sails going round; the drystone wall down the spur, the gate across the path
 * and the wall that drops away from its other post; the bench under the oak and the rope
 * swing on the long bough; the posts the kites are tied to; the limestone the turf never
 * covered; and the flock on the far pastures. The Blender meshes carry no materials: their
 * vertex colour says what each face is made of, and one shader here paints them all.
 *
 * The sails are the wind made visible at a distance: they turn faster the harder it
 * blows, race in a gust, and all but stop when the day goes still.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cos, dot, float, mix, normalWorld, normalize, positionLocal, positionWorld,
    pow, reflect, saturate, sin, smoothstep, step, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {
    VERDANT_HILLS_MATERIALS, VERDANT_HILLS_MATERIAL_STEPS, verdantHillsPropRecord,
} from './verdant-hills-assets.js';
import {
    VERDANT_HILLS_BENCH, VERDANT_HILLS_BOULDERS, VERDANT_HILLS_FEATURE_TREES, VERDANT_HILLS_GATE,
    VERDANT_HILLS_MILL, VERDANT_HILLS_POSTS, VERDANT_HILLS_WALL_SECTION, layoutVerdantHillsSheep,
    layoutVerdantHillsWall, layoutVerdantHillsWallHeads,
} from './verdant-hills-layout.js';
import { verdantHillsGroundHeight } from './verdant-hills-terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const { clamp } = THREE.MathUtils;
/** A prop's texture coordinate is 0.5 + metres / 32. */
const UV_METRES = 32;
/** Where the mill's windshaft ends and how it is tilted, when the pack records neither. */
const MILL_HUB = [0, 12.75, 3.05];
const MILL_AXIS = [0, 0.1392, 0.9903];
/** How fast the sails turn, radians a second: becalmed, at rest, per unit of the wind dial, per unit of gust. */
export const VERDANT_HILLS_SAIL_SPEED = Object.freeze({
    settled: 0.08, rest: 0.35, wind: 1.9, gust: 1.2,
});
/** Sails are heavy: seconds to take a gust up, and longer to give it back. */
const SAIL_QUICKENS = 0.8;
const SAIL_SLOWS = 2.6;
// The rope swing: how far apart its ropes hang, how high its seat is, and the plank's size.
const SWING_SPAN = 0.46;
const SWING_SEAT = 0.52;
const SWING_PLANK = [0.6, 0.04, 0.19];
const ROPE = 0.011;

const is = (code, material) => step(0.5, code.sub(material).abs()).oneMinus();

export class VerdantHillsHomestead {
    /**
     * `props` is the parsed prop pack (`assets.props`); `oak` the parsed old oak
     * (`assets.trees['oak-hero']`), whose `swing` anchor the rope swing hangs from. `rng`
     * is accepted for symmetry with the other parts: the layout plants from its own seed.
     */
    constructor({
        light, props, tier, rng = Math.random, oak = null,
    }) {
        this.light = light;
        this.props = props;
        this.tier = tier;
        this.rng = rng;
        this.oak = oak;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsHomestead';
        this.owned = [];
        this.places = {};
        this.sails = null;
        /** Radians the sails have turned since they were built, and how fast they turn now. */
        this.sailAngle = 0;
        this.sailSpeed = VERDANT_HILLS_SAIL_SPEED.rest;
        this.sailFrame = { hub: new THREE.Vector3(), facing: new THREE.Quaternion() };
        this.spin = new THREE.Quaternion();
        this.stats = {
            wallSections: 0, wallHeads: 0, posts: 0, boulders: 0, sheep: 0, swing: false,
        };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        if (!this.props?.meshes) return this;
        this.painted = this.createPaintMaterial();
        this.buildMill();
        this.buildWall();
        this.buildGate();
        this.buildBench();
        this.buildPosts();
        this.buildBoulders();
        this.buildSheep();
        this.buildSwing();
        return this;
    }

    /** What the pack recorded beside a prop: its anchors among them. */
    record(prop) {
        return this.props?.records?.[prop] || verdantHillsPropRecord(prop);
    }

    /** A prop's anchor point in the world, or null when the pack records none. */
    anchor(prop, key) {
        const local = this.record(prop)?.anchors?.[key];
        const place = this.places[prop];
        if (!place || !Array.isArray(local) || local.length < 3) return null;
        return new THREE.Vector3(local[0], local[1], local[2]).multiplyScalar(place.scale ?? 1)
            .applyAxisAngle(UP, place.yaw).add(new THREE.Vector3(place.x, place.y, place.z));
    }

    /**
     * One shader for every prop. `sway` hangs the mesh from a pivot and lets the wind
     * swing it (the rope swing); everything else stands where it was put.
     */
    createPaintMaterial(sway = null) {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = sway ? 'VerdantHillsSwingPaint' : 'VerdantHillsPaint';
        const paint = attribute('color', 'vec4'); // tone, material code / 16, occlusion, wear
        const code = paint.g.mul(VERDANT_HILLS_MATERIAL_STEPS).round();
        const tone = paint.r;
        const wear = paint.a;
        const world = positionWorld;
        if (sway) {
            // A pendulum about the bough: it swings across it, a few degrees in a breeze and
            // further in a gust, and never quite hangs still.
            const pivot = vec3(sway.pivot.x, sway.pivot.y, sway.pivot.z);
            const along = vec3(sway.along.x, 0, sway.along.z);
            const across = vec3(-sway.along.z, 0, sway.along.x);
            const force = light.uWind.add(light.uGust.mul(1.4));
            const angle = sin(light.uTime.mul(sway.rate).add(0.7)).mul(force.mul(0.085).add(0.02).min(0.2))
                .add(sin(light.uTime.mul(sway.rate * 0.31).add(2.1)).mul(0.012));
            const arm = positionLocal.sub(pivot);
            const reach = dot(arm, across);
            material.positionNode = pivot.add(along.mul(dot(arm, along)))
                .add(vec3(0, 1, 0).mul(arm.y.mul(cos(angle)).sub(reach.mul(sin(angle)))))
                .add(across.mul(arm.y.mul(sin(angle)).add(reach.mul(cos(angle)))));
        }
        // The grain follows the surface, in the metres its texture coordinate lays it out
        // in: it turns with the sails and stays with every stone of the wall.
        const st = uv().sub(0.5).mul(UV_METRES);
        const grain = light.noise(st.mul(2.2));
        const boards = light.noise(st.mul(vec2(7, 0.6)).add(grain.rg.mul(0.05)));
        // Whole runs of wall differ: lichen takes one stretch and leaves the next.
        const broad = light.noise(world.xz.mul(0.09));
        const M = VERDANT_HILLS_MATERIALS;
        // Timber left to the weather goes silver-grey, board by board: pale even in shade.
        const timber = mix(
            mix(color(0x645f56), color(0x928d82), tone.mul(0.6).add(boards.g.mul(0.4))),
            color(0xa7a194),
            wear.mul(boards.b.mul(0.5).add(0.25)),
        );
        const wooden = is(code, M.timber);
        // Limewash is chalk white where the rain has left it and streaked grey-green where it runs.
        const wash = mix(color(0xd6d0c0), color(0xf7f3e9), tone.mul(0.55).add(grain.r.mul(0.45)));
        const grime = mix(color(0x77715c), color(0x4c5433), grain.g.mul(0.6).add(boards.r.mul(0.4)));
        const limewash = mix(wash, grime, smoothstep(0.12, 0.95, wear.mul(boards.a.mul(0.7).add(0.65))).mul(0.8));
        const white = mix(mix(color(0xcbc5b6), color(0xf5f1e7), tone), timber, wear.mul(0.45));
        // Tarred boards are nearly black, and dry to grey where the weather has had them.
        const tar = mix(
            mix(color(0x0a0908), color(0x1d1a17), tone.mul(0.6).add(boards.g.mul(0.4))),
            color(0x4c4a45),
            wear.mul(0.42),
        );
        // Grey limestone, pale where it is clean; grey-gold lichen on its tops and moss at its foot.
        const stone = mix(color(0x6d6a61), color(0xc6c0af), tone.mul(0.6).add(grain.a.mul(0.4)));
        const lichen = mix(color(0x4a5a2a), color(0xb9b57c), grain.b.mul(0.55).add(broad.g.mul(0.45)));
        const weathered = mix(stone, lichen, smoothstep(0.22, 0.85, wear.mul(broad.r.mul(0.9).add(0.55))).mul(0.78));
        const door = mix(mix(color(0x1c3433), color(0x3b6460), tone), timber, wear.mul(0.55));
        const canvas = mix(color(0xb5a98b), color(0xece4cf), tone).mul(wear.mul(0.3).oneMinus());
        const wool = mix(mix(color(0xb9af97), color(0xf1ebda), tone), color(0x85775b), wear.mul(0.62));
        const skin = mix(color(0x13100e), color(0x3b332c), tone);
        const rust = wear.mul(grain.g.mul(0.6).add(0.3));
        const iron = mix(mix(color(0x1a1918), color(0x46433f), tone), color(0x6a3a1d), rust);
        let albedo = timber;
        albedo = mix(albedo, limewash, is(code, M.limewash));
        albedo = mix(albedo, white, is(code, M.white));
        albedo = mix(albedo, tar, is(code, M.tar));
        albedo = mix(albedo, weathered, is(code, M.stone));
        albedo = mix(albedo, color(0x0b1418), is(code, M.glass));
        albedo = mix(albedo, door, is(code, M.door));
        albedo = mix(albedo, canvas, is(code, M.canvas));
        albedo = mix(albedo, wool, is(code, M.wool));
        albedo = mix(albedo, skin, is(code, M.skin));
        albedo = mix(albedo, iron, is(code, M.iron));
        const glass = is(code, M.glass);
        const cloth = is(code, M.canvas);
        const fleece = is(code, M.wool);
        const masonry = is(code, M.stone);
        const sheen = saturate(is(code, M.tar).add(is(code, M.iron).mul(0.5)));

        const normal = normalize(normalWorld);
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const toward = dot(normal, light.uSunDir);
        // Boards and stone are lit from the front only; a fleece takes the light all round.
        const facing = mix(saturate(toward), saturate(toward.mul(0.55).add(0.45)), fleece);
        const rim = pow(saturate(dot(normal, view).abs()).oneMinus(), 3)
            .mul(saturate(dot(view, light.uSunDir).negate().mul(0.6).add(0.5)));
        // The joints of a drystone wall are holes: the sun does not reach into them either.
        const joints = mix(vec3(1), vec3(smoothstep(0.12, 0.6, paint.b)), masonry);
        // Thin timber is mostly its own shade in the bake: soften it there, and let the open
        // shade a bench or a gate stands in be filled by the grass and the sky around it.
        const occlusion = mix(paint.b.mul(0.85).add(0.15), mix(float(1), paint.b, 0.55), wooden);
        const open = light.uBounce.mul(0.5).add(light.uSkyLight.mul(0.2)).add(light.uSunColor.mul(0.02));
        const fill = light.ambient(normal).add(open.mul(wooden));
        // Sailcloth lets the sun through: seen against it, a sail is a pale lit sheet.
        const through = saturate(toward.negate()).mul(cloth).mul(0.6);
        const bounce = reflect(view.negate(), normal);
        const gleam = pow(saturate(dot(bounce, light.uSunDir)), 14).mul(sheen).mul(0.5);
        let lit = albedo.mul(light.uSunColor).mul(facing.mul(0.34).add(rim.mul(fleece.mul(0.3).add(0.2)))).mul(joints)
            .mul(sun)
            .add(albedo.mul(vec3(1.08, 1, 0.8)).mul(light.uSunColor).mul(through.mul(0.34)).mul(sun))
            .add(light.uSunColor.mul(gleam.mul(0.3)).mul(sun))
            .add(albedo.mul(fill).mul(occlusion));
        // Window glass is dark, and shows the sky it faces and a glint of the sun.
        const glint = pow(saturate(dot(bounce, light.uSunDir)), 60).mul(sun);
        lit = mix(lit, light.sky(bounce).mul(tone.mul(0.3).add(0.4)).add(light.uSunColor.mul(glint.mul(0.5))), glass);
        // fragmentNode, not colorNode: the props of the home hill cast into the shadow map.
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    /** Stand a prop in the world, its base `bed` metres into the ground. */
    place(name, material, {
        x, z, yaw = 0, bed = 0, scale = 1, casts = true,
    }) {
        const geometry = this.props.meshes[name];
        if (!geometry) return null;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `VerdantHills ${name}`;
        const y = verdantHillsGroundHeight(x, z) - bed;
        mesh.position.set(x, y, z);
        mesh.rotation.set(0, yaw, 0);
        mesh.scale.setScalar(scale);
        mesh.castShadow = casts;
        mesh.frustumCulled = false;
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.places[name] = {
            x, y, z, yaw, scale,
        };
        return mesh;
    }

    /**
     * Many copies of one prop in a single draw. `each(entry, dummy)` poses the dummy for an
     * entry, or returns the matrix itself when a pose is more than a turn and a scale.
     */
    scatter(name, entries, each, casts) {
        const geometry = this.props.meshes[name];
        if (!geometry || !entries.length) return null;
        const mesh = new THREE.InstancedMesh(geometry, this.painted, entries.length);
        mesh.name = `VerdantHills ${name}`;
        const dummy = new THREE.Object3D();
        entries.forEach((entry, index) => {
            dummy.rotation.set(0, 0, 0);
            dummy.scale.setScalar(1);
            const matrix = each(entry, dummy);
            if (!matrix) dummy.updateMatrix();
            mesh.setMatrixAt(index, matrix || dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = casts;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        return mesh;
    }

    /** The tower on its terrace, bedded, and the sails on the nose of its windshaft. */
    buildMill() {
        // Far beyond the shadow map: the mill's shade is baked into the land with the trees'.
        const tower = this.place('windmill', this.painted, { ...VERDANT_HILLS_MILL, casts: false });
        const geometry = this.props.meshes.windmill_sails;
        if (!tower || !geometry) return;
        const { yaw } = VERDANT_HILLS_MILL;
        const turned = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
        const axis = this.record('windmill')?.anchors?.axis;
        const tilt = new THREE.Vector3(...(Array.isArray(axis) && axis.length >= 3 ? axis : MILL_AXIS)).normalize();
        this.sailFrame.hub.copy(this.anchor('windmill', 'hub')
            || new THREE.Vector3(...MILL_HUB).applyAxisAngle(UP, yaw).add(tower.position));
        // The sails are modelled about +Z: face them along the windshaft, then turn the mill.
        this.sailFrame.facing.copy(turned).multiply(new THREE.Quaternion().setFromUnitVectors(FORWARD, tilt));
        const sails = new THREE.Mesh(geometry, this.painted);
        sails.name = 'VerdantHills windmill_sails';
        sails.castShadow = false;
        sails.frustumCulled = false;
        sails.matrixAutoUpdate = false;
        this.sails = sails;
        this.group.add(sails);
        this.poseSails();
    }

    /** Turn the sails to `sailAngle` about the windshaft: leading edge first, clockwise from the front. */
    poseSails() {
        const { sails, sailFrame } = this;
        if (!sails) return;
        sails.position.copy(sailFrame.hub);
        sails.quaternion.copy(sailFrame.facing)
            .multiply(this.spin.setFromAxisAngle(FORWARD, -(this.sailAngle % (Math.PI * 2))));
        sails.updateMatrix();
    }

    /** The drystone wall, section by section over the ground, and the piers that finish its free ends. */
    buildWall() {
        // Every section is built, also the first few that stand wide of a 16:9 frame: a
        // wider screen sees them, and a run with a section missing would show a cut face.
        const along = new THREE.Vector3();
        const across = new THREE.Vector3();
        const raked = new THREE.Matrix4();
        const wall = this.scatter('wall', layoutVerdantHillsWall(), (section) => {
            // Raked, not tipped: a section's length is laid from one foot to the other, up or
            // down the slope, while its stones stay plumb. Its courses run with the ground and
            // its two ends stand upright, so sections of different pitch meet without a notch
            // and a plumb pier closes the end of a run.
            along.set(section.to.x - section.from.x, section.to.y - section.from.y, section.to.z - section.from.z)
                .divideScalar(VERDANT_HILLS_WALL_SECTION);
            across.set(Math.sin(section.yaw), 0, Math.cos(section.yaw));
            return raked.makeBasis(along, UP, across).setPosition(section.x, section.y, section.z);
        }, true);
        this.stats.wallSections = wall ? wall.count : 0;
        // Every end of every run is finished with a pier, which swallows the section's cut stones.
        const piers = this.scatter('wall_head', layoutVerdantHillsWallHeads(), (head, dummy) => {
            dummy.position.set(head.x, head.y, head.z);
            dummy.rotation.set(0, head.yaw, 0);
        }, true);
        this.stats.wallHeads = piers ? piers.count : 0;
    }

    buildGate() {
        this.place('gate', this.painted, VERDANT_HILLS_GATE);
    }

    buildBench() {
        this.place('bench', this.painted, VERDANT_HILLS_BENCH);
    }

    /** A post for every kite: its top stands where the kite's line is made fast. */
    buildPosts() {
        const top = this.record('post')?.anchors?.top;
        const tall = Array.isArray(top) && top[1] > 0 ? top[1] : 1.3;
        const posts = this.scatter('post', VERDANT_HILLS_POSTS, (post, dummy) => {
            dummy.position.set(post.x, verdantHillsGroundHeight(post.x, post.z), post.z);
            dummy.rotation.set(0, post.yaw, 0);
            dummy.scale.setScalar(post.height / tall);
        }, true);
        this.stats.posts = posts ? posts.count : 0;
    }

    buildBoulders() {
        ['boulder_a', 'boulder_b', 'boulder_c'].forEach((name) => {
            const stones = VERDANT_HILLS_BOULDERS.filter((stone) => stone.asset === name);
            const mesh = this.scatter(name, stones, (stone, dummy) => {
                dummy.position.set(stone.x, verdantHillsGroundHeight(stone.x, stone.z) - stone.bed, stone.z);
                dummy.rotation.set(0, stone.yaw, 0);
                dummy.scale.setScalar(stone.scale);
            }, true);
            this.stats.boulders += mesh ? mesh.count : 0;
        });
    }

    /** The flock: those with their heads up in one draw, those grazing in another. */
    buildSheep() {
        const flock = layoutVerdantHillsSheep(null, this.tier.sheep);
        [['sheep_a', false], ['sheep_b', true]].forEach(([name, grazing]) => {
            const sheep = flock.filter((entry) => entry.grazing === grazing);
            const mesh = this.scatter(name, sheep, (entry, dummy) => {
                dummy.position.set(entry.x, verdantHillsGroundHeight(entry.x, entry.z) - 0.02, entry.z);
                dummy.rotation.set(0, entry.yaw, 0);
                dummy.scale.setScalar(entry.scale);
            }, false);
            this.stats.sheep += mesh ? mesh.count : 0;
        });
    }

    /** Where the old oak's `swing` anchor is in the world, and which way its bough runs there. */
    swingPoint() {
        const local = this.oak?.anchors?.swing;
        const tree = VERDANT_HILLS_FEATURE_TREES.find((entry) => entry.asset === 'oak-hero');
        if (!tree || !Array.isArray(local) || local.length < 3) return null;
        const foot = new THREE.Vector3(tree.x, verdantHillsGroundHeight(tree.x, tree.z) - 0.05, tree.z);
        return {
            pivot: new THREE.Vector3(local[0], local[1], local[2]).multiplyScalar(tree.scale)
                .applyAxisAngle(UP, tree.yaw).add(foot),
            along: new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, tree.yaw),
            limb: (Number(this.oak.anchors.swingLimbRadius) || 0.2) * tree.scale,
        };
    }

    /** Two ropes and a plank under the long bough; nothing at all if the oak records no place for them. */
    buildSwing() {
        const hang = this.swingPoint();
        if (!hang) return;
        const { pivot, along, limb } = hang;
        const seat = verdantHillsGroundHeight(pivot.x, pivot.z) + SWING_SEAT;
        const drop = pivot.y - seat;
        if (!(drop > 1)) return;
        // Along the bough, up, across it: a right-handed set, so the faces below wind outward.
        const across = new THREE.Vector3(-along.z, 0, along.x);
        const positions = [];
        const normals = [];
        const uvs = [];
        const colours = [];
        const indices = [];
        // A box given by its centre and its half extents along the bough, up, and across it.
        const box = (centre, half, tone, wearing) => {
            const base = positions.length / 3;
            const axes = [along, UP, across];
            for (let face = 0; face < 6; face += 1) {
                const axis = Math.floor(face / 2);
                const sign = face % 2 ? 1 : -1;
                const u = axes[(axis + 1) % 3];
                const v = axes[(axis + 2) % 3];
                [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => {
                    const point = centre.clone().addScaledVector(axes[axis], sign * half[axis])
                        .addScaledVector(u, a * half[(axis + 1) % 3]).addScaledVector(v, b * half[(axis + 2) % 3]);
                    positions.push(point.x, point.y, point.z);
                    normals.push(axes[axis].x * sign, axes[axis].y * sign, axes[axis].z * sign);
                    // Laid out in metres, as the pack's props are.
                    uvs.push(0.5 + (a * half[(axis + 1) % 3]) / UV_METRES);
                    uvs.push(0.5 + (b * half[(axis + 2) % 3]) / UV_METRES);
                    colours.push(tone, VERDANT_HILLS_MATERIALS.timber / VERDANT_HILLS_MATERIAL_STEPS, 1, wearing);
                });
                const corner = base + face * 4;
                if (sign > 0) indices.push(corner, corner + 1, corner + 2, corner, corner + 2, corner + 3);
                else indices.push(corner, corner + 2, corner + 1, corner, corner + 3, corner + 2);
            }
        };
        const middle = new THREE.Vector3(pivot.x, seat, pivot.z);
        box(middle, [SWING_PLANK[0] / 2, SWING_PLANK[1] / 2, SWING_PLANK[2] / 2], 0.55, 0.7);
        // Each rope runs from inside the bough down through the plank: bleached hemp.
        [-1, 1].forEach((sideways) => {
            const centre = middle.clone().addScaledVector(along, (sideways * SWING_SPAN) / 2);
            centre.y = seat + (drop + limb) / 2;
            box(centre, [ROPE, (drop + limb) / 2 + 0.03, ROPE], 0.92, 1);
        });
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
        geometry.setIndex(indices);
        geometry.boundingSphere = new THREE.Sphere(pivot.clone(), drop + 2);
        // A pendulum this long swings about once in four seconds.
        const material = this.createPaintMaterial({ pivot, along, rate: Math.sqrt(9.81 / drop) });
        const swing = new THREE.Mesh(geometry, material);
        swing.name = 'VerdantHills swing';
        swing.castShadow = true;
        swing.frustumCulled = false;
        swing.matrixAutoUpdate = false;
        this.group.add(swing);
        this.places.swing = {
            x: pivot.x, y: seat, z: pivot.z, yaw: Math.atan2(-along.z, along.x), scale: 1,
        };
        this.stats.swing = true;
    }

    /**
     * Turn the sails. `frame.wind` and `frame.gust` (0..1) set how fast; `frame.settled`
     * lets them run down until they barely move.
     */
    update(time, dt, frame = {}) {
        const elapsed = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
        const level = (value) => (Number.isFinite(value) ? clamp(value, 0, 1) : 0);
        const {
            settled, rest, wind, gust,
        } = VERDANT_HILLS_SAIL_SPEED;
        const wanted = frame.settled === true ? settled : rest + wind * level(frame.wind) + gust * level(frame.gust);
        const eases = wanted > this.sailSpeed ? SAIL_QUICKENS : SAIL_SLOWS;
        this.sailSpeed += (wanted - this.sailSpeed) * (1 - Math.exp(-elapsed / eases));
        this.sailAngle += this.sailSpeed * elapsed;
        this.poseSails();
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.sails = null;
        this.painted = null;
    }
}
