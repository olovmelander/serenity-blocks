/**
 * Sky Children V2 AAA — Mood Director debug overlay
 *
 * A tiny on-screen panel that visualises MoodDirector state so Phase 0 is
 * observable: the current act, the master radiance, and the fast transients
 * (gust / ignite / flare / sparkle / cameraPunch). The radiance swatch ramps
 * cool-violet → pale → warm-gold → rosy so you can *see* the warm/cool split
 * shift with line clears and combos.
 *
 * Gated behind `?skyV2Debug`; zero cost when not enabled.
 *
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §2.2, Phase 0.
 */

/** Cool-violet (Reverie) → pale → warm-gold → rosy (Triumph) ramp for the swatch. */
function radianceToCss(r) {
    const x = Math.min(1, Math.max(0, r));
    const stops = [
        [106, 113, 184], // #6A71B8 cool violet (look-bible shadow)
        [143, 182, 216], // #8FB6D8 cool blue
        [243, 235, 221], // #F3EBDD pale
        [246, 192, 99], // #F6C063 warm gold
        [229, 122, 90], // rosy-orange (Triumph)
    ];
    const f = x * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(f));
    const k = f - i;
    const a = stops[i];
    const b = stops[i + 1];
    const ch = (j) => Math.round(a[j] + (b[j] - a[j]) * k);
    return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

function bar(label, accent) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:2px 0;';

    const name = document.createElement('span');
    name.textContent = label;
    name.style.cssText = 'width:88px;color:#9aa6cf;flex:0 0 auto;';

    const track = document.createElement('div');
    track.style.cssText = 'position:relative;flex:1 1 auto;height:8px;border-radius:4px;'
        + 'background:rgba(255,255,255,0.07);overflow:hidden;';

    const fill = document.createElement('div');
    fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:0%;border-radius:4px;background:${accent};`
        + 'transition:width 0.08s linear;';
    track.appendChild(fill);

    const val = document.createElement('span');
    val.textContent = '0.00';
    val.style.cssText = 'width:34px;text-align:right;color:#f3ebdd;flex:0 0 auto;';

    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(val);
    return { row, fill, val };
}

export function createSkyMoodDebugOverlay() {
    if (typeof document === 'undefined') return null;

    const panel = document.createElement('div');
    panel.id = 'sky-children-v2-debug';
    panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:99999;'
        + 'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;'
        + 'padding:10px 12px;border-radius:10px;width:248px;pointer-events:none;'
        + 'background:rgba(28,24,44,0.8);border:1px solid rgba(246,192,99,0.28);'
        + 'box-shadow:0 6px 24px rgba(0,0,0,0.45);backdrop-filter:blur(6px);';

    const title = document.createElement('div');
    title.style.cssText = 'display:flex;justify-content:space-between;align-items:center;'
        + 'margin-bottom:6px;color:#f6c063;font-weight:600;letter-spacing:0.04em;';
    const titleText = document.createElement('span');
    titleText.textContent = 'MOOD DIRECTOR';
    const swatch = document.createElement('span');
    swatch.style.cssText = 'width:14px;height:14px;border-radius:50%;'
        + 'border:1px solid rgba(255,255,255,0.4);background:#6a71b8;';
    title.appendChild(titleText);
    title.appendChild(swatch);

    const actRow = document.createElement('div');
    actRow.style.cssText = 'margin-bottom:6px;color:#8fb6d8;font-weight:600;';
    actRow.textContent = 'Reverie';

    const radiance = bar('radiance', '#f6c063');
    const gust = bar('gust', '#8fb6d8');
    const ignite = bar('ignite', '#ee7a52');
    const flare = bar('flare', '#ffd2a0');
    const sparkle = bar('sparkle', '#f3ebdd');
    const camera = bar('cameraPunch', '#e58d4a');
    const legacy = bar('wind', '#9aa6cf');

    panel.appendChild(title);
    panel.appendChild(actRow);
    panel.appendChild(radiance.row);
    panel.appendChild(gust.row);
    panel.appendChild(ignite.row);
    panel.appendChild(flare.row);
    panel.appendChild(sparkle.row);
    panel.appendChild(camera.row);
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
            const css = radianceToCss(s.radiance);
            swatch.style.background = css;
            radiance.fill.style.background = css;
            setBar(radiance, s.radiance);
            setBar(gust, s.gust);
            setBar(ignite, s.ignite, 1.2);
            setBar(flare, s.flare, 1.2);
            setBar(sparkle, s.sparkle);
            setBar(camera, s.cameraPunch);
            if (extra.windStrength !== undefined) setBar(legacy, extra.windStrength, 3);
        },
        dispose() {
            panel.remove();
        },
    };
}
