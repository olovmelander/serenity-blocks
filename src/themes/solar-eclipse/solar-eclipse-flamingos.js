/**
 * Solar Eclipse — the flamingos: the skeins that fly to roost low over the flooded salt flat as
 * totality darkens the sky, the flock wading far out in the mirror-still water, and the mirror's
 * image of both.
 *
 * Where every bird is and how it stands are solar-eclipse-flamingo-flight.js's (a pure function
 * of the clock and the layout); this module draws them. The bird is the theme's own, modelled,
 * rigged and animated in Blender (scripts/blender/solar_eclipse_flamingo.py writes
 * solar-eclipse-flamingo-model.js). Every bird's sixteen finished bones are two vec4 rows each in
 * ONE uniform array (a block of ROWS_PER_BIRD rows a bird, the instance's own); the vertex stage
 * skins each vertex to two of them. Two draws share one instanced geometry: the birds, and their
 * image in the water (the same bones turned over the water's plane).
 *
 * The light is the eclipse's: overhead the dark of the moon's shadow, all round the low band of
 * sunlit sky beyond it, brighter toward the shadow's near edge (u.umbraAz, to the right) and
 * doubled by the mirror from below. So the birds are silhouettes against the band, their pink
 * caught faintly on the side that faces its bright reach; far birds sink a little into the air
 * and the mist lying on the far water.
 *
 * A bird is small (a 1.55 m span at 120 m is ~25 px of a 1080-line frame; a wading bird 400 m
 * out ~8 px tall), so its neck, head, bill and legs would be a fraction of a pixel and break up
 * into sparkle. The vertex stage widens every thin part to at least a pixel (along its own
 * normal, by what it lacks of MIN_PX), and a tube widened so is let through by the share it
 * truly covers: a distant neck is a faint, steady line, never a flicker.
 *
 * The image in the water is turned over the water's plane (MIRROR.eye under the lens), so it lies
 * below the horizon wherever its bird is; it is lit as the bird itself is (the water returns what
 * the bird gives off toward it), a little darker and lighter in hand than the bird (the water
 * returns most, not all, of the light near the horizon, and its film and mist lie over it), and
 * gently wobbled by the water's swell unless a chain has stilled it to glass (u.glass).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    exp,
    float,
    floor,
    instanceIndex,
    int,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    sqrt,
    step,
    uniformArray,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    MIRROR, UMBRA, approach, wrapAngle,
} from './solar-eclipse-core.js';
import {
    BIRD_FLOATS, ROWS_PER_BIRD, flamingoModel, flockBird, flockSpan, restView, writeBirds,
} from './solar-eclipse-flamingo-flight.js';

/** The narrowest a thin part is drawn (pixels of the buffer). */
export const MIN_PX = 1.2;
/** Birds the table holds at most: a flock of 20 and a flight of 12 (1024 rows: 16 KB). */
export const MOST_BIRDS = 32;

/**
 * How the eclipse lights a bird (shares of the scene's own colours):
 *   glow, horizon  the band of light all round, on the faces that look at the horizon
 *   water          the band again from below, off the mirror (a share of the above)
 *   mid, zenith    the dark of the shadow overhead, on the faces that look up
 *   lean           how much more the faces turned to the band's bright reach take (the umbra's
 *                  lean, squared on the bird so the pink catches on that side)
 *   daylight       the diamond's daylight, as the haze of the moment it floods back
 */
export const TONE = Object.freeze({
    glow: 0.075,
    horizon: 0.32,
    water: 0.65,
    mid: 0.9,
    zenith: 0.6,
    daylight: 0.55,
});
/** The air between: metres for a bird to sink a share 1 − 1/e into the band behind it. */
const HAZE_METRES = 4000;
/** The mist that lies on the far water (solar-eclipse-sky.js), as much as stands in front. */
const MIST = 0.32;
/** The image in the water: how much of the bird the water returns; how much of it shows. */
const REFLECT = 0.8;
const REFLECT_ALPHA = 0.88;
/** How far the water's swell sways the image (pixels) when it is not glass. */
const WOBBLE_PX = 0.7;
/** How fast the flock's centre follows a new layout (per second). */
const FOLLOW = 0.8;

/** v turned by q (a unit quaternion): v + 2 q.xyz × (q.xyz × v + w v). */
const turn = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2.0));

/** The flamingo's mesh: rest positions, normals, plumage and kind, skin and half-thickness. */
export function buildFlamingoGeometry() {
    const m = flamingoModel();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(m.index, 1));
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.BufferAttribute(m.colours, 4, true));
    geometry.setAttribute('skin', new THREE.BufferAttribute(m.skin, 4, true));
    geometry.instanceCount = 0;
    return geometry;
}

/**
 * One of the two draws: the birds, or (`mirrored`) their image in the water. `bones` is the
 * table (a uniform array of vec4 rows).
 */
