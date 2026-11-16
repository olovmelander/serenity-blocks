/**
 * Tornado — the funnel: body, torn veil, dust skirt, ground dust and the debris it carries.
 *
 * The body is a grid wrapped into a tube in the vertex stage: its centre line is a rope hung
 * from the cloud (anchored above, the foot wandering, the stem swaying), its radius the profile
 * in tornado-core (a stem, a flare into the wall cloud, a foot). Nothing is marched: the column
 * is soft because its opacity falls with the angle between the wall and the eye, torn by two
 * noise reads that turn with the funnel and rise with the updraught. A second, wider tube is the
 * veil of condensation torn off it, a third the dust skirt round the foot, a fourth the WALL CLOUD
 * the funnel hangs from: a squat, ragged-bottomed collar under the deck, turning slowly.
 *
 * The funnel is not always on the ground (u.touch): it comes down out of the wall cloud, and it
 * lets go and is drawn back up (the storm's own life, a perfect clear, the end of a run). Its
 * foot is then a point of torn condensation, and the dust under it thins (u.contact).
 *
 * A twist calls down a TWIN: a thin rope of its own, out in open sky (u.twin).
 *
 * The body also carries the RIBBONS: a helix of light for every piece the funnel has swallowed,
 * in that piece's colour, climbing from the foot. That is the old Tornado's ribbons, kept as the
 * theme's signature and tied to play.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
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
    uv,
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
/** How far below the cloud base the wall cloud hangs, as a share of the funnel's height. */
const WALL_SHARE = 0.38;

/** The twin's centre line at height fraction h: a rope of its own, hung from (twin.x, twin.y). */
function twinCentreNode(u, h) {
    const bell = h.mul(h.oneMinus()).mul(4.0);
    const sway = vec2(
        sin(h.mul(3.4).add(u.wind.mul(0.9))),
        cos(h.mul(2.7).add(u.wind.mul(0.7))).mul(0.6),
    ).mul(bell).mul(38.0);
    const wander = vec2(sin(u.wind.mul(0.21)).mul(34.0), cos(u.wind.mul(0.17)).mul(20.0)).mul(pow(h.oneMinus(), 1.4));
    return vec3(u.twin.x.add(wander.x).add(sway.x), h.mul(WORLD.cloudBase), u.twin.y.add(wander.y).add(sway.y));
}

