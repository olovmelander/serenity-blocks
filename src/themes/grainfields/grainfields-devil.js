/**
 * Grainfields — a twist's dust devil.
 *
 * A twist sets the wind wheeling in the stand (the whirl in the barley, grainfields-land pulsesAt);
 * over it stands the thing a whirl of wind on a dry harvest field really raises: a dust devil, a
 * column of dust and chaff a dozen metres tall, narrow at its foot and opening upward, turning,
 * leaning with the wind and walking slowly over the field. It reads at every hour: pale against
 * the storm, lit gold from its sunward side in a broken sky, blazing with the sun beyond it.
 *
 * One tall quad per devil, turned to face the eye about the vertical, in rows so it can lean and
 * snake. The fragment treats the quad as the column seen from the side: across it, the chord
 * through a hollow tube (dust gathers in the wall, the eye is clear); on it, streaks wound round
 * the tube, read once for the wall facing the eye and once for the wall behind (which turns the
 * other way across the quad), so the column visibly rotates. It rises from the stand, holds and
 * thins away. Blended as light plus cover (grainfields-chaff.js): dust hides what is behind it.
 *
 * Its flakes are the chaff ring's wound records (grainfields-chaff.js), thrown by the world.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    asin,
    attribute,
    clamp,
    cross,
    dot,
    exp,
    float,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { deckShadow } from './grainfields-tsl.js';
import { DEVIL_WALK, lightAndCover } from './grainfields-chaff.js';
import { groundHeight } from './grainfields-plan.js';

/** Devils standing at once (a second twist while one stands raises another). */
export const DEVILS = 3;
/** A devil's life (seconds): it rises over `rise`, and thins away over its last `fade`. */
export const DEVIL = Object.freeze({ life: 8.5, rise: 1.3, fade: 2.6 });
/** The quad's rows up the column. */
const ROWS = 22;
/** The quad is this much wider than the column at each height (room for its soft edge). */
const MARGIN = 1.3;

/** The column's half-width at height share `v` (0 the foot … 1 the top), as a share of its radius. */
const widthAt = (v) => v.pow(0.9).mul(1.25).add(0.5).add(exp(v.mul(-13.0)).mul(1.4));

