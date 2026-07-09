// Reference-image overlay — lays a concept/target image (e.g. nano-banana / Imagen
// art) over the live render so the agent (or you) can iterate the shader toward it.
// Modes: 'off' | 'overlay' (blended, opacity slider) | 'split' (draggable wipe) | 'side' (right half).
export function createReferenceOverlay({ container }) {
    const wrap = document.createElement('div');
    wrap.className = 'ref-wrap';

    const img = document.createElement('img');
    img.className = 'ref-img';
    img.draggable = false;
    img.alt = 'reference';
    wrap.appendChild(img);

    const handle = document.createElement('div');
    handle.className = 'ref-split-handle';
    wrap.appendChild(handle);

    container.appendChild(wrap);

    let mode = 'off';
    let opacity = 0.5;
    let split = 0.5; // 0..1 — fraction from the left where the render/reference seam sits
    let url = null;

    function apply() {
        const visible = mode !== 'off' && !!url;
        wrap.style.display = visible ? 'block' : 'none';
        if (!visible) return;
        img.src = url;

        // The wrap always spans the full viewport so clip-path percentages map directly to
        // screen X (the seam lines up with the render underneath). `cover` makes the reference
        // fill the same frame as the render so split/side comparisons are spatially aligned.
        wrap.style.left = '0';
        wrap.style.width = '100%';

        if (mode === 'overlay') {
            img.style.opacity = String(opacity);
            img.style.objectFit = 'contain'; // see the whole reference while blending
            img.style.clipPath = 'none';
            handle.style.display = 'none';
        } else if (mode === 'split') {
            // Render shows left of the seam; reference fills from the seam rightward.
            img.style.opacity = '1';
            img.style.objectFit = 'cover';
            img.style.clipPath = `inset(0 0 0 ${split * 100}%)`;
            handle.style.display = 'block';
            handle.style.left = `${split * 100}%`;
        } else if (mode === 'side') {
            // Locked 50% split — render on the left half, reference on the right.
            img.style.opacity = '1';
            img.style.objectFit = 'cover';
            img.style.clipPath = 'inset(0 0 0 50%)';
            handle.style.display = 'none';
        }
    }

    // Drag the split seam.
    let dragging = false;
    const onMove = (e) => {
        if (!dragging) return;
        split = Math.min(1, Math.max(0, e.clientX / window.innerWidth));
        apply();
    };
    handle.addEventListener('pointerdown', (e) => { dragging = true; handle.setPointerCapture(e.pointerId); });
    handle.addEventListener('pointerup', (e) => { dragging = false; handle.releasePointerCapture?.(e.pointerId); });
    handle.addEventListener('pointermove', onMove);

    return {
        element: wrap,
        get mode() { return mode; },
        get hasImage() { return !!url; },
        setUrl(nextUrl, opts = {}) {
            const { mode: nextMode, opacity: nextOpacity } = opts;
            url = nextUrl;
            if (nextMode) mode = nextMode;
            else if (mode === 'off') mode = 'overlay'; // showing an image implies a visible mode
            if (typeof nextOpacity === 'number') opacity = nextOpacity;
            apply();
        },
        setMode(nextMode) { mode = nextMode; apply(); },
        setOpacity(nextOpacity) { opacity = Math.min(1, Math.max(0, nextOpacity)); apply(); },
        getState() {
            return {
                mode, opacity, split, url,
            };
        },
        destroy() { wrap.remove(); },
    };
}
