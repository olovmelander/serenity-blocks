/**
 * Steam Configuration (renderer): debug logging and mock mode. The AppID is the main process's
 * (electron/steam-app-id.js).
 */

// Safely access process.env (works in both browser and Electron)
const getEnv = (key) => {
    if (typeof process !== 'undefined' && process.env) {
        return process.env[key];
    }
    return undefined;
};

const isProduction = getEnv('NODE_ENV') === 'production';
const isMockMode = getEnv('MOCK_STEAM') === 'true';

export const SteamConfig = {
    // Enable debug logging in development
    debugMode: !isProduction,

    // Mock mode for local testing without Steam
    mockMode: isMockMode,
};

if (SteamConfig.debugMode) {
    console.log('🎮 Steam Config:');
    console.log(`   Mock Mode: ${SteamConfig.mockMode}`);
    console.log(`   Debug Mode: ${SteamConfig.debugMode}`);
}
