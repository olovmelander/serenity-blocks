/**
 * @fileoverview Odyssey Mode Module Exports
 */

export { OdysseyStateManager } from './OdysseyStateManager.js';
export { LevelRegistry, getLevelRegistry } from './LevelRegistry.js';
export {
    ODYSSEY_THEME_PRESENTATION_COLORS,
    getOdysseyThemePresentationPalette,
    hasOdysseyThemePresentationPalette,
} from './theme-presentation.js';
export { LEVEL_CONFIGS } from './data/levels.js';
export { CHAPTER_CONFIGS } from './data/chapters.js';
export {
    ODYSSEY_LAYOUT_DATA,
    buildOdysseyPresentationLayout,
    createPatchReadyOdysseyLayoutSnippet,
    parseOdysseyLayoutData,
    serializeOdysseyLayoutData,
} from './data/odyssey-layout.js';

// Phase 2: Gameplay Hybrid System
export { VictoryConditionEvaluator } from './VictoryConditionEvaluator.js';
export { ModifierStack, MODIFIER_DEFINITIONS } from './ModifierStack.js';
export { MechanicsMixer } from './MechanicsMixer.js';
export { GameplayHybridEngine } from './GameplayHybridEngine.js';
