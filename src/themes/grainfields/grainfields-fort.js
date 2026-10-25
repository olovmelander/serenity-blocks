/**
 * Grainfields — the ruin on the knoll.
 *
 * The old castle on its knoll in the vale (PLACES.fort), a kilometre and a half out and seen
 * against Lapporten's gate a degree or two over the field's crest: a round tower split open, the
 * gatehouse where the path arrives, the keep turned three-quarters to the fields with sky through
 * its windows, a broken square tower, and a curtain wall breached round the crown. It is modelled
 * in Blender (scripts/blender/grainfields/ruin.py) and loaded with the trees; here it is shaded by
 * the shared light. The stone comes in a few tones, with turf on what faces up and on the rubble
 * heaps, and the sky each face sees is baked in. The sun gets in only through the side a face is
 * open to (a cone round its bent normal), so the inside of the keep and the gate's passage stay
 * in shadow.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    float,
    max,
    mix,
    modelWorldMatrix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    sqrt,
    texture,
    vec3,
    vec4,
} from 'three/tsl';
import { PLACES } from './grainfields-core.js';
import { groundHeight } from './grainfields-plan.js';
import { aerial } from './grainfields-light.js';
import { deckShadow } from './grainfields-tsl.js';

/**
 * The ruin's turn about the vertical (radians): its gate (the model's +z) faces down the path to
 * the fields. ruin.py's RUIN_YAW is the same number (its previews look from the eye).
 */
export const RUIN_YAW = PLACES.fort.yaw;

/** Linear albedos: the stone's darkest and lightest tones, and the turf. */
const STONE_DARK = [0.15, 0.142, 0.128];
const STONE_LIGHT = [0.33, 0.3, 0.25];
const TURF = [0.07, 0.085, 0.035];

/** The ruin as a part, or null without its asset (the knoll then stands bare). */
export function createFort(u, t, ruin) {
    if (!ruin?.geometry) return null;
    const F = PLACES.fort;
    const baseY = groundHeight(F.x, F.z);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsRuin';
    material.fog = false;
    const paint = attribute('color', 'vec4'); // the sky seen, the stone's tone, turf, dressed (1) or rubble (0)
    const open = attribute('_bent', 'vec3');
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N = normalize(normalWorld).toVar();
        const sky = paint.x.toVar();
        const bent = normalize(modelWorldMatrix.mul(vec4(open, 0.0)).xyz).toVar();
        // Each face its own tone, blotched by weathering; rubble a shade darker than dressed stone.
        const blotch = texture(t.noise, P.xz.mul(0.045).add(P.y.mul(0.03))).g;
        const tone = clamp(paint.y.mul(0.75).add(blotch.mul(0.5)).sub(0.12), 0.0, 1.0);
        const stone = mix(vec3(...STONE_DARK), vec3(...STONE_LIGHT), tone).mul(mix(float(0.85), float(1.0), paint.w));
        // Turf on what faces up (the wall walks, the broken tops, the heaps), moss at the walls' feet.
        const up = smoothstep(0.5, 0.85, N.y);
        const foot = float(1.0).sub(smoothstep(0.4, 3.5, P.y.sub(baseY)));
        const grass = clamp(max(paint.z, up.mul(0.85)).add(foot.mul(0.4)), 0.0, 1.0);
        const albedo = mix(stone, vec3(...TURF), grass);
        // The sun gets in through the side a face is open to: a cone round its bent normal, as wide
        // as the share of sky it sees.
        // (Soft and generous: an outer wall the sun only grazes still takes it.)
        const cone = sqrt(float(1.0).sub(sky));
        const through = smoothstep(cone.sub(0.45), cone.add(0.05), dot(bent, u.sunDir));
        const sunlit = deckShadow(u, t.noise, P).mul(u.sunUp).mul(through);
        const ndl = max(dot(N, u.sunDir), 0.0);
        // The sky's fill and the fields' bounce, as much of them as the face sees. The sun always
        // stands beyond the ruin from the fields, so the faces they see are in shade: the bright
        // sky round the sun lights the ones turned toward it a little more (the planes part).
        const seen = sky.mul(0.8).add(0.2);
        const sunward = max(dot(N, normalize(vec3(u.sunDir.x, 0.0, u.sunDir.z))), 0.0);
        const fill = u.fill.mul(N.y.mul(0.45).add(0.55)).add(u.bounce.mul(N.y.mul(-0.5).add(0.5)))
            .add(u.glow.mul(sunward.mul(sunward).mul(0.1)))
            .mul(seen);
        const lit = albedo.mul(u.sun.mul(ndl).mul(sunlit).add(fill));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    const mesh = new THREE.Mesh(ruin.geometry, material);
    mesh.name = 'GrainfieldsRuin';
    mesh.position.set(F.x, baseY, F.z);
    mesh.rotation.y = RUIN_YAW;
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    return {
        mesh,
        meshes: [mesh],
        update() {},
        // The geometry is the assets bundle's (disposeGrainfieldsAssets releases it).
        dispose() {
            material.dispose();
        },
    };
}
