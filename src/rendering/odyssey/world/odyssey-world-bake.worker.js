/* eslint-disable no-restricted-globals -- `self` is the Worker global scope */
/**
 * One World boot-bake Worker (plan item 2.1, 2026-08-21). Runs the five texture bakes and the
 * cloud-field sculpt — all deterministic typed-array work — off the main thread and posts each
 * stage as it lands (relief first: every terrain consumer hangs off its height mirror) with the
 * buffers in the transfer list. Imports 'three' CORE only (DataUtils, IcosahedronGeometry), never
 * 'three/webgpu'. The main-thread twin is odyssey-world-bake-loader.js's synchronous fallback,
 * which runs the very same functions, so both paths are one code path (golden suite).
 *
 * Protocol: main → { reliefRes, shadowRes, cloudSpecs, railSamples, cloudField }.
 *           worker → { stage: 'relief'|'textures'|'cloudField', ...data, ms } then { stage: 'done', ms }.
 *           errors → { stage: 'error', message }.
 */

import {
    bakeReliefData, bakeGroundSunFieldsData, bakeGroundAtlasData, bakeDetailNormalData, bakeMacroData,
    makeReliefSampler,
} from './odyssey-world-bake-data.js';
import { buildCloudFieldGeometryData, cloudFieldGeometryDataBuffers } from './odyssey-cloud-field.js';

const now = () => performance.now();

self.onmessage = (event) => {
    const {
        reliefRes, shadowRes, cloudSpecs = null, railSamples = null, cloudField = false,
    } = event.data || {};
    const t0 = now();
    try {
        const relief = bakeReliefData(reliefRes);
        const t1 = now();
        // `total` is needed again below (sun fields), so post a copy and keep ours.
        self.postMessage({
            stage: 'relief',
            relief: {
                data: relief.data, total: relief.total.slice(), res: relief.res, step: relief.step, origin: relief.origin,
            },
            ms: +(t1 - t0).toFixed(1),
        }, [relief.data.buffer]);
        const sample = makeReliefSampler(relief);
        const sunFields = bakeGroundSunFieldsData(sample, shadowRes);
        const t2 = now();
        const atlas = bakeGroundAtlasData();
        const t3 = now();
        const detail = bakeDetailNormalData();
        const t4 = now();
        const macro = bakeMacroData();
        const t5 = now();
        self.postMessage({
            stage: 'textures',
            sunFields,
            atlas,
            detail,
            macro,
            ms: {
                sunFields: +(t2 - t1).toFixed(1), atlas: +(t3 - t2).toFixed(1), detail: +(t4 - t3).toFixed(1), macro: +(t5 - t4).toFixed(1),
            },
        }, [
            sunFields.data.buffer, atlas.data.buffer, ...atlas.fields.map((f) => f.buffer),
            detail.data.buffer, macro.data.buffer,
        ]);
        if (cloudField && Array.isArray(cloudSpecs)) {
            const field = buildCloudFieldGeometryData(cloudSpecs, railSamples);
            const t6 = now();
            self.postMessage({ stage: 'cloudField', field, ms: +(t6 - t5).toFixed(1) }, cloudFieldGeometryDataBuffers(field));
        }
        self.postMessage({ stage: 'done', ms: +(now() - t0).toFixed(1) });
    } catch (error) {
        self.postMessage({ stage: 'error', message: String(error?.message || error) });
    }
};
