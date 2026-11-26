/** Cleaved specimens hanging above the two shores. Their facets turn through the light. */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, abs, attribute, cameraPosition, clamp, cos, dot, float, fwidth, int, length, max, min, mix,
    normalize, positionGeometry, pow, reflect, refract, sin, smoothstep, uniform, uniformArray, varying, vec3, vec4,
} from 'three/tsl';

// A double-terminated quartz splinter modeled in Blender. A diagonal cleavage cuts through
// the long prism faces on one side. Keep Blender's polygon boundaries for the arris lighting.
// The two tips are offset independently. Coordinates are thousandths of the specimen's scale.
const CORNERS = [
    [321, 376, -91], [321, -405, -91], [318, 400, -76], [283, -340, 124],
    [-231, 298, 316], [-231, -256, 316], [-11, 637, 253], [111, -627, 218],
    [242, -385, 180], [-343, 315, 155], [-343, -376, 155], [-152, 590, -272],
    [-152, -311, -272], [-218, 750, -126], [-254, -691, -44], [196, 306, -291],
    [196, -426, -291], [-2, 642, -280], [252, -617, -200], [37, 952, -6],
    [65, 870, 114], [171, 763, 15], [8, 951, -41], [62, -882, -13],
];
const FACETS = [
    [1, 0, 2, 3], [8, 6, 4, 5, 7], [10, 5, 4, 9], [12, 14, 10, 9, 13, 11],
    [16, 12, 11, 17, 15], [16, 15, 0, 1, 18], [21, 19, 20], [13, 9, 4, 6, 20, 19, 22],
    [22, 17, 11, 13], [22, 19, 21, 2, 0, 15, 17], [23, 18, 1, 3, 8, 7],
    [23, 7, 5, 10, 14], [23, 14, 12, 16, 18], [8, 3, 2, 21, 20, 6],
];

// Pockets of air between the fans and the vault, with room for the playfield in the middle.
// x, y, z, scale, mineral family. Smaller chips drift around the same parent pocket.
const POCKETS = [
    [-12.1, 7.4, -2.8, 0.90, 0], [13.6, 8.9, -4.3, 0.78, 1],
    [-18.9, 11.2, -17, 0.83, 2], [22, 4.9, -22, 0.98, 3],
    [-9.3, 1.7, -10.4, 0.64, 0], [9.5, 1.1, -12.8, 0.69, 4],
    [-24.5, 5.0, -10.7, 0.66, 2], [17, 12.5, -25.6, 0.71, 3],
    [-20.2, 2.5, -37.5, 0.95, 3], [29.7, 8.7, -38.1, 0.80, 0],
];
const COUNTS = {
    Minimal: 6, Low: 10, Medium: 17, High: 24, Ultra: 27, Extreme: 30,
};

