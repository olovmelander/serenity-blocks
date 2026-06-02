import { describe, expect, it } from 'vitest';
import {
    ODYSSEY_NODE_SHELL_STYLE_INDEX,
    resolveOdysseyNodeShellStyle,
} from './LevelNodeManager.js';
import { ODYSSEY_NODE_STYLES } from './chapter-environments/shared/chapter-profile.js';

describe('Odyssey node shell styles', () => {
    it('maps each P3b world shell to a stable shader index', () => {
        expect(ODYSSEY_NODE_SHELL_STYLE_INDEX).toEqual({
            [ODYSSEY_NODE_STYLES.MAGMA_GEODE]: 0,
            [ODYSSEY_NODE_STYLES.BUBBLE_PEARL]: 1,
            [ODYSSEY_NODE_STYLES.SEED_LANTERN]: 2,
            [ODYSSEY_NODE_STYLES.CAIRN_LANTERN]: 3,
            [ODYSSEY_NODE_STYLES.CLOUD_WISP]: 4,
            [ODYSSEY_NODE_STYLES.STARLIT_ORB]: 5,
            [ODYSSEY_NODE_STYLES.LENSED_SHARD]: 6,
            [ODYSSEY_NODE_STYLES.NEON_SIGN]: 7,
        });
    });

    it('resolves the eight chapter profiles to distinct shell styles', () => {
        const chapterShells = Array.from({ length: 8 }, (_, index) => (
            resolveOdysseyNodeShellStyle(index + 1, index + 1)
        ));

        expect(chapterShells.map((shell) => shell.style)).toEqual([
            ODYSSEY_NODE_STYLES.MAGMA_GEODE,
            ODYSSEY_NODE_STYLES.BUBBLE_PEARL,
            ODYSSEY_NODE_STYLES.SEED_LANTERN,
            ODYSSEY_NODE_STYLES.CAIRN_LANTERN,
            ODYSSEY_NODE_STYLES.CLOUD_WISP,
            ODYSSEY_NODE_STYLES.STARLIT_ORB,
            ODYSSEY_NODE_STYLES.LENSED_SHARD,
            ODYSSEY_NODE_STYLES.NEON_SIGN,
        ]);
        expect(chapterShells.map((shell) => shell.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it('falls back to chapter 1 styling for unknown chapters', () => {
        expect(resolveOdysseyNodeShellStyle(99, 12)).toMatchObject({
            style: ODYSSEY_NODE_STYLES.MAGMA_GEODE,
            index: 0,
            baseColor: 0xff4400,
            accentColor: 0xffaa44,
        });
    });
});
