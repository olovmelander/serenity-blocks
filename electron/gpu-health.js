export const SOFTWARE_RENDERER_PATTERNS = [
  /swiftshader/i,
  /software/i,
  /llvmpipe/i,
  /mesa offscreen/i,
  /basic render/i,
];

export const DISCRETE_GPU_VENDOR_PATTERNS = [
  /nvidia/i,
  /amd/i,
  /advanced micro devices/i,
  /radeon/i,
];

export function findActiveAdapter(adapters = []) {
  if (!Array.isArray(adapters) || adapters.length === 0) {
    return null;
  }

  return adapters.find((adapter) => adapter?.active) || adapters[0] || null;
}

export function classifyGpuHealth({
  adapters = [],
  gpuFeatureStatus = {},
  activeWebGLRenderer = '',
  hardwareAccelerationDisabled = false,
  preferDiscreteGpu = false,
  angleBackend = null,
} = {}) {
  const activeAdapter = findActiveAdapter(adapters);
  const availableAdapters = Array.isArray(adapters) ? adapters : [];
  const activeRendererLower = String(activeWebGLRenderer || '').toLowerCase();
  const activeAdapterVendor = activeAdapter?.vendor || activeAdapter?.driverVendor || '';
  const activeAdapterName = activeAdapter?.name || '';
  const hasDiscreteOption = availableAdapters.some((adapter) => (
    DISCRETE_GPU_VENDOR_PATTERNS.some((pattern) => pattern.test(adapter?.vendor || adapter?.driverVendor || adapter?.name || ''))
  ));
  const softwareRenderer = SOFTWARE_RENDERER_PATTERNS.some((pattern) => pattern.test(activeRendererLower));
  const gpuCompositingState = String(gpuFeatureStatus?.gpu_compositing || '').toLowerCase();
  const webglState = String(gpuFeatureStatus?.webgl || '').toLowerCase();
  const webgl2State = String(gpuFeatureStatus?.webgl2 || '').toLowerCase();
  const reasons = [];
  const remediation = [];
  let status = 'healthy';

  if (hardwareAccelerationDisabled) {
    status = 'unsafe';
    reasons.push('hardware_acceleration_disabled');
  }

  if (softwareRenderer) {
    status = 'unsafe';
    reasons.push('software_renderer_active');
  }

  if (gpuCompositingState && gpuCompositingState !== 'enabled') {
    status = 'unsafe';
    reasons.push(`gpu_compositing_${gpuCompositingState}`);
  }

  if (webglState.includes('disabled') || webglState.includes('software')) {
    status = 'unsafe';
    reasons.push(`webgl_${webglState || 'unavailable'}`);
  }

  if (!availableAdapters.length) {
    status = status === 'unsafe' ? 'unsafe' : 'degraded';
    reasons.push('no_gpu_adapter_reported');
  }

  if (status === 'healthy' && (webgl2State.includes('disabled') || webgl2State.includes('software'))) {
    status = 'degraded';
    reasons.push(`webgl2_${webgl2State || 'unavailable'}`);
  }

  if (status === 'healthy'
      && preferDiscreteGpu
      && hasDiscreteOption
      && activeAdapter
      && !DISCRETE_GPU_VENDOR_PATTERNS.some((pattern) => pattern.test(activeAdapterVendor) || pattern.test(activeAdapterName))) {
    status = 'degraded';
    reasons.push('hybrid_gpu_not_using_discrete_adapter');
  }

  if (status !== 'healthy') {
    remediation.push('Set Serenity Blocks.exe to High performance in Windows Graphics Settings.');
    remediation.push('Confirm the packaged launcher, not the core executable, is the process you are launching.');
    remediation.push('Update to a current WHQL GPU driver and retest the packaged build.');
  }

  if (status === 'degraded') {
    remediation.push('Keep the stable D3D11 baseline profile and avoid experimental GPU switches.');
  }

  return {
    status,
    reasons,
    remediation,
    activeAdapter,
    activeAdapterMatchesPreference: status !== 'degraded' || !reasons.includes('hybrid_gpu_not_using_discrete_adapter'),
    isUsingSoftwareRenderer: softwareRenderer,
    angleBackend,
    renderer: activeWebGLRenderer || null,
    driverVendor: activeAdapter?.driverVendor || activeAdapter?.vendor || null,
    driverVersion: activeAdapter?.driverVersion || null,
    updatedAt: Date.now(),
  };
}
