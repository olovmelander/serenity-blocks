import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, clamp, dot, float, fract, instancedBufferAttribute, max, mix,
    normalWorld, normalize, positionGeometry, positionLocal, positionWorld, sin, smoothstep, texture, uniform,
    uv, vec3,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attributeFloats } from '../shared/attribute-floats.js';
import { bankHeight } from './aurora-terrain.js';

const CONIFER_URL = new URL('./assets/winter-conifers.glb', import.meta.url).href;
const MODELS = ['spruce_near', 'pine_near', 'spruce_grove', 'pine_grove'];
let specimens;
let loading;

const SHADE_WIDTH = 512;
const SHADE_HEIGHT = 256;
const BANK_LEFT = -190;
const BANK_BACK = -182;
const BANK_WIDTH = 380;
const BANK_DEPTH = 200;

/** Root contact and diffuse crown shadows are projected onto the actual bank surface. */
export function createConiferShade() {
    const map = new THREE.DataTexture(
        new Uint8Array(SHADE_WIDTH * SHADE_HEIGHT),
        SHADE_WIDTH,
        SHADE_HEIGHT,
        THREE.RedFormat,
        THREE.UnsignedByteType,
    );
    map.name = 'Aurora — conifer contact shadows';
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.needsUpdate = true;
    return map;
}

function shadeBank(map, x, z, height) {
    const pixels = map.image.data;
    const root = Math.max(1, height * 0.066);
    const span = height * 0.19;
    const towardEye = height * 0.115;
    const stepX = BANK_WIDTH / SHADE_WIDTH;
    const stepZ = BANK_DEPTH / SHADE_HEIGHT;
    const left = Math.max(0, Math.floor((x - 2 * span - BANK_LEFT) / stepX));
    const right = Math.min(SHADE_WIDTH - 1, Math.ceil((x + 2 * span - BANK_LEFT) / stepX));
    const back = Math.max(0, Math.floor((z - 2 * span - BANK_BACK) / stepZ));
    const front = Math.min(SHADE_HEIGHT - 1, Math.ceil((z + towardEye + 2 * span - BANK_BACK) / stepZ));
    for (let row = back; row <= front; row += 1) {
        const dz = BANK_BACK + (row + 0.5) * stepZ - z;
        for (let col = left; col <= right; col += 1) {
            const dx = BANK_LEFT + (col + 0.5) * stepX - x;
            const foot = Math.exp(-(dx * dx + dz * dz) / (root * root));
            const along = (dz - towardEye) * 0.72;
            const canopy = 0.55 * Math.exp((-2 * (dx * dx + along * along)) / (span * span));
            const shade = 1 - (1 - foot) * (1 - canopy);
            const index = row * SHADE_WIDTH + col;
            pixels[index] = Math.max(pixels[index], Math.round(255 * shade));
        }
    }
}

/** The packed Blender meshes stay as CPU arrays. Each world owns its own disposable GPU buffers. */
export function preloadAuroraConifers() {
    if (specimens) return Promise.resolve();
    if (!loading) {
        loading = new GLTFLoader().loadAsync(CONIFER_URL).then(({ scene }) => {
            try {
                const parsed = {};
                for (const name of MODELS) {
                    const object = scene.getObjectByName(name);
                    const { geometry, position, scale } = object;
                    const points = attributeFloats(geometry.attributes.position, 3);
                    for (let i = 0; i < points.length; i += 3) {
                        points[i] = points[i] * scale.x + position.x;
                        points[i + 1] = points[i + 1] * scale.y + position.y;
                        points[i + 2] = points[i + 2] * scale.z + position.z;
                    }
                    parsed[name] = {
                        points,
                        normals: attributeFloats(geometry.attributes.normal, 3),
                        paint: geometry.attributes.color.array,
                        index: geometry.index.array,
                        tips: object.userData.snowTips,
                    };
                }
                specimens = parsed;
            } finally {
                scene.traverse((object) => {
                    object.geometry?.dispose();
                    object.material?.dispose();
                });
            }
        }).catch((error) => {
            console.warn('[Aurora] Using procedural trees for this visit.', error);
        })
            .finally(() => { loading = null; });
    }
    return loading;
}

function specimenGeometry(model) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(model.points, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(model.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(model.paint, 4, true));
    geometry.setIndex(new THREE.BufferAttribute(model.index, 1));
    return geometry;
}

