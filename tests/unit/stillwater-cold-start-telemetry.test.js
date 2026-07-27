import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import StillwaterTheme from '../../src/themes/stillwater/stillwater-theme.js';
import {
    createStillwaterCharacters,
} from '../../src/themes/stillwater/rendering/stillwater-characters.js';
import {
    evaluateColdActivationTelemetry,
} from '../../scripts/stillwater-wave8-validation.mjs';

const validationHarnessSource = readFileSync(
    new URL('../../scripts/stillwater-wave8-validation.mjs', import.meta.url),
    'utf8',
);
const themeSource = readFileSync(
    new URL('../../src/themes/stillwater/stillwater-theme.js', import.meta.url),
    'utf8',
);

function createLongTaskObserverHarness() {
    const instances = [];
    class MockPerformanceObserver {
        static supportedEntryTypes = ['longtask'];

        constructor(callback) {
            this.callback = callback;
            this.records = [];
            this.disconnect = vi.fn();
            this.observe = vi.fn();
            this.takeRecords = vi.fn(() => this.records.splice(0));
            instances.push(this);
        }

        emit(entries) {
            this.callback({ getEntries: () => entries });
        }
    }
    return { instances, MockPerformanceObserver };
}

function createTrollGltf() {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(
        new THREE.BoxGeometry(1, 2, 1),
        new THREE.MeshStandardMaterial(),
    ));
    return { animations: [], scene };
}

function createValidColdActivationTelemetry() {
    return {
        clock: 'performance.now',
        activationToRevealMs: 180,
        milestones: {
            sceneStart: { timestampMs: 100, elapsedMs: 0 },
            rendererReady: { timestampMs: 120, elapsedMs: 20 },
            runtimeConstructed: { timestampMs: 140, elapsedMs: 40 },
            criticalHeroReady: { timestampMs: 180, elapsedMs: 80 },
            targetHeroReady: { timestampMs: 230, elapsedMs: 130 },
            warmRenderComplete: { timestampMs: 260, elapsedMs: 160 },
            canvasReveal: { timestampMs: 280, elapsedMs: 180 },
        },
        heroGltf: {
            measurement: 'combined GLTF load + parse/attach',
            gpuUploadMeasured: false,
            clock: 'performance.now',
            loads: {
                low: {
                    status: 'ready',
                    startedAtMs: 125,
                    completedAtMs: 175,
                    combinedLoadParseAttachMs: 50,
                },
                high: {
                    status: 'ready',
                    startedAtMs: 185,
                    completedAtMs: 225,
                    combinedLoadParseAttachMs: 40,
                },
            },
        },
        longTasks: {
            supported: true,
            observing: false,
            postRevealObservationMs: 250,
            count: 0,
            totalDurationMs: 0,
            longestDurationMs: null,
            entries: [],
        },
    };
}

function setColdLongTasks(telemetry, tasks) {
    const sceneStartMs = telemetry.milestones.sceneStart.timestampMs;
    telemetry.longTasks.entries = tasks.map((task) => ({
        entryType: 'longtask',
        name: 'self',
        startTimeMs: task.startTimeMs,
        durationMs: task.durationMs,
        elapsedStartMs: task.startTimeMs - sceneStartMs,
        elapsedEndMs: task.startTimeMs + task.durationMs - sceneStartMs,
    }));
    telemetry.longTasks.count = tasks.length;
    telemetry.longTasks.totalDurationMs = tasks.reduce(
        (total, task) => total + task.durationMs,
        0,
    );
    telemetry.longTasks.longestDurationMs = tasks.length
        ? Math.max(...tasks.map((task) => task.durationMs))
        : null;
    return telemetry;
}

