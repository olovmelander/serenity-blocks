const Jimp = require('jimp');

async function processImage() {
    console.log("Loading Luma sprites...");
    const image = await Jimp.read('/home/melolo/.gemini/antigravity/brain/468340ba-8ad1-4095-92e4-3b10bbcbdb78/luma_sprites_raw_1774716806374.png');
    
    // Crop to the row of Lumas (top half 1024x512)
    image.crop(0, 0, 1024, 512);

    // Color distance removal
    const targetColor = { r: 0, g: 255, b: 0 }; // Bright Green
    const threshold = 140; 

    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
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

    // Resize to 256x64 (4 frames x 64px each)
    image.resize(256, 64, Jimp.RESIZE_NEAREST_NEIGHBOR);
    
    await image.writeAsync('/home/melolo/serenity-blocks/luma_sprite.png');
    console.log("Successfully processed luma_sprite.png (4 frames, 64px each).");
    process.exit(0);
}

processImage().catch(err => { console.error(err); process.exit(1); });
