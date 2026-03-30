import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 4 Foliage Pass Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const foliageWgslPath = path.join(root, 'src', 'themes', 'sky-children', 'wgsl', 'foliage.wgsl');
const resourcesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-resources.js');
const pipelinesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-pipelines.js');

const foliageWgslSource = fs.readFileSync(foliageWgslPath, 'utf8');
const resourcesSource = fs.readFileSync(resourcesPath, 'utf8');
const pipelinesSource = fs.readFileSync(pipelinesPath, 'utf8');

console.log('Test 1: Foliage WGSL defines layered wind and blade helpers');
assert(foliageWgslSource.includes('struct FoliageParams'), 'Missing FoliageParams struct');
assert(foliageWgslSource.includes('fn foliage_blade_local('), 'Missing blade local helper');
assert(foliageWgslSource.includes('fn foliage_wind_layers('), 'Missing layered wind helper');
assert(foliageWgslSource.includes('fn foliage_color_ramp('), 'Missing foliage color ramp helper');
console.log('  ✓ PASS');

console.log('\nTest 2: Phase 4 foliage defaults and mutable state factory exist');
assert(resourcesSource.includes('SKY_CHILDREN_PHASE4_FOLIAGE_DEFAULTS'), 'Missing Phase 4 foliage defaults object');
assert(resourcesSource.includes('windStrength'), 'Missing windStrength default');
assert(resourcesSource.includes('sssDistortion'), 'Missing sssDistortion default');
assert(resourcesSource.includes('instanceCount'), 'Missing instanceCount default');
assert(
    resourcesSource.includes('export function createSkyChildrenPhase4FoliageState'),
    'Missing Phase 4 foliage state factory',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Pipeline composition exposes Phase 4 foliage uniform budget and builder');
assert(
    pipelinesSource.includes('export const SKY_CHILDREN_PHASE4_UNIFORM_FLOATS = 104'),
    'Missing Phase 4 uniform float budget',
);
assert(
    pipelinesSource.includes('foliage_base_variation: vec4f'),
    'Missing foliage base/variation uniform block',
);
assert(
    pipelinesSource.includes('foliage_wind_secondary: vec4f'),
    'Missing foliage wind secondary uniform block',
);
assert(
    pipelinesSource.includes('export function buildSkyChildrenPhase4TerrainCloudFoliageWGSL'),
    'Missing Phase 4 WGSL builder',
);
assert(
    pipelinesSource.includes('@vertex\nfn vs_foliage('),
    'Missing foliage vertex entrypoint in composed shader',
);
assert(
    pipelinesSource.includes('@fragment\nfn fs_foliage('),
    'Missing foliage fragment entrypoint in composed shader',
);
assert(
    pipelinesSource.includes('let distance_fade = 1.0 - smoothstep(34.0, 126.0, view_distance);'),
    'Missing foliage distance fade for far-field stability',
);
assert(
    pipelinesSource.includes('discard;'),
    'Missing foliage alpha discard guard for overdraw control',
);
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 4 Foliage Tests Passed ===');
