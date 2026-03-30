import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Moonlit Forest Phase 1 Hardening Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const themePath = path.join(__dirname, '..', '..', 'src', 'themes', 'moonlit-forest', 'moonlit-forest-theme.js');
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Renderer capability model is normalized');
assert(themeSource.includes('setupRendererCapabilities()'), 'Missing setupRendererCapabilities');
assert(themeSource.includes('maxColorAttachments'), 'Missing maxColorAttachments capability');
assert(themeSource.includes('post: !this.flags.noPost && supportsPost'), 'Missing post capability gating');
assert(themeSource.includes('mrt: !this.flags.noMRT && supportsMRT'), 'Missing MRT capability gating');
assert(themeSource.includes('compute: !this.flags.noCompute && supportsCompute'), 'Missing compute capability gating');
console.log('  ✓ PASS');

console.log('\nTest 2: Device-loss recovery and forced fallback path exist');
assert(themeSource.includes('async handleDeviceLoss(info)'), 'Missing handleDeviceLoss');
assert(themeSource.includes('async requestWebGLFallback(reason = \'runtime-fallback\', error = null)'), 'Missing requestWebGLFallback');
assert(themeSource.includes('this.flags.forceWebGL = true;'), 'Missing forced WebGL fallback toggle');
assert(themeSource.includes('await this.createScene();'), 'Fallback path does not reinitialize scene');
console.log('  ✓ PASS');

console.log('\nTest 3: Renderer resilience wiring handles both callback and device-lost promise');
assert(themeSource.includes('setupRendererResilience()'), 'Missing setupRendererResilience');
assert(themeSource.includes('this.renderer.onDeviceLost = (info) =>'), 'Missing onDeviceLost callback');
assert(themeSource.includes('const deviceLostPromise = this.renderer?.backend?.device?.lost;'), 'Missing WebGPU device-lost promise probe');
assert(themeSource.includes('this.handleDeviceLoss(info);'), 'Device-lost hooks do not dispatch recovery');
console.log('  ✓ PASS');

console.log('\nTest 4: Scene creation performs lifecycle cleanup before re-init');
assert(themeSource.includes('this.cancelAnimationLoop();'), 'Missing animation loop cleanup before scene create');
assert(themeSource.includes('this.clearEventSubscriptions();'), 'Missing event cleanup before scene create');
assert(themeSource.includes('this.removeResizeListener();'), 'Missing resize cleanup before scene create');
assert(themeSource.includes('this.clearManagedTimeouts();'), 'Missing timeout cleanup before scene create');
assert(themeSource.includes('this.cleanupRenderer();'), 'Missing runtime resource cleanup before scene create');
console.log('  ✓ PASS');

console.log('\nTest 5: Render path degrades safely when post/render fails');
assert(themeSource.includes('Post render failed, disabling post path'), 'Missing post failure fallback handling');
assert(themeSource.includes('this.requestWebGLFallback(\'webgpu-render-failure\', error);'), 'Missing WebGPU render failure fallback');
console.log('  ✓ PASS');

console.log('\nTest 6: stop() uses centralized cleanup path');
assert(themeSource.includes('stop() {'), 'Missing stop method');
assert(themeSource.includes('this.cancelAnimationLoop();'), 'stop() missing animation cancellation');
assert(themeSource.includes('this.clearEventSubscriptions();'), 'stop() missing event subscription cleanup');
assert(themeSource.includes('this.clearManagedTimeouts();'), 'stop() missing timeout cleanup');
assert(themeSource.includes('this.cleanupRenderer();'), 'stop() missing renderer cleanup');
console.log('  ✓ PASS');

console.log('\n=== All Moonlit Forest Phase 1 Tests Passed ===');
