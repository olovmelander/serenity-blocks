/** One-shot terrain preparation. Only transferable numeric buffers leave this worker. */
import { bakeTerrain } from './painted-ages-bake.js';

globalThis.onmessage = ({ data: options }) => {
    try {
        const bake = bakeTerrain(options);
        delete bake.heightAt;
        const buffers = new Set();
        const collect = (value) => {
            if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
            else if (value && typeof value === 'object') Object.values(value).forEach(collect);
        };
        collect(bake);
        globalThis.postMessage(bake, [...buffers]);
    } catch (error) {
        globalThis.postMessage({ error: error.message });
    }
};
