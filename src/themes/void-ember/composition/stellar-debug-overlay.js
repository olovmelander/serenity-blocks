/**
 * Void Ember AAA — Stellar Conductor debug overlay
 *
 * A tiny on-screen panel that visualises StellarConductor state so Phase 0 is
 * observable: current act, the master intensity, the derived life-state
 * channels (temperature / agitation / corona / breath) and the fast transients
 * (flare / cme / nova). The temperature swatch uses a cheap black-body
 * approximation so you can *see* the star heat from red → blue with combos.
 *
 * Gated behind `?voidEmber=1`; zero cost when not enabled.
 *
 * See docs/VOID_EMBER_AAA_PLAN.md Phase 0.
 */

/** Cheap black-body-ish ramp (0=deep red ember → 1=blue-white) for the swatch only. */
function tempToCss(t) {
    const x = Math.min(1, Math.max(0, t));
    // deep red → orange → amber → white → blue-white
    const stops = [
        [90, 14, 6],
        [200, 60, 14],
        [255, 150, 60],
        [255, 230, 200],
        [200, 220, 255],
    ];
    const f = x * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(f));
    const k = f - i;
    const a = stops[i];
    const b = stops[i + 1];
    const r = Math.round(a[0] + (b[0] - a[0]) * k);
    const g = Math.round(a[1] + (b[1] - a[1]) * k);
    const bl = Math.round(a[2] + (b[2] - a[2]) * k);
    return `rgb(${r},${g},${bl})`;
}

function bar(label, accent) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:2px 0;';

    const name = document.createElement('span');
    name.textContent = label;
    name.style.cssText = 'width:88px;color:#d6a98c;flex:0 0 auto;';

    const track = document.createElement('div');
    track.style.cssText = 'position:relative;flex:1 1 auto;height:8px;border-radius:4px;'
        + 'background:rgba(255,255,255,0.07);overflow:hidden;';

    const fill = document.createElement('div');
    fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:0%;border-radius:4px;background:${accent};`
        + 'transition:width 0.08s linear;';
    track.appendChild(fill);

    const val = document.createElement('span');
    val.textContent = '0.00';
    val.style.cssText = 'width:34px;text-align:right;color:#f5e3d6;flex:0 0 auto;';

    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(val);
    return { row, fill, val };
}

export function createStellarDebugOverlay() {
    if (typeof document === 'undefined') return null;

    const panel = document.createElement('div');
    panel.id = 'void-ember-debug';
    panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:99999;'
        + 'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;'
        + 'padding:10px 12px;border-radius:10px;width:248px;pointer-events:none;'
        + 'background:rgba(18,8,6,0.8);border:1px solid rgba(255,140,60,0.28);'
        + 'box-shadow:0 6px 24px rgba(0,0,0,0.45);backdrop-filter:blur(6px);';

    const title = document.createElement('div');
    title.style.cssText = 'display:flex;justify-content:space-between;align-items:center;'
        + 'margin-bottom:6px;color:#ffd9b0;font-weight:600;letter-spacing:0.04em;';
    const titleText = document.createElement('span');
    titleText.textContent = 'STELLAR CONDUCTOR';
    const swatch = document.createElement('span');
    swatch.style.cssText = 'width:14px;height:14px;border-radius:50%;'
        + 'border:1px solid rgba(255,255,255,0.4);background:#5a0e06;';
    title.appendChild(titleText);
    title.appendChild(swatch);

    const actRow = document.createElement('div');
    actRow.style.cssText = 'margin-bottom:6px;color:#ffb072;font-weight:600;';
    actRow.textContent = 'Dormant Ember';

    const intensity = bar('intensity', '#ff8a3c');
    const temperature = bar('temperature', '#ffcf8a');
    const agitation = bar('agitation', '#ff6a2a');
    const corona = bar('corona', '#ffd27a');
    const breath = bar('breath', '#c77a4a');
    const flare = bar('flare', '#ffd2a0');
    const cme = bar('cme', '#ff9a5a');
    const nova = bar('nova', '#fff0d0');
    const legacy = bar('legacy.int', '#9b7bff');

    panel.appendChild(title);
    panel.appendChild(actRow);
    panel.appendChild(intensity.row);
    panel.appendChild(temperature.row);
    panel.appendChild(agitation.row);
    panel.appendChild(corona.row);
    panel.appendChild(breath.row);
    panel.appendChild(flare.row);
    panel.appendChild(cme.row);
    panel.appendChild(nova.row);
    panel.appendChild(legacy.row);
    document.body.appendChild(panel);

    const setBar = (b, value, scale = 1) => {
        const v = Math.max(0, value) / scale;
        b.fill.style.width = `${Math.min(100, v * 100)}%`;
        b.val.textContent = value.toFixed(2);
    };

    return {
        update(conductor, extra = {}) {
            if (!conductor) return;
            const s = conductor.getState();
            actRow.textContent = s.act;
            const cssTemp = tempToCss(s.temperature);
            swatch.style.background = cssTemp;
            temperature.fill.style.background = cssTemp;
            setBar(intensity, s.intensity);
            setBar(temperature, s.temperature);
            setBar(agitation, s.agitation);
            setBar(corona, s.coronaEnergy);
            setBar(breath, s.breath);
            setBar(flare, s.flare, 1.5);
            setBar(cme, s.cmePulse);
            setBar(nova, s.novaFlash, 1.5);
            if (extra.legacyIntensity !== undefined) setBar(legacy, extra.legacyIntensity, 3);
        },
        dispose() {
            panel.remove();
        },
    };
}
