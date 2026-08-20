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
const waterAdapterSource = readFileSync(
    new URL('../../src/playground/effects/stillwater-water.effect.js', import.meta.url),
    'utf8',
);
const waterSource = readFileSync(
    new URL('../../src/themes/stillwater/rendering/stillwater-water.js', import.meta.url),
    'utf8',
);
const waterExecutableSource = waterSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const waterResponseAdapterSource = readFileSync(
    new URL('../../src/playground/effects/stillwater-water-response.js', import.meta.url),
    'utf8',
);
const waterResponseSource = readFileSync(
    new URL(
        '../../src/themes/stillwater/sim/stillwater-water-response.js',
        import.meta.url,
    ),
    'utf8',
);
const waterResponseExecutableSource = waterResponseSource
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

describe('Stillwater Wave 1/2/3 playground contracts', () => {
    it('keeps unique Wave metadata IDs on the WebGPU/TSL surface contract', () => {
        const sources = [compositionSource, waterAdapterSource];
        const ids = sources.map(extractMetaId);

        expect(ids).toEqual(['stillwater-composition', 'stillwater-water']);
        expect(new Set(ids).size).toBe(ids.length);
        [compositionSource, waterSource].forEach((source) => {
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
            /THREE\.(?:PostProcessing|RenderPipeline)\b|\bbloom\s*\(|\bpass\s*\(/,
        );
    });

    it('keeps the Wave 1 numeric smoothstep edges ordered', () => {
        expect(findReversedNumericSmoothsteps(compositionSource)).toEqual([]);
    });

    it('gates High/Low and auto/off reflection paths before constructing them', () => {
        expect(waterSource).toContain('getStillwaterQualityProfile');
        // The quality profile remains the SOURCE of the reflector scale; the
        // `?reflectScale=` override exists only so the cost of the reflector can
        // be measured against a baseline, and the profile is its fallback.
        expect(waterSource).toContain(
            'reflectorScale: readReflectScale(params, qualityProfile.reflectionScale)',
        );
        expect(waterSource).toContain('responseSlots: Math.max(4, qualityProfile.wakeSlots)');
        expect(waterSource).toContain("params?.get?.('quality')");
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
        expect(waterSource).toContain('post = new THREE.RenderPipeline(renderer);');
        expect(waterSource).toContain('if (postEnabled)');
        expect(waterSource).toContain('toneMapping(THREE.ACESFilmicToneMapping');
        expect(waterSource).toContain('post.outputColorTransform = false;');
        expect(waterAdapterSource).toContain('window.__STILLWATER_WATER__ = debugApi;');
        expect(waterSource).toContain('const getDiagnostics = () => {');
        expect(waterSource).toContain('if (premiumFlow)');
        expect(waterSource).toContain("'materialx-broad-analytic-warp'");
        expect(waterSource).toContain("'materialx-domain-warp'");
        expect(waterSource).toContain("'layered-analytic-sine'");
        expect(waterSource).toContain('materialXFlow: premiumFlow');
        expect(waterSource).toContain('calmMask: true');
        expect(waterSource).toContain('const gradeMode = readGrade(params);');
        expect(waterSource).toContain("'ACES-1.0-only'");
        expect(waterSource).toContain("'ACES-1.0-teal-shadow-warm-highlight'");
    });

    it('keeps the lake bed visible and owns pass resources and unavailable counters honestly', () => {
        expect(waterSource).toContain('function makeTerrainGeometry()');
        // The banks used to be a flat plate with a lake-shaped hole punched in
        // it, which read as a diorama and left the far shore fully visible. They
        // are now contoured ribbons running alongside an open channel. The
        // invariant that still matters is that both the banks and the lake are
        // driven by the one shared shoreline sampler, so terrain can never
        // creep over the bed.
        expect(waterSource).toContain('export function sampleShore(');
        expect(waterSource).toContain('const section = bankSection(t);');
        expect(waterSource).toContain('function makeLakeCollarGeometry(');
        expect(waterSource).toContain('skyMaterial.fog = false;');
        expect(waterSource).toContain('scenePass?.dispose?.();');
        expect(waterSource).toContain('waterMaterial.side = THREE.FrontSide');
        expect(waterSource).not.toContain('waterMaterial.side = THREE.DoubleSide');
        expect(waterSource).toContain(
            "reflectionNode.reflector.getRenderTarget(reflectionCamera).texture.name = 'output'",
        );
        expect(waterSource).toContain('moonMaterial.depthTest = false;');
        expect(waterSource).toContain('moon.renderOrder = 2;');
        expect(waterSource).toContain('moonHaloMaterial.depthTest = false;');
        expect(waterSource).toContain('moonHalo.renderOrder = 1;');
        expect(waterSource).toContain(
            'programs: renderer.info?.programs ? renderer.info.programs.length : null',
        );
    });

    it('keeps Wave 3 fixed-slot responses TSL-only, preallocated, and compute-free', () => {
        expect(waterExecutableSource).not.toMatch(/\b(?:glslFn|wgslFn)\s*\(/);
        expect(waterExecutableSource).not.toMatch(
            /\b(?:vertexShader|fragmentShader)\s*:|THREE\.ShaderMaterial\b/,
        );
        expect(waterExecutableSource).not.toMatch(
            /renderer\.(?:compute|computeAsync)\s*\(|\b(?:storage|instancedArray)\s*\(/,
        );
        expect(waterSource).toContain('uniformArray(responseBindings.stateValues');
        expect(waterSource).toContain('uniformArray(responseBindings.shapeValues');
        expect(waterSource).toContain('const uResponseActivity = responseBindings ? uniform(0)');
        expect(waterSource).toContain('const uResponseMode = responseBindings');
        expect(waterSource).toContain('responseState.getActiveMode(time)');
        expect(waterSource).toContain('const makeOpticalResponseField = Fn(');
        expect(waterSource).toContain(
            'const makeDisplacementResponseHeight = Fn(',
        );
        expect(waterSource).toContain(
            'makeResponseTerms(samplePosition, false, {',
        );
        expect(waterSource).toContain(
            'makeResponseTerms(samplePosition, true)',
        );
        expect(waterSource).toContain('height.assign(response.height)');
        expect(waterSource).toContain('If(uResponseActivity.greaterThan(0)');
        expect(waterSource).toContain(
            'uResponseMode.equal(STILLWATER_RESPONSE_KIND.lock)',
        );
        expect(waterSource).toContain(
            'uResponseMode.equal(STILLWATER_RESPONSE_KIND.tetris)',
        );
        expect(waterSource).toContain(
            'uResponseMode.equal(STILLWATER_RESPONSE_KIND.tspin)',
        );
        expect(waterSource).toContain('.ElseIf(');
        expect(waterSource).toContain('const height = float(0).toVar()');
        expect(waterSource).toContain("fragmentResponse?.get('slope')");
        expect(waterSource).toContain('responseGraphActive:');
        expect(waterSource).toContain('responseGraphMode:');
        expect(waterSource).toContain(
            'responseGraphModel = leanResponseGraph',
        );
        expect(waterSource).toContain(
            'const leanResponseGraph = qualityProfile.wakeSlots > 0',
        );
        expect(waterSource).toContain(
            'const TETRIS_DEPTH_WAKE_OFFSETS = Object.freeze([-4.5, -1.5, 1.5, 4.5])',
        );
        expect(waterSource).toContain('reservedSpecialSlot: responsesEnabled ? 0 : null');
        expect(waterSource).toContain('TETRIS_DEPTH_WAKE_OFFSETS.length');
        expect(waterSource).toContain('waterMaterial.positionNode = positionLocal.add(');
        expect(waterSource).toContain('waterMaterial.emissiveNode = responseLight');
        expect(waterSource).toContain("params?.get?.('event') || 'idle'");
        expect(waterSource).toContain("readToggle(params, 'responses', true)");
        expect(waterSource).toContain('triggerReaction: (type, options)');
        expect(waterSource).toContain('getResponseState');
        expect(waterSource).toContain('getResourceState');
        expect(waterResponseSource).toContain('const stateValues = Array.from(');
        expect(waterResponseSource).toContain('const shapeValues = Array.from(');
        expect(waterResponseSource).toContain('let routineCursor = 1;');
        expect(waterResponseSource).toContain('function getActiveMode(time)');
        expect(waterResponseExecutableSource).not.toMatch(
            /\bnew\s+THREE\.(?:Mesh|BufferGeometry|Material)\b/,
        );
        expect(waterResponseExecutableSource).not.toMatch(/\.(?:push|splice|shift|unshift)\s*\(/);
        expect(waterSource).toContain('computeFeedback: false');
    });

    it('keeps production ownership behind thin playground compatibility adapters', () => {
        expect(waterSource).toContain('export function createStillwaterWater(');
        expect(waterSource).not.toContain('export const meta');
        expect(waterSource).not.toContain('window.__STILLWATER_WATER__');
        expect(waterAdapterSource).toContain(
            "from '../../themes/stillwater/rendering/stillwater-water.js'",
        );
        expect(waterAdapterSource).toContain('const runtime = createStillwaterWater(context)');
        expect(waterAdapterSource).not.toContain('new THREE.');
        expect(waterResponseAdapterSource).toContain(
            "from '../../themes/stillwater/sim/stillwater-water-response.js'",
        );
        expect(waterResponseAdapterSource).not.toContain('function createPackedVector');
    });

    it('keeps the Wave 3 numeric smoothstep edges ordered', () => {
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
