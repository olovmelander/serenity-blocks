/**
 * Desktop GPU remediation panel markup (packaged Windows fallback guidance). Pure
 * formatting — extracted from main.js (plan §3d god-file ceiling); styles live in
 * public/styles/main.css under `.desktop-gpu-remediation*`.
 */

/**
 * @param {object|null} [gpuHealth] desktop runtime GPU health report
 * @returns {string} inner HTML for the remediation panel
 */
export function formatGpuRemediationHtml(gpuHealth = null) {
    const meta = (label, value) => (value ? `<div class="desktop-gpu-remediation__meta">${label}: ${value}</div>` : '');
    const renderer = meta('Renderer', gpuHealth?.renderer);
    const adapter = meta('Adapter', gpuHealth?.activeAdapter?.name);
    const driver = gpuHealth?.driverVersion
        ? meta('Driver', `${gpuHealth.driverVendor || 'Unknown'} ${gpuHealth.driverVersion}`)
        : '';
    const reasons = Array.isArray(gpuHealth?.reasons) && gpuHealth.reasons.length > 0
        ? `<div class="desktop-gpu-remediation__detail">Issue: ${gpuHealth.reasons.join(', ')}</div>`
        : '';
    const instructions = Array.isArray(gpuHealth?.remediation) && gpuHealth.remediation.length > 0
        ? gpuHealth.remediation.map((step) => `<li>${step}</li>`).join('')
        : '<li>Switch the app to High performance in Windows Graphics Settings and relaunch.</li>';

    return `
        <div class="desktop-gpu-remediation__header">
            <strong>Desktop GPU Fallback Active</strong>
            <button type="button" class="desktop-gpu-remediation__dismiss" aria-label="Dismiss GPU guidance">×</button>
        </div>
        <div class="desktop-gpu-remediation__body">
            <div class="desktop-gpu-remediation__status">
                The packaged app detected a ${gpuHealth?.status || 'degraded'} Windows GPU path
                and lowered desktop quality to protect stability.
            </div>
            ${renderer}
            ${adapter}
            ${driver}
            ${reasons}
            <ol class="desktop-gpu-remediation__steps">${instructions}</ol>
        </div>
    `;
}
