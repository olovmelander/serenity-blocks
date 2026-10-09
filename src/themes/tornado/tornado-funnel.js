/**
 * Tornado — the funnel: body, torn veil, dust skirt, ground dust and the debris it carries.
 *
 * The body is a grid wrapped into a tube in the vertex stage: its centre line is a rope hung
 * from the cloud (anchored above, the foot wandering, the stem swaying), its radius the profile
 * in tornado-core (a stem, a flare into the wall cloud, a foot). Nothing is marched: the column
 * is soft because its opacity falls with the angle between the wall and the eye, torn by two
 * noise reads that turn with the funnel and rise with the updraught. A second, wider tube is the
 * veil of condensation torn off it, a third the dust skirt round the foot.
 *
 * The body also carries the RIBBONS: a helix of light for every piece the funnel has swallowed,
 * in that piece's colour, climbing from the foot. That is the old Tornado's ribbons, kept as the
 * theme's signature and tied to play.
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
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { TAU, WORLD, mulberry32 } from './tornado-core.js';
import {
    FLASHES, RIBBONS, funnelCentreNode, funnelRadiusNode, noiseAt, tnGauss, tnLuma,
} from './tornado-tsl.js';

const SKIRT_SHARE = WORLD.skirtHeight / WORLD.cloudBase;
/** How far up the funnel a satellite vortex reaches before it merges with the stem. */
const CHILD_SHARE = 0.4;

