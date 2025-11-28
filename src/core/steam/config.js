/**
 * Steam Configuration
 *
 * Uses Spacewar (AppID 480) for development/testing
 * Switch to your real AppID for production
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
const steamAppId = getEnv('STEAM_APP_ID');

export const SteamConfig = {
    // Spacewar (480) for testing, real AppID for production
    appId: steamAppId
        ? parseInt(steamAppId)
        : (isProduction ? 0 : 480),

    // Enable debug logging in development
    debugMode: !isProduction,

    // Mock mode for local testing without Steam
    mockMode: isMockMode,
};

if (SteamConfig.debugMode) {
    console.log('🎮 Steam Config:');
    console.log(`   AppID: ${SteamConfig.appId} ${SteamConfig.appId === 480 ? '(Spacewar - Testing)' : '(Production)'}`);
    console.log(`   Mock Mode: ${SteamConfig.mockMode}`);
    console.log(`   Debug Mode: ${SteamConfig.debugMode}`);
}
