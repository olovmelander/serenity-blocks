import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    AURORA_OVAL,
    AURORA_PALETTE,
    auroraStripPhase,
    buildAuroraCrownGeometry,
    createAuroraCrownMaterial,
    createPlanetAuroraCrown,
} from './odyssey-planet-aurora.js';
import { createCosmicExpanseEnvironment, updateCosmicExpanseEnvironment } from './cosmic-expanse.js';

const R = 28;

/** Every distinct constructor/scope in a TSL node graph, for law assertions. */
function graphKinds(node) {
    const kinds = new Set();
    node.traverse((child) => {
        kinds.add(`${child?.constructor?.name}${child?.scope ? `:${child.scope}` : ''}`);
    });
    return kinds;
}

describe('ch6 auroral crown geometry (Space overhaul Wave 5)', () => {
    it('merges four strips onto both poles as ONE indexed geometry', () => {
        const g = buildAuroraCrownGeometry(R);
        const strips = AURORA_OVAL.rings.length * 2;
        const columns = AURORA_OVAL.segments + 1;

        expect(g.getAttribute('position').count).toBe(strips * columns * 2);
        expect(g.getIndex().count).toBe(strips * AURORA_OVAL.segments * 6);

        // Both poles, or the "whichever cap is dark glows" contract is a lie.
        const y = g.getAttribute('position').array;
        let north = 0;
        let south = 0;
        for (let i = 1; i < y.length; i += 3) {
            if (y[i] > 0) north += 1; else south += 1;
        }
        expect(north).toBe(south);
        expect(north).toBeGreaterThan(0);
    });

    it('rises along the POLAR AXIS, not along the radius', () => {
        // The first probe extruded each curtain radially off a 17-degree colatitude, which
        // splayed all four strips outward and rendered as a corrugated lampshade. This is
        // the assertion that would have caught it: a radial tip scales BOTH the height and
        // the ring radius by the shell factor, an axial tip lifts y by exactly height*R
        // and grows the radius by only lean*height*R.
        const g = buildAuroraCrownGeometry(R);
        const pos = g.getAttribute('position').array;
        const ring = AURORA_OVAL.rings[0];
        const rise = ring.height * R;

        // Strip 0 (north, inner ring) starts at vertex 0: foot = v0, tip = v1.
        const foot = [pos[0], pos[1], pos[2]];
        const tip = [pos[3], pos[4], pos[5]];
        expect(tip[1] - foot[1]).toBeCloseTo(rise, 5);

        const radial = (v) => Math.hypot(v[0], v[2]);
        expect(radial(tip) - radial(foot)).toBeCloseTo(ring.lean * rise, 5);

        // ...and the radial alternative is genuinely different, so both assertions above
        // have teeth. Near the pole the two extrusions differ only slightly in HEIGHT
        // (8.03 vs 8.40 here — caught by the toBeCloseTo above, not by eye) and much more
        // in RADIUS, which is exactly the splay that produced the lampshade.
        const radialWouldGrow = (radial(foot) / AURORA_OVAL.footLift) * ring.height;
        expect(Math.abs(radialWouldGrow - ring.lean * rise)).toBeGreaterThan(0.5);
    });

    it('carries the RADIAL direction as its normal, tip and foot alike', () => {
        // The deliberate lie that lets the crown reuse the gas giant's own terminator
        // arithmetic. A real geometric normal would differ between the foot row and the
        // tip row of a leaning ribbon; these must be identical and unit length.
        const g = buildAuroraCrownGeometry(R);
        const n = g.getAttribute('normal').array;
        for (let v = 0; v < 8; v += 2) {
            const a = [n[v * 3], n[v * 3 + 1], n[v * 3 + 2]];
            const b = [n[(v + 1) * 3], n[(v + 1) * 3 + 1], n[(v + 1) * 3 + 2]];
            expect(Math.hypot(...a)).toBeCloseTo(1, 6);
            expect(a[0]).toBeCloseTo(b[0], 6);
            expect(a[1]).toBeCloseTo(b[1], 6);
            expect(a[2]).toBeCloseTo(b[2], 6);
        }
    });

    it('closes its azimuth seam exactly, so the ribs cannot tear', () => {
        const g = buildAuroraCrownGeometry(R);
        const uv = g.getAttribute('uv').array;
        const pos = g.getAttribute('position').array;
        const columns = AURORA_OVAL.segments + 1;

        // First and last column of strip 0 must share a position but span uv.x 0 -> 1.
        const last = (columns - 1) * 2;
        expect(uv[0]).toBe(0);
        expect(uv[last * 2]).toBe(1);
        expect(pos[last * 3]).toBeCloseTo(pos[0], 5);
        expect(pos[last * 3 + 2]).toBeCloseTo(pos[2], 5);
    });

    it('writes the strip phases the disc half reproduces', () => {
        // The two halves agree only because both derive their phase from auroraStripPhase.
        // If the geometry ever inlines a different formula the painted oval breaks in
        // different places from the curtains standing on it.
        const g = buildAuroraCrownGeometry(R);
        const ring = g.getAttribute('aRing').array;
        const columns = AURORA_OVAL.segments + 1;
        const stripStart = (s) => s * columns * 2 * 4;

        expect(ring[stripStart(0) + 3]).toBeCloseTo(auroraStripPhase(0, 1), 6);
        expect(ring[stripStart(1) + 3]).toBeCloseTo(auroraStripPhase(1, 1), 6);
        expect(ring[stripStart(2) + 3]).toBeCloseTo(auroraStripPhase(2, -1), 6);
        expect(ring[stripStart(3) + 3]).toBeCloseTo(auroraStripPhase(3, -1), 6);
        // The south strips must NOT share the north phases, or all four ripple in lockstep.
        expect(auroraStripPhase(2, -1)).not.toBeCloseTo(auroraStripPhase(0, 1), 3);
    });

    it('is deterministic — the same crown on every build', () => {
        const a = buildAuroraCrownGeometry(R).getAttribute('position').array;
        const b = buildAuroraCrownGeometry(R).getAttribute('position').array;
        expect(Array.from(a)).toEqual(Array.from(b));
    });
});

