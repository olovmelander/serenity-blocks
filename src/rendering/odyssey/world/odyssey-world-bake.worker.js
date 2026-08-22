/* eslint-disable no-restricted-globals -- `self` is the Worker global scope */
/**
 * One World boot-bake Worker (plan item 2.1, 2026-08-21). Runs the five texture bakes and the
 * cloud-field sculpt — all deterministic typed-array work — off the main thread and posts each
 * stage as it lands (relief first: every terrain consumer hangs off its height mirror) with the
 * buffers in the transfer list. Imports 'three' CORE only (DataUtils, IcosahedronGeometry), never
 * 'three/webgpu'. The main-thread twin is odyssey-world-bake-loader.js's synchronous fallback,
 * which runs the very same functions, so both paths are one code path (golden suite).
 *
 * ONE worker instance runs ONE lane (item 2.4, 2026-08-21): with the startup's CPU steps no
 * longer costing ~1 s of yield latency, a single serial worker (~1.8 s) became the critical path
 * and the world step waited on it. The loader now starts three lanes in parallel —
 * `terrain` (relief → sunFields, the only real dependency), `plates` (atlas, detail, macro) and
 * `cloudField` — so the wall time is the longest lane, not the sum.
 *
 * Protocol: main → { lane, reliefRes, shadowRes, cloudSpecs, railSamples }.
 *           worker → { stage: 'relief'|'sunFields'|'atlas'|'detail'|'macro'|'cloudField', … , ms }
 *                    then { stage: 'done', lane, ms }.
 *           errors → { stage: 'error', lane, message }.
 */

import {
    bakeReliefData, bakeReliefBand, bakeGroundSunFieldsData, bakeGroundAtlasData, bakeDetailNormalData,
    bakeMacroData, makeReliefSampler,
} from './odyssey-world-bake-data.js';
import { buildCloudFieldGeometryData, cloudFieldGeometryDataBuffers } from './odyssey-cloud-field.js';

const now = () => performance.now();

/** Time one bake and post its stage message with the buffers transferred. */
function post(stage, payload, transfer, ms) {
    self.postMessage({ stage, ...payload, ms: +ms.toFixed(1) }, transfer);
}

self.onmessage = (event) => {
    const {
        lane = 'all', reliefRes, shadowRes, cloudSpecs = null, railSamples = null,
        jStart = 0, jEnd = 0, relief: reliefIn = null,
    } = event.data || {};
    const t0 = now();
    try {
        if (lane === 'reliefBand') {
            // One horizontal band of the relief bake (the plate splits per texel).
            const band = bakeReliefBand(reliefRes, jStart, jEnd);
            post('reliefBand', { band }, [band.data.buffer, band.total.buffer], now() - t0);
        }
        if (lane === 'sunFields') {
            // The sun march needs the WHOLE plate (and normalises over it), so it stays one job;
            // the main thread hands it the merged height mirror.
            const sunFields = bakeGroundSunFieldsData(makeReliefSampler(reliefIn), shadowRes);
            post('sunFields', { sunFields }, [sunFields.data.buffer], now() - t0);
        }
        if (lane === 'terrain' || lane === 'all') {
            const relief = bakeReliefData(reliefRes);
            const t1 = now();
            // `total` is needed again below (sun fields), so post a copy and keep ours.
            post('relief', {
                relief: {
                    data: relief.data,
                    total: relief.total.slice(),
                    res: relief.res,
                    step: relief.step,
                    origin: relief.origin,
                },
            }, [relief.data.buffer], t1 - t0);
            const sunFields = bakeGroundSunFieldsData(makeReliefSampler(relief), shadowRes);
            post('sunFields', { sunFields }, [sunFields.data.buffer], now() - t1);
        }
        if (lane === 'plates' || lane === 'all') {
            const t1 = now();
            const atlas = bakeGroundAtlasData();
            const t2 = now();
            post('atlas', { atlas }, [atlas.data.buffer, ...atlas.fields.map((f) => f.buffer)], t2 - t1);
            const detail = bakeDetailNormalData();
            const t3 = now();
            post('detail', { detail }, [detail.data.buffer], t3 - t2);
            const macro = bakeMacroData();
            post('macro', { macro }, [macro.data.buffer], now() - t3);
        }
        if ((lane === 'cloudField' || lane === 'all') && Array.isArray(cloudSpecs)) {
            const t1 = now();
            const field = buildCloudFieldGeometryData(cloudSpecs, railSamples);
            post('cloudField', { field }, cloudFieldGeometryDataBuffers(field), now() - t1);
        }
        self.postMessage({ stage: 'done', lane, ms: +(now() - t0).toFixed(1) });
    } catch (error) {
        self.postMessage({ stage: 'error', lane, message: String(error?.message || error) });
    }
};
