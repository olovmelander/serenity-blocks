import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { describe, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-theme.js');
const materialsPath = path.join(root, 'src', 'themes', 'bioluminescence', 'bioluminescence-materials.js');
const planPath = path.join(root, 'docs', 'BIOLUMINESCENCE_WEBGPU_UPGRADE_PLAN.md');
const artPath = path.join(root, 'docs', 'BIOLUMINESCENCE_ART_DIRECTION.md');

const themeSource = fs.readFileSync(themePath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const planSource = fs.readFileSync(planPath, 'utf8');
const artSource = fs.readFileSync(artPath, 'utf8');

describe('Bioluminescence Phase 5: Enhanced Environment and World Building', () => {
    it('expands quality presets with phase5 world-building controls', () => {
        const requiredPresetFields = [
            'ceilingCrystalCount',
            'stalactiteCount',
            'tendrilCount',
            'vineCount',
            'shelfMushroomCount',
            'giantMushroomCount',
            'clusterMiniCount',
            'microCrystalCount',
            'mossPatchCount',
            'rubbleCount',
            'enableJellyfish',
            'jellyfishCount',
            'pointLightCount',
        ];

        requiredPresetFields.forEach((field) => {
            assert(themeSource.includes(field), `Missing Phase 5 preset field: ${field}`);
        });

        assert(themeSource.includes('mushroomCount: 15'), 'High preset should target 15 mushrooms');
        assert(themeSource.includes('ceilingCrystalCount: 8'), 'High preset should include ceiling crystals');
        assert(themeSource.includes('microCrystalCount: 200'), 'High preset should include micro-crystal field');
        assert(themeSource.includes('rubbleCount: 25'), 'High preset should include rubble field');
        assert(themeSource.includes('mossPatchCount: 50'), 'High preset should include moss patches');
    });

    it('implements biome-band composition and cave architecture builders', () => {
        assert(themeSource.includes('const BIOME_BAND_LAYOUT'), 'Missing biome-band layout map');
        assert(themeSource.includes("name: 'Band A'"), 'Band A foreground config missing');
        assert(themeSource.includes("name: 'Band B'"), 'Band B mid config missing');
        assert(themeSource.includes("name: 'Band C'"), 'Band C abyss config missing');
        assert(themeSource.includes('createBiomeBandConfig()'), 'Missing biome-band resolver');
        assert(themeSource.includes('sampleBiomePosition(band = \'mid\''), 'Missing band-aware placement helper');
        assert(themeSource.includes('createCaveCeilingDome()'), 'Missing cave ceiling dome builder');
        assert(themeSource.includes('createPrimaryBackWall()'), 'Missing primary back-wall builder');
        assert(themeSource.includes('createSideCaveWalls()'), 'Missing side-wall builder');
        assert(themeSource.includes('createStalactiteField()'), 'Missing stalactite cluster builder');
        assert(themeSource.includes('createBackgroundDepthLayers()'), 'Missing abyss depth-layer builder');
    });

    it('replaces Water.js fallback usage with dedicated custom water shader material', () => {
        assert(!themeSource.includes("from 'three/examples/jsm/objects/Water.js'"), 'Phase 5 should remove Water.js import');
        assert(!themeSource.includes('new Water('), 'Phase 5 should not instantiate Water.js');
        assert(themeSource.includes('createWaterMaterial({'), 'Theme should use custom WebGL water fallback material');
        assert(materialsSource.includes('createWaterMaterial(options = {})'), 'Fallback material factory missing createWaterMaterial');
        assert(materialsSource.includes('waterFallbackVertexShader'), 'Missing WebGL water fallback vertex shader');
        assert(materialsSource.includes('waterFallbackFragmentShader'), 'Missing WebGL water fallback fragment shader');
    });

    it('adds four mushroom species and upgraded crystal ecosystem methods', () => {
        assert(themeSource.includes('createTallSpireMushroom('), 'Missing tall-spire mushroom species');
        assert(themeSource.includes('createShelfMushroomPopulation()'), 'Missing shelf mushroom species population');
        assert(themeSource.includes('createClusterMiniMushroomPopulation()'), 'Missing cluster-mini mushroom species population');
        assert(themeSource.includes('createGiantAncientMushrooms()'), 'Missing giant ancient mushroom species population');
        assert(themeSource.includes('this.mushroomSpeciesStats'), 'Missing species telemetry structure');
        assert(themeSource.includes('createCeilingCrystalField()'), 'Missing ceiling crystal type');
        assert(themeSource.includes('createMicroCrystalField()'), 'Missing micro-crystal field type');
        assert(themeSource.includes('createPillarCrystalCluster('), 'Missing pillar crystal cluster type');
    });

    it('adds mycelium network mesh generation and organic details systems', () => {
        assert(themeSource.includes('createMyceliumNetwork()'), 'Missing mycelium network builder');
        assert(themeSource.includes('createMyceliumSegment(from, to)'), 'Missing mycelium segment builder');
        assert(themeSource.includes('this.createMyceliumNetwork();'), 'Scene creation should build mycelium network');
        assert(themeSource.includes('createHangingTendrils()'), 'Missing hanging tendril system');
        assert(themeSource.includes('createJellyfishSchool()'), 'Missing jellyfish system');
        assert(themeSource.includes('createMossPatchField()'), 'Missing moss patch field');
        assert(themeSource.includes('createRubbleField()'), 'Missing rubble field');
    });

    it('keeps phase5 requirements aligned with plan and art packet language', () => {
        assert(planSource.includes('### Phase 5: Enhanced Environment & World Building (High)'), 'Plan missing Phase 5 section');
        assert(planSource.includes('Band A: Foreground fungal grove'), 'Plan missing Band A requirement');
        assert(planSource.includes('Band B: Mid cavern corridor'), 'Plan missing Band B requirement');
        assert(planSource.includes('Band C: Far abyss chamber'), 'Plan missing Band C requirement');
        assert(planSource.includes('At least 4 mushroom species and 3 crystal types'), 'Plan missing species/type target');
        assert(artSource.includes('Band A — Foreground Fungal Grove'), 'Art direction missing Band A packet');
        assert(artSource.includes('Band B — Mid Cavern Corridor'), 'Art direction missing Band B packet');
        assert(artSource.includes('Band C — Far Abyss Chamber'), 'Art direction missing Band C packet');
        assert(artSource.includes('Mushroom Species: 4 distinct types'), 'Art direction missing 4 species lock');
        assert(artSource.includes('Crystal Types: 3 distinct types'), 'Art direction missing 3 crystal-type lock');
    });
});
