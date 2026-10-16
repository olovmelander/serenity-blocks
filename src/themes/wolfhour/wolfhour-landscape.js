/**
 * Wolfhour alpine terrain study. Geometry, erosion, moonlight and snow are baked once on
 * the CPU; rendering is four opaque draws with interpolated colour and one reaction gain.
 * Authored for an orthographic 1000-unit-tall view looking down -Z. All ranges cover
 * +/-2400 world units, so a resize does not regenerate terrain or move its composition.
 * The arrays and the granite's pixels are baked in wolfhour-landscape-bake.js (a first visit: in a
 * worker); this module makes the meshes, the texture and the material from them.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, positionGeometry, texture, uniform, vec2, vec3,
} from 'three/tsl';
import {
    GRANITE_SIZE, RANGES, bakeGranite, bakeRange, landscapeScale,
} from './wolfhour-landscape-bake.js';

const PARALLAX_RESPONSE = Object.freeze([0.18, 0.48, 0.88, 1.24]);

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
    geometry.setAttribute('color', new THREE.BufferAttribute(baked.colours, 3));
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
    const graniteTexture = makeGraniteTexture(seed);
    const material = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour baked alpine moonlight',
        depthWrite: true,
        depthTest: true,
        side: THREE.FrontSide,
    });
    const graniteUV = vec2(
        positionGeometry.x.mul(0.0019).add(positionGeometry.y.mul(0.0007)),
        positionGeometry.y.mul(0.0022),
    );
    const granite = texture(graniteTexture, graniteUV);
    const grain = granite.r.mul(1.12).add(0.42)
        .add(granite.g.sub(0.5).mul(0.32))
        .mul(granite.b.mul(-0.43).add(1));
    material.colorNode = attribute('color', 'vec3').mul(grain).add(
        vec3(0.15, 0.155, 0.17).mul(attribute('aMoonResponse', 'float')).mul(uPulse),
    );
    const geometries = [];
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
        },
        resize(aspect = 16 / 9) {
            const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
            group.scale.x = Math.max(0.28, Math.min(2.7, safeAspect / (16 / 9)));
            group.updateMatrix();
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
            for (const geometry of geometries) geometry.dispose();
            material.dispose();
            graniteTexture.dispose();
            recentImpactXs.length = 0;
            group.clear();
        },
    };
}
