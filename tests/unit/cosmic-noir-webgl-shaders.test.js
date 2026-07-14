import { describe, expect, it } from 'vitest';
import {
    gasSwirlVertexShader,
    voidSparkVertexShader,
} from '../../src/themes/cosmic-noir/cosmic-noir-shaders.js';

describe('Cosmic Noir WebGL fallback shaders', () => {
    it.each([
        ['void spark', voidSparkVertexShader],
        ['gas swirl', gasSwirlVertexShader],
    ])('avoids the reserved active identifier in the %s vertex shader', (_name, shader) => {
        expect(shader).not.toMatch(/\bactive\b/);
        expect(shader).toMatch(
            /float activeMask = step\(0\.0, rawAge\) \* \(1\.0 - step\(aLife, rawAge\)\);/,
        );
    });

    it('keeps the void-spark lifetime mask wired to position, alpha, and size', () => {
        expect(voidSparkVertexShader.match(/\bactiveMask\b/g)).toHaveLength(4);
        expect(voidSparkVertexShader).toContain(
            'float alpha = pow(1.0 - lifeNorm, 0.45) * activeMask;',
        );
        expect(voidSparkVertexShader).toContain(
            'float size = aSize * (1.2 - lifeNorm * 0.8) * activeMask;',
        );
    });

    it('keeps the gas-swirl lifetime mask wired to fade and point size', () => {
        expect(gasSwirlVertexShader.match(/\bactiveMask\b/g)).toHaveLength(3);
        expect(gasSwirlVertexShader).toContain(
            'float fade = pow(1.0 - lifeNorm, 0.3) * activeMask;',
        );
        expect(gasSwirlVertexShader).toContain(
            'gl_PointSize = aSize * (1.0 - lifeNorm * 0.45) * activeMask * (320.0 / -mvPosition.z);',
        );
    });
});
