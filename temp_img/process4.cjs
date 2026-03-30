const Jimp = require('jimp');

async function processImage() {
    console.log("Loading 4-frame sprite...");
    const image = await Jimp.read('/home/melolo/.gemini/antigravity/brain/468340ba-8ad1-4095-92e4-3b10bbcbdb78/alva_walk_4frame_1774706860641.png');
    
    // Crop to top row (4 frames)
    image.crop(0, 0, 1024, 512);

    // Color distance removal
    const targetColor = { r: 0, g: 255, b: 0 }; // Bright Green
    const threshold = 150; // Increased threshold for halo removal

    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
        const r = this.bitmap.data[idx];
        const g = this.bitmap.data[idx + 1];
        const b = this.bitmap.data[idx + 2];
        
        // Simple Euclidean color distance
        const distance = Math.sqrt(
            Math.pow(r - targetColor.r, 2) +
            Math.pow(g - targetColor.g, 2) +
            Math.pow(b - targetColor.b, 2)
        );

        if (distance < threshold) {
            this.bitmap.data[idx + 3] = 0;
        }
    });

    // Final resize to 320x80
    image.resize(320, 80, Jimp.RESIZE_NEAREST_NEIGHBOR);
    
    await image.writeAsync('/home/melolo/serenity-blocks/alva_sprite.png');
    console.log("Successfully processed sprite (Alva_walk_4frame) with distance-based chroma key.");
    process.exit(0);
}

processImage().catch(err => { console.error(err); process.exit(1); });