function coniferMaterial(land, motion) {
    const { atmosphere, uniforms } = land;
    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'Aurora — snow pillows, hanging needles and bark';
    const p = positionGeometry;
    // A front travels down the shore. The trunk stays put at its foot, and the outer fans
    // nod under their load at a different rate from the sway of the whole crown.
    const gust = sin(uniforms.time.mul(0.64).add(positionLocal.z.mul(0.071)).add(positionLocal.x.mul(0.049)));
    const tuft = sin(uniforms.time.mul(1.21).add(positionLocal.z.mul(0.12)).add(p.y.mul(14)));
    const bend = p.y.max(0).mul(p.y).mul(0.17).mul(gust);
    const tips = p.xz.length().mul(tuft).mul(0.33);
    material.positionNode = positionLocal.add(vec3(bend.add(tips.mul(0.42)), tips, bend.mul(0.25)).mul(motion));
    material.colorNode = Fn(() => {
        const n = normalize(normalWorld).toVar();
        const paint = attribute('color', 'vec4');
        const snow = smoothstep(0.64, 0.85, paint.r).toVar();
        const bark = vec3(0.095, 0.063, 0.046);
        const needle = mix(vec3(0.018, 0.047, 0.043), vec3(0.033, 0.092, 0.073), paint.g);
        // Soft blue light held under the lip and fresh powder above it.
        const up = clamp(n.y.mul(0.55).add(0.50), 0, 1);
        const frost = texture(land.noiseTexture, p.xz.mul(1.7).add(p.y.mul(0.6))).g;
        const powder = mix(vec3(0.31, 0.44, 0.55), vec3(0.72, 0.82, 0.86), up)
            .mul(frost.mul(0.22).add(0.90));
        const driftEdge = sin(p.x.mul(175).add(p.z.mul(142))).mul(0.009).add(0.032);
        const foot = smoothstep(0, 0.028, driftEdge.sub(p.y)).mul(smoothstep(0.10, 0.28, paint.r).oneMinus());
        const cover = max(snow, foot).toVar();
        const albedo = mix(mix(bark, needle, smoothstep(0.1, 0.3, paint.r)), powder, cover);
        const aurora = atmosphere.auroraAbove(positionWorld).toVar();
        const light = land.litSurface(albedo, n, { aurora, backlit: snow.mul(0.6).add(0.4) });
        const edge = float(1).sub(dot(n, normalize(cameraPosition.sub(positionWorld))).abs()).clamp(0, 1);
        const rim = edge.mul(edge).mul(max(n.y.mul(0.7).add(0.3), 0)).mul(paint.g);
        // Blue light from the open sky reaches the front of each cap. Light from the
        // curtains grazes its far lip; sheltered needles between the two remain dark.
        const sky = max(dot(n, vec3(-0.40, 0.83, 0.39)), 0).mul(0.79).add(0.17);
        const crown = smoothstep(0.02, 0.09, p.y);
        const blue = vec3(0.085, 0.145, 0.215).mul(sky).mul(cover).mul(crown.mul(0.9).add(0.1));
        const color = light.add(blue).mul(paint.g.mul(0.65).add(0.35))
            .add(uniforms.auroraLight.mul(rim).mul(cover.mul(0.23).add(0.042)));
        return atmosphere.apply(color, positionWorld, { aurora });
    })();
    return material;
}

/** Grains break loose from one of the loaded tips every few seconds, then disperse beneath it. */
function driftingSnow(land, anchors, random) {
    const perBranch = land.preset.treeCount >= 22 ? 22 : 10;
    const count = anchors.length * perBranch;
    const transform = new THREE.Object3D();
    const seeds = new Float32Array(count * 4);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
    mesh.name = 'Aurora — powder falling from boughs';
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    anchors.forEach(({ position }, j) => {
        for (let k = 0; k < perBranch; k += 1) {
            const i = j * perBranch + k;
            transform.position.copy(position);
            transform.position.x += (random() - 0.5) * 0.38;
            transform.position.z += (random() - 0.5) * 0.26;
            transform.scale.setScalar(0.045 + 0.12 * random());
            transform.updateMatrix();
            mesh.setMatrixAt(i, transform.matrix);
            seeds.set([j * (38 / anchors.length) + (k / perBranch) * 0.38, random(), random(), random()], i * 4);
        }
    });
    mesh.geometry.setAttribute('grain', new THREE.InstancedBufferAttribute(seeds, 4));
    const grain = instancedBufferAttribute(mesh.geometry.attributes.grain);
    const age = fract(land.uniforms.time.add(grain.x).div(38)).mul(38).min(3.1);
    const life = smoothstep(0.0, 0.12, age).mul(smoothstep(1.65, 3.05, age).oneMinus());
    const spread = age.mul(age).mul(0.35).add(age.mul(0.35));
    const fall = age.mul(age).mul(grain.z.mul(0.85).add(0.60));
    material.positionNode = positionLocal.add(vec3(
        spread.mul(grain.y.mul(1.2).add(0.22)).add(sin(age.mul(3).add(grain.w.mul(9))).mul(age).mul(0.11)),
        fall.negate(),
        spread.mul(grain.w.sub(0.5)).mul(0.52),
    ));
    material.colorNode = vec3(0.51, 0.68, 0.77).add(land.uniforms.auroraLight.mul(0.44));
    material.opacityNode = smoothstep(0.04, 0.5, uv().sub(0.5).length()).oneMinus().mul(life).mul(0.70);
    return { mesh, perBranch };
}

