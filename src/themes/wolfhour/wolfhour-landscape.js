/**
 * Wolfhour's moonlit ranges. Geometry, erosion, how much light each part receives, where snow
 * can lie and how much valley air stands in front of it are baked once on the CPU; rendering is
 * four opaque draws that light each pixel from the moon, cut a crisp snow line through the
 * granite with a noise read, and fade into the valley air.
 * Authored for an orthographic 1000-unit-tall view looking down -Z. All ranges cover
 * +/-2400 world units, so a resize does not regenerate terrain or move its composition.
 * The arrays and the granite's pixels are baked in wolfhour-landscape-bake.js (a first visit: in a
 * worker); this module makes the meshes, the texture and the material from them.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, dot, exp, float, floor, fract, fwidth, hash, max, mix, normalize, positionGeometry, sin,
    smoothstep, step, texture, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import {
    GRANITE_SIZE, LIT_RAMP, MOON_LIGHT, RANGES, WOLFHOUR_PALETTE, bakeGranite, bakeRange, landscapeScale,
} from './wolfhour-landscape-bake.js';

const PARALLAX_RESPONSE = Object.freeze([0.18, 0.48, 0.88, 1.24]);
/** Snow glints: the cell (world units) that may hold one, and its light (linear, above bloom). */
const GLINT_CELL = 3.4;
const GLINT_COLOUR = vec3(1.1, 1.2, 1.45);
/** The moon's direction and the moonlit palette, as shader constants. */
const MOON = vec3(MOON_LIGHT.x, MOON_LIGHT.y, MOON_LIGHT.z);
const PALETTE = Object.fromEntries(Object.entries(WOLFHOUR_PALETTE).map(([key, rgb]) => [key, vec3(...rgb)]));
/** The valley air's colour low in the valley and high on the walls (linear, before the grade). */
const MIST_LOW = vec3(0.052, 0.074, 0.122);
const MIST_HIGH = vec3(0.016, 0.024, 0.046);

/**
 * The air at (x, y) of a range's own frame, shared by everything that fades into it: one air for
 * every range, brighter and bluer low in the valley, a little more light on the side under the
 * moon (left).
 */
export function wolfhourAir(x, y) {
    return mix(MIST_LOW, MIST_HIGH, smoothstep(-470, 260, y)).mul(smoothstep(500, -1100, x).mul(0.32).add(0.84));
}

function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}

