/**
 * Winter AAA — Storm Director debug overlay
 *
 * A tiny on-screen panel that visualises StormDirector state so Phase 0 is
 * observable: intensity bar, current act, transients, accent swatch, plus the
 * theme's legacy stormEnergy for cross-checking that the new spine tracks
 * gameplay. Gated behind `?winterStorm=1`; zero cost when not enabled.
 *
 * See docs/WINTER_AAA_PLAN.md Phase 0.
 */

function bar(label, accent) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:2px 0;';

    const name = document.createElement('span');
    name.textContent = label;
    name.style.cssText = 'width:84px;color:#9fb6cc;flex:0 0 auto;';

    const track = document.createElement('div');
    track.style.cssText = 'position:relative;flex:1 1 auto;height:8px;border-radius:4px;'
        + 'background:rgba(255,255,255,0.08);overflow:hidden;';

    const fill = document.createElement('div');
    fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:0%;border-radius:4px;background:${accent};`
        + 'transition:width 0.08s linear;';
    track.appendChild(fill);

    const val = document.createElement('span');
    val.textContent = '0.00';
    val.style.cssText = 'width:34px;text-align:right;color:#dce8f5;flex:0 0 auto;';

    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(val);
    return { row, fill, val };
}

export function createStormDebugOverlay() {
    if (typeof document === 'undefined') return null;

    const panel = document.createElement('div');
    panel.id = 'winter-storm-debug';
    panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:99999;'
        + 'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;'
        + 'padding:10px 12px;border-radius:10px;width:240px;pointer-events:none;'
        + 'background:rgba(6,12,22,0.78);border:1px solid rgba(120,200,255,0.25);'
        + 'box-shadow:0 6px 24px rgba(0,0,0,0.4);backdrop-filter:blur(6px);';

    const title = document.createElement('div');
    title.style.cssText = 'display:flex;justify-content:space-between;align-items:center;'
        + 'margin-bottom:6px;color:#cfe6ff;font-weight:600;letter-spacing:0.04em;';
    const titleText = document.createElement('span');
    titleText.textContent = 'STORM DIRECTOR';
    const swatch = document.createElement('span');
    swatch.style.cssText = 'width:14px;height:14px;border-radius:50%;'
        + 'border:1px solid rgba(255,255,255,0.4);background:#6ff2d6;';
    title.appendChild(titleText);
    title.appendChild(swatch);

    const actRow = document.createElement('div');
    actRow.style.cssText = 'margin-bottom:6px;color:#7fd9ff;font-weight:600;';
    actRow.textContent = 'Still Night';

    const intensity = bar('intensity', '#6ff2d6');
    const gust = bar('gust', '#7fd9ff');
    const whiteout = bar('whiteout', '#ffffff');
    const flare = bar('flare', '#ff7ce0');
    const legacy = bar('stormEnergy', '#9bbcff');

    panel.appendChild(title);
    panel.appendChild(actRow);
    panel.appendChild(intensity.row);
    panel.appendChild(gust.row);
    panel.appendChild(whiteout.row);
    panel.appendChild(flare.row);
    panel.appendChild(legacy.row);
    document.body.appendChild(panel);

    const setBar = (b, value, scale = 1) => {
        const v = Math.max(0, value) / scale;
        b.fill.style.width = `${Math.min(100, v * 100)}%`;
        b.val.textContent = value.toFixed(2);
    };

    return {
        update(director, extra = {}) {
            if (!director) return;
            const s = director.getState();
            actRow.textContent = s.act;
            const cssAccent = `#${s.accentHex.toString(16).padStart(6, '0')}`;
            swatch.style.background = cssAccent;
            intensity.fill.style.background = cssAccent;
            setBar(intensity, s.intensity);
            setBar(gust, s.gust);
            setBar(whiteout, s.whiteout, 1.2);
            setBar(flare, s.flare, 1.2);
            if (extra.stormEnergy !== undefined) setBar(legacy, extra.stormEnergy, 1.65);
        },
        dispose() {
            panel.remove();
        },
    };
}
