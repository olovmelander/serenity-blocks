const Jimp = require('jimp');

async function processImage() {
    console.log("Loading vibrant Luma sprites...");
    const raw = await Jimp.read('/home/melolo/.gemini/antigravity/brain/468340ba-8ad1-4095-92e4-3b10bbcbdb78/luma_sprites_vibrant_raw_1774717073296.png');
    
    // Create final image 256x64 (4 frames x 64px)
    const final = new Jimp(256, 64);
    
    const frames = [
        { x: 0, y: 0, w: 512, h: 512 },    // Yellow
        { x: 512, y: 0, w: 512, h: 512 },  // Blue
        { x: 0, y: 512, w: 512, h: 512 },  // Pink
        { x: 512, y: 512, w: 512, h: 512 } // Orange
    ];

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const sub = raw.clone().crop(frame.x, frame.y, frame.w, frame.h);
        
        // Resize to 64x64
        sub.resize(64, 64, Jimp.RESIZE_NEAREST_NEIGHBOR);
        
        // Remove green with distance threshold
        const targetColor = { r: 0, g: 255, b: 0 }; 
        const threshold = 150; 
        
        sub.scan(0, 0, sub.bitmap.width, sub.bitmap.height, function(x, y, idx) {
            const r = this.bitmap.data[idx];
            const g = this.bitmap.data[idx + 1];
            const b = this.bitmap.data[idx + 2];
            const distance = Math.sqrt(
                Math.pow(r - targetColor.r, 2) +
                Math.pow(g - targetColor.g, 2) +
                Math.pow(b - targetColor.b, 2)
            );
            if (distance < threshold) {
                this.bitmap.data[idx + 3] = 0;
            }
        });

        // Composite into final
        final.composite(sub, i * 64, 0);
    }

    await final.writeAsync('/home/melolo/serenity-blocks/luma_sprite.png');
    console.log("Successfully upgraded luma_sprite.png to high-vibrancy vibrant asset.");
    process.exit(0);
}

processImage().catch(err => { console.error(err); process.exit(1); });
