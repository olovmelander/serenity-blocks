const Jimp = require('jimp');

async function processImage() {
    console.log("Starting Jimp...");
    const image = await Jimp.read('/home/melolo/.gemini/antigravity/brain/468340ba-8ad1-4095-92e4-3b10bbcbdb78/alva_pixel_walk_1774705006062.png');
    console.log("Loaded image.");

    image.crop(0, 0, 1024, 512);
    
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
        let r = this.bitmap.data[idx];
        let g = this.bitmap.data[idx + 1];
        let b = this.bitmap.data[idx + 2];
        
        // Remove the lime green background (#00FF00) perfectly
        if (g > 150 && r < 80 && b < 80) {
            this.bitmap.data[idx + 3] = 0; // Set Alpha to 0
        }
    });

    // Resize down by 4x to 256x128 for crispy pixel art view
    image.resize(256, 128, Jimp.RESIZE_NEAREST_NEIGHBOR);

    console.log("Writing output...");
    await image.writeAsync('/home/melolo/serenity-blocks/alva_sprite.png');
    console.log("Done.");
    process.exit(0);
}

processImage().catch(err => {
    console.error(err);
    process.exit(1);
});