/** One wall of the funnel. kind: 'body' | 'veil' | 'skirt'. */
function createShell({
    u, noise, tier, kind, index = 0,
}) {
    const [around, upward] = tier.radial;
    let geometry;
    if (kind === 'skirt') geometry = new THREE.PlaneGeometry(1, 1, Math.round(around * 0.75), 12);
    else if (kind === 'child') geometry = new THREE.PlaneGeometry(1, 1, 24, 28);
    else geometry = new THREE.PlaneGeometry(1, 1, around, upward);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, side: THREE.FrontSide, fog: false,
    });

    const spinRate = {
        body: 1.0, veil: 0.72, skirt: 0.5, child: 2.4,
    }[kind];
    const a = positionGeometry.x.add(0.5); // round the tube, 0..1
    const g = positionGeometry.y.add(0.5); // up the mesh, 0..1
    // Height as a share of the funnel.
    let h = g;
    if (kind === 'skirt') h = g.mul(SKIRT_SHARE);
    else if (kind === 'child') h = g.mul(CHILD_SHARE);
    // Wound the other way, so the grid's front faces look outward.
    const ang = a.mul(-TAU);
    const N = vec3(cos(ang), 0.0, sin(ang));

    // ── Vertex: wrap the grid round the rope ──
    const lump = noiseAt(noise, vec2(a.mul(3.0).add(u.spin.mul(spinRate)), h.mul(2.0).sub(u.flow.mul(0.4)))).r.sub(0.5);
    let radius;
    if (kind === 'skirt') {
        const foot = funnelRadiusNode(u, float(0.0));
        radius = foot.mul(2.2).add(34.0).add(u.fury.mul(40.0))
            .mul(pow(g, 0.8).mul(-0.5).add(1.0))
            .mul(lump.mul(0.7).add(1.0));
    } else if (kind === 'veil') {
        radius = funnelRadiusNode(u, h).mul(1.34).add(4.0).mul(lump.mul(0.5).add(1.0));
    } else if (kind === 'child') {
        radius = float(2.4).add(g.mul(g).mul(13.0)).mul(u.girth.mul(0.45).add(0.55)).mul(lump.mul(0.5).add(1.0));
    } else {
        radius = funnelRadiusNode(u, h).mul(lump.mul(0.22).add(1.0));
    }
    let centre = funnelCentreNode(u, h);
    if (kind === 'child') {
        // It circles the foot and leans in, to merge with the stem at its top.
        const round = u.spin.mul(0.55).add(index / 3 + index * 0.11).add(g.mul(0.55)).mul(TAU);
        const writhe = sin(g.mul(8.0).add(u.wind.mul(2.3)).add(index * 2.1)).mul(g.mul(g.oneMinus())).mul(22.0);
        const out = funnelRadiusNode(u, float(0.05)).mul(2.4).add(34.0)
            .mul(pow(g, 0.6).mul(-0.86).add(1.0))
            .add(writhe);
        centre = centre.add(vec3(cos(round), 0.0, sin(round)).mul(out));
    }
    material.positionNode = centre.add(N.mul(radius));

    // ── Fragment ──
    material.colorNode = Fn(() => {
        const V = normalize(cameraPosition.sub(positionWorld)).toVar();
        const flat = normalize(vec3(V.x, 0.0, V.z));
        const rim = clamp(dot(N, flat), 0.0, 1.0).toVar();
        const sa = a.add(u.spin.mul(spinRate)).toVar();
        const n1 = texture(noise, vec2(sa.mul(3.0).add(h.mul(1.6)), h.mul(2.4).sub(u.flow.mul(0.5)))).r.toVar();
        const n2 = (tier.detail
            ? texture(noise, vec2(sa.mul(8.0).add(h.mul(4.0)).add(n1.mul(0.3)), h.mul(7.0).sub(u.flow.mul(1.3)))).g
            : float(0.5)).toVar();
        const body = rim.mul(n1.mul(0.7).add(0.7)).add(n2.sub(0.5).mul(0.35)).toVar();

        const alpha = float(0.0).toVar();
        if (kind === 'body') {
            alpha.assign(smoothstep(0.1, 0.46, body).mul(smoothstep(0.93, 1.0, h).oneMinus()));
        } else if (kind === 'veil') {
            const ends = smoothstep(0.9, 1.0, h).oneMinus().mul(smoothstep(0.0, 0.05, h));
            alpha.assign(smoothstep(0.36, 0.98, body).mul(0.46).mul(ends));
        } else if (kind === 'child') {
            const born = smoothstep(0.3, 0.62, u.fury).mul(smoothstep(0.72, 1.0, g).oneMinus());
            alpha.assign(smoothstep(0.28, 0.98, body).mul(born).mul(0.6));
        } else {
            const thinning = pow(clamp(g.oneMinus(), 0.0, 1.0), 0.8);
            alpha.assign(smoothstep(0.2, 0.8, body).mul(thinning).mul(u.fury.mul(0.3).add(0.62)));
        }

        // The low sun lights the side that faces it and burns through the thin limbs.
        const side = dot(N, normalize(vec3(u.sunDir.x, 0.0, u.sunDir.z))).mul(0.5).add(0.5);
        const lit = smoothstep(0.3, 1.0, side).toVar();
        const through = clamp(dot(V.negate(), u.sunDir), 0.0, 1.0);
        const limb = rim.oneMinus().mul(rim.oneMinus()).mul(through.mul(through).mul(through).mul(through));
        const col = mix(u.funnelShade, u.funnelLit, lit).mul(n1.mul(0.65).add(0.6)).toVar();
        col.mulAssign(n2.mul(0.3).add(0.82));
        col.addAssign(u.sun.mul(limb).mul(1.5));
        if (kind === 'skirt') {
            col.assign(u.dust.mul(lit.mul(1.1).add(0.4)).mul(n1.mul(0.7).add(0.55)));
        } else if (kind === 'child') {
            // Thin condensation: paler than the stem, with the foot in the dust.
            col.assign(mix(col, u.funnelLit.mul(0.55).add(u.cloudMid.mul(1.6)), 0.45));
            col.assign(mix(col, u.dust.mul(lit.mul(0.9).add(0.5)), exp(g.mul(-5.0)).mul(0.6)));
        } else {
            // Dust at the foot, cloud at the top.
            col.assign(mix(col, u.dust.mul(lit.mul(0.9).add(0.45)), exp(h.mul(-6.0)).mul(0.75)));
            const crown = u.cloudMid.mul(1.25).add(u.cloudLit.mul(lit).mul(0.16));
            col.assign(mix(col, crown, smoothstep(0.7, 1.0, h).mul(0.8)));
        }
        for (let i = 0; i < FLASHES; i += 1) {
            const f = u.flashes.element(i);
            const lightning = exp(length(positionWorld.xz.sub(f.xy)).div(max(f.w.mul(1.6), 1.0)).negate()).mul(f.z);
            col.addAssign(u.bolt.mul(lightning).mul(0.18));
        }
        const far = length(positionWorld.sub(cameraPosition));
        col.assign(mix(col, u.haze, exp(far.div(-5200.0)).oneMinus().mul(0.8)));

        if (kind === 'body') {
            // The ribbons: one helix of light per swallowed piece, climbing with the updraught.
            const glow = vec3(0.0).toVar();
            for (let i = 0; i < RIBBONS; i += 1) {
                const shape = u.ribbons.element(i * 2); // (phase, head, tail, light)
                const paint = u.ribbons.element(i * 2 + 1); // (rgb, turns)
                // A bright thread, a fainter one beside it and a soft glow round both.
                const s = fract(sa.add(h.mul(paint.w)).add(shape.x).add(n1.sub(0.5).mul(0.02)));
                const off = abs(s.sub(0.5));
                const band = tnGauss(off.div(0.0075))
                    .add(tnGauss(off.sub(0.024).div(0.005)).mul(0.5))
                    .add(tnGauss(off.div(0.034)).mul(0.2));
                const span = smoothstep(shape.z, shape.z.add(0.06), h)
                    .mul(smoothstep(shape.y.sub(0.07), shape.y, h).oneMinus())
                    .mul(smoothstep(0.76, 0.96, h).oneMinus());
                glow.addAssign(paint.rgb.mul(band).mul(span).mul(shape.w));
            }
            glow.mulAssign(n2.mul(0.7).add(0.6)).mulAssign(rim.mul(0.75).add(0.25));
            glow.mulAssign(u.release.mul(1.3).add(1.0));
            col.addAssign(glow.mul(3.4));
            alpha.assign(clamp(alpha.add(tnLuma(glow).mul(1.2)), 0.0, 1.0));
        }
        return vec4(col, alpha);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = {
        body: 40, veil: 42, child: 43, skirt: 44,
    }[kind];
    mesh.name = `tornado-${kind}`;
    return mesh;
}

/** Dust lying round the foot: a disc on the ground, swirled. */
function createGroundDust({ u, noise }) {
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const reach = funnelRadiusNode(u, float(0.0)).mul(5.5).add(110.0);
    const foot = funnelCentreNode(u, float(0.0));
    material.positionNode = vec3(
        foot.x.add(positionGeometry.x.mul(reach).mul(2.0)),
        0.5,
        foot.z.add(positionGeometry.y.mul(reach).mul(2.0)),
    );
    material.colorNode = Fn(() => {
        const g = positionGeometry.xy.mul(2.0);
        const rr = clamp(length(g), 0.0, 1.0).toVar();
        const turn = atan(g.y, g.x).div(TAU);
        const swirl = vec2(turn.mul(4.0).add(u.spin.mul(0.5)).add(rr.mul(1.5)), rr.mul(2.0).sub(u.flow.mul(0.3)));
        const n = texture(noise, swirl)
            .level(1.0).r;
        const lay = smoothstep(0.3, 0.72, n.add(rr.oneMinus().mul(0.42)));
        const alpha = smoothstep(0.12, 1.0, rr).oneMinus().mul(lay).mul(u.fury.mul(0.3).add(0.5));
        return vec4(u.dust.mul(n.mul(0.6).add(0.75)), alpha);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 36;
    mesh.name = 'tornado-ground-dust';
    return mesh;
}

/**
 * The dust front of a four-line clear: a low wall that rolls out from the foot across the field
 * and over the lens. A ring on the ground alone would be a hairline at this distance.
 */
function createFront({ u, noise }) {
    const geometry = new THREE.PlaneGeometry(1, 1, 96, 4);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const a = positionGeometry.x.add(0.5);
    const g = positionGeometry.y.add(0.5);
    const ang = a.mul(TAU);
    const lump = noiseAt(noise, vec2(a.mul(9.0), u.flow.mul(0.3))).r;
    const radius = u.shock.x.mul(lump.sub(0.5).mul(0.06).add(1.0));
    const tall = u.shock.x.mul(0.05).add(26.0).mul(lump.mul(0.9).add(0.55));
    const foot = funnelCentreNode(u, float(0.0));
    material.positionNode = vec3(
        foot.x.add(cos(ang).mul(radius)),
        g.mul(tall),
        foot.z.add(sin(ang).mul(radius)),
    );
    material.colorNode = Fn(() => {
        const billow = texture(noise, vec2(a.mul(40.0).add(u.flow.mul(0.2)), g.mul(0.9).sub(u.flow.mul(0.6)))).g;
        const top = pow(clamp(g.oneMinus(), 0.0, 1.0), 1.3);
        const alpha = top.mul(smoothstep(0.16, 0.6, billow.add(top.mul(0.3)))).mul(u.shock.y).mul(1.7);
        const far = length(positionWorld.sub(cameraPosition));
        const lit = u.dust.mul(billow.mul(0.9).add(0.9)).add(u.sun.mul(g.mul(0.22).add(0.06)));
        const col = mix(lit, u.haze, exp(far.div(-3200.0)).oneMinus());
        return vec4(col, clamp(alpha, 0.0, 1.0));
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 48;
    mesh.visible = false;
    mesh.name = 'tornado-dust-front';
    return mesh;
}

/** Boards and shingles in the air round the foot: instanced quads, flown in the vertex stage. */
function createDebris({ u, tier }) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.attributes.position);
    geometry.setAttribute('uv', base.attributes.uv);
    const count = tier.debris;
    const rand = mulberry32(7741);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
        data[i * 4] = rand() ** 1.6; // how far out it rides
        data[i * 4 + 1] = rand(); // phase
        data[i * 4 + 2] = 0.5 + rand(); // rise rate
        data[i * 4 + 3] = 0.35 + rand() ** 3 * 2.4; // size, metres
    }
    geometry.setAttribute('aDeb', new THREE.InstancedBufferAttribute(data, 4));
    geometry.instanceCount = count;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const d = attribute('aDeb', 'vec4');
    const cycle = fract(d.y.mul(7.13).add(u.flow.mul(0.22).mul(d.z)));
    const height = pow(cycle, 1.3).mul(0.46).mul(fract(d.y.mul(3.7)).mul(0.65).add(0.35));
    const out = funnelRadiusNode(u, height).mul(d.x.mul(u.fury.mul(1.6).add(1.8)).add(1.12));
    const angle = d.y.add(u.spin.mul(float(1.0).div(d.x.mul(1.6).add(1.0)))).mul(TAU);
    const centre = funnelCentreNode(u, height).add(vec3(cos(angle), 0.0, sin(angle)).mul(out));
    // A board tumbling: the quad turns in the view plane and flips edge-on.
    const roll = u.wind.mul(d.z.mul(4.0).add(3.0)).add(d.y.mul(50.0));
    const flip = abs(sin(u.wind.mul(5.0).add(d.y.mul(31.0)))).mul(0.78).add(0.22);
    const cx = positionGeometry.x.mul(cos(roll)).sub(positionGeometry.y.mul(flip).mul(sin(roll)));
    const cy = positionGeometry.x.mul(sin(roll)).add(positionGeometry.y.mul(flip).mul(cos(roll)));
    // More of it in the air as the chain builds.
    const shown = step(fract(d.y.mul(91.7)), u.fury.mul(0.62).add(0.38));
    material.positionNode = centre.add(u.camRight.mul(cx).add(u.camUp.mul(cy)).mul(d.w).mul(shown));
    const fade = varying(sin(cycle.mul(Math.PI)));
    const glint = varying(pow(max(sin(u.wind.mul(6.0).add(d.y.mul(40.0))), 0.0), 6.0));
    material.colorNode = Fn(() => {
        const col = mix(vec3(0.014, 0.012, 0.012), u.funnelLit.mul(0.55), glint);
        return vec4(mix(col, u.haze, 0.14), clamp(fade, 0.0, 1.0).mul(0.92));
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 46;
    mesh.name = 'tornado-debris';
    return { mesh, base };
}

export function createFunnel({ u, noise, tier }) {
    const group = new THREE.Group();
    group.name = 'tornado-funnel';
    const meshes = [
        createGroundDust({ u, noise }),
        createShell({
            u, noise, tier, kind: 'body',
        }),
    ];
    if (tier.shells > 1) {
        meshes.push(createShell({
            u, noise, tier, kind: 'veil',
        }));
    }
    meshes.push(createShell({
        u, noise, tier, kind: 'skirt',
    }));
    // The satellite vortices of a long chain (drawn only while the chain runs).
    const children = [];
    for (let i = 0; i < (tier.shells > 1 ? 3 : 2); i += 1) {
        const child = createShell({
            u, noise, tier, kind: 'child', index: i,
        });
        child.visible = false;
        children.push(child);
        meshes.push(child);
    }
    const front = createFront({ u, noise });
    meshes.push(front);
    meshes.forEach((m) => group.add(m));

    const debris = createDebris({ u, tier });
    const debrisGroup = new THREE.Group();
    debrisGroup.name = 'tornado-debris';
    debrisGroup.add(debris.mesh);

    return {
        object: group,
        debris: debrisGroup,
        front,
        children,
        dispose() {
            meshes.forEach((m) => {
                m.geometry.dispose();
                m.material.dispose();
            });
            debris.mesh.geometry.dispose();
            debris.base.dispose();
            debris.mesh.material.dispose();
        },
    };
}