/** Instantiate a small number of detailed specimens in front of cheaper, irregular groves. */
export function createAuroraConifers(land, random) {
    if (!specimens) return null;
    const group = new THREE.Group();
    group.name = 'Aurora — winter conifers';
    const count = land.preset.treeCount;
    const heroCount = Math.max(2, Math.min(5, Math.floor(count / 6)));
    const motion = uniform(1);
    const material = coniferMaterial(land, motion);
    const buckets = new Map();
    const anchors = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const rank = Math.floor(i / 2) / Math.max(1, Math.ceil(count / 2) - 1);
        const species = i === 1 || (i > 3 && i % 5 <= 1) ? 'pine' : 'spruce';
        const lod = i < heroCount ? 'near' : 'grove';
        const name = `${species}_${lod}`;
        if (!buckets.has(name)) buckets.set(name, []);
        let distance = 45 + rank * 78 + random() * 8;
        let bearing = 31 + random() * 10;
        let height = (22 - rank * 10) * (0.85 + random() * 0.48);
        if (i < 4) {
            distance = [42, 50, 33, 64][i];
            bearing = [34, 36, 47, 30][i];
            height = [31, 28, 36, 21][i];
        }
        let x = Math.tan(bearing * (Math.PI / 180)) * distance;
        while (x < distance * 1.23 && bankHeight(side * x, -distance, land.seed) < 0.10) x += 0.75;
        dummy.position.set(side * x, bankHeight(side * x, -distance, land.seed) - 0.64, -distance);
        if (land.coniferShade) shadeBank(land.coniferShade, dummy.position.x, -distance, height);
        dummy.rotation.set((random() - 0.5) * 0.05, random() * Math.PI * 2, (random() - 0.5) * 0.055);
        const girth = height * (0.90 + random() * 0.27);
        dummy.scale.set(girth, height, girth);
        dummy.updateMatrix();
        buckets.get(name).push(dummy.matrix.clone());
        if (i < 6) {
            // The inward-facing tips shed where the release can be seen against open sky.
            const tips = specimens[name].tips.map((tip) => new THREE.Vector3(...tip).applyMatrix4(dummy.matrix));
            tips.sort((a, b) => side * (a.x - b.x));
            anchors.push({ position: tips[0], baseX: dummy.position.x });
        }
    }
    if (land.coniferShade) land.coniferShade.needsUpdate = true;
    for (const [name, matrices] of buckets) {
        const mesh = new THREE.InstancedMesh(specimenGeometry(specimens[name]), material, matrices.length);
        mesh.name = `Aurora — ${name}`;
        matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.boundingSphere.radius += 0.4;
        group.add(mesh);
    }
    const { mesh: snow, perBranch } = driftingSnow(land, anchors, random);
    group.add(snow);
    land.group.add(group);
    // Translate the trees with their banks at narrow aspect ratios. Their girth and the
    // offset of a shedding tip from its parent trunk are both measured in real metres.
    const placements = group.children.map((mesh) => ({
        mesh, rest: mesh.instanceMatrix.array.slice(),
    }));
    let width = 1;
    return {
        count,
        setAspect(aspect) {
            const lens = aspect < 0.9 ? 1.296 : 1;
            const ratio = Math.min(1, (aspect * lens) / (16 / 9));
            const next = ratio + 0.13 * (1 - ratio);
            if (Math.abs(next - width) < 0.0001) return width;
            width = next;
            for (const { mesh, rest } of placements) {
                for (let i = 0; i < mesh.count; i += 1) {
                    const at = i * 16 + 12;
                    const trunkX = mesh === snow ? anchors[Math.floor(i / perBranch)].baseX : rest[at];
                    mesh.instanceMatrix.array[at] = rest[at] + (width - 1) * trunkX;
                }
                mesh.instanceMatrix.needsUpdate = true;
                if (mesh !== snow) {
                    mesh.computeBoundingSphere();
                    mesh.boundingSphere.radius += 0.4;
                }
            }
            return width;
        },
        setReducedMotion(reduced) { motion.value = reduced ? 0 : 1; snow.visible = !reduced; },
        dispose() {
            group.removeFromParent();
            for (const mesh of group.children) {
                mesh.geometry.dispose();
                mesh.dispose();
            }
            snow.material.dispose();
            material.dispose();
            group.clear();
        },
    };
}
