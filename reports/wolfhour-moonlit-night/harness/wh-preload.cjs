// Harness-only: Electron 38's Chromium predates the string form of
// GPUTextureViewDescriptor.swizzle that three r186 sends (an identity 'rgba').
if (typeof GPUTexture !== 'undefined') {
    const original = GPUTexture.prototype.createView;
    GPUTexture.prototype.createView = function createView(descriptor) {
        if (descriptor && typeof descriptor.swizzle === 'string') {
            const { swizzle, ...rest } = descriptor;
            return original.call(this, rest);
        }
        return original.call(this, descriptor);
    };
}
// Harness-only: report every uncaptured WebGPU error and device loss to the console log.
if (typeof GPUAdapter !== 'undefined') {
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function requestDevice(...args) {
        const device = await request.apply(this, args);
        let count = 0;
        device.addEventListener('uncapturederror', (event) => {
            count += 1;
            if (count <= 12) console.error(`[gpu-error] ${event.error?.constructor?.name}: ${event.error?.message}`);
        });
        device.lost.then((info) => console.error(`[gpu-lost] ${info.reason}: ${info.message}`));
        return device;
    };
}
