import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Nimbus Veil Phase 2 Render Path + Module Split Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-theme.js');
const materialsPath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-materials.js');
const postPath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-post.js');
const planPath = path.join(root, 'docs', 'NIMBUS_VEIL_WEBGPU_UPGRADE_PLAN.md');
const artPath = path.join(root, 'docs', 'NIMBUS_VEIL_ART_DIRECTION.md');

const themeSource = fs.readFileSync(themePath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const postSource = fs.readFileSync(postPath, 'utf8');
const planSource = fs.readFileSync(planPath, 'utf8');
const artSource = fs.readFileSync(artPath, 'utf8');

console.log('Test 1: Theme imports Phase 2 material + post modules');
assert(
    themeSource.includes("from './nimbus-veil-materials.js';"),
    'Theme missing materials module import',
);
assert(
    themeSource.includes("import { NimbusVeilPost } from './nimbus-veil-post.js';"),
    'Theme missing post module import',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Material factory module keeps shader source as fallback');
assert(
    materialsSource.includes("from './nimbus-veil-shaders.js';"),
    'Material module should import fallback shader source',
);
assert(materialsSource.includes('createNimbusStarsMaterial'), 'Missing stars material factory');
assert(materialsSource.includes('createNimbusCloudMaterial'), 'Missing cloud material factory');
assert(materialsSource.includes('createNimbusDustMaterial'), 'Missing dust material factory');
assert(materialsSource.includes('createNimbusMistMaterial'), 'Missing mist material factory');
assert(materialsSource.includes('createNimbusLightBurstMaterial'), 'Missing light burst material factory');
assert(materialsSource.includes('createNimbusPulseMaterial'), 'Missing pulse material factory');
assert(
    materialsSource.includes('resolveMaterialPath(isWebGPU = false, usesNodeMaterial = false)'),
    'Missing dual-path resolution helper',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Theme scene creation consumes material factories');
assert(
    themeSource.includes('createNimbusStarsMaterial({'),
    'Stars creation should use material factory',
);
assert(
    themeSource.includes('createNimbusCloudMaterial({'),
    'Cloud creation should use material factory',
);
assert(
    themeSource.includes('createNimbusDustMaterial({'),
    'Dust creation should use material factory',
);
assert(
    themeSource.includes('createNimbusMistMaterial({'),
    'Mist creation should use material factory',
);
assert(
    themeSource.includes('createNimbusLightBurstMaterial({'),
    'Light burst creation should use material factory',
);
assert(
    themeSource.includes('createNimbusPulseMaterial({'),
    'Pulse wave creation should use material factory',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Post module provides unified post/direct renderer API');
assert(postSource.includes('export class NimbusVeilPost'), 'Missing NimbusVeilPost class');
assert(postSource.includes('init(options = {})'), 'Missing post init method');
assert(postSource.includes('render(sceneOverride = null, cameraOverride = null)'), 'Missing post render abstraction');
assert(postSource.includes('setSize(width, height)'), 'Missing post resize normalization');
assert(postSource.includes('dispose()'), 'Missing post dispose method');
assert(postSource.includes('new EffectComposer(this.renderer)'), 'Post module missing WebGL composer path');
assert(postSource.includes("this.mode = 'webgl-post';"), 'Post mode should use stable webgl-post label');
console.log('  ✓ PASS');

console.log('\nTest 5: Theme render path uses post abstraction for all runtime modes');
assert(themeSource.includes('this.nimbusPost?.isEnabled()'), 'renderFrame should query nimbusPost state');
assert(
    themeSource.includes('this.nimbusPost.render(this.scene, this.camera)'),
    'renderFrame should route through NimbusVeilPost',
);
assert(
    themeSource.includes('this.renderPath = this.isWebGPU ? \'webgpu-direct\' : \'webgl-direct\';'),
    'Direct render path tagging missing',
);
assert(
    themeSource.includes('this.renderPath = this.nimbusPost.getMode();'),
    'Post render path tagging missing',
);
console.log('  ✓ PASS');

console.log('\nTest 6: Resize logic is normalized across renderer and post');
assert(themeSource.includes('this.nimbusPost.setSize(width, height);'), 'Resize should route through post abstraction');
assert(
    themeSource.includes('const bloomEnabledByQuality = this.qualityPreset?.enableBloom === true;'),
    'Post setup should respect quality bloom toggles before enabling composer',
);
console.log('  ✓ PASS');

console.log('\nTest 7: Tone mapping ownership is explicit and centralized');
assert(themeSource.includes('applyColorPipeline(postEnabled = false)'), 'Missing color pipeline owner helper');
assert(
    themeSource.includes('this.renderer.toneMapping = THREE.NoToneMapping;'),
    'Missing explicit renderer tone mapping ownership',
);
assert(themeSource.includes('toneMappingOwner: \'renderer\''), 'Color pipeline owner must be tracked');
assert(
    themeSource.includes('colorPipeline: this.colorPipeline,'),
    'Capability snapshots should include color pipeline evidence',
);
assert(
    themeSource.includes('colorPipeline: { ...this.colorPipeline },'),
    'Validation snapshots should include color pipeline audit state',
);
console.log('  ✓ PASS');

console.log('\nTest 8: Plan and art packet remain aligned with calm Sky-inspired direction');
assert(planSource.includes('Phase 2: Render Path Abstraction and Module Split'), 'Plan missing Phase 2 section');
assert(
    planSource.includes('- [x] Implement `renderFrame()` abstraction for all runtime modes.'),
    'Plan Phase 2 task checklist not updated',
);
assert(artSource.includes('Use Sky: Children of the Light as a mood reference only.'), 'Art packet guardrail missing');
assert(artSource.includes('Board readability is non-negotiable.'), 'Art packet readability lock missing');
assert(artSource.includes('## Phase 2 Art-Safety Guardrails'), 'Art packet missing Phase 2 guardrail section');
console.log('  ✓ PASS');

console.log('\n=== All Nimbus Veil Phase 2 Tests Passed ===');
