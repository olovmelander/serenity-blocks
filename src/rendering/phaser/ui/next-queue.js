import { SHAPES, COLORS } from '../../../core/constants.js';

const TITLE_COLOR = '#a78bfa';
const PANEL_BG_COLOR = 0x000000;
const PANEL_BORDER_COLOR = 0x8b5cf6;

/**
 * Lightweight renderer for the next piece queue.
 * Draws up to five upcoming tetrominoes using mini blocks inside a panel.
 */
export class NextQueuePanel {
    /**
     * @param {Phaser.Scene} scene
     * @param {Object} [config]
     * @param {number} [config.x=0]
     * @param {number} [config.y=0]
     * @param {number} [config.blockSize=12]
     * @param {number} [config.maxVisible=5]
     * @param {number} [config.depth=50]
     */
    constructor(scene, config = {}) {
        this.scene = scene;
        this.blockSize = config.blockSize ?? 12;
        this.maxVisible = config.maxVisible ?? 5;
        this.padding = config.padding ?? 12;
        this.entrySpacing = this.blockSize * 4 + (config.itemGap ?? 10);
        this.entryWidth = this.blockSize * 4;
        this.entryHeight = this.blockSize * 4;

        this.container = scene.add.container(config.x ?? 0, config.y ?? 0);
        this.container.setDepth(config.depth ?? 50);
        this.currentKeys = [];

        this.background = scene.add.graphics();
        this.background.setDepth(-1);
        this.container.add(this.background);

        this.title = scene.add.text(this.padding, this.padding, 'NEXT', {
            fontFamily: 'Orbitron',
            fontSize: `${Math.round(this.blockSize * 1.2)}px`,
            color: TITLE_COLOR,
            letterSpacing: 1,
        });
        this.title.setDepth(1);
        this.container.add(this.title);

        this.itemContainers = [];
        this.panelWidth = this.entryWidth + this.padding * 2;
        this.panelHeight = this.padding * 2 + this.title.height + this.entryHeight * this.maxVisible;

        this.redrawBackground(this.panelHeight);
    }

    /**
     * Update the queue with a list of piece keys.
     * @param {string[]} nextPieces
     */
    setPieces(nextPieces = []) {
        const truncated = nextPieces.slice(0, this.maxVisible);
        if (this.arraysEqual(this.currentKeys, truncated)) {
            return;
        }
        this.currentKeys = truncated.slice();

        this.clearItems();

        const visibleCount = Math.min(this.maxVisible, truncated.length);
        const yStart = this.title.y + this.title.height + this.padding * 0.75;

        for (let i = 0; i < visibleCount; i++) {
            const pieceKey = truncated[i];
            if (!pieceKey || !SHAPES[pieceKey]) continue;

            const shape = SHAPES[pieceKey];
            const colorHex = COLORS[pieceKey] || '#ffffff';
            const item = this.createPieceEntry(shape, colorHex);

            const offsetY = yStart + i * this.entrySpacing;
            item.setPosition(this.padding, offsetY);

            this.container.add(item);
            this.itemContainers.push(item);
        }

        const totalHeight = this.calculatePanelHeight(visibleCount, yStart);
        this.redrawBackground(totalHeight);
    }

    arraysEqual(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    /**
     * Destroy resources when no longer needed.
     */
    destroy() {
        this.clearItems();
        this.title?.destroy();
        this.background?.destroy();
        this.container?.destroy();
    }

    clearItems() {
        this.itemContainers.forEach((child) => child.destroy());
        this.itemContainers.length = 0;
    }

    calculatePanelHeight(visibleCount, yStart) {
        if (visibleCount === 0) {
            return Math.max(
                this.padding * 2 + this.title.height + this.blockSize * 2,
                this.panelHeight,
            );
        }

        const lastItemBottom = yStart + (visibleCount - 1) * this.entrySpacing + this.entryHeight;
        return lastItemBottom + this.padding;
    }

    redrawBackground(height) {
        this.panelHeight = height;
        this.background.clear();
        this.background.fillStyle(PANEL_BG_COLOR, 0.35);
        this.background.fillRoundedRect(0, 0, this.panelWidth, height, 12);
        this.background.lineStyle(2, PANEL_BORDER_COLOR, 0.4);
        this.background.strokeRoundedRect(0, 0, this.panelWidth, height, 12);
    }

    createPieceEntry(shape, colorHex) {
        const entry = this.scene.add.container(0, 0);
        const blockCanvas = this.scene.add.graphics();
        entry.add(blockCanvas);

        const outline = this.scene.add.graphics();
        outline.lineStyle(1, 0xffffff, 0.08);
        outline.strokeRoundedRect(
            -this.padding * 0.4,
            -this.padding * 0.4,
            this.entryWidth + this.padding * 0.8,
            this.entryHeight + this.padding * 0.8,
            8,
        );
        entry.addAt(outline, 0);

        const colorInt = Phaser.Display.Color.HexStringToColor(colorHex).color;
        const rows = shape.length;
        const cols = shape[0].length;

        const contentWidth = cols * this.blockSize;
        const contentHeight = rows * this.blockSize;
        const offsetX = (this.entryWidth - contentWidth) / 2;
        const offsetY = (this.entryHeight - contentHeight) / 2;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (shape[row][col] <= 0) continue;

                const x = offsetX + col * this.blockSize;
                const y = offsetY + row * this.blockSize;
                this.drawMiniBlock(blockCanvas, x, y, colorInt);
            }
        }

        return entry;
    }

    drawMiniBlock(graphics, x, y, colorInt) {
        const size = this.blockSize;
        graphics.fillStyle(colorInt, 1);
        graphics.fillRect(x, y, size, size);

        // Highlights & shadows for subtle depth
        graphics.fillStyle(0xffffff, 0.25);
        graphics.fillRect(x, y, size, Math.max(1, Math.round(size * 0.2)));
        graphics.fillRect(x, y, Math.max(1, Math.round(size * 0.2)), size);

        graphics.fillStyle(0x000000, 0.25);
        graphics.fillRect(
            x,
            y + size - Math.max(1, Math.round(size * 0.2)),
            size,
            Math.max(1, Math.round(size * 0.2)),
        );
        graphics.fillRect(
            x + size - Math.max(1, Math.round(size * 0.2)),
            y,
            Math.max(1, Math.round(size * 0.2)),
            size,
        );

        graphics.lineStyle(1, 0x000000, 0.35);
        graphics.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    }
}
