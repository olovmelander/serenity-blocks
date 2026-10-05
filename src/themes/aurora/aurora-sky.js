/**
 * The night the aurora hangs in: a sky dome (gradient, airglow, Milky Way, and the curtain
 * buffer read by view direction), a catalogue of star sprites, and a pool of meteors.
 * Everything is placed by direction from the rendering camera, so the lake's mirror pass
 * reflects stars and meteors without any special handling.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp,
    instanceIndex, instancedBufferAttribute, max, mix, normalize, positionGeometry,
    positionWorld, select, sin, smoothstep, texture, uniformArray, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { AURORA_COLORS } from './aurora-palette.js';

const DOME_RADIUS = 9000;
const STAR_RADIUS = 8200;
/** Stars smaller than this many device pixels shimmer as the camera breathes. */
const MIN_STAR_PIXELS = 1.7;
const DEG = Math.PI / 180;
const STAR_AZIMUTH = 80 * DEG;
const STAR_LOW = Math.sin(-3 * DEG);
const STAR_HIGH = Math.sin(84 * DEG);

const triple = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);
const direction = (azimuth, elevation) => new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    -Math.cos(elevation) * Math.cos(azimuth),
);

/** The Milky Way crosses the frame on the diagonal the main arc leaves open. */
const GALAXY_A = direction(-64 * DEG, 9 * DEG);
const GALAXY_B = direction(34 * DEG, 66 * DEG);
export const GALAXY_NORMAL = new THREE.Vector3().crossVectors(GALAXY_A, GALAXY_B).normalize();
const GALAXY_U = GALAXY_A.clone();
const GALAXY_V = new THREE.Vector3().crossVectors(GALAXY_NORMAL, GALAXY_U).normalize();

const STAR_TINTS = [
    [0.7, 0.81, 1.0],
    [1.0, 1.0, 1.0],
    [1.0, 0.9, 0.72],
    [1.0, 0.72, 0.5],
];

/**
 * Deterministic star catalogue: directions inside the cone the camera can ever show,
 * denser along the galactic plane, with the steep brightness distribution of a real sky
 * (a handful of bright stars, thousands of faint ones).
 */
export function buildStarCatalogue(count, random) {
    const directions = new Float32Array(count * 3);
    const data = new Float32Array(count * 4);
    const tints = new Float32Array(count * 3);
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 40) {
        guard += 1;
        const azimuth = (random() * 2 - 1) * STAR_AZIMUTH;
        const sinElevation = STAR_LOW + random() * (STAR_HIGH - STAR_LOW);
        const cosElevation = Math.sqrt(1 - sinElevation * sinElevation);
        const x = cosElevation * Math.sin(azimuth);
        const y = sinElevation;
        const z = -cosElevation * Math.cos(azimuth);
        const plane = (x * GALAXY_NORMAL.x + y * GALAXY_NORMAL.y + z * GALAXY_NORMAL.z) / 0.2;
        if (random() > (0.34 + Math.exp(-plane * plane)) / 1.34) continue;
        const rank = random() ** 6;
        // The first few are the named stars: larger, with diffraction spikes.
        const hero = placed < Math.min(14, Math.ceil(count / 260));
        const brightness = hero ? 0.72 + random() * 0.28 : 0.04 + rank * 0.8;
        directions.set([x, y, z], placed * 3);
        data.set([
            (0.0011 + 0.0032 * brightness ** 0.6) * (hero ? 2.3 : 1),
            0.35 + 5.2 * brightness ** 1.5,
            random() * Math.PI * 2,
            hero ? 1 : 0,
        ], placed * 4);
        const pick = random();
        let tint = STAR_TINTS[1];
        if (pick < 0.26) tint = STAR_TINTS[0];
        else if (pick > 0.9) tint = STAR_TINTS[3];
        else if (pick > 0.71) tint = STAR_TINTS[2];
        tints.set(tint, placed * 3);
        placed += 1;
    }
    return {
        count: placed, directions, data, tints,
    };
}

export class AuroraSky {
    /**
     * @param {object} options
     * @param {THREE.Object3D} options.parent group the sky objects join
     * @param {object} options.preset quality preset
     * @param {import('./aurora-curtains.js').AuroraCurtains} options.curtains
     * @param {THREE.Texture} options.noiseTexture shared noise tile (not owned)
     * @param {object} options.uniforms shared world uniforms (time, activity, viewHeight, aspect)
     * @param {Function} options.random seeded generator for the catalogue
     */
    constructor({
        parent, preset, curtains, noiseTexture, uniforms, random,
    }) {
        this.parent = parent;
        this.preset = preset;
        this.uniforms = uniforms;
        this.disposed = false;
        this.group = new THREE.Group();
        this.group.name = 'Aurora — sky';
        parent.add(this.group);
        this.geometries = new Set();
        this.materials = new Set();
        this.createDome(curtains, noiseTexture);
        this.createStars(random);
        this.createMeteors();
    }

