/**
 * Steam Integration Module
 *
 * Exports all Steam-related functionality for Serenity Blocks.
 */

// Core service
export { SteamService, default as steamService } from './steam-service.js';

// Rich Presence
export { RichPresenceManager, richPresenceManager } from './rich-presence-manager.js';

// Configuration
export {
    STEAM_APP_ID,
    STEAM_RETRY,
    STEAM_CONNECTION,
    AVATAR_SIZES,
    AVATAR_CACHE,
    STEAM_STORAGE_KEYS,
    STEAM_EVENTS,
    STEAM_IPC,
    STEAM_DEFAULTS,
    PERSONA_STATE,
    PERSONA_STATE_LABELS,
} from './steam-config.js';
