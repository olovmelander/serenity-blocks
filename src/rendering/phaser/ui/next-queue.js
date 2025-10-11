import { SHAPES, COLORS } from '../../../core/constants.js';

const TITLE_COLOR = '#a78bfa';
const PANEL_BG_COLOR = 0x000000;
const PANEL_BORDER_COLOR = 0x8b5cf6;
const HIGHLIGHT_COLOR = 0xef4444;

/**
 * Lightweight renderer for the next piece queue.
 * Draws upcoming tetrominoes using mini blocks inside a panel.
 * Supports both horizontal and vertical layouts.
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
     * @param {string} [config.layout='vertical'] - 'vertical' or 'horizontal'
     */
    constructor(scene, config = {}) {
        this.scene = scene;
        this.blockSize = config.blockSize ?? 12;
        this.maxVisible = config.maxVisible ?? 3;
        this.padding = config.padding ?? 12;
        this.layout = config.layout ?? 'vertical';
        this.itemGap = config.itemGap ?? 10;
        this.entrySpacing = this.blockSize * 4 + this.itemGap;
        this.entryWidth = this.blockSize * 4;
        this.entryHeight = this.blockSize * 4;

        this.container = scene.add.container(config.x ?? 0, config.y ?? 0);
        this.container.setDepth(config.depth ?? 50);
        this.currentKeys = [];

        this.background = scene.add.graphics();
        this.background.setDepth(-1);
        this.container.add(this.background);

        this.title = scene.add.text(0, 0, 'NEXT', {
            fontFamily: 'Orbitron',
            fontSize: `${Math.round(this.blockSize * 1.2)}px`,
            color: TITLE_COLOR,
            letterSpacing: 1,
        });
        this.title.setDepth(1);
        this.container.add(this.title);

        this.itemContainers = [];

        this.panelWidth = this.calculatePanelWidth(this.maxVisible);
        this.panelHeight = this.calculatePanelHeight(this.maxVisible);

        this.alignTitle();
        this.redrawBackground(this.panelWidth, this.panelHeight);
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

        for (let i = 0; i < visibleCount; i++) {
            const pieceKey = truncated[i];
            if (!pieceKey || !SHAPES[pieceKey]) continue;

            const shape = SHAPES[pieceKey];
            const colorHex = COLORS[pieceKey] || '#ffffff';
            const isFirst = i === 0;
            const item = this.createPieceEntry(shape, colorHex, isFirst);

            if (this.layout === 'horizontal') {
                const xStart = this.isTitleVertical()
                    ? this.title.width + this.padding * 1.5
                    : this.padding;
                const offsetX = xStart + i * this.entrySpacing;
                item.setPosition(offsetX, this.padding);
            } else {
                const yStart = this.title.y + this.title.height + this.padding * 0.75;
                const offsetY = yStart + i * this.entrySpacing;
                item.setPosition(this.padding, offsetY);
            }

            this.container.add(item);
            this.itemContainers.push(item);
        }

        const width = this.calculatePanelWidth(visibleCount);
        const height = this.calculatePanelHeight(visibleCount);
        this.redrawBackground(width, height);
    }

    alignTitle() {
        if (this.layout === 'horizontal' && this.isTitleVertical()) {
            this.title.setPosition(this.padding, this.padding);
        } else {
            this.title.setPosition(this.padding, this.padding);
        }
    }

    isTitleVertical() {
        return this.layout === 'horizontal';
    }

    arraysEqual(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

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

    calculatePanelWidth(visibleCount) {
        if (this.layout === 'vertical') {
            return this.entryWidth + this.padding * 2;
        }

        const titleWidth = this.isTitleVertical() ? this.title.width + this.padding * 0.5 : 0;
        if (visibleCount === 0) {
            return Math.max(
                titleWidth + this.padding * 2 + this.entryWidth,
                this.panelWidth,
            );
        }

        const itemsWidth = visibleCount * this.entrySpacing - this.itemGap;
        return titleWidth + itemsWidth + this.padding * 2;
    }

    calculatePanelHeight(visibleCount) {
        if (this.layout === 'horizontal') {
            return this.entryHeight + this.padding * 2;
        }

        if (visibleCount === 0) {
            return Math.max(
                this.padding * 2 + this.title.height + this.entryHeight,
                this.panelHeight,
            );
        }

        const yStart = this.title.y + this.title.height + this.padding * 0.75;
        const lastItemBottom = yStart + (visibleCount - 1) * this.entrySpacing + this.entryHeight;
        return lastItemBottom + this.padding;
    }

    redrawBackground(width, height) {
        this.panelWidth = width;
        this.panelHeight = height;
        this.background.clear();
        this.background.fillStyle(PANEL_BG_COLOR, 0); // Transparent background
        this.background.fillRoundedRect(0, 0, width, height, 12);
        this.background.lineStyle(2, PANEL_BORDER_COLOR, 0); // No border
        this.background.strokeRoundedRect(0, 0, width, height, 12);
    }

    createPieceEntry(shape, colorHex, isFirst = false) {
        const entry = this.scene.add.container(0, 0);
        const blockCanvas = this.scene.add.graphics();
        entry.add(blockCanvas);

        const outline = this.scene.add.graphics();
        const outlineColor = isFirst ? HIGHLIGHT_COLOR : PANEL_BORDER_COLOR;
        const alpha = isFirst ? 0.9 : 0.4;
        const thickness = isFirst ? 3 : 2;

        outline.lineStyle(thickness, outlineColor, alpha);
        outline.strokeRoundedRect(
            -this.padding * 0.4,
            -this.padding * 0.4,
            this.entryWidth + this.padding * 0.8,
            this.entryHeight + this.padding * 0.8,
            8,
        );
        entry.addAt(outline, 0);

        const glow = this.scene.add.graphics();
        if (isFirst) {
            glow.fillStyle(HIGHLIGHT_COLOR, 0.3);
            glow.fillRoundedRect(
                -this.padding * 0.4,
                -this.padding * 0.4,
                this.entryWidth + this.padding * 0.8,
                this.entryHeight + this.padding * 0.8,
                8,
            );
            entry.add(glow);
        }

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

        graphics.fillStyle(0xffffff, 0.25);
        graphics.fillRect(x, y, size, Math.max(1, Math.round(size * 0.1)));
        graphics.fillRect(x, y, Math.max(1, Math.round(size * 0.1)), size);

        graphics.fillStyle(0x000000, 0.25);
        graphics.fillRect(
            x,
            y + size - Math.max(1, Math.round(size * 0.1)),
            size,
            Math.max(1, Math.round(size * 0.1)),
        );
        graphics.fillRect(
            x + size - Math.max(1, Math.round(size * 0.1)),
            y,
            Math.max(1, Math.round(size * 0.1)),
            size,
        );

        graphics.lineStyle(1, 0x000000, 0.35);
        graphics.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    }
}