describe('ch6 auroral crown material (Space overhaul Wave 5)', () => {
    it('re-arms setOpacityScale by reading materialOpacity back into its alpha', () => {
        // INTEGRATION LAW 1. The crown lives in the `earth` entryContinuity bucket, and
        // setOpacityScale writes material.opacity — a DEAD WRITE wherever opacityNode
        // exists. Multiplying by the materialOpacity NODE is what makes the write live,
        // and is the only reason the aurora fades up with the earth ignite instead of
        // popping in at full brightness across the Ch5 summit.
        const material = createAuroraCrownMaterial();
        expect(material.opacityNode).toBeTruthy();
        expect(graphKinds(material.opacityNode)).toContain('MaterialNode:opacity');
    });

    it('stays an additive, depth-tested, non-writing, fog-exempt curtain', () => {
        const material = createAuroraCrownMaterial();
        expect(material.blending).toBe(THREE.AdditiveBlending);
        expect(material.transparent).toBe(true);
        // depth TEST stays on so the far-side curtain hides behind the planet; depth
        // WRITE stays off so the curtains do not occlude each other.
        expect(material.depthWrite).toBe(false);
        expect(material.depthTest).toBe(true);
        expect(material.fog).toBe(false);
        expect(material.userData.emitsBloom).toBe(true);
        // MEASURED, not assumed: without this the crown costs TWO draws, because three
        // renders every transparent DoubleSide object in a back pass and a front pass.
        // Additive blending is commutative, so the split changes no pixel here.
        expect(material.forceSinglePass).toBe(true);
    });

    it('ports the winter-verified emerald rather than a second hand-mixed green', () => {
        // Winter's aurora green is the only one in this project measured against real
        // photographs (133.9 deg / 145.3 deg hue). Re-deriving one by eye throws that away.
        expect(AURORA_PALETTE.greenWarm).toEqual([0.04, 1.00, 0.26]);
        expect(AURORA_PALETTE.greenCool).toEqual([0.03, 1.00, 0.52]);
        expect(AURORA_PALETTE.crimson).toEqual([0.86, 0.055, 0.15]);
        expect(AURORA_PALETTE.pink).toEqual([1.00, 0.32, 0.62]);
    });
});

describe('ch6 auroral crown in the chapter (Space overhaul Wave 5)', () => {
    it('hangs off the hero group as ONE extra draw, inside the staging bucket', () => {
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        const { heroPlanet } = group.userData;
        const crowns = [];
        heroPlanet.traverse((child) => {
            if (child.name === 'hero-planet-aurora-crown') crowns.push(child);
        });
        expect(crowns).toHaveLength(1);
        expect(crowns[0].frustumCulled).toBe(false);
    });

    it('fades with the earth ignite instead of popping in over the Ch5 summit', () => {
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        group.userData.chapterOpacity = 1;
        const crown = () => {
            let found = null;
            group.userData.heroPlanet.traverse((c) => {
                if (c.name === 'hero-planet-aurora-crown') found = c;
            });
            return found;
        };

        // Early: the hero is barely lit, so its aurora must be barely lit too.
        updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, 0.05);
        const early = crown().material.opacity;
        expect(early).toBeLessThan(0.05);

        // Settled: full strength.
        updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, 0.6);
        expect(crown().material.opacity).toBeGreaterThan(0.95);
        expect(crown().material.opacity).toBeGreaterThan(early);
    });

    it('builds its curtains on the hero sphere radius, not a drifted copy', () => {
        // A radius mismatch does not error — it just floats the curtains off their oval.
        const crown = createPlanetAuroraCrown(R, undefined);
        const pos = crown.geometry.getAttribute('position').array;
        const foot = Math.hypot(pos[0], pos[1], pos[2]);
        expect(foot).toBeCloseTo(R * AURORA_OVAL.footLift, 4);
    });
});