/** One range's mesh, from its baked arrays (shared, read-only: never written). */
function buildRange(index, qualityScale, seed) {
    const baked = bakeRange(index, qualityScale, seed);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(baked.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(baked.indices, 1));
    geometry.setAttribute('normal', new THREE.BufferAttribute(baked.normals, 3));
    geometry.setAttribute('aLight', new THREE.BufferAttribute(baked.light, 2));
    geometry.setAttribute('aSurface', new THREE.BufferAttribute(baked.surface, 2));
    geometry.setAttribute('aMoonResponse', new THREE.BufferAttribute(baked.eventLight, 1));
    geometry.userData.crestColumns = baked.crestColumns;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

/** The granite grain's texture, from its baked pixels. */
function makeGraniteTexture(seed) {
    const map = new THREE.DataTexture(bakeGranite(seed), GRANITE_SIZE, GRANITE_SIZE);
    map.name = 'Wolfhour granite and snow grain';
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return map;
}

/** Creates the landscape without a renderer, camera, texture fetch or animation allocation. */
export function createWolfhourLandscape({ scene = null, quality = 'High', seed = 7319 } = {}) {
    const scale = landscapeScale(quality);
    const group = new THREE.Group();
    group.name = 'Wolfhour alpine landscape';
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    const uPulse = uniform(0);
    const uTime = uniform(0);
    // Snow glints cost a few hashes on every terrain pixel: Medium and up.
    const glints = !['Minimal', 'Low'].includes(quality);
    const graniteTexture = makeGraniteTexture(seed);
    const material = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour moonlit snow and granite',
        depthWrite: true,
        depthTest: true,
        side: THREE.FrontSide,
    });
    const graniteUV = vec2(
        positionGeometry.x.mul(0.0019).add(positionGeometry.y.mul(0.0007)),
        positionGeometry.y.mul(0.0022),
    );
    material.colorNode = Fn(() => {
        const granite = texture(graniteTexture, graniteUV).toVar();
        // A second, coarser read of the same grain breaks the snow line into drifts,
        // tongues and outcrops; the baked potential decides where the line runs.
        // Stretched down the fall line, so drifts and outcrops run with the slope.
        const broad = texture(graniteTexture, vec2(
            positionGeometry.x.mul(0.0024).add(0.37),
            positionGeometry.y.mul(0.0009).add(positionGeometry.x.mul(0.0003)).add(0.11),
        )).r;
        const surface = attribute('aSurface', 'vec2').toVar();
        const potential = surface.x.sub(0.5).mul(1.35).add(0.5)
            .add(broad.sub(0.5).mul(0.2))
            .add(granite.r.sub(0.5).mul(0.06))
            .toVar();
        const edge = max(fwidth(potential).mul(1.2), 0.012);
        const snow = smoothstep(float(0.5).sub(edge), float(0.5).add(edge), potential);
        const rockGrain = granite.r.mul(0.95).add(0.5).mul(granite.b.mul(-0.38).add(1));
        // Wind-packed drifts: the stretched read also lifts and lowers the snow's light a little,
        // which breaks up the soft facets the smoothed normals leave.
        const snowGrain = granite.r.mul(0.12).add(0.88).add(broad.mul(0.16));
        // Moonlight per pixel from the smoothed normal: a contrast curve applied per vertex
        // and then interpolated would show the triangles.
        const facing = max(dot(normalize(attribute('normal', 'vec3')), MOON), 0);
        const lit = smoothstep(LIT_RAMP[0], LIT_RAMP[1], facing);
        const light = attribute('aLight', 'vec2');
        const rock = mix(PALETTE.rockShade, PALETTE.rockLit, lit).mul(light.y).mul(rockGrain);
        const frost = mix(PALETTE.snowShade, PALETTE.snowLit, lit).mul(light.x).mul(snowGrain).toVar();
        if (glints) {
            // Glints: in about one cell in twenty of moonlit snow a crystal catches the moon and
            // twinkles.
            // A glint is never smaller than a pixel, so the camera's drift cannot make it shimmer.
            const gp = positionGeometry.xy.div(GLINT_CELL).toVar();
            const cell = floor(gp);
            const cellId = cell.x.add(4096).mul(1031).add(cell.y.add(4096).mul(7)).toVar();
            const chance = hash(cellId);
            const spot = vec2(hash(cellId.mul(3).add(1)), hash(cellId.mul(3).add(2))).mul(0.6).add(0.2);
            const offset = fract(gp).sub(spot).mul(GLINT_CELL);
            const radius = max(fwidth(positionGeometry.x).mul(0.75), 0.32);
            const twinkle = sin(uTime.mul(1.7).add(hash(cellId.mul(3).add(3)).mul(6.283))).max(0).pow(6);
            const glint = step(0.955, chance).mul(exp(dot(offset, offset).div(radius.mul(radius)).negate()))
                .mul(twinkle).mul(snow)
                .mul(lit)
                .mul(light.x);
            frost.addAssign(GLINT_COLOUR.mul(glint));
        }
        const ground = mix(rock, frost, snow).add(
            vec3(0.10, 0.13, 0.2).mul(attribute('aMoonResponse', 'float')).mul(uPulse),
        );
        return vec4(mix(ground, wolfhourAir(positionGeometry.x, positionGeometry.y), surface.y), 1);
    })();
    const geometries = [];
    const props = [];
    const motion = { cameraX: 0, cameraY: 0 };
    const recentImpactXs = [];
    let triangles = 0;
    let vertices = 0;
    for (const [index, config] of RANGES.entries()) {
        const geometry = buildRange(index, scale, seed);
        geometries.push(geometry);
        triangles += geometry.index.count / 3;
        vertices += geometry.getAttribute('position').count;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = config.name;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
    }
    scene?.add(group);
    /** The crest (row 0) of range `index` at local x: its height and depth, interpolated. */
    const crestPoint = (index, x) => {
        const geometry = geometries[index];
        const position = geometry.getAttribute('position');
        let lo = 0;
        let hi = geometry.userData.crestColumns - 1;
        const clampedX = Math.max(position.getX(lo), Math.min(position.getX(hi), x));
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (position.getX(mid) < clampedX) lo = mid;
            else hi = mid;
        }
        const t = clamp01((clampedX - position.getX(lo)) / (position.getX(hi) - position.getX(lo)));
        return {
            x: clampedX,
            y: position.getY(lo) + (position.getY(hi) - position.getY(lo)) * t,
            z: position.getZ(lo) + (position.getZ(hi) - position.getZ(lo)) * t,
        };
    };
    /**
     * Props keep their proportions while the terrain stretches with the aspect, or follow a share
     * of the stretch (`squeeze` 0..1: 0 keeps the prop's own width, 1 stretches it with the land).
     */
    const fitProps = () => {
        const stretch = group.scale.x;
        for (const prop of props) {
            const follow = stretch ** (prop.userData.wolfhourSqueeze || 0);
            prop.scale.x = (prop.userData.wolfhourScale * follow) / stretch;
            prop.updateMatrix?.();
        }
    };
    const applyParallax = (camera) => {
        motion.cameraX = Number.isFinite(camera?.position?.x) ? camera.position.x : 0;
        motion.cameraY = Number.isFinite(camera?.position?.y) ? camera.position.y : 0;
        for (let i = 0; i < group.children.length; i++) {
            const mesh = group.children[i];
            // The response is measured in world space; group X scaling is only the
            // framing mechanism, so cancel it when assigning local mesh translation.
            mesh.position.x = (motion.cameraX * (1 - PARALLAX_RESPONSE[i])) / group.scale.x;
            mesh.position.y = motion.cameraY * (1 - PARALLAX_RESPONSE[i]);
            mesh.updateMatrix();
        }
    };
    return {
        group,
        graniteTexture,
        motion,
        parallaxResponse: PARALLAX_RESPONSE,
        applyParallax,
        crestPoint,
        /** Resize a prop stood with addProp (its proportions are kept through aspect changes). */
        setPropScale(object, size) {
            if (!props.includes(object) || !Number.isFinite(size) || size <= 0) return;
            object.userData.wolfhourScale = size;
            object.scale.y = size;
            fitProps();
        },
        /**
         * Stand `object` on range `index` (it moves and scales with that range) at local `x`,
         * `lift` above (negative: below) its crest and `depth` in front of it; `squeeze` is the
         * share of the terrain's aspect stretch its width follows.
         */
        addProp(index, object, {
            x = 0, lift = 0, depth = 4, squeeze = 0,
        } = {}) {
            const mesh = group.children[index];
            const crest = crestPoint(index, x);
            object.position.set(crest.x, crest.y + lift, crest.z + depth);
            object.userData.wolfhourScale = object.scale.x;
            object.userData.wolfhourSqueeze = Math.min(1, Math.max(0, squeeze));
            mesh.add(object);
            props.push(object);
            fitProps();
            return crest;
        },
        getImpactOffset(out = {}) {
            const hero = group.children[1];
            out.x = hero.position.x * group.scale.x;
            out.y = hero.position.y;
            out.z = hero.position.z;
            return out;
        },
        triangles,
        vertices,
        update(time, state = {}) {
            const pulse = typeof state === 'number' ? state
                : (state.mountainPulse ?? state.ridgePulse ?? state.pulse ?? 0);
            uPulse.value = Math.max(0, Math.min(1.5, Number.isFinite(pulse) ? pulse : 0));
            uTime.value = Number.isFinite(time) ? time : 0;
        },
        resize(aspect = 16 / 9) {
            const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
            group.scale.x = Math.max(0.28, Math.min(2.7, safeAspect / (16 / 9)));
            group.updateMatrix();
            fitProps();
            // A resize can happen between camera frames: preserve each layer's current
            // world displacement without waiting for the next applyParallax call.
            for (let i = 0; i < group.children.length; i++) {
                const mesh = group.children[i];
                mesh.position.x = (motion.cameraX * (1 - PARALLAX_RESPONSE[i])) / group.scale.x;
                mesh.updateMatrix();
            }
        },
        randomImpactTarget(random = Math.random, { maxAbsX } = {}) {
            const scaleX = group.scale.x;
            const shiftX = group.children[1].position.x * scaleX;
            const localTargetX = (worldX) => (this.impactTarget(worldX, { maxAbsX }).x - shiftX) / scaleX;
            // Find the visible intervals before sampling. Randomizing first and then
            // clamping would pile impacts up at the same inner/outer shoulder edges.
            let ranges = [
                [localTargetX(-1e9), localTargetX(shiftX - 1)],
                [localTargetX(shiftX + 1), localTargetX(1e9)],
            ].filter(([lo, hi]) => hi > lo);
            const totalLength = ranges.reduce((sum, [lo, hi]) => sum + hi - lo, 0);
            if (totalLength <= 0) return this.impactTarget(shiftX, { maxAbsX });
            // History stays in terrain coordinates, so camera motion and resizing
            // cannot disguise a repeat hit on the same rock. Two exclusions always
            // leave at least half the available shoulder length to sample from.
            const separation = Math.min(80, totalLength * 0.12);
            for (const previousX of recentImpactXs) {
                const next = [];
                for (const [lo, hi] of ranges) {
                    if (previousX - separation > lo) next.push([lo, Math.min(hi, previousX - separation)]);
                    if (previousX + separation < hi) next.push([Math.max(lo, previousX + separation), hi]);
                }
                ranges = next;
            }
            const availableLength = ranges.reduce((sum, [lo, hi]) => sum + hi - lo, 0);
            const roll = random();
            let remaining = (Number.isFinite(roll) ? clamp01(roll) : 0.5) * availableLength;
            let selectedX = ranges.at(-1)[1];
            for (const [lo, hi] of ranges) {
                if (remaining <= hi - lo) { selectedX = lo + remaining; break; }
                remaining -= hi - lo;
            }
            recentImpactXs.push(selectedX);
            if (recentImpactXs.length > 2) recentImpactXs.shift();
            return this.impactTarget(selectedX * scaleX + shiftX, { maxAbsX });
        },
        impactTarget(worldX, { maxAbsX } = {}) {
            // An impact belongs to a visible massif shoulder, clear of the central board.
            // Sample the baked crest itself so low tiers and the landing sprite agree.
            const scaleX = group.scale.x;
            const hero = group.children[1];
            const shiftX = hero.position.x * scaleX;
            const localLimit = Number.isFinite(maxAbsX) && maxAbsX > 0
                ? Math.min(760, (maxAbsX + Math.abs(shiftX)) / scaleX) : 760;
            const localMinimum = Math.min(420, localLimit * 0.8);
            const requested = Number.isFinite(worldX) ? (worldX - shiftX) / scaleX : 520;
            let x = (requested < 0 ? -1 : 1)
                * Math.max(localMinimum, Math.min(localLimit, Math.abs(requested)));
            if (Number.isFinite(maxAbsX) && maxAbsX > 0) {
                const boundedWorldX = Math.max(-maxAbsX, Math.min(maxAbsX, x * scaleX + shiftX));
                x = (boundedWorldX - shiftX) / scaleX;
            }
            const geometry = geometries[1];
            const position = geometry.getAttribute('position');
            let lo = 0;
            let hi = geometry.userData.crestColumns - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (position.getX(mid) < x) lo = mid;
                else hi = mid;
            }
            const t = clamp01((x - position.getX(lo)) / (position.getX(hi) - position.getX(lo)));
            const y = position.getY(lo) + (position.getY(hi) - position.getY(lo)) * t;
            const z = position.getZ(lo) + (position.getZ(hi) - position.getZ(lo)) * t;
            return { x: x * scaleX + shiftX, y: y + hero.position.y, z: z + hero.position.z };
        },
        dispose() {
            group.removeFromParent();
            for (const prop of props) prop.removeFromParent();
            props.length = 0;
            for (const geometry of geometries) geometry.dispose();
            material.dispose();
            graniteTexture.dispose();
            recentImpactXs.length = 0;
            group.clear();
        },
    };
}
