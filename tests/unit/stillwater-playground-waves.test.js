import {
    existsSync,
    readFileSync,
    statSync,
} from 'node:fs';
import { describe, expect, it } from 'vitest';

const compositionSource = readFileSync(
    new URL('../../src/playground/effects/stillwater-composition.effect.js', import.meta.url),
    'utf8',
);
const compositionExecutableSource = compositionSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const waterSource = readFileSync(
    new URL('../../src/playground/effects/stillwater-water.effect.js', import.meta.url),
    'utf8',
);
const waterExecutableSource = waterSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const playgroundSource = readFileSync(
    new URL('../../src/playground/main.js', import.meta.url),
    'utf8',
);
const playgroundReadme = readFileSync(
    new URL('../../src/playground/README.md', import.meta.url),
    'utf8',
);
const conceptImageUrl = new URL(
    '../../public/playground-refs/stillwater-composition-concept-2026-07.png',
    import.meta.url,
);
const conceptProvenanceUrl = new URL(
    '../../public/playground-refs/stillwater-composition-concept-2026-07.md',
    import.meta.url,
);

function extractMetaId(source) {
    return source.match(/export const meta\s*=\s*\{[\s\S]*?\bid:\s*['"]([^'"]+)['"]/)?.[1];
}

function findReversedNumericSmoothsteps(source) {
    return [...source.matchAll(
        /smoothstep\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/g,
    )]
        .filter((match) => Number(match[1]) > Number(match[2]))
        .map((match) => match[0]);
}

describe('Stillwater Wave 1/2 playground contracts', () => {
    it('keeps unique Wave metadata IDs on the WebGPU/TSL surface contract', () => {
        const sources = [compositionSource, waterSource];
        const ids = sources.map(extractMetaId);

        expect(ids).toEqual(['stillwater-composition', 'stillwater-water']);
        expect(new Set(ids).size).toBe(ids.length);
        sources.forEach((source) => {
            expect(source).toMatch(
                /import\s+\*\s+as\s+THREE\s+from\s+['"]three\/webgpu['"]/,
            );
            expect(source).toMatch(/from\s+['"]three\/tsl['"]/);
            expect(source).not.toMatch(/from\s+['"]three['"]/);
        });
    });

    it('locks the Wave 1 layout, board guide, reference, and peripheral proxy anchors', () => {
        expect(compositionSource).toContain('LAYOUT_RECTS');
        expect(compositionSource).toContain('LAYOUT_ANCHORS');
        expect(compositionSource).toContain("params?.get?.('layout')");
        expect(compositionSource).toContain("params?.get?.('boardGuide') === '1'");
        expect(compositionSource).toContain(
            "'/playground-refs/stillwater-composition-concept-2026-07.png'",
        );
        expect(compositionSource).toContain("spirit.name = 'stillwater-spirit-placeholder-left'");
        expect(compositionSource).toContain("troll.name = 'stillwater-troll-placeholder-right'");
        expect(compositionSource).toContain('window.__STILLWATER_COMPOSITION__ = debugApi');
        expect(compositionSource).toContain('anchors: {');
        expect(compositionSource).toContain('anchorScreens');
        expect(compositionSource).toContain('boardClear:');
        expect(compositionSource).toContain('projectObjectBounds(');
        expect(compositionSource).toContain('boardRects:');
        expect(compositionSource).toContain('if (side < 0)');
    });

    it('keeps the composition blockout free of particles and post-processing', () => {
        expect(compositionExecutableSource).not.toMatch(
            /new\s+THREE\.Points\b|THREE\.PointsNodeMaterial\b/,
        );
        expect(compositionExecutableSource).not.toMatch(
            /THREE\.PostProcessing\b|\bbloom\s*\(|\bpass\s*\(/,
        );
    });

    it('keeps the Wave 1 numeric smoothstep edges ordered', () => {
        expect(findReversedNumericSmoothsteps(compositionSource)).toEqual([]);
    });

    it('gates High/Low and auto/off reflection paths before constructing them', () => {
        expect(waterSource).toContain('const REFLECTOR_SCALE = 0.45;');
        expect(waterSource).toContain("params?.get?.('quality')");
        expect(waterSource).toContain("? 'Low' : 'High'");
        expect(waterSource).toContain("params?.get?.('reflection') || 'auto'");
        expect(waterSource).toContain("['0', 'off', 'false', 'no'].includes(raw)");
        expect(waterSource).toContain("if (reflectionRequest !== 'off')");
        expect(waterSource).toContain("if (reflectionMode === 'reflector')");
        expect(waterSource).toContain("else if (reflectionMode === 'analytic')");
        expect(waterSource).toContain('reflector({');
        expect(waterSource).toContain('let analyticReflection = skyReflection');
    });

    it('keeps MaterialX flow, the board calm mask, grade preview, and diagnostics explicit', () => {
        expect(waterSource).toContain('mx_noise_vec3 as materialXNoiseVec3');
        expect(waterSource).toContain('mx_worley_noise_float as materialXWorley');
        expect(waterSource).toMatch(/\bmaterialXNoiseVec3\s*\(/);
        expect(waterSource).toMatch(/\bmaterialXWorley\s*\(/);
        expect(waterSource).toContain('const calmMask = smoothstep(');
        expect(waterSource).toContain('const post = new THREE.PostProcessing(renderer);');
        expect(waterSource).toContain('toneMapping(THREE.ACESFilmicToneMapping');
        expect(waterSource).toContain('post.outputColorTransform = false;');
        expect(waterSource).toContain('window.__STILLWATER_WATER__ = debugApi;');
        expect(waterSource).toContain('getDiagnostics: () => ({ ...diagnostics })');
        expect(waterSource).toContain('materialXFlow: true');
        expect(waterSource).toContain('calmMask: true');
        expect(waterSource).toContain('const gradeMode = readGrade(params);');
        expect(waterSource).toContain("'ACES-1.0-only'");
        expect(waterSource).toContain("'ACES-1.0-teal-shadow-warm-highlight'");
    });

    it('keeps the lake bed visible and owns pass resources and unavailable counters honestly', () => {
        expect(waterSource).toContain('function makeTerrainGeometry()');
        expect(waterSource).toContain('shape.holes.push(lakeHole)');
        expect(waterSource).toContain('function makeLakeCollarGeometry(');
        expect(waterSource).toContain('skyMaterial.fog = false;');
        expect(waterSource).toContain('scenePass.dispose?.();');
        expect(waterSource).toContain('waterMaterial.side = THREE.FrontSide');
        expect(waterSource).not.toContain('waterMaterial.side = THREE.DoubleSide');
        expect(waterSource).toContain(
            'programs: renderer.info?.programs ? renderer.info.programs.length : null',
        );
    });

    it('defers raw shader, compute feedback, and wake-slot implementation beyond Wave 2', () => {
        expect(waterExecutableSource).not.toMatch(/\b(?:glslFn|wgslFn)\s*\(/);
        expect(waterExecutableSource).not.toMatch(
            /\b(?:vertexShader|fragmentShader)\s*:|THREE\.ShaderMaterial\b/,
        );
        expect(waterExecutableSource).not.toMatch(
            /renderer\.(?:compute|computeAsync)\s*\(|\b(?:storage|instancedArray)\s*\(/,
        );
        expect(waterExecutableSource).not.toMatch(
            /\b(?:createWake|updateWake|WAKE_SLOT_COUNT|uWake\w*|wakeSlots?)\s*=/,
        );
        expect(waterSource).toContain('wakeSlots: 0');
        expect(waterSource).toContain('computeFeedback: false');
    });

    it('keeps the Wave 2 numeric smoothstep edges ordered', () => {
        expect(findReversedNumericSmoothsteps(waterSource)).toEqual([]);
    });

    it('keeps the generated composition reference and provenance together', () => {
        expect(existsSync(conceptImageUrl)).toBe(true);
        expect(existsSync(conceptProvenanceUrl)).toBe(true);
        expect(statSync(conceptImageUrl).size).toBeGreaterThan(100_000);

        const pngSignature = readFileSync(conceptImageUrl).subarray(0, 8).toString('hex');
        const provenance = readFileSync(conceptProvenanceUrl, 'utf8');
        expect(pngSignature).toBe('89504e470d0a1a0a');
        expect(provenance).toContain('Stillwater composition concept provenance');
        expect(provenance).toContain('Tool: Codex built-in image generation');
        expect(provenance).toContain('Third-party image inputs: none');
    });

    it('keeps GPU timestamp queries explicit and opt-in in the playground', () => {
        expect(playgroundReadme).toContain('`trackTimestamp=1`');
        expect(playgroundReadme).toContain('`profile=1`');
        expect(playgroundSource).toContain(
            'const trackTimestamp = profileEnabled && timestampRequested;',
        );
        expect(playgroundSource).toContain('if (profileEnabled) resetProfile();');
        expect(playgroundSource).toContain(
            'new THREE.WebGPURenderer({ antialias: true, forceWebGL, trackTimestamp })',
        );
        expect(playgroundSource).toContain("renderer.resolveTimestampsAsync('render')");
        expect(playgroundSource).toContain('profile: {');
        expect(playgroundSource).toContain('snapshot: profileSnapshot');
    });
});