function shardGeometry(count, planes) {
    const positions = [];
    const edges = [];
    const normals = [];
    const corners = CORNERS.map(([x, y, z]) => new THREE.Vector3(x, y, z).multiplyScalar(0.001));
    const triangle = new THREE.Triangle();
    const normal = new THREE.Vector3();
    FACETS.forEach((face) => {
        // The quantised coordinates are slightly off-plane. Use one normal for the entire facet.
        triangle.set(corners[face[0]], corners[face[1]], corners[face[2]]).getNormal(normal);
        planes.push(new THREE.Vector4(normal.x, normal.y, normal.z, normal.dot(corners[face[0]])));
        for (let k = 1; k < face.length - 1; k += 1) {
            const vertices = [face[0], face[k], face[k + 1]];
            const perimeter = [true, k === face.length - 2, k === 1];
            vertices.forEach((vertex, i) => {
                positions.push(...corners[vertex].toArray());
                normals.push(normal.x, normal.y, normal.z);
                for (let side = 0; side < 3; side += 1) edges.push(side === i || !perimeter[side] ? 1 : 0);
            });
        }
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aCleavage', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('aArris', new THREE.Float32BufferAttribute(edges, 3));

    const records = new Float32Array(count * 8);
    for (let i = 0; i < count; i += 1) {
        const [x, y, z, size, family] = POCKETS[i % POCKETS.length];
        const chip = Math.floor(i / POCKETS.length);
        const phase = (i + 1) * 2.39996;
        const reach = chip * 1.08;
        records.set([
            x + reach * Math.cos(phase), y + reach * Math.sin(phase), z + reach * 0.45,
            size / (1 + 0.75 * chip), phase, 0.12 + (i % 7) * 0.016, Math.sin(phase) * 0.82, family,
        ], i * 8);
    }
    const buffer = new THREE.InstancedInterleavedBuffer(records, 8);
    geometry.setAttribute('iPocket', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('iTurn', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = count;
    return geometry;
}

export function createCaveShards({ light, quality }) {
    const u = light.uniforms;
    const motion = uniform(1);
    const count = COUNTS[quality] ?? COUNTS.High;
    const planes = [];
    const geometry = shardGeometry(count, planes);
    const walls = uniformArray(planes, 'vec4');
    const pocket = attribute('iPocket', 'vec4');
    const turn = attribute('iTurn', 'vec4');
    const phase = u.time.mul(turn.y).add(turn.x);
    const yaw = turn.x.add(sin(phase.mul(0.81)).mul(motion).mul(1.45));
    const tilt = turn.z.add(sin(phase.mul(0.57)).mul(motion).mul(0.37));
    const rotate = (v) => {
        const x = v.x.mul(cos(tilt)).sub(v.y.mul(sin(tilt)));
        const y = v.x.mul(sin(tilt)).add(v.y.mul(cos(tilt)));
        return vec3(x.mul(cos(yaw)).add(v.z.mul(sin(yaw))), y, v.z.mul(cos(yaw)).sub(x.mul(sin(yaw))));
    };
    const unrotate = (v) => {
        const x = v.x.mul(cos(yaw)).sub(v.z.mul(sin(yaw)));
        const z = v.x.mul(sin(yaw)).add(v.z.mul(cos(yaw)));
        return vec3(x.mul(cos(tilt)).add(v.y.mul(sin(tilt))), v.y.mul(cos(tilt)).sub(x.mul(sin(tilt))), z);
    };
    const drift = vec3(sin(phase.mul(0.64)).mul(0.56), sin(phase).mul(0.86), cos(phase.mul(0.79)).mul(0.32));
    const world = pocket.xyz.add(drift.mul(motion)).add(rotate(positionGeometry).mul(pocket.w));
    const vWorld = varying(world, 'vChipWorld');
    const vLocal = varying(positionGeometry, 'vChipLocal');
    const vIncident = varying(unrotate(world.sub(cameraPosition)), 'vChipIncident');
    const sky = vec3(-0.42, 0.78, -0.46);
    const vSky = varying(unrotate(sky), 'vChipSky');
    const vPlane = varying(attribute('aCleavage', 'vec3'), 'vChipPlane');
    const vNormal = varying(rotate(attribute('aCleavage', 'vec3')), 'vChipNormal');
    const vTint = varying(vec3(u.familyColor.element(int(turn.w.add(0.5)))), 'vChipTint');
    const edge = varying(attribute('aArris', 'vec3'), 'vChipArris');
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'Crystal Cave — cleaved splinters';
    material.positionNode = world;
    material.colorNode = Fn(() => {
        const n = normalize(vNormal).toVar();
        const eye = normalize(cameraPosition.sub(vWorld)).toVar();
        const mirror = reflect(eye.negate(), n).toVar();
        const skyFace = max(dot(n, sky), 0).toVar();
        const rim = float(1).sub(clamp(dot(n, eye), 0, 1)).toVar();
        const catchLight = max(dot(mirror, sky), 0).pow(16);
        // Follow the refracted view to its exit on Blender's actual planes. A tilted chip has
        // the shape of its opposite facet inside the near one, moving with the viewer.
        const origin = vLocal.toVar();
        const ray = refract(normalize(vIncident), normalize(vPlane), float(0.65)).toVar();
        const exitFace = vec4(0, 1, 0, 3).toVar();
        Loop(planes.length, ({ i }) => {
            const wall = walls.element(i).toVar();
            const facing = dot(wall.xyz, ray).toVar();
            const span = max(wall.w.sub(dot(wall.xyz, origin)), 0).div(max(facing, 0.0001)).toVar();
            If(facing.greaterThan(0.0001).and(span.lessThan(exitFace.w)), () => {
                exitFace.assign(vec4(wall.xyz, span));
            });
        });
        const farPoint = origin.add(ray.mul(exitFace.w)).toVar();
        const exitRay = refract(ray, exitFace.xyz.negate(), float(1.54));
        const window = max(dot(exitRay, vSky), 0).pow(5);
        const farLight = dot(exitFace.xyz, vSky).mul(0.5).add(0.5);
        const absorption = pow(mix(vec3(1), vTint, 0.79), vec3(exitFace.w.mul(1.6).add(0.13)));
        const cut = abs(farPoint.x.add(farPoint.z.mul(0.71)).sub(farPoint.y.mul(0.31)));
        const inclusion = float(1).sub(smoothstep(0.008, 0.032, cut)).mul(0.28);
        const interior = absorption.mul(mix(vTint, u.skyTint, 0.38))
            .mul(farLight.mul(0.69).add(window.mul(2.4)).add(inclusion));
        const facet = vTint.mul(skyFace.mul(0.59).add(rim.mul(0.37)).add(0.08)).add(interior);
        const widths = max(fwidth(edge), vec3(0.0001)).toVar();
        const pixels = abs(edge).div(widths);
        const arris = float(1).sub(smoothstep(0.05, 0.85, min(pixels.x, min(pixels.y, pixels.z))));
        const lightColour = mix(vTint, u.skyTint, 0.52);
        const surface = facet.add(lightColour.mul(arris.mul(0.61).add(catchLight.mul(2.9)))
            .mul(u.skyLevel.mul(0.5).add(u.resonance.mul(0.42)).add(0.28)));
        return light.haze(surface, length(vWorld.sub(cameraPosition)), vWorld.y);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Crystal Cave — floating shards';
    mesh.frustumCulled = false;
    return {
        mesh,
        motion,
        count,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