function flamingoMaterial({ u, bones, mirrored }) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: !mirrored,
        depthTest: true,
        side: mirrored ? THREE.BackSide : THREE.FrontSide,
        fog: false,
    });
    material.name = mirrored ? 'solar-eclipse-flamingo-images' : 'solar-eclipse-flamingos';
    const aSkin = attribute('skin', 'vec4');
    const aNormal = attribute('normal', 'vec3');
    const aPlumage = attribute('color', 'vec4');
    const vNormal = varying(vec3(0, 1, 0), mirrored ? 'seFlamingoImageNormal' : 'seFlamingoNormal');
    const vPlumage = varying(vec4(1), mirrored ? 'seFlamingoImagePlumage' : 'seFlamingoPlumage');
    const vReal = varying(vec3(0), mirrored ? 'seFlamingoImageReal' : 'seFlamingoReal');
    const vSeen = varying(vec3(0), mirrored ? 'seFlamingoImageSeen' : 'seFlamingoSeen');
    const { eye } = MIRROR;

    material.positionNode = Fn(() => {
        // The bird's block of the table: per bone its turn, then its place and scale.
        const base = int(instanceIndex).mul(ROWS_PER_BIRD).toVar();
        const rest = positionGeometry;
        const pos = vec3(0).toVar();
        const nor = vec3(0).toVar();
        const scale = float(0).toVar();
        [[aSkin.x, aSkin.z], [aSkin.y, aSkin.z.oneMinus()]].forEach(([id, w]) => {
            const row = base.add(int(floor(id.mul(255.0).add(0.5))).mul(2)).toVar();
            const q = bones.element(row).toVar();
            const t = bones.element(row.add(1)).toVar();
            pos.addAssign(turn(q, rest).mul(t.w).add(t.xyz).mul(w));
            nor.addAssign(turn(q, aNormal).mul(w));
            scale.addAssign(t.w.mul(w));
        });
        const n = normalize(nor.add(vec3(0.0, 1e-6, 0.0))).toVar();
        // Never thinner than a pixel: what a thin part lacks of MIN_PX it grows along its normal.
        const dist = max(length(pos.sub(cameraPosition)), 0.5);
        const least = u.texel.mul(dist).mul(MIN_PX * 0.5).toVar();
        const truly = aSkin.w.mul(0.255).mul(scale).toVar();
        const thin = step(aSkin.w, 0.999);
        const drawn = max(truly, least);
        pos.addAssign(n.mul(drawn.sub(truly).mul(thin)));
        // A tube widened so is let through by the share it truly covers.
        const tube = step(aPlumage.w, 0.25).mul(thin);
        // (A thin dark line on the bright band reads stronger than its share: the square root.)
        const cover = mix(float(1.0), clamp(sqrt(truly.div(drawn)), 0.4, 1.0), tube);
        // What dips under the water lies on it.
        pos.assign(vec3(pos.x, max(pos.y, -eye), pos.z));
        vNormal.assign(n);
        vReal.assign(pos);
        vPlumage.assign(vec4(aPlumage.rgb, cover));
        if (!mirrored) {
            vSeen.assign(pos);
            return pos;
        }
        // The image: turned over the water's plane, swayed a little by the swell.
        const height = pos.y.add(eye);
        const sway = u.texel.mul(dist).mul(WOBBLE_PX).mul(float(1.0).sub(u.glass))
            .mul(smoothstep(0.0, 0.5, height))
            .mul(sin(height.mul(6.5).add(u.time.mul(2.3)).add(pos.x.mul(0.37)).add(pos.z.mul(0.21))));
        const image = vec3(pos.x.add(sway), pos.y.negate().sub(2 * eye), pos.z);
        vSeen.assign(image);
        return image;
    })();

    material.colorNode = Fn(() => {
        const N = normalize(vNormal.add(vec3(0.0, 1e-6, 0.0))).toVar();
        // The band's light: brighter toward the moon's shadow's near edge (to the right).
        const lean = cos(atan(N.x, N.z.negate()).sub(u.umbraAz)).mul(UMBRA.lean).add(1.0).toVar();
        const facing = sqrt(max(N.y.mul(N.y).oneMinus(), 0.0));
        const up = max(N.y, 0.0);
        const down = max(N.y.negate(), 0.0);
        const band = u.glow.mul(TONE.glow).add(u.horizon.mul(TONE.horizon)).mul(lean.mul(lean));
        const sky = u.mid.mul(TONE.mid).add(u.zenith.mul(TONE.zenith));
        const light = band.mul(facing.add(down.mul(TONE.water))).add(sky.mul(up))
            .add(u.haze.mul(u.daylight.mul(TONE.daylight)));
        const lit = vPlumage.rgb.mul(light).toVar();

        // The air between: far birds sink a little into the band of light behind them.
        const P = vReal;
        const dist = max(length(P), 1.0);
        const look = P.div(dist).toVar();
        const toward = cos(atan(look.x, look.z.negate()).sub(u.umbraAz)).mul(UMBRA.lean).add(1.0).toVar();
        const alt = abs(look.y);
        const air = u.glow.mul(exp(alt.div(max(u.glowHeight, 1e-3)).negate())).add(u.horizon).mul(toward);
        const haze = float(1.0).sub(exp(dist.div(-HAZE_METRES)));
        lit.assign(mix(lit, air, haze));
        // The mist lying on the far water, in front of what stands in it (and of the image).
        const seenY = normalize(vSeen).y;
        // (Bounded before it is masked: above the horizon the exponent would grow.)
        const under = max(seenY.negate(), 0.0);
        const lying = exp(under.div(-0.011)).mul(0.55).add(exp(under.div(-0.003)).mul(0.45))
            .mul(step(seenY, 0.0));
        const mist = mix(u.haze, u.glow, 0.3).mul(toward).mul(MIST);
        const far = smoothstep(60.0, 700.0, dist);
        if (mirrored) {
            const image = lit.mul(REFLECT).add(mist.mul(lying));
            return vec4(image, vPlumage.a.mul(REFLECT_ALPHA));
        }
        return vec4(lit.add(mist.mul(lying).mul(far)), vPlumage.a);
    })();
    return material;
}