export function createDevils(u, t, reactions) {
    const plane = new THREE.PlaneGeometry(2, 1, 1, ROWS);
    plane.translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    const footData = new Float32Array(DEVILS * 4);
    const shapeData = new Float32Array(DEVILS * 4);
    const aFootAttr = new THREE.InstancedBufferAttribute(footData, 4); // foot xyz (at its start), start time
    const aShapeAttr = new THREE.InstancedBufferAttribute(shapeData, 4); // height, radius, spin (signed), power
    aFootAttr.setUsage(THREE.DynamicDrawUsage);
    aShapeAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFoot', aFootAttr);
    geometry.setAttribute('aShape', aShapeAttr);
    geometry.instanceCount = 0;

    const material = lightAndCover(new THREE.MeshBasicNodeMaterial());
    material.name = 'GrainfieldsDevil';
    material.side = THREE.DoubleSide;
    const aFoot = attribute('aFoot', 'vec4');
    const aShape = attribute('aShape', 'vec4');
    const vAt = varying(vec4(0.0), 'gfDevilAt'); // across (-MARGIN..MARGIN), up 0..1, age, power
    const vLight = varying(vec4(0.0), 'gfDevilLight'); // the dust's light rgb, which side the sun is on
    const vTurn = varying(vec2(0.0), 'gfDevilTurn'); // spin, seed
    material.positionNode = Fn(() => {
        const p = positionGeometry;
        const v = p.y.toVar();
        const age = u.time.sub(aFoot.w).toVar();
        const a = max(age, 0.0);
        // It rises out of the stand; its foot walks with the whirl.
        const grown = smoothstep(0.0, DEVIL.rise, a).mul(0.82).add(0.18);
        const foot = vec3(aFoot.x.add(a.mul(DEVIL_WALK[0])), aFoot.y, aFoot.z.add(a.mul(DEVIL_WALK[1]))).toVar();
        const toEye = u.eye.sub(foot);
        const across = normalize(cross(vec3(0.0, 1.0, 0.0), vec3(toEye.x, 0.0, toEye.z)).add(vec3(1e-5, 0.0, 0.0))).toVar();
        const seed = aFoot.x.mul(0.37).add(aFoot.z.mul(0.11));
        // The column leans downwind more the higher it stands, and snakes as it turns.
        const lean = vec3(u.windDir.x, 0.0, u.windDir.y).mul(v.mul(v).mul(aShape.x).mul(0.16).mul(u.windStrength.add(0.3)));
        const snake = across.mul(sin(v.mul(5.2).add(a.mul(1.7)).add(seed)).mul(v).mul(aShape.y).mul(0.55));
        const half = widthAt(v).mul(aShape.y).mul(MARGIN);
        const centre = foot.add(vec3(0.0, v.mul(aShape.x).mul(grown), 0.0)).add(lean).add(snake).toVar();
        vAt.assign(vec4(p.x.mul(MARGIN), v, age, aShape.w));
        vTurn.assign(vec2(aShape.z, seed));
        // The dust's light at this height: the sun through the deck (more with the sun beyond the
        // column), the sky, the barley's gold from below, the afterglow at dusk.
        const sunlit = deckShadow(u, t.noise, centre).mul(u.sunUp);
        const V = normalize(centre.sub(u.eye));
        const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
        const a2 = ahead.mul(ahead);
        const phase = a2.mul(a2).mul(1.5).add(a2.mul(0.45)).add(0.3);
        const light = u.sun.mul(sunlit.mul(phase.mul(0.42))).add(u.fill.mul(1.05)).add(u.bounce.mul(float(1.0).sub(v).mul(0.7)))
            .add(u.glow.mul(u.day.oneMinus().mul(0.2)));
        vLight.assign(vec4(light, dot(u.sunDir, across).mul(sunlit)));
        return centre.add(across.mul(p.x.mul(half)));
    })();
    material.colorNode = Fn(() => {
        const x = vAt.x.toVar();
        const v = vAt.y.toVar();
        const age = vAt.z.toVar();
        const ax = x.abs().toVar();
        // Across the column: a hollow tube seen side on. Its wall is where the dust is, so the
        // sight line through the rim crosses the most of it and the one through the eye the least.
        const inside = float(1.0).sub(smoothstep(0.7, 1.0, ax));
        const rim = ax.mul(ax).mul(0.45).add(0.55);
        // The streaks wound round it: the near wall (angle asin x) and the far wall (pi minus it),
        // both carried round by the spin, so the near one crosses the quad one way and the far one
        // the other. They climb as they turn (a helix), tighter toward the foot.
        const theta = asin(clamp(x, -1.0, 1.0)).div(3.1416);
        const run = age.mul(vTurn.x).mul(0.11);
        const helix = v.mul(1.6).add(vTurn.y);
        const climb = v.mul(2.4).sub(age.mul(0.42));
        const near = texture(t.noise, vec2(theta.mul(0.5).add(helix).sub(run), climb)).g;
        const far = texture(t.noise, vec2(float(0.5).sub(theta.mul(0.5)).add(helix).sub(run), climb.add(0.37))).g;
        const streaks = smoothstep(0.36, 0.62, near).mul(0.62).add(smoothstep(0.36, 0.62, far).mul(0.38));
        // Its top frays into the air (unevenly), its foot stands in the stand's own flung chaff.
        const top = float(1.0).sub(smoothstep(0.42, 1.0, v.add(near.sub(0.5).mul(0.5))));
        const base = smoothstep(0.0, 0.08, v);
        const lived = smoothstep(0.0, 0.7, age).mul(float(1.0).sub(smoothstep(DEVIL.life - DEVIL.fade, DEVIL.life, age)));
        const cover = inside.mul(rim).mul(streaks.mul(0.8).add(0.2)).mul(top).mul(base)
            .mul(lived)
            .mul(vAt.w)
            .mul(1.7)
            .clamp(0.0, 0.94);
        // Dust the colour of the field's dry soil and straw; its sunward side lighter, the other in
        // its own shade (a column, not a card).
        const tone = mix(vec3(0.34, 0.27, 0.18), vec3(0.6, 0.49, 0.32), streaks);
        const side = x.mul(vLight.w.sign()).mul(vLight.w.abs().min(1.0)).mul(0.3).add(0.85);
        return vec4(tone.mul(vLight.xyz).mul(side).mul(cover), cover);
    })();
    material.outputNode = material.colorNode;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsDevil';
    mesh.frustumCulled = false;
    mesh.renderOrder = 26.2;
    mesh.visible = false;

    return {
        mesh,
        meshes: [mesh],
        count: 0,
        update(time, dt, world) {
            const { devils } = reactions;
            const calm = world?.reducedMotion ? 0.35 : 1;
            let n = 0;
            for (let i = 0; i < devils.length && n < DEVILS; i++) {
                const d = devils[i];
                const age = time - d.at;
                if (age < 0 || age >= DEVIL.life) continue;
                const o = n * 4;
                footData[o] = d.x;
                footData[o + 1] = groundHeight(d.x, d.z) + 0.1;
                footData[o + 2] = d.z;
                footData[o + 3] = d.at;
                shapeData[o] = d.height;
                shapeData[o + 1] = d.radius;
                shapeData[o + 2] = d.spin * calm;
                shapeData[o + 3] = d.power;
                n += 1;
            }
            geometry.instanceCount = n;
            this.count = n;
            mesh.visible = n > 0;
            if (n) {
                aFootAttr.needsUpdate = true;
                aShapeAttr.needsUpdate = true;
            }
        },
        dispose() {
            geometry.dispose();
            plane.dispose();
            material.dispose();
        },
    };
}