/** One wall of the funnel. kind: 'body' | 'veil' | 'skirt' | 'child' | 'wall' | 'twin'. */
function createShell({
    u, noise, tier, kind, index = 0,
}) {
    const [around, upward] = tier.radial;
    let geometry;
    if (kind === 'skirt') geometry = new THREE.PlaneGeometry(1, 1, around, 24);
    else if (kind === 'child') geometry = new THREE.PlaneGeometry(1, 1, 24, 28);
    else if (kind === 'twin') geometry = new THREE.PlaneGeometry(1, 1, 28, 56);
    else if (kind === 'wall') geometry = new THREE.PlaneGeometry(1, 1, around, 12);
    else geometry = new THREE.PlaneGeometry(1, 1, around, upward);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, side: THREE.FrontSide, fog: false,
    });

    const spinRate = {
        body: 1.0, veil: 0.72, skirt: 0.5, child: 2.4, wall: 0.3, twin: 2.6,
    }[kind];
    const a = positionGeometry.x.add(0.5); // round the tube, 0..1
    const g = positionGeometry.y.add(0.5); // up the mesh, 0..1
    // Height as a share of the funnel. The stem (and the veil torn off it) hangs from the cloud:
    // lifted off the ground, the whole mesh is drawn up under it.
    const reach = kind === 'twin' ? u.twin.z : u.touch;
    const low = reach.oneMinus().clamp(0.0, 0.94);
    const lifted = smoothstep(0.02, 0.14, low);
    let h = low.add(g.mul(low.oneMinus()));
    if (kind === 'skirt') h = g.mul(SKIRT_SHARE);
    else if (kind === 'child') h = g.mul(CHILD_SHARE);
    else if (kind === 'wall') h = g.mul(WALL_SHARE).add(1 - WALL_SHARE);
    // A foot that is off the ground is a point of condensation, not a cut tube.
    const tip = mix(float(1.0), pow(smoothstep(0.0, 0.32, g), 0.7), lifted);
    // Wound the other way, so the grid's front faces look outward.
    const ang = a.mul(-TAU);
    const N = vec3(cos(ang), 0.0, sin(ang));

    // ── Vertex: wrap the grid round the rope ──
    const lump = noiseAt(noise, vec2(a.mul(3.0).add(u.spin.mul(spinRate)), h.mul(2.0).sub(u.flow.mul(0.4)))).r.sub(0.5);
    let radius;
    if (kind === 'skirt') {
        // The debris cloud: it bulges a little above the ground and rounds off at its top, a
        // heap of dust rolled round the foot rather than a cone.
        const foot = funnelRadiusNode(u, float(0.0));
        const bulge = sin(clamp(g.mul(0.85).add(0.18), 0.0, 1.0).mul(Math.PI)).mul(0.55).add(0.45);
        radius = foot.mul(2.4).add(40.0).add(u.fury.mul(44.0))
            .mul(bulge)
            .mul(pow(g, 1.6).mul(-0.42).add(1.0))
            .mul(lump.mul(0.3).add(1.0))
            .mul(u.contact.mul(0.5).add(0.5));
    } else if (kind === 'veil') {
        radius = funnelRadiusNode(u, h).mul(1.34).add(4.0).mul(lump.mul(0.5).add(1.0))
            .mul(tip);
    } else if (kind === 'child') {
        radius = float(2.4).add(g.mul(g).mul(13.0)).mul(u.girth.mul(0.45).add(0.55)).mul(lump.mul(0.5).add(1.0));
    } else if (kind === 'wall') {
        // A block of cloud lowered under the base: rounded in at its foot, opening into the deck.
        const opening = smoothstep(0.6, 1.0, g);
        radius = float(108.0).add(u.flare.mul(60.0)).add(u.girth.mul(7.0))
            .mul(smoothstep(0.0, 0.45, g).mul(0.18).add(0.82))
            .add(opening.mul(opening).mul(90.0))
            .mul(lump.mul(0.36).add(1.0));
    } else if (kind === 'twin') {
        // A rope: a few metres through at the ground, opening into the base it hangs from.
        radius = float(3.0).add(pow(h, 1.5).mul(13.0)).add(exp(h.oneMinus().mul(-9.0)).mul(44.0))
            .add(exp(h.mul(-14.0)).mul(9.0).mul(lifted.oneMinus()))
            .mul(u.twin.w)
            .mul(lump.mul(0.4).add(1.0))
            .mul(tip);
    } else {
        radius = funnelRadiusNode(u, h).mul(lump.mul(0.22).add(1.0)).mul(tip);
    }
    let centre = kind === 'twin' ? twinCentreNode(u, h) : funnelCentreNode(u, h);
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
        // Striations: the bands of condensation wound round the funnel, rising with it (a read
        // stretched along the winding), and the fine wisps torn off its limbs.
        const stRead = texture(noise, vec2(sa.mul(1.4).add(h.mul(4.0)), h.mul(8.5).sub(u.flow.mul(1.2)))).b;
        const bands = float(1.0).sub(abs(stRead.mul(2.0).sub(1.0))).toVar();
        const wisp = (tier.detail
            ? texture(noise, vec2(sa.mul(14.0).add(h.mul(9.0)), h.mul(16.0).sub(u.flow.mul(2.4)))).a
            : float(0.5)).toVar();
        const limbTorn = rim.oneMinus().mul(rim.oneMinus());
        const body = rim.mul(n1.mul(0.7).add(0.7)).add(n2.sub(0.5).mul(0.35))
            .add(wisp.sub(0.5).mul(0.55).mul(limbTorn))
            .toVar();

        const alpha = float(0.0).toVar();
        const skirtDust = float(0.5).toVar();
        if (kind === 'body') {
            // Between the bands the wall is thinner: the funnel reads as wound condensation.
            alpha.assign(smoothstep(0.1, 0.46, body).mul(smoothstep(0.93, 1.0, h).oneMinus())
                .mul(mix(float(0.8), float(1.0), smoothstep(0.2, 0.8, bands)))
                .mul(mix(float(1.0), smoothstep(0.0, 0.22, g), lifted)));
        } else if (kind === 'veil') {
            const ends = smoothstep(0.76, 0.9, h).oneMinus().mul(smoothstep(0.0, 0.05, g));
            alpha.assign(smoothstep(0.36, 0.98, body).mul(0.46).mul(ends));
        } else if (kind === 'child') {
            const born = smoothstep(0.3, 0.62, u.fury).mul(smoothstep(0.72, 1.0, g).oneMinus()).mul(u.contact);
            alpha.assign(smoothstep(0.28, 0.98, body).mul(born).mul(0.6));
        } else if (kind === 'wall') {
            // Solid cloud with a torn foot (scud hanging from it) and a soft limb.
            const torn = n1.mul(0.62).add(n2.mul(0.3)).add(wisp.sub(0.5).mul(0.2)).sub(0.2);
            alpha.assign(smoothstep(torn, torn.add(0.2), g).mul(smoothstep(0.0, 0.34, rim))
                .mul(smoothstep(0.8, 1.0, g).oneMinus()));
        } else if (kind === 'twin') {
            const ends = smoothstep(0.9, 1.0, h).oneMinus().mul(mix(float(1.0), smoothstep(0.0, 0.2, g), lifted));
            alpha.assign(smoothstep(0.1, 0.5, body).mul(0.94).mul(ends).mul(smoothstep(0.01, 0.08, u.twin.z)));
        } else {
            // A billowing debris cloud. Dust has no edge anywhere: its cover falls away up the
            // heap and toward its limb as a smooth profile, and the billows (two reads that climb
            // with the updraught, each across the heap's own height) only thin it, by a threshold
            // that barely follows the profile, so no billow draws a rim and the top is not a line.
            const d1 = texture(noise, vec2(sa.mul(4.0).add(g.mul(0.9)), g.mul(1.5).sub(u.flow.mul(0.7)))).r;
            const d2 = texture(noise, vec2(sa.mul(11.0).sub(g.mul(1.7)), g.mul(4.2).sub(u.flow.mul(1.5)))).g;
            const dust = d1.mul(0.62).add(d2.mul(0.38)).toVar();
            const soft = exp(g.mul(g).mul(-3.4)).mul(smoothstep(0.0, 0.75, rim)).toVar();
            skirtDust.assign(dust);
            alpha.assign(soft.mul(smoothstep(0.3, 0.7, dust.add(soft.mul(0.22))))
                .mul(u.fury.mul(0.3).add(0.74))
                .mul(u.contact.mul(0.7).add(0.3)));
        }

        // The low sun lights the side that faces it and burns through the thin limbs.
        const side = dot(N, normalize(vec3(u.sunDir.x, 0.0, u.sunDir.z))).mul(0.5).add(0.5);
        const lit = smoothstep(0.3, 1.0, side).toVar();
        const through = clamp(dot(V.negate(), u.sunDir), 0.0, 1.0);
        const limb = rim.oneMinus().mul(rim.oneMinus()).mul(through.mul(through).mul(through).mul(through));
        // Thick condensation: the side away from the sun is dark, the lit side bright, and the
        // bands catch more light than the troughs between them.
        const col = mix(u.funnelShade.mul(0.8), u.funnelLit, lit.mul(lit)).mul(n1.mul(0.65).add(0.6)).toVar();
        col.mulAssign(n2.mul(0.3).add(0.82));
        col.mulAssign(mix(float(0.82), float(1.1), smoothstep(0.2, 0.8, bands)));
        // The limb the sun stands behind glows through (a wider, stronger rim than before).
        const limbWide = rim.oneMinus().mul(through.mul(through));
        col.addAssign(u.sun.mul(limb.mul(1.9).add(limbWide.mul(0.35))));
        if (kind === 'skirt') {
            // Billowing dust: lit tops, a darker heart, the sun burning through its thin edge.
            const billow = smoothstep(0.3, 0.75, skirtDust);
            // (No rim of sun: a rim is what made the heap a glass bowl. The low sun through the
            // whole of it instead, strongest where the dust is thin.)
            col.assign(u.dust.mul(lit.mul(1.1).add(0.35)).mul(billow.mul(0.75).add(0.45))
                .mul(g.mul(0.5).add(0.75))
                .add(u.sun.mul(through.mul(through)).mul(billow.oneMinus().mul(0.1).add(0.03))));
        } else if (kind === 'child' || kind === 'twin') {
            // Thin condensation: paler than the stem, with the foot in the dust.
            col.assign(mix(col, u.funnelLit.mul(0.55).add(u.cloudMid.mul(1.6)), kind === 'twin' ? 0.2 : 0.45));
            const inDust = kind === 'twin' ? exp(h.mul(-9.0)).mul(lifted.oneMinus()) : exp(g.mul(-5.0));
            col.assign(mix(col, u.dust.mul(lit.mul(0.9).add(0.5)), inDust.mul(0.6)));
        } else if (kind === 'wall') {
            // The deck's own slate, lobed; the low sun under it catches its foot and its sunward
            // side, and the storm's charge burns in it. Its top is the deck's colour: no seam.
            const lobes = smoothstep(0.25, 0.8, n1.mul(0.7).add(n2.mul(0.3)));
            const slate = mix(u.cloudDark.mul(0.6), u.cloudMid.mul(0.62).add(u.cloudLit.mul(0.018)), lobes);
            const under = g.oneMinus().mul(g.oneMinus());
            // The torn foot: scud hanging under the block, thin enough to glow.
            const scud = smoothstep(0.0, 0.55, g).oneMinus().mul(wisp.mul(0.8).add(0.4));
            col.assign(slate
                .add(u.cloudLit.mul(lit.mul(lit)).mul(under.mul(0.8).add(0.3)).mul(lobes.mul(0.7).add(0.4)).mul(0.5))
                .add(u.cloudRim.mul(scud).mul(lit.mul(0.6).add(0.1)).mul(0.26))
                .add(u.sun.mul(limbWide.mul(0.3)))
                .add(u.charge.mul(1.1).mul(under.add(0.25))));
            // Its top is the deck's own shade round the storm's heart: no seam.
            col.assign(mix(col, u.cloudDark.add(u.cloudMid).mul(0.36).add(u.cloudLit.mul(0.03)), smoothstep(0.8, 1.0, g)));
        } else {
            // Dust at the foot (dragged up the lower third, darker and browner), cloud at the top.
            col.assign(mix(col, u.dust.mul(lit.mul(0.9).add(0.4)).mul(bands.mul(0.3).add(0.8)), exp(h.mul(-4.5)).mul(0.82)));
            // The wall cloud burns in the chain's colours while the storm is wound up.
            const crown = u.cloudMid.mul(1.25).add(u.cloudLit.mul(lit).mul(0.16)).add(u.charge.mul(0.7));
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
            // A ribbon that is not lit costs nothing (a uniform branch, the same for every pixel).
            const glow = vec3(0.0).toVar();
            const held = Math.min(RIBBONS, tier.ribbons ?? RIBBONS);
            for (let i = 0; i < held; i += 1) {
                const shape = u.ribbons.element(i * 2); // (phase, head, tail, light)
                const paint = u.ribbons.element(i * 2 + 1); // (rgb, turns)
                If(shape.w.greaterThan(0.0005), () => {
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
                });
            }
            glow.mulAssign(n2.mul(0.7).add(0.6)).mulAssign(rim.mul(0.75).add(0.25));
            // A back-to-back: light runs up the funnel and through everything wound on it.
            const front = tnGauss(h.sub(u.surge.x).div(0.085)).mul(u.surge.y).toVar();
            glow.mulAssign(u.release.mul(1.3).add(1.0).add(front.mul(2.2)));
            col.addAssign(u.bolt.mul(front).mul(n2.mul(0.9).add(0.25)).mul(rim.mul(0.6).add(0.4)).mul(1.3));
            col.addAssign(glow.mul(3.4));
            alpha.assign(clamp(alpha.add(tnLuma(glow).mul(1.2)), 0.0, 1.0));
        }
        return vec4(col, alpha);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = {
        body: 40, wall: 41, veil: 42, child: 43, skirt: 44, twin: 45,
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
        const alpha = smoothstep(0.12, 1.0, rr).oneMinus().mul(lay).mul(u.fury.mul(0.3).add(0.5))
            .mul(u.contact.mul(0.55).add(0.45));
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
    // (Low: at the lens it stands a few stalks high over the horizon, so the storm shows over it.)
    const tall = u.shock.x.mul(0.014).add(13.0).mul(lump.mul(1.1).add(0.5));
    const foot = funnelCentreNode(u, float(0.0));
    material.positionNode = vec3(
        foot.x.add(cos(ang).mul(radius)),
        g.mul(tall),
        foot.z.add(sin(ang).mul(radius)),
    );
    material.colorNode = Fn(() => {
        const billow = texture(noise, vec2(a.mul(40.0).add(u.flow.mul(0.2)), g.mul(0.9).sub(u.flow.mul(0.6)))).g;
        const curl = texture(noise, vec2(a.mul(110.0).sub(u.flow.mul(0.3)), g.mul(2.6).sub(u.flow.mul(1.1)))).r;
        const roll = billow.mul(0.65).add(curl.mul(0.35));
        const top = exp(g.mul(g).mul(-3.0));
        const alpha = top.mul(smoothstep(0.26, 0.66, roll.add(top.mul(0.2)))).mul(u.shock.y).mul(1.25);
        const far = length(positionWorld.sub(cameraPosition));
        // A rolling wall: dark at its foot, its billows' tops lit by the low sun.
        const lit = u.dust.mul(roll.mul(1.1).add(0.45)).mul(g.mul(0.7).add(0.55)).add(u.sun.mul(g.mul(roll)).mul(0.3));
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
function createDebris({ u, noise, tier }) {
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
    // Some are long boards, the rest shards (the fragment cuts them ragged).
    const board = step(0.62, fract(d.y.mul(17.3)));
    const stretch = mix(float(1.0), fract(d.y.mul(5.9)).mul(2.6).add(2.2), board);
    const lx = positionGeometry.x.mul(stretch);
    const cx = lx.mul(cos(roll)).sub(positionGeometry.y.mul(flip).mul(sin(roll)));
    const cy = lx.mul(sin(roll)).add(positionGeometry.y.mul(flip).mul(cos(roll)));
    // More of it in the air as the chain builds.
    const shown = step(fract(d.y.mul(91.7)), u.fury.mul(0.62).add(0.38).mul(u.contact.mul(0.8).add(0.2)));
    material.positionNode = centre.add(u.camRight.mul(cx).add(u.camUp.mul(cy)).mul(d.w).mul(shown));
    const fade = varying(sin(cycle.mul(Math.PI)));
    const glint = varying(pow(max(sin(u.wind.mul(6.0).add(d.y.mul(40.0))), 0.0), 6.0));
    const seed = varying(d.y);
    const isBoard = varying(board);
    material.colorNode = Fn(() => {
        const col = mix(vec3(0.014, 0.012, 0.012), u.funnelLit.mul(0.55), glint);
        // A ragged shard: the quad's corners and edges bitten away by noise (boards keep their
        // straight sides and only lose a corner or two).
        const st = uv().sub(0.5).mul(2.0);
        const edge = max(abs(st.x), abs(st.y));
        const bite = texture(noise, uv().mul(0.35).add(vec2(seed.mul(13.1), seed.mul(7.7)))).g;
        const keep = edge.add(bite.sub(0.5).mul(mix(float(1.1), float(0.35), isBoard)));
        const shape = float(1.0).sub(smoothstep(0.62, 0.78, keep));
        return vec4(mix(col, u.haze, 0.14), clamp(fade, 0.0, 1.0).mul(0.92).mul(shape));
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
        u, noise, tier, kind: 'wall',
    }));
    meshes.push(createShell({
        u, noise, tier, kind: 'skirt',
    }));
    // The twin of a twist: parked until one is called down.
    const twin = createShell({
        u, noise, tier, kind: 'twin',
    });
    twin.visible = false;
    meshes.push(twin);
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

    const debris = createDebris({ u, noise, tier });
    const debrisGroup = new THREE.Group();
    debrisGroup.name = 'tornado-debris';
    debrisGroup.add(debris.mesh);

    return {
        object: group,
        debris: debrisGroup,
        front,
        children,
        twin,
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
