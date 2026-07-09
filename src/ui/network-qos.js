/**
 * NetworkQosHud - Lightweight network stats HUD for online multiplayer
 */
export class NetworkQosHud {
    constructor(parent = document.body) {
        this.container = null;
        this.values = {};

        this.createUI(parent);
    }

    createUI(parent) {
        this.container = document.createElement('div');
        this.container.id = 'network-qos-hud';
        this.container.className = 'network-qos-hud collapsed';

        this.container.innerHTML = `
            <button class="network-qos-toggle" type="button" aria-label="Toggle network stats">NET</button>
            <div class="network-qos-stats">
                <div class="qos-row"><span class="label">RTT</span><span class="value" data-qos="rtt">-- ms</span></div>
                <div class="qos-row"><span class="label">Loss</span><span class="value" data-qos="loss">--%</span></div>
                <div class="qos-row"><span class="label">Snap</span><span class="value" data-qos="rate">-- Hz</span></div>
                <div class="qos-row"><span class="label">Interp</span><span class="value" data-qos="interp">-- ms</span></div>
                <div class="qos-row"><span class="label">Route</span><span class="value" data-qos="route">--</span></div>
            </div>
        `;

        parent.appendChild(this.container);

        this.container.querySelectorAll('[data-qos]').forEach((el) => {
            this.values[el.dataset.qos] = el;
        });

        const toggleBtn = this.container.querySelector('.network-qos-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleExpanded());
        }
    }

    update(stats = {}) {
        if (this.values.rtt) {
            this.values.rtt.textContent = stats.rttMs !== null && stats.rttMs !== undefined
                ? `${Math.round(stats.rttMs)} ms`
                : '-- ms';
        }
        if (this.values.loss) {
            this.values.loss.textContent = stats.lossPct !== null && stats.lossPct !== undefined
                ? `${stats.lossPct.toFixed(1)}%`
                : '--%';
        }
        if (this.values.rate) {
            this.values.rate.textContent = stats.snapshotRate !== null && stats.snapshotRate !== undefined
                ? `${stats.snapshotRate.toFixed(1)} Hz`
                : '-- Hz';
        }
        if (this.values.interp) {
            this.values.interp.textContent = stats.interpDelayMs !== null && stats.interpDelayMs !== undefined
                ? `${Math.round(stats.interpDelayMs)} ms`
                : '-- ms';
        }
        if (this.values.route) {
            this.values.route.textContent = stats.route || '--';
        }
    }

    setVisible(visible) {
        if (!this.container) return;
        this.container.classList.toggle('hidden', !visible);
    }

    toggleExpanded() {
        if (!this.container) return;
        this.container.classList.toggle('collapsed');
    }

    destroy() {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
    }
}