describe('Stillwater validation-only cold-start telemetry', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('records activation milestones and immediate post-reveal Chromium LongTasks', () => {
        vi.useFakeTimers();
        const observerHarness = createLongTaskObserverHarness();
        const now = vi.fn()
            .mockReturnValueOnce(100)
            .mockReturnValue(170);
        vi.stubGlobal('performance', { now });
        vi.stubGlobal(
            'PerformanceObserver',
            observerHarness.MockPerformanceObserver,
        );
        const theme = new StillwaterTheme();
        theme.validationEnabled = true;
        theme.runtimeGeneration = 7;

        theme.beginActivationTelemetry(7);
        theme.recordActivationMilestone('rendererReady', 7, 110);
        theme.recordActivationMilestone('runtimeConstructed', 7, 120);
        theme.recordActivationMilestone('criticalHeroReady', 7, 135);
        theme.recordActivationMilestone('targetHeroReady', 7, 150);
        theme.recordActivationMilestone('warmRenderComplete', 7, 165);
        theme.completeActivationTelemetry(7);

        const [observer] = observerHarness.instances;
        observer.emit([
            {
                entryType: 'longtask',
                name: 'self',
                startTime: 95,
                duration: 20,
            },
            {
                entryType: 'longtask',
                name: 'self',
                startTime: 160,
                duration: 20,
            },
            {
                entryType: 'longtask',
                name: 'after-reveal',
                startTime: 171,
                duration: 60,
            },
        ]);
        observer.records.push({
            entryType: 'longtask',
            name: 'pending-at-reveal',
            startTime: 168,
            duration: 8,
        });
        vi.runOnlyPendingTimers();

        const diagnostics = theme.getActivationTelemetryDiagnostics();
        expect(diagnostics.activationToRevealMs).toBe(70);
        expect(diagnostics.milestones).toMatchObject({
            sceneStart: { timestampMs: 100, elapsedMs: 0 },
            rendererReady: { timestampMs: 110, elapsedMs: 10 },
            runtimeConstructed: { timestampMs: 120, elapsedMs: 20 },
            criticalHeroReady: { timestampMs: 135, elapsedMs: 35 },
            targetHeroReady: { timestampMs: 150, elapsedMs: 50 },
            warmRenderComplete: { timestampMs: 165, elapsedMs: 65 },
            canvasReveal: { timestampMs: 170, elapsedMs: 70 },
        });
        expect(diagnostics.longTasks).toMatchObject({
            supported: true,
            observing: false,
            postRevealObservationMs: 250,
            count: 4,
            totalDurationMs: 108,
            longestDurationMs: 60,
        });
        expect(diagnostics.longTasks.entries[0].elapsedStartMs).toBe(-5);
        expect(diagnostics.measurementNotes.heroGltf).toContain(
            'GPU upload is not measured separately',
        );
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
    });

    it('does no observer or timestamp work when validation is disabled', () => {
        const observerHarness = createLongTaskObserverHarness();
        const now = vi.fn();
        vi.stubGlobal('performance', { now });
        vi.stubGlobal(
            'PerformanceObserver',
            observerHarness.MockPerformanceObserver,
        );
        const theme = new StillwaterTheme();
        theme.validationEnabled = false;

        theme.beginActivationTelemetry(3);

        expect(theme.getActivationTelemetryDiagnostics()).toBeNull();
        expect(observerHarness.instances).toHaveLength(0);
        expect(now).not.toHaveBeenCalled();
    });

    it('disconnects an in-flight LongTask observer during teardown', () => {
        const observerHarness = createLongTaskObserverHarness();
        vi.stubGlobal('performance', { now: vi.fn(() => 100) });
        vi.stubGlobal(
            'PerformanceObserver',
            observerHarness.MockPerformanceObserver,
        );
        const theme = new StillwaterTheme();
        theme.validationEnabled = true;
        theme.runtimeGeneration = 4;
        theme.beginActivationTelemetry(4);
        const [observer] = observerHarness.instances;

        theme.disposeRuntime();

        expect(observer.takeRecords).toHaveBeenCalledTimes(1);
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
        expect(theme.activationLongTaskObserver).toBeNull();
        expect(theme.activationTelemetry).toBeNull();
    });

    it('labels troll timings as combined load plus parse/attach', async () => {
        const timestamps = [10, 25, 30, 60];
        vi.stubGlobal('performance', {
            now: vi.fn(() => timestamps.shift()),
        });
        const loader = {
            loadAsync: vi.fn(async () => createTrollGltf()),
        };
        const root = new THREE.Group();
        const characters = createStillwaterCharacters({
            root,
            profile: {
                name: 'Medium',
                trollLod: 'medium',
                bloom: false,
            },
            mode: 'troll',
            loader,
            telemetryEnabled: true,
        });

        await expect(characters.ready).resolves.toBe(true);

        expect(characters.getDiagnostics().gltfTimings).toEqual({
            measurement: 'combined GLTF load + parse/attach',
            gpuUploadMeasured: false,
            clock: 'performance.now',
            loads: {
                low: {
                    status: 'ready',
                    startedAtMs: 10,
                    completedAtMs: 25,
                    combinedLoadParseAttachMs: 15,
                },
                medium: {
                    status: 'ready',
                    startedAtMs: 30,
                    completedAtMs: 60,
                    combinedLoadParseAttachMs: 30,
                },
            },
        });
        expect(loader.loadAsync).toHaveBeenCalledTimes(2);
        characters.dispose();
    });

    it('accepts one finalized, clock-consistent High-tier activation record', () => {
        const evaluation = evaluateColdActivationTelemetry(
            createValidColdActivationTelemetry(),
            'High',
        );

        expect(evaluation).toMatchObject({
            ok: true,
            milestones: {
                ok: true,
                strictTimestampChronology: true,
                strictElapsedChronology: true,
                elapsedClockAgreement: true,
                activationToRevealConsistent: true,
                clockAgreement: true,
            },
            heroGltf: {
                ok: true,
                expectedLods: ['low', 'high'],
                actualLods: ['high', 'low'],
                exactLoadSet: true,
                loadTimingsValid: true,
                readinessClockAgreement: true,
                clockAgreement: true,
            },
            longTasks: {
                ok: true,
                finalized: true,
            },
        });
        expect(evaluation.canvasRevealEvidence).toContain(
            'not compositor or GPU-present evidence',
        );
    });

    it('allows the shared low-LOD promise to coalesce Minimal hero milestones', () => {
        const telemetry = createValidColdActivationTelemetry();
        delete telemetry.heroGltf.loads.high;
        telemetry.milestones.targetHeroReady = {
            ...telemetry.milestones.criticalHeroReady,
        };

        const evaluation = evaluateColdActivationTelemetry(telemetry, 'Minimal');

        expect(evaluation).toMatchObject({
            ok: true,
            milestones: {
                ok: true,
                strictTimestampChronology: true,
                strictElapsedChronology: true,
                coalescedHeroReadyAllowed: true,
            },
            heroGltf: {
                ok: true,
                targetLod: 'low',
                expectedLods: ['low'],
                actualLods: ['low'],
            },
        });
    });

    it('rejects an observing, out-of-order, or clock-inconsistent activation', () => {
        const telemetry = createValidColdActivationTelemetry();
        telemetry.longTasks.observing = true;
        telemetry.milestones.targetHeroReady = {
            timestampMs: 180,
            elapsedMs: 80,
        };
        telemetry.activationToRevealMs = 181;
        telemetry.heroGltf.clock = 'Date.now';

        const evaluation = evaluateColdActivationTelemetry(telemetry, 'High');

        expect(evaluation.ok).toBe(false);
        expect(evaluation.longTasks).toMatchObject({
            ok: false,
            finalized: false,
        });
        expect(evaluation.milestones).toMatchObject({
            ok: false,
            strictTimestampChronology: false,
            strictElapsedChronology: false,
            activationToRevealConsistent: false,
        });
        expect(evaluation.heroGltf).toMatchObject({
            ok: false,
            clockAgreement: false,
        });
    });

    it('accepts recorded LongTasks that finish while the canvas is DOM-masked', () => {
        const telemetry = setColdLongTasks(
            createValidColdActivationTelemetry(),
            [{ startTimeMs: 130, durationMs: 100 }],
        );

        const evaluation = evaluateColdActivationTelemetry(telemetry, 'High');

        expect(evaluation.ok).toBe(true);
        expect(evaluation.longTasks).toMatchObject({
            ok: true,
            count: 1,
            summaryConsistent: true,
            recordComplete: true,
            unmaskedClean: true,
            preRevealMaskedCount: 1,
            overlapsRevealCount: 0,
            postRevealCount: 0,
            unmaskedCount: 0,
        });
        expect(evaluation.longTasks.acceptanceRule).toContain(
            'retained as diagnostics',
        );
    });

    it('rejects LongTasks that cross or start after the DOM reveal boundary', () => {
        const telemetry = setColdLongTasks(
            createValidColdActivationTelemetry(),
            [
                { startTimeMs: 260, durationMs: 30 },
                { startTimeMs: 285, durationMs: 60 },
            ],
        );

        const evaluation = evaluateColdActivationTelemetry(telemetry, 'High');

        expect(evaluation.ok).toBe(false);
        expect(evaluation.longTasks).toMatchObject({
            ok: false,
            count: 2,
            summaryConsistent: true,
            recordComplete: true,
            unmaskedClean: false,
            preRevealMaskedCount: 0,
            overlapsRevealCount: 1,
            postRevealCount: 1,
            unmaskedCount: 2,
        });
        expect(evaluation.longTasks.classifications).toEqual([
            expect.objectContaining({
                visibility: 'overlaps-reveal-unmasked',
            }),
            expect.objectContaining({
                visibility: 'post-reveal-unmasked',
            }),
        ]);
    });

    it('requires exactly the low and configured target LOD timing records', () => {
        const unexpectedLoad = createValidColdActivationTelemetry();
        unexpectedLoad.heroGltf.loads.medium = {
            status: 'ready',
            startedAtMs: 190,
            completedAtMs: 220,
            combinedLoadParseAttachMs: 30,
        };
        const missingTiming = createValidColdActivationTelemetry();
        delete missingTiming.heroGltf.loads.high.startedAtMs;

        const unexpectedEvaluation = evaluateColdActivationTelemetry(
            unexpectedLoad,
            'High',
        );
        const missingEvaluation = evaluateColdActivationTelemetry(
            missingTiming,
            'High',
        );

        expect(unexpectedEvaluation.heroGltf).toMatchObject({
            ok: false,
            exactLoadSet: false,
            expectedLods: ['low', 'high'],
            actualLods: ['high', 'low', 'medium'],
        });
        expect(missingEvaluation.heroGltf).toMatchObject({
            ok: false,
            exactLoadSet: true,
            loadTimingsValid: false,
        });
    });

    it('preserves the complete activation record outside truncated graph diagnostics', () => {
        const revealDeferral = themeSource.indexOf(
            'await new Promise((resolve) => {',
        );
        const opacityReveal = themeSource.indexOf(
            "this.renderer.domElement.style.opacity = '1';",
        );
        expect(revealDeferral).toBeGreaterThan(-1);
        expect(opacityReveal).toBeGreaterThan(revealDeferral);
        expect(validationHarnessSource).toContain(
            'activationTelemetry = activation',
        );
        expect(validationHarnessSource).toContain(
            'activationTelemetry,',
        );
        expect(validationHarnessSource).toContain(
            'JSON.parse(JSON.stringify(activation))',
        );
        expect(validationHarnessSource).toContain(
            "'## Activation milestones'",
        );
        expect(validationHarnessSource).toContain(
            'combined load + parse/attach',
        );
        expect(validationHarnessSource).toContain(
            "'cold_activation_telemetry_complete'",
        );
        expect(validationHarnessSource).toContain(
            "'cold_activation_longtask_observer_finalized'",
        );
        expect(validationHarnessSource).toContain(
            "'cold_activation_unmasked_longtask_clean'",
        );
        expect(validationHarnessSource).toContain(
            'longTasks.observing === false',
        );
        expect(validationHarnessSource).toContain(
            'not compositor or GPU-present evidence',
        );
        expect(validationHarnessSource).toContain(
            'Pre-reveal masked LongTasks are retained as diagnostics',
        );
        expect(validationHarnessSource).toContain(
            'Unmasked-by-DOM-boundary LongTasks',
        );
        expect(validationHarnessSource).toContain(
            '{ enforceCalibratedBaseline: true }',
        );
        expect(validationHarnessSource).toContain(
            'const reactionBudget = evaluateFrameBudget(reactionSummary);',
        );
    });
});
