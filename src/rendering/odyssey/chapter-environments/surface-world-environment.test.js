import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    createSurfaceWorldEnvironment,
    updateSurfaceWorldEnvironment,
    resolveSurfaceWorldEntryRampState,
    resolveSurfaceWorldAlpineRampState,
    resolveSurfaceWorldSeamRecedeState,
    resolveSurfaceWorldSurfaceExitState,
    resolveSurfaceWorldWaterCrossingState,
} from './surface-world.js';
import {
    CH3_BIRD_SILHOUETTE_SETTINGS,
    CH3_TREE_VALUE_SETTINGS,
    CH3_WATER_READABILITY_SETTINGS,
} from './surface-world.tsl.js';
import { getChapter3QuaterniusAssetById } from './shared/chapter-03-quaternius-assets.js';
import { CANONICAL_HERO_MOUNTAIN_SPEC_IDS } from './shared/canonical-mountain-range.js';
import { getActiveOdysseyChapterPositions } from '../path-utils.js';
import { ODYSSEY_CHAPTER_PROFILES } from './shared/chapter-profile.js';

function stubCanvasDocument() {
    const gradient = { addColorStop: vi.fn() };
    const context = {
        clearRect: vi.fn(),
        createRadialGradient: vi.fn(() => gradient),
        createLinearGradient: vi.fn(() => gradient),
        quadraticCurveTo: vi.fn(),
        moveTo: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
    };
    vi.stubGlobal('document', {
        createElement: vi.fn(() => ({
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
        })),
    });
}

function colorChannels(hex) {
    return {
        r: Math.floor(hex / 0x10000) % 0x100,
        g: Math.floor(hex / 0x100) % 0x100,
        b: hex % 0x100,
    };
}

