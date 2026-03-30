import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 2 Terrain Pass Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const terrainWgslPath = path.join(root, 'src', 'themes', 'sky-children', 'wgsl', 'terrain.wgsl');
const resourcesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-resources.js');
const pipelinesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-pipelines.js');

const terrainWgslSource = fs.readFileSync(terrainWgslPath, 'utf8');
const resourcesSource = fs.readFileSync(resourcesPath, 'utf8');
const pipelinesSource = fs.readFileSync(pipelinesPath, 'utf8');

console.log('Test 1: Terrain WGSL defines tri-planar and distance-stability functions');
assert(terrainWgslSource.includes('struct TerrainParams'), 'Missing TerrainParams struct');
assert(terrainWgslSource.includes('fn terrain_triplanar_weights('), 'Missing tri-planar weights function');
assert(terrainWgslSource.includes('fn terrain_triplanar_normal('), 'Missing tri-planar normal sampling');
assert(terrainWgslSource.includes('fn terrain_distance_roughness('), 'Missing distance roughness falloff function');
assert(terrainWgslSource.includes('fn terrain_detail_attenuation('), 'Missing distance detail attenuation');
assert(terrainWgslSource.includes('fn terrain_height('), 'Missing terrain height function');
console.log('  ✓ PASS');

console.log('\nTest 2: Phase 2 terrain defaults and mutable state factory exist');
assert(resourcesSource.includes('SKY_CHILDREN_PHASE2_TERRAIN_DEFAULTS'), 'Missing Phase 2 terrain defaults object');
assert(resourcesSource.includes('triplanarScale'), 'Missing triplanarScale default');
assert(resourcesSource.includes('roughnessFalloffStart'), 'Missing roughness falloff start default');
assert(resourcesSource.includes('roughnessFalloffEnd'), 'Missing roughness falloff end default');
assert(resourcesSource.includes('shimmerSuppression'), 'Missing shimmer suppression default');
assert(
    resourcesSource.includes('export function createSkyChildrenPhase2TerrainState'),
    'Missing Phase 2 terrain state factory',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Pipeline composition exposes Phase 2 uniform budget and terrain bindings');
assert(
    pipelinesSource.includes('export const SKY_CHILDREN_PHASE2_UNIFORM_FLOATS = 60'),
    'Missing Phase 2 uniform float budget',
);
assert(
    pipelinesSource.includes('terrain_color_roughness_near: vec4f'),
    'Missing terrain color/roughness uniforms in frame block',
);
assert(
    pipelinesSource.includes('terrain_cool_triplanar: vec4f'),
    'Missing terrain cool/triplanar uniform block',
);
assert(
    pipelinesSource.includes('terrain_falloff_height: vec4f'),
    'Missing terrain falloff/height uniform block',
);
assert(
    pipelinesSource.includes('buildSkyChildrenPhase2TerrainWGSL'),
    'Missing Phase 2 WGSL builder',
);
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 2 Terrain Tests Passed ===');
