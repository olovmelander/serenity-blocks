/**
 * Dual-state theme tripwire (plan Phase 3c.5 / Phase 7).
 *
 * 19 themes deliberately maintain BOTH a live TSL path (WebGPURenderer) and a
 * GLSL ShaderMaterial fallback twin — the Phase 7 program retires the GLSL
 * branch theme by theme. This tripwire pins the set so it can only SHRINK
 * deliberately: a theme entering the mixed state (new GLSL in a TSL theme, or
 * a WebGPURenderer added to a GLSL theme) fails CI.
 *
 * Measured convention: renderer constructions use arbitrary namespace prefixes
 * (THREE.WebGPURenderer, THREE_WEBGPU.WebGPURenderer, WEBGPU_MODULE. ...), and
 * ShaderMaterial evidence often lives in sibling files — scan whole theme dirs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Phase 7 batch order (plan §7.2) — delete a name here when its GLSL twin is
// retired. NEVER add a name: that is a new dual-maintenance burden.
const DUAL_STATE_ALLOWLIST = [
    'astral-weave', 'black-hole', 'chiral-gold', 'chromadelic-highway',
    'cosmic-noir', 'electric-dreams', 'fluid-dreams', 'ice-temple', 'lunara',
    'moonlit-forest', 'neon-district', 'neon-dusk', 'ocean', 'stellar-drift',
    'stellar-velocity', 'swedish-forest', 'synthwave-sunset', 'winter', 'wolfhour',
];

const WEBGPU_RE = /new\s+[\w$.]*WebGPURenderer\s*\(/;
const SHADER_RE = /new\s+[\w$.]*ShaderMaterial\s*\(/;

function measureDualStateThemes() {
    const files = execFileSync('git', ['ls-files', 'src/themes/**/*.js', 'src/themes/**/*.ts'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n').filter(Boolean).map((f) => f.replace(/\\/g, '/'));
    const byTheme = new Map();
    for (const file of files) {
        const themeId = file.split('/')[2];
        if (!themeId || !file.split('/')[3]) continue; // top-level files (theme-manager etc.)
        const src = readFileSync(path.join(repoRoot, file), 'utf8');
        const entry = byTheme.get(themeId) || { webgpu: false, shader: false };
        if (WEBGPU_RE.test(src)) entry.webgpu = true;
        if (SHADER_RE.test(src)) entry.shader = true;
        byTheme.set(themeId, entry);
    }
    return [...byTheme.entries()].filter(([, e]) => e.webgpu && e.shader).map(([id]) => id).sort();
}

describe('dual-state theme tripwire (Phase 7 allowlist)', () => {
    it('the dual-state set equals the committed allowlist (shrink-only)', () => {
        const measured = measureDualStateThemes();
        const entered = measured.filter((id) => !DUAL_STATE_ALLOWLIST.includes(id));
        expect(entered, 'theme ENTERED the dual GLSL/TSL state — retire one path instead').toEqual([]);
        const retired = DUAL_STATE_ALLOWLIST.filter((id) => !measured.includes(id));
        expect(retired, 'GLSL twin retired — delete the name from DUAL_STATE_ALLOWLIST to lock it in').toEqual([]);
    });
});