    createDome(curtains, noiseTexture) {
        const u = this.uniforms;
        const material = new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        });
        material.name = 'Aurora — sky dome';
        material.colorNode = Fn(() => {
            const rd = normalize(positionWorld.sub(cameraPosition)).toVar();
            const up = clamp(rd.y, 0, 1).toVar();
            const sky = mix(
                triple(AURORA_COLORS.skyZenith),
                triple(AURORA_COLORS.skyHorizon),
                exp(up.mul(-5.2)),
            ).toVar();
            sky.addAssign(triple(AURORA_COLORS.airglow).mul(exp(up.mul(-13))));

            // Milky Way: a soft band along the galactic plane, broken by cloud structure
            // and a dark dust lane, fading into the horizon haze.
            const plane = dot(rd, vec3(GALAXY_NORMAL.x, GALAXY_NORMAL.y, GALAXY_NORMAL.z));
            const along = atan(
                dot(rd, vec3(GALAXY_V.x, GALAXY_V.y, GALAXY_V.z)),
                dot(rd, vec3(GALAXY_U.x, GALAXY_U.y, GALAXY_U.z)),
            );
            const galaxyUV = vec2(along.mul(0.62), plane.mul(1.5).add(0.5));
            const broad = texture(noiseTexture, galaxyUV);
            const detail = texture(noiseTexture, galaxyUV.mul(3.7).add(0.31));
            const band = exp(plane.mul(plane).mul(-34));
            const clouds = smoothstep(0.22, 0.92, broad.b.mul(0.62).add(detail.r.mul(0.38)));
            const lane = smoothstep(0.42, 0.78, broad.a.mul(0.6).add(detail.g.mul(0.4)))
                .mul(exp(plane.mul(plane).mul(-190)));
            const galaxy = vec3(0.5, 0.6, 0.86).mul(band.mul(clouds))
                .add(vec3(0.95, 0.74, 0.52).mul(band.mul(band).mul(clouds).mul(0.5)))
                .mul(lane.mul(0.8).oneMinus())
                .mul(smoothstep(0.02, 0.3, rd.y).mul(0.075));
            sky.addAssign(galaxy);

            // A bright display lifts the whole sky a little, as it does to the eye.
            sky.mulAssign(u.activity.mul(0.35).add(1));
            sky.addAssign(curtains.sample(rd));
            // Below the horizon only the lake and the shore are ever drawn.
            sky.mulAssign(smoothstep(-0.06, 0.0, rd.y).mul(0.75).add(0.25));
            return sky;
        })();
        const geometry = new THREE.SphereGeometry(DOME_RADIUS, 48, 24);
        this.dome = new THREE.Mesh(geometry, material);
        this.dome.name = 'Aurora — sky dome';
        this.dome.renderOrder = -1000;
        this.dome.frustumCulled = false;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(this.dome);
    }

    createStars(random) {
        const u = this.uniforms;
        const catalogue = buildStarCatalogue(this.preset.starCount, random);
        this.starCount = catalogue.count;
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        });
        material.name = 'Aurora — stars';
        const dir = instancedBufferAttribute(new THREE.InstancedBufferAttribute(catalogue.directions, 3));
        const data = instancedBufferAttribute(new THREE.InstancedBufferAttribute(catalogue.data, 4));
        const tint = instancedBufferAttribute(new THREE.InstancedBufferAttribute(catalogue.tints, 3));
        const pixels = data.x.mul(u.viewHeight);
        const drawn = max(pixels, MIN_STAR_PIXELS);
        material.vertexNode = Fn(() => {
            const clip = cameraProjectionMatrix.mul(cameraViewMatrix)
                .mul(vec4(cameraPosition.add(dir.mul(STAR_RADIUS)), 1)).toVar();
            const size = drawn.div(u.viewHeight).mul(2);
            const offset = positionGeometry.xy.mul(vec2(size.div(u.aspect), size));
            return vec4(clip.xy.add(offset.mul(clip.w)), clip.z, clip.w);
        })();
        const p = uv().sub(0.5).mul(2);
        const r2 = dot(p, p);
        const core = exp(r2.mul(-8.5)).add(exp(r2.mul(-2.4)).mul(0.1));
        const spikes = exp(abs(p.x).mul(-7)).mul(exp(p.y.mul(p.y).mul(-700)))
            .add(exp(abs(p.y).mul(-7)).mul(exp(p.x.mul(p.x).mul(-700))))
            .mul(data.w)
            .mul(0.55);
        // Scintillation: two incommensurate flickers, stronger low in the sky where the
        // light crosses more air.
        const low = smoothstep(0.1, 0.55, dir.y).oneMinus();
        const flicker = sin(u.time.mul(2.3).add(data.z)).mul(sin(u.time.mul(3.71).add(data.z.mul(1.7))));
        const twinkle = flicker.mul(low.mul(0.3).add(0.12)).add(1);
        // A sprite clamped up to the minimum size keeps its energy, not its radiance.
        const energy = pixels.div(drawn).mul(pixels.div(drawn));
        const horizon = smoothstep(0.0, 0.13, dir.y);
        const reddened = mix(vec3(1.0, 0.78, 0.6), vec3(1), smoothstep(0.02, 0.3, dir.y));
        material.colorNode = tint.mul(reddened).mul(data.y).mul(core.add(spikes))
            .mul(twinkle)
            .mul(energy)
            .mul(horizon);
        const mesh = new THREE.InstancedMesh(geometry, material, catalogue.count);
        mesh.name = 'Aurora — star catalogue';
        mesh.frustumCulled = false;
        mesh.renderOrder = -900;
        this.stars = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    createMeteors() {
        const u = this.uniforms;
        const slots = Math.max(1, this.preset.meteorSlots);
        this.meteorSlots = slots;
        this.meteorCursor = 0;
        // start direction + launch time; end direction + duration; brightness, tail, width, warmth
        this.meteorStart = Array.from({ length: slots }, () => new THREE.Vector4(0, 1, 0, -100));
        this.meteorEnd = Array.from({ length: slots }, () => new THREE.Vector4(0, 1, 0, 1));
        this.meteorLook = Array.from({ length: slots }, () => new THREE.Vector4(0, 0.3, 0.004, 0));
        const start = uniformArray(this.meteorStart, 'vec4');
        const end = uniformArray(this.meteorEnd, 'vec4');
        const look = uniformArray(this.meteorLook, 'vec4');
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        });
        material.name = 'Aurora — meteors';
        const a = start.element(instanceIndex);
        const b = end.element(instanceIndex);
        const c = look.element(instanceIndex);
        const age = u.time.sub(a.w);
        const progress = clamp(age.div(b.w), 0, 1);
        const alive = age.greaterThanEqual(0).and(age.lessThan(b.w));
        material.vertexNode = Fn(() => {
            const head = progress;
            const tail = max(progress.sub(c.y), 0);
            const at = (fraction) => cameraProjectionMatrix.mul(cameraViewMatrix)
                .mul(vec4(cameraPosition.add(normalize(mix(a.xyz, b.xyz, fraction)).mul(STAR_RADIUS)), 1));
            const clipHead = at(head).toVar();
            const clipTail = at(tail).toVar();
            const clip = at(mix(tail, head, positionGeometry.x.add(0.5))).toVar();
            const aspect = vec2(u.aspect, 1);
            const heading = clipHead.xy.div(clipHead.w).sub(clipTail.xy.div(clipTail.w)).mul(aspect);
            const along = heading.div(max(heading.length(), 1e-5));
            const across = vec2(along.y.negate(), along.x).div(aspect);
            const offset = across.mul(positionGeometry.y.mul(c.z).mul(2));
            return select(alive, vec4(clip.xy.add(offset.mul(clip.w)), clip.z, clip.w), vec4(0, 0, 2, 1));
        })();
        const lengthwise = uv().x;
        const sideways = uv().y.sub(0.5).mul(2);
        const trail = lengthwise.pow(2.4).mul(exp(sideways.mul(sideways).mul(-9)));
        const headGlow = exp(lengthwise.oneMinus().mul(-26)).mul(exp(sideways.mul(sideways).mul(-3.5)));
        const life = sin(progress.mul(Math.PI)).pow(0.55);
        const meteorTint = mix(vec3(0.75, 1.0, 0.9), vec3(1.0, 0.86, 0.7), c.w);
        material.colorNode = meteorTint.mul(trail.mul(0.9).add(headGlow.mul(2.6))).mul(c.x).mul(life);
        const mesh = new THREE.InstancedMesh(geometry, material, slots);
        mesh.name = 'Aurora — meteor pool';
        mesh.frustumCulled = false;
        mesh.renderOrder = -880;
        this.meteors = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    /**
     * Launch a meteor between two sky directions (unit vectors as [x, y, z]).
     * Reuses the oldest slot; allocates nothing.
     */
    launchMeteor(time, from, to, {
        duration = 0.8, brightness = 1.6, tail = 0.34, width = 0.0032, warmth = 0,
    } = {}) {
        if (this.disposed) return false;
        const slot = this.meteorCursor;
        this.meteorCursor = (slot + 1) % this.meteorSlots;
        this.meteorStart[slot].set(from[0], from[1], from[2], time);
        this.meteorEnd[slot].set(to[0], to[1], to[2], Math.max(0.15, duration));
        this.meteorLook[slot].set(brightness, tail, width, warmth);
        return true;
    }

    resetMeteors() {
        for (const slot of this.meteorStart) slot.w = -100;
        this.meteorCursor = 0;
    }

    /** Keep the dome centred on the camera so the sky sits at infinity. */
    update(camera) {
        if (this.disposed) return;
        this.dome.position.copy(camera.position);
    }

    getDiagnostics() {
        return { stars: this.starCount, meteorSlots: this.meteorSlots };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.group.removeFromParent();
        this.stars.dispose();
        this.meteors.dispose();
        for (const geometry of this.geometries) geometry.dispose();
        for (const material of this.materials) material.dispose();
        this.geometries.clear();
        this.materials.clear();
        this.group.clear();
    }
}
