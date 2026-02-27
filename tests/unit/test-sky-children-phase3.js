import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 3 Cloud Pass Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const cloudWgslPath = path.join(root, 'src', 'themes', 'sky-children', 'wgsl', 'cloud.wgsl');
const resourcesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-resources.js');
const pipelinesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-pipelines.js');

const cloudWgslSource = fs.readFileSync(cloudWgslPath, 'utf8');
const resourcesSource = fs.readFileSync(resourcesPath, 'utf8');
const pipelinesSource = fs.readFileSync(pipelinesPath, 'utf8');

console.log('Test 1: Cloud WGSL defines scattering and silhouette functions');
assert(cloudWgslSource.includes('struct CloudParams'), 'Missing CloudParams struct');
assert(cloudWgslSource.includes('struct CloudSample'), 'Missing CloudSample struct');
assert(cloudWgslSource.includes('fn cloud_beers_law('), 'Missing Beers Law cloud function');
assert(cloudWgslSource.includes('fn cloud_henyey_greenstein('), 'Missing HG phase function');
assert(cloudWgslSource.includes('fn cloud_layer('), 'Missing cloud layer function');
assert(cloudWgslSource.includes('fn cloud_render('), 'Missing cloud render entrypoint');
console.log('  ✓ PASS');

console.log('\nTest 2: Phase 3 cloud defaults and mutable state factory exist');
assert(resourcesSource.includes('SKY_CHILDREN_PHASE3_CLOUD_DEFAULTS'), 'Missing Phase 3 cloud defaults object');
assert(resourcesSource.includes('scatterG'), 'Missing scatterG default');
assert(resourcesSource.includes('silverStrength'), 'Missing silverStrength default');
assert(resourcesSource.includes('silhouetteStrength'), 'Missing silhouetteStrength default');
assert(
    resourcesSource.includes('export function createSkyChildrenPhase3CloudState'),
    'Missing Phase 3 cloud state factory',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Pipeline composition exposes Phase 3 cloud uniform budget and builder');
assert(
    pipelinesSource.includes('export const SKY_CHILDREN_PHASE3_UNIFORM_FLOATS = 80'),
    'Missing Phase 3 uniform float budget',
);
assert(
    pipelinesSource.includes('cloud_color_density: vec4f'),
    'Missing cloud color/density uniform block',
);
assert(
    pipelinesSource.includes('cloud_shape_silver: vec4f'),
    'Missing cloud shape/silver uniform block',
);
assert(
    pipelinesSource.includes('buildSkyChildrenPhase3TerrainCloudWGSL'),
    'Missing Phase 3 WGSL builder',
);
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 3 Cloud Tests Passed ===');