describe('Surface World chapter environment (creative plan ch3)', () => {
    it('mounts the ocean, foreground pass-by layer, conifer tree-line, and snow motes', () => {
        stubCanvasDocument();

        const group = createSurfaceWorldEnvironment();

        expect(group.userData.ocean?.name).toBe('ocean-surface');
        // Cabin removed from Ch3 (no human-structure cue) — the meadow/lake/great-tree carry it.
        expect(group.userData.cabin).toBeUndefined();
        expect(group.userData.foregroundLayer?.name).toBe('foreground-pass-by');
        // Remake plan action #1: the redundant procedural spruce + tree-line stands are cut; the
        // shared GLB snow-conifer belt is now the ONE tree-line (Ch3↔Ch4 continuous), so we assert
        // the surviving belt instead of the removed procedural spruces.
        expect(group.userData.coniferBelt?.name).toBe('snow-conifer-belt');
        expect(group.userData.spruces).toBeUndefined();
        expect(group.userData.snowMotes?.name).toBe('snow-motes');
        expect(group.userData.quaterniusNatureLayer?.name)
            .toBe('quaternius-cc0-nature-assets');
        expect(group.userData.distantMountains.userData.canonicalMountainRange.sourceChapter)
            .toBe(4);
        expect(group.userData.distantMountains.userData.specIds)
            .toEqual([...CANONICAL_HERO_MOUNTAIN_SPEC_IDS]);
        expect(group.userData.distantMountains.userData.isSingleHeroChain)
            .toBe(true);
        expect(group.userData.quaterniusNatureLayer.userData.assetRecords.length)
            .toBeGreaterThanOrEqual(12);
        expect(group.userData.quaterniusNatureLayer.userData.assetRecords
            .some((asset) => asset.id === 'pigeon-animated' && asset.license === 'Public Domain (CC0)'))
            .toBe(true);
        expect(group.userData.quaterniusProceduralFallbacks).toContain(group.userData.trees);
        expect(group.userData.quaterniusProceduralFallbacks).toContain(group.userData.birds);
        // The hero must triple its presence: crown upscale applied.
        expect(group.userData.greatTree.scale.x).toBeGreaterThan(1.3);
        // The corridor-wide leaf story doubled the leaf count's reach.
        expect(group.userData.fallingLeaves).toBeTruthy();
    });

    it('keeps the Chapter 3 profile and water pass out of the washed beige read', () => {
        stubCanvasDocument();

        const profile = ODYSSEY_CHAPTER_PROFILES.find((chapter) => chapter.id === 3);
        expect(profile.atmosphere.ambientIntensity).toBeLessThan(0.7);
        expect(profile.atmosphere.exposure).toBeLessThanOrEqual(1);
        // Masterplan D2 dim (0x96a842 → 0x687d31): live capture showed the ch3 path was the
        // journey's worst figure-ground offender — the pin follows chapter-profile.js.
        expect(profile.path.emissiveColor).toBe(0x687d31);
        expect(profile.path.widthScale).toBeLessThanOrEqual(0.9);

        const group = createSurfaceWorldEnvironment();
        const waterReadability = group.userData.ocean.userData.readability;
        expect(waterReadability.sourceChapter).toBe(2);
        expect(waterReadability.sourceBuilder).toBe('createWaterSurfaceTSL');
        expect(waterReadability.deepColor).toBe(CH3_WATER_READABILITY_SETTINGS.deepColor);
        const deepWater = colorChannels(waterReadability.deepColor);
        expect(deepWater.b).toBeGreaterThan(deepWater.g);
        expect(deepWater.b).toBeGreaterThan(deepWater.r);
        expect(waterReadability.maxColor[2]).toBeGreaterThan(waterReadability.maxColor[0]);
        expect(waterReadability.sunPathGain).toBeLessThan(0.25);
        expect(waterReadability.corridorWidth).toBeGreaterThanOrEqual(200);
        expect(waterReadability.corridorDepth).toBeGreaterThanOrEqual(500);
        expect(waterReadability.seaWidth).toBeGreaterThanOrEqual(1000);
        expect(waterReadability.seaCenterZ).toBeGreaterThan(0);
        expect(waterReadability.corridorCenterZ).toBeLessThan(waterReadability.seaCenterZ);
        expect(waterReadability.waterShelfFadeMin).toBeLessThan(0);
        expect(waterReadability.waterShelfFadeMax).toBeGreaterThan(0);
        expect(group.userData.ocean.userData.sea?.name).toBe('surface-chapter-02-water-foreground');
        expect(group.userData.ocean.userData.river?.name).toBe('surface-chapter-02-water-river');
        expect(group.userData.ocean.userData.sea?.material.userData.emitsBloom).toBe(true);
        expect(group.userData.ocean.userData.sea.renderOrder).toBeLessThan(group.userData.landscape.renderOrder);
        expect(group.userData.ocean.userData.river.renderOrder).toBeLessThan(group.userData.landscape.renderOrder);
        expect(group.userData.landscape.material.userData.waterShelfFade.min)
            .toBe(waterReadability.waterShelfFadeMin);
        expect(group.userData.auroraPreview).toBeNull();
        expect(group.userData.auroraPreviewOpacityUniformTargets).toHaveLength(0);
        expect(group.userData.oceanOpacityUniformTargets.length).toBeGreaterThan(0);
        expect(group.userData.distantMountainOpacityUniformTargets.length).toBeGreaterThan(0);
        expect(group.userData.alpineElements).not.toContain(group.userData.distantMountains);
        expect(group.userData.distantMountainElements).toContain(group.userData.distantMountains);
    });

    it('uses richer tree/bird silhouettes and records CC0 source candidates', () => {
        stubCanvasDocument();

        const group = createSurfaceWorldEnvironment();
        const { birds } = group.userData;
        const crosserCount = birds.children.filter((bird) => bird.userData.crosser).length;
        const vertexCount = birds.children[0].geometry.attributes.position.count;

        expect(group.userData.trees.geometry.userData.cc0Candidates)
            .toBe(CH3_TREE_VALUE_SETTINGS.cc0Candidates);
        expect(group.userData.greatTree.userData.cc0Candidates)
            .toBe(CH3_TREE_VALUE_SETTINGS.cc0Candidates);
        expect(CH3_TREE_VALUE_SETTINGS.cc0Candidates[0].license).toBe('Public Domain (CC0)');
        expect(CH3_TREE_VALUE_SETTINGS.cc0Candidates.some(
            (asset) => asset.name === 'Bush with Flowers',
        )).toBe(true);
        expect(birds.children).toHaveLength(CH3_BIRD_SILHOUETTE_SETTINGS.flockCount);
        expect(crosserCount).toBe(CH3_BIRD_SILHOUETTE_SETTINGS.crosserCount);
        expect(vertexCount).toBeGreaterThanOrEqual(CH3_BIRD_SILHOUETTE_SETTINGS.vertexCount);
        expect(birds.userData.cc0Candidate.license).toBe('Public Domain (CC0)');
        expect(group.userData.quaterniusNatureLayer.userData.assetManifest.contract.license)
            .toBe('Public Domain (CC0)');

        [
            'pine-igsu',
            'pine-cluster',
            'twisted-edsp',
            'twisted-9awl',
            'pine-79gm',
            'pine-699s',
            'tree-hero',
            'bush-flowers',
            'tree-t9kb',
            'bird-jay',
        ].forEach((assetId) => {
            expect(getChapter3QuaterniusAssetById(assetId)?.license)
                .toBe('Public Domain (CC0)');
        });
    });

    it('drives the season scalar and the season-lerped key light from progress', () => {
        stubCanvasDocument();

        const group = createSurfaceWorldEnvironment();
        const { uniforms } = group.userData;
        const tStart = group.userData.chapterTStart;
        const tEnd = group.userData.chapterTEnd;
        expect(tEnd).toBeGreaterThan(tStart);

        // Spring (chapter start): warm golden key — red channel dominates blue.
        updateSurfaceWorldEnvironment(group, 0.016, 1.0, null, tStart);
        expect(uniforms.uSeason.value).toBe(0);
        const springKey = group.userData.sunKey.color.clone();
        expect(springKey.r).toBeGreaterThan(springKey.b);

        // Winter (chapter end): the key cools — blue overtakes red, intensity drops.
        updateSurfaceWorldEnvironment(group, 0.016, 2.0, null, tEnd);
        expect(uniforms.uSeason.value).toBeCloseTo(1, 5);
        expect(group.userData.snowBlendUniformTargets[0].value).toBeCloseTo(1, 5);
        const winterKey = group.userData.sunKey.color;
        expect(winterKey.b).toBeGreaterThan(winterKey.r);
        expect(group.userData.sunKey.intensity).toBeLessThan(0.7);
    });

    it('ramps the chapter entry so the landscape slab cannot pop at the breach', () => {
        const positions = getActiveOdysseyChapterPositions();
        const ch3Start = positions[2];
        const ch4Start = positions[3];

        // Before/at the boundary: invisible or rising; well inside: fully present.
        expect(resolveSurfaceWorldEntryRampState(ch3Start - 0.03, positions).entryOpacity).toBe(0);
        const rising = resolveSurfaceWorldEntryRampState(ch3Start + 0.005, positions).entryOpacity;
        expect(rising).toBeGreaterThan(0);
        expect(rising).toBeLessThan(1);
        const mid = ch3Start + (ch4Start - ch3Start) * 0.5;
        expect(resolveSurfaceWorldEntryRampState(mid, positions).entryOpacity).toBe(1);
        // No progress info (pilot/standalone): fully visible.
        expect(resolveSurfaceWorldEntryRampState(null).entryOpacity).toBe(1);
    });

    it('keeps Chapter 2 water as an early crossing and gives the horizon to mountains', () => {
        const positions = getActiveOdysseyChapterPositions();
        const ch3Start = positions[2];
        const ch4Start = positions[3];
        const span = ch4Start - ch3Start;

        const early = resolveSurfaceWorldWaterCrossingState(ch3Start + span * 0.2, positions);
        expect(early.waterCrossingOpacity).toBe(1);
        expect(early.waterCrossingVisible).toBe(true);

        const fading = resolveSurfaceWorldWaterCrossingState(ch3Start + span * 0.4, positions);
        expect(fading.waterCrossingOpacity).toBeGreaterThan(0);
        expect(fading.waterCrossingOpacity).toBeLessThan(1);

        const late = resolveSurfaceWorldWaterCrossingState(ch3Start + span * 0.65, positions);
        expect(late.waterCrossingOpacity).toBe(0);
        expect(late.waterCrossingVisible).toBe(false);

        const mountainReveal = resolveSurfaceWorldAlpineRampState(ch3Start + span * 0.1, positions);
        expect(mountainReveal.rampOpacity).toBeGreaterThan(0);
        expect(mountainReveal.rampVisible).toBe(true);

        const earlyRecede = resolveSurfaceWorldSeamRecedeState(ch3Start + span * 0.1, positions);
        expect(earlyRecede.recedeOpacity).toBe(1);

        const finalRecede = resolveSurfaceWorldSeamRecedeState(ch4Start, positions);
        expect(finalRecede.recedeOpacity).toBe(0);

        const beforeSurfaceExit = resolveSurfaceWorldSurfaceExitState(ch4Start - span * 0.1, positions);
        expect(beforeSurfaceExit.surfaceExitOpacity).toBe(1);

        const boundarySurfaceExit = resolveSurfaceWorldSurfaceExitState(ch4Start, positions);
        expect(boundarySurfaceExit.surfaceExitOpacity).toBeGreaterThan(0.45);
        expect(boundarySurfaceExit.surfaceExitOpacity).toBeLessThan(0.55);

        const afterSurfaceExit = resolveSurfaceWorldSurfaceExitState(ch4Start + span * 0.1, positions);
        expect(afterSurfaceExit.surfaceExitOpacity).toBe(0);
    });
});
