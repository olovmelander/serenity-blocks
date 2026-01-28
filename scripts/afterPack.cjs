/**
 * electron-builder afterPack hook
 *
 * This hook runs after electron-builder packages the app.
 * It renames the main executable and copies the GPU preference launcher
 * so users get the high-performance GPU by default.
 */

const fs = require('fs');
const path = require('path');

module.exports = async function(context) {
    // Only run for Windows builds
    if (context.electronPlatformName !== 'win32') {
        console.log('[afterPack] Skipping GPU launcher setup (not Windows)');
        return;
    }

    const appOutDir = context.appOutDir;
    const productName = context.packager.appInfo.productName || 'Serenity Blocks';

    const originalExe = path.join(appOutDir, `${productName}.exe`);
    const coreExe = path.join(appOutDir, 'SerenityBlocks-core.exe');
    const launcherSrc = path.join(__dirname, '..', 'electron', 'SerenityBlocksLauncher.exe');
    const launcherDest = path.join(appOutDir, `${productName}.exe`);

    console.log('[afterPack] Setting up GPU preference launcher...');

    // Check if launcher exists
    if (!fs.existsSync(launcherSrc)) {
        console.log('[afterPack] WARNING: GPU launcher not found at:', launcherSrc);
        console.log('[afterPack] Run: npm run build:gpu-launcher first');
        console.log('[afterPack] Skipping launcher setup - app will use default GPU');
        return;
    }

    try {
        // Step 1: Rename original exe to core exe
        console.log(`[afterPack] Renaming ${productName}.exe -> SerenityBlocks-core.exe`);
        fs.renameSync(originalExe, coreExe);

        // Step 2: Copy launcher as main exe
        console.log(`[afterPack] Installing GPU launcher as ${productName}.exe`);
        fs.copyFileSync(launcherSrc, launcherDest);

        console.log('[afterPack] GPU preference launcher installed successfully!');
        console.log('[afterPack] Users will now automatically use their discrete GPU (NVIDIA/AMD)');

        // Note: steamworks.js bundles its own native dependencies, no manual DLL copying needed
        console.log('[afterPack] ✅ steamworks.js handles its own native binaries');
    } catch (error) {
        console.error('[afterPack] Failed to setup GPU launcher:', error.message);
        // Try to restore original if we partially failed
        if (!fs.existsSync(originalExe) && fs.existsSync(coreExe)) {
            console.log('[afterPack] Restoring original executable...');
            fs.renameSync(coreExe, originalExe);
        }
    }
};
