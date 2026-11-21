import * as THREE from 'three/webgpu';

/** One carved wind-horse block, stamped on every colour of cotton. UV zero is the cord. */
export function createWindHorsePrint() {
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(128, 160) : null;
    const ctx = canvas?.getContext('2d');
    if (!ctx) {
        const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        blank.needsUpdate = true;
        return blank;
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 160);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const cut = (path, width = 2) => {
        ctx.lineWidth = width;
        ctx.stroke(new Path2D(path));
    };
    // Double rules, corner lozenges and knots left by the carver.
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 15, 108, 132);
    ctx.lineWidth = 1;
    ctx.strokeRect(14, 19, 100, 124);
    for (const x of [24, 104]) {
        for (const y of [30, 131]) {
            ctx.save();
            ctx.translate(x, y);
            cut('M-7 0 L0 -7 L7 0 L0 7 Z M-3 0 L0 -3 L3 0 L0 3 Z', 1.8);
            ctx.restore();
        }
    }
    // The swept tail, four legs and raised muzzle read together at thumbnail size.
    ctx.fill(new Path2D('M28 83 Q20 82 17 74 Q24 79 28 77 Q19 73 20 65 Q25 73 34 72 '
        + 'Q41 66 50 69 Q64 74 73 67 L79 55 L81 48 L85 52 L88 44 L90 53 L100 59 '
        + 'L99 64 L92 65 L86 61 Q86 72 76 80 L83 84 L91 81 L98 74 L101 75 '
        + 'L96 84 L83 92 L72 88 L79 94 L92 95 L94 99 L77 99 L65 89 '
        + 'Q56 91 48 85 L42 91 L31 95 L25 105 L21 105 L25 92 L36 85 L38 80 '
        + 'L30 85 L18 89 L14 96 L12 95 L14 85 L26 80 Z'));
    cut('M44 69 Q53 64 65 69 L61 77 L46 74 Z M49 65 L54 57 L61 65 M53 58 L57 52 L61 58', 2.6);
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    cut('M43 78 Q55 83 65 81 M77 65 L82 59 M80 67 L84 62 M84 57 L86 56', 1.7);
    ctx.fillRect(89, 56, 2, 2);
    ctx.strokeStyle = '#fff';
    // Short broken hatch marks, deliberately ornament rather than invented lettering.
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 8; col++) {
            const x = 27 + 9 * col;
            const y = 108 + 5 * row;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 5 + ((row + col) % 3), y - ((col * 3 + row) % 4));
            ctx.stroke();
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'HimalayanPeakWindHorseInk';
    texture.flipY = false;
    texture.anisotropy = 2;
    return texture;
}
