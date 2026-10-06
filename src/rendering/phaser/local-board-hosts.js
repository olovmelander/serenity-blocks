import Phaser from 'phaser';
import { COLS, ROWS } from '../../core/constants.js';
import { createBoardScene } from './board-scene.js';
import { phaserBoardRuntimeConfig } from './frame-rate-policy.js';

const waitForBoardBoot = (milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
});

export async function createLocalMultiplayerBoards(mode) {
    mode._destroySeparatePhaserGames();
    const creationGeneration = mode._boardCreationGeneration;
    const ownsCreation = () => mode.isActive && creationGeneration === mode._boardCreationGeneration;
    const numPlayers = mode.matchConfig?.numPlayers || 2;
    console.log(
        `[LocalMultiplayer] Creating separate Phaser instances for ${numPlayers} players...`,
    );

    let BoardScene = mode.deps.BoardSceneClass
        || mode.deps.MultiplayerBoardSceneClass
        || mode.deps.phaserGame?.BoardSceneClass
        || mode.deps.phaserGame?.MultiplayerBoardSceneClass;

    if (!BoardScene) {
        console.log('[LocalMultiplayer] BoardSceneClass not found, attempting dynamic creation...');
        try {
            BoardScene = createBoardScene(Phaser);
        } catch (err) {
            console.error(
                '[LocalMultiplayer] Failed to dynamically generate BoardScene class:',
                err,
            );
        }
    }

    if (!BoardScene) {
        throw new Error('BoardScene or MultiplayerBoardScene class not available');
    }

    console.log('[LocalMultiplayer] Using scene class:', BoardScene.name || 'BoardScene');

    // Game configuration for each player
    // Calculate dynamic block size
    const blockSize = mode._calculateDynamicBlockSize();
    mode.currentBlockSize = blockSize;
    console.log(`[LocalMultiplayer] Using dynamic block size: ${blockSize} px`);

    // Update CSS variables immediately
    mode._updateBoardCSSVariables(blockSize);

    // Game configuration for each player
    // Use a fixed internal resolution based on standard 40px blocks
    // This ensures all drawing logic (tetrominos, effects) works as designed
    const FIXED_BLOCK_SIZE = 40;
    const internalWidth = COLS * FIXED_BLOCK_SIZE;
    const internalHeight = ROWS * FIXED_BLOCK_SIZE;

    const createGameConfig = (parent) => ({
        width: internalWidth,
        height: internalHeight,
        parent,
        ...phaserBoardRuntimeConfig(mode.deps, Phaser.WEBGL),
        transparent: true,
        banner: false,
        scale: {
            mode: Phaser.Scale.FIT, // Scale the canvas to fit the parent container
            autoCenter: Phaser.Scale.CENTER_BOTH,
            width: internalWidth,
            height: internalHeight,
        },
    });

    // Arrays to store Phaser games and scenes
    mode.phaserGames = [];
    mode.boardScenes = [];

    // Create Phaser instance for each player
    try {
        for (let i = 1; i <= numPlayers; i++) {
            if (!ownsCreation()) return false;
            console.log(`[LocalMultiplayer] Creating Player ${i} Phaser game...`);

            const phaserGame = new Phaser.Game(createGameConfig(`p${i}-phaser-container`));
            // Publish the owner before any await so cancellation can destroy it.
            mode.phaserGames.push(phaserGame);

            // Wait for game to initialize
            // Keep construction sequential so cancellation cannot publish a later owner.
            // eslint-disable-next-line no-await-in-loop
            await waitForBoardBoot(100);
            if (!ownsCreation()) return false;

            // Add and start BoardScene
            const sceneKey = `P${i}Board`; // Removed space
            // Pass FIXED_BLOCK_SIZE so the scene draws at internal resolution
            const boardScene = new BoardScene(sceneKey, { blockSize: FIXED_BLOCK_SIZE });
            phaserGame.scene.add(sceneKey, boardScene, true);
            console.log(`[LocalMultiplayer] Player ${i} scene created: `, boardScene.scene?.key);

            // The well's look: solid slate garbage, a coloured ghost (well-board-style.js).
            boardScene.setWellStyle?.(true);

            // Store references
            mode.boardScenes.push(boardScene);

            // Also maintain legacy p1/p2 references for backwards compatibility
            if (i === 1) {
                mode.p1PhaserGame = phaserGame;
                mode.p1BoardScene = boardScene;
            } else if (i === 2) {
                mode.p2PhaserGame = phaserGame;
                mode.p2BoardScene = boardScene;
            } else if (i === 3) {
                mode.p3PhaserGame = phaserGame;
                mode.p3BoardScene = boardScene;
            } else if (i === 4) {
                mode.p4PhaserGame = phaserGame;
                mode.p4BoardScene = boardScene;
            }
        }

        // Wait for all scenes to fully initialize
        await waitForBoardBoot(200);
        if (!ownsCreation()) return false;

        // Apply the user's effect-quality tier. These per-player scenes never
        // received it before — they ran at the BaseBoardScene default 'High'
        // regardless of the setting.
        const quality = mode.deps.settingsManager?.get?.().effectQuality;
        if (quality) {
            mode.boardScenes.forEach((scene) => scene?.setEffectQuality?.(quality));
        }

        // Initialize BoardJuice for each player's canvas
        mode._initBoardJuice();

        console.log(`[LocalMultiplayer] ${numPlayers} Phaser instances created successfully`);
        return true;
    } catch (error) {
        if (creationGeneration === mode._boardCreationGeneration) mode._destroySeparatePhaserGames();
        throw error;
    }
}

export function destroyLocalMultiplayerBoards(mode) {
    mode._boardCreationGeneration = (mode._boardCreationGeneration || 0) + 1;
    const games = new Set([
        ...(mode.phaserGames || []),
        ...[1, 2, 3, 4].map((i) => mode[`p${i}PhaserGame`]),
    ]);
    mode.phaserGames = [];
    mode.boardScenes = [];
    for (let i = 1; i <= 4; i++) {
        mode[`p${i}PhaserGame`] = null;
        mode[`p${i}BoardScene`] = null;
    }
    games.forEach((game) => {
        try {
            game?.destroy?.(true);
        } catch (error) {
            console.warn('[LocalMultiplayer] Failed to destroy player renderer:', error);
        }
    });
}
