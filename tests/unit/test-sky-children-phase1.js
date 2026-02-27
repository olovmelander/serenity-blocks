import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 1 Lighting Core Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const wgslPath = path.join(root, 'src', 'themes', 'sky-children', 'wgsl', 'stylized_lighting.wgsl');
const resourcesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-resources.js');
const pipelinesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-pipelines.js');

const wgslSource = fs.readFileSync(wgslPath, 'utf8');
const resourcesSource = fs.readFileSync(resourcesPath, 'utf8');
const pipelinesSource = fs.readFileSync(pipelinesPath, 'utf8');

console.log('Test 1: WGSL core contains required phase1 structs and functions');
assert(wgslSource.includes('struct LightParams'), 'Missing LightParams struct');
assert(wgslSource.includes('struct SurfaceParams'), 'Missing SurfaceParams struct');
assert(wgslSource.includes('fn journey_diffuse('), 'Missing journey_diffuse');
assert(wgslSource.includes('fn fresnel_rim('), 'Missing fresnel_rim');
assert(wgslSource.includes('fn ocean_specular('), 'Missing ocean_specular');
assert(wgslSource.includes('fn glitter_specular('), 'Missing glitter_specular');
assert(wgslSource.includes('fn colored_shadow_blend('), 'Missing colored_shadow_blend');
assert(wgslSource.includes('fn calculate_journey_lighting_custom('), 'Missing runtime-tunable lighting entrypoint');
assert(wgslSource.includes('fn calculate_journey_lighting('), 'Missing calculate_journey_lighting');
console.log('  ✓ PASS');

console.log('\nTest 2: Journey formulas match plan-critical constants and combination order');
assert(wgslSource.includes('n.y *= 0.3;'), 'Missing Journey Y-normal compression (0.3)');
assert(wgslSource.includes('return saturate(4.0 * n_dot_l);'), 'Missing Journey diffuse multiplier (4.0)');
assert(
    wgslSource.includes('pow(saturate(1.0 - n_dot_v), power) * strength'),
    'Missing rim Fresnel formulation',
);
assert(
    wgslSource.includes('let spec_base = max(rim_contrib, ocean_contrib);'),
    'Missing Journey spec rule max(rim, ocean)',
);
assert(
    wgslSource.includes('return base + spec_base + glitter_contrib;'),
    'Missing final spec composition (+ glitter)',
);
assert(
    wgslSource.includes('journey_diffuse_custom('),
    'Missing runtime-controlled diffuse path for Phase 1 tuning',
);
assert(
    wgslSource.includes('0.3,'),
    'Missing fallback yNormalCompression default in wrapper',
);
assert(
    wgslSource.includes('4.0,'),
    'Missing fallback diffuseMultiplier default in wrapper',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Phase 1 defaults lock warm/cool split and shadow tint parameters');
assert(resourcesSource.includes('SKY_CHILDREN_PHASE1_LIGHTING_DEFAULTS'), 'Missing default lighting object');
assert(resourcesSource.includes('ambientColor'), 'Missing ambient color defaults');
assert(resourcesSource.includes('shadow'), 'Missing shadow defaults');
assert(resourcesSource.includes('rimPower'), 'Missing rim defaults');
assert(resourcesSource.includes('threshold'), 'Missing glitter threshold defaults');
assert(resourcesSource.includes('yNormalCompression: 0.3'), 'Missing default yNormalCompression = 0.3');
assert(resourcesSource.includes('diffuseMultiplier: 4.0'), 'Missing default diffuseMultiplier = 4.0');
console.log('  ✓ PASS');

console.log('\nTest 4: Pipeline helper validates GPUDevice and WGSL source before module creation');
assert(pipelinesSource.includes('createSkyChildrenStylizedLightingModule'), 'Missing phase1 pipeline helper');
assert(
    pipelinesSource.includes('requires a valid GPUDevice'),
    'Missing GPUDevice validation error path',
);
assert(
    pipelinesSource.includes('Stylized lighting WGSL source is required'),
    'Missing WGSL source validation error path',
);
console.log('  ✓ PASS');

console.log('\n=== All Sky Children Phase 1 Tests Passed ===');