/**
 * The flamingos: { object, update(world), pin(k, start), dispose() }. `tier.flamingos` is
 * { flock, flight }: how many wade, the most a flight holds.
 */
export function createFlamingos({ u, tier }) {
    const counts = tier?.flamingos ?? { flock: 18, flight: 12 };
    const flockCount = Math.max(0, Math.min(20, counts.flock | 0));
    const flightMost = Math.max(0, Math.min(MOST_BIRDS - flockCount, counts.flight | 0));
    const slots = Math.max(1, flockCount + flightMost);
    const rows = Array.from({ length: slots * ROWS_PER_BIRD }, () => new THREE.Vector4(0, 0, 0, 0));
    const bones = uniformArray(rows, 'vec4');
    const table = new Float32Array(slots * BIRD_FLOATS);
    const geometry = buildFlamingoGeometry();
    const group = new THREE.Group();
    group.name = 'solar-eclipse-flamingos';
    const meshes = [false, true].map((mirrored) => {
        const mesh = new THREE.Mesh(geometry, flamingoMaterial({ u, bones, mirrored }));
        mesh.name = mirrored ? 'solar-eclipse-flamingo-images' : 'solar-eclipse-flamingos';
        mesh.frustumCulled = false;
        mesh.renderOrder = mirrored ? 21 : 20;
        group.add(mesh);
        return mesh;
    });
    const flock = Array.from({ length: flockCount }, (_, i) => flockBird(i));
    const span = { centre: 0, half: 0 };
    const target = { centre: 0, half: 0 };
    let placed = false;
    let last = null;
    let pinned = null;
    let birds = [];
    const scene = {
        time: 0, view: null, span, flightMost, pinned: null,
    };

    return {
        object: group,
        meshes,
        flock,
        /** The bone table as last written (the tests). */
        table,
        get count() {
            return geometry.instanceCount;
        },
        /** Every bird drawn this frame: { id, kind, place, size, heading } (the tests). */
        get birds() {
            return birds;
        },
        /**
         * Pin flight `k` (its identity: its line, lane and way) to leave at `start` and hold back
         * every other flight: a capture's flight in view.
         */
        pin(k, start) {
            pinned = Number.isFinite(start) ? { k: Math.round(k) || 0, start } : null;
        },
        update(world) {
            const { time } = world;
            const view = restView({ fov: world.fov(), aspect: world.aspect, pitch: world.pitch() });
            const layout = world.layoutNow();
            flockSpan(view, layout, world.sunScreenX, target);
            // The flock follows a new layout over a moment (and at once in a capture or a seek).
            const dt = last === null ? Infinity : time - last;
            if (!placed || world.capture || !(dt >= 0 && dt < 1)) {
                span.centre = target.centre;
                span.half = target.half;
                placed = true;
            } else {
                const k = approach(FOLLOW, dt);
                span.centre += wrapAngle(target.centre - span.centre) * k;
                span.half += (target.half - span.half) * k;
            }
            last = time;
            scene.time = time;
            scene.view = view;
            scene.pinned = pinned;
            const report = [];
            const count = writeBirds(scene, flock, table, report);
            birds = report;
            for (let i = 0; i < count * ROWS_PER_BIRD; i += 1) {
                rows[i].set(table[i * 4], table[i * 4 + 1], table[i * 4 + 2], table[i * 4 + 3]);
            }
            geometry.instanceCount = count;
            meshes.forEach((mesh) => {
                mesh.visible = count > 0;
            });
        },
        dispose() {
            group.removeFromParent();
            geometry.dispose();
            meshes.forEach((mesh) => mesh.material.dispose());
        },
    };
}
