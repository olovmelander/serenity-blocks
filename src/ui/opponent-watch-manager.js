import { SHAPES } from '../core/constants.js';

/**
 * OpponentWatchManager - Manages the 2x2 grid of opponent mini-boards
 *
 * Features:
 * - Maximum 4 visible opponents at a time
 * - Click to swap watched players
 * - Auto-watch selects 4 alive players automatically
 * - Canvas-based rendering for performance with many players
 */
export class OpponentWatchManager {
    constructor(container) {
        this.container = container;
        this.watchedPlayers = []; // Max 4 player IDs
        this.playerBoards = new Map(); // playerId -> { canvas, ctx, nextCtx, name, element }
        this.allPlayers = [];
        this.localPlayerId = null;
        this.maxVisible = 4;

        // Block colors for rendering (matching Phaser theme)
        this.blockColors = {
            I: '#00f0f0',
            O: '#f0f000',
            T: '#a000f0',
            S: '#00f000',
            Z: '#f00000',
            J: '#0000f0',
            L: '#f0a000',
            G: '#808080', // Garbage
        };
    }

    /**
     * Set the local player ID (to exclude from watch list)
     */
    setLocalPlayer(playerId) {
        this.localPlayerId = playerId;
    }

    /**
     * Set all players in the match
     * @param {Array} players - Array of player objects { id, name, isAlive, frags, grid }
     */
    setPlayers(players) {
        // Filter out the local player
        this.allPlayers = players.filter((p) => p.id !== this.localPlayerId);
        this.autoSelectOpponents();
    }

    /**
     * Auto-select up to 4 opponents (prioritize alive players)
     */
    autoSelectOpponents() {
        const alive = this.allPlayers.filter((p) => p.isAlive !== false);
        const dead = this.allPlayers.filter((p) => p.isAlive === false);

        // Keep currently watched alive players if possible
        const currentAlive = this.watchedPlayers.filter((id) => alive.some((p) => p.id === id));

        // Fill remaining slots with other alive players
        const newAlive = alive
            .filter((p) => !currentAlive.includes(p.id))
            .slice(0, this.maxVisible - currentAlive.length)
            .map((p) => p.id);

        this.watchedPlayers = [...currentAlive, ...newAlive];

        // If still room, add dead players
        if (this.watchedPlayers.length < this.maxVisible) {
            const additionalDead = dead
                .filter((p) => !this.watchedPlayers.includes(p.id))
                .slice(0, this.maxVisible - this.watchedPlayers.length)
                .map((p) => p.id);
            this.watchedPlayers.push(...additionalDead);
        }

        this.updateDisplay();
        this.updateWatchingCount();
    }

    /**
     * Toggle watching a specific player
     */
    toggleWatch(playerId) {
        const index = this.watchedPlayers.indexOf(playerId);
        if (index !== -1) {
            // Already watching - remove
            this.watchedPlayers.splice(index, 1);
        } else {
            // Not watching - add (replace oldest if at max)
            if (this.watchedPlayers.length >= this.maxVisible) {
                this.watchedPlayers.shift();
            }
            this.watchedPlayers.push(playerId);
        }
        this.updateDisplay();
        this.updateWatchingCount();
    }

    /**
     * Update the display of mini-boards
     */
    updateDisplay() {
        if (!this.container) return;

        // Clear container
        this.container.innerHTML = '';
        this.playerBoards.clear();

        // Create mini-board for each watched player
        this.watchedPlayers.forEach((playerId) => {
            const player = this.allPlayers.find((p) => p.id === playerId);
            if (!player) return;

            const boardEl = this._createMiniBoardElement(player);
            this.container.appendChild(boardEl);

            const canvas = boardEl.querySelector('canvas.opponent-grid');
            const nextCanvas = boardEl.querySelector('canvas.next-queue-canvas');

            this.playerBoards.set(playerId, {
                canvas,
                ctx: canvas.getContext('2d'),
                nextCtx: nextCanvas ? nextCanvas.getContext('2d') : null,
                name: player.name,
                element: boardEl,
            });

            // Initial render
            if (player.grid) {
                this._renderMiniBoard(this.playerBoards.get(playerId).ctx, player.grid, player.currentPiece);
            }
        });
    }

    /**
     * Update watching count display
     */
    updateWatchingCount() {
        const countEl = document.getElementById('watching-count');
        if (countEl) {
            countEl.textContent = `${this.watchedPlayers.length}/${this.maxVisible}`;
        }
    }

    /**
     * Create a mini-board DOM element for a player
     */
    _createMiniBoardElement(player) {
        const div = document.createElement('div');
        div.className = `opponent-mini-board ${player.isAlive === false ? 'dead' : ''}`;
        div.dataset.playerId = player.id;

        div.innerHTML = `
            <div class="opponent-next-queue">
                <canvas class="next-queue-canvas" width="96" height="24"></canvas>
            </div>
            <canvas class="opponent-grid" width="80" height="160"></canvas>
            <span class="opponent-name">${this._escapeHtml(player.name)}</span>
            <span class="opponent-frags">⚔️ ${player.frags || 0}</span>
        `;

        // Click to swap/unwatch
        div.onclick = () => this.toggleWatch(player.id);

        return div;
    }

    /**
     * Update all mini-boards from network state
     * @param {Array} playerStates - Array of player state objects
     */
    updateFromState(playerStates) {
        if (!playerStates) return;

        playerStates.forEach((state) => {
            const board = this.playerBoards.get(state.id);
            if (board) {
                // Update the canvas
                this._renderMiniBoard(board.ctx, state.grid, state.currentPiece);

                // Update next queue
                if (state.nextPieces && board.nextCtx) {
                    this._renderNextQueue(board.nextCtx, state.nextPieces);
                }

                // Update alive status
                if (state.isAlive === false && !board.element.classList.contains('dead')) {
                    board.element.classList.add('dead');
                } else if (state.isAlive !== false && board.element.classList.contains('dead')) {
                    board.element.classList.remove('dead');
                }

                // Update frags display
                const fragsEl = board.element.querySelector('.opponent-frags');
                if (fragsEl) {
                    fragsEl.textContent = `⚔️ ${state.frags || 0}`;
                }

                // Apply player color to border
                if (state.color) {
                    board.element.style.borderColor = state.color;
                }
            }
        });

        // Update unwatched list
        this._updateUnwatchedList(playerStates);
    }

    /**
     * Render next queue for opponent
     */
    _renderNextQueue(ctx, nextPieces) {
        if (!ctx || !nextPieces) return;

        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        // Draw up to 3 next pieces
        const blockSize = 6; // Smaller blocks for next pieces
        const spacing = 32; // Spacing between pieces

        for (let i = 0; i < Math.min(3, nextPieces.length); i++) {
            const shapeKey = nextPieces[i];
            const shape = SHAPES[shapeKey];
            const color = this.blockColors[shapeKey] || '#fff';

            if (!shape) continue;

            // Center in slot
            const pieceWidth = shape[0].length * blockSize;
            const pieceHeight = shape.length * blockSize;

            const startX = (i * spacing) + (spacing - pieceWidth) / 2;
            const startY = (ctx.canvas.height - pieceHeight) / 2;

            ctx.fillStyle = color;
            for (let r = 0; r < shape.length; r++) {
                for (let c = 0; c < shape[r].length; c++) {
                    if (shape[r][c]) {
                        ctx.fillRect(startX + c * blockSize, startY + r * blockSize, blockSize - 1, blockSize - 1);
                    }
                }
            }
        }
    }

    /**
     * Update the list of unwatched players
     */
    _updateUnwatchedList(playerStates) {
        const unwatchedContainer = document.getElementById('unwatched-list');
        if (!unwatchedContainer) return;

        const unwatched = this.allPlayers.filter((p) => !this.watchedPlayers.includes(p.id));

        if (unwatched.length === 0) {
            unwatchedContainer.innerHTML = '';
            return;
        }

        unwatchedContainer.innerHTML = `
            <div class="unwatched-list-title">Others (${unwatched.length})</div>
            ${unwatched.map((p) => {
            const state = playerStates?.find((s) => s.id === p.id) || p;
            return `
                    <div class="unwatched-player ${state.isAlive === false ? 'dead' : ''}" 
                         data-player-id="${p.id}">
                        <span>${this._escapeHtml(p.name)}</span>
                        <span>⚔️ ${state.frags || 0}</span>
                    </div>
                `;
        }).join('')}
        `;

        // Add click handlers
        unwatchedContainer.querySelectorAll('.unwatched-player').forEach((el) => {
            el.onclick = () => this.toggleWatch(el.dataset.playerId);
        });
    }

    /**
     * Render a mini-board to canvas
     * Uses 8px block size for compact display
     */
    _renderMiniBoard(ctx, grid, currentPiece) {
        if (!ctx || !grid) return;

        const blockSize = 8;
        // Skip spawn area rows (0-3), display rows 4-23 as visible rows 0-19

        // Clear canvas
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        // Draw grid cells (rows 4-23 visible as rows 0-19)
        for (let row = 4; row < 24; row++) {
            for (let col = 0; col < 10; col++) {
                const cell = grid[row]?.[col];
                if (cell && cell !== 0) {
                    // Get color from cell (could be object with color or piece type)
                    let color = this.blockColors.G; // Default garbage color
                    if (typeof cell === 'object' && cell.color) {
                        ({ color } = cell);
                    } else if (typeof cell === 'string') {
                        color = this.blockColors[cell] || color;
                    }

                    ctx.fillStyle = color;
                    ctx.fillRect(
                        col * blockSize,
                        (row - 4) * blockSize,
                        blockSize - 1,
                        blockSize - 1,
                    );
                }
            }
        }

        if (currentPiece && currentPiece.shape) {
            const ghostY = this._calculateGhostY(currentPiece, grid);
            if (ghostY > currentPiece.y) {
                this._drawPiece(ctx, currentPiece, ghostY, blockSize, true);
            }

            this._drawPiece(ctx, currentPiece, currentPiece.y, blockSize, false);
        }
    }

    _drawPiece(ctx, piece, pieceY, blockSize, isGhost) {
        const shape = piece.shape;
        if (!shape) return;

        const pieceKey = piece.type || piece.shapeKey;
        const pieceColor = piece.color || this.blockColors[pieceKey] || '#fff';

        if (isGhost) {
            ctx.save();
            ctx.globalAlpha = 0.35;
        }

        ctx.fillStyle = pieceColor;
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (!shape[row][col]) continue;

                const drawRow = pieceY + row - 4;
                const drawCol = piece.x + col;

                if (drawRow >= 0 && drawRow < 20 && drawCol >= 0 && drawCol < 10) {
                    ctx.fillRect(
                        drawCol * blockSize,
                        drawRow * blockSize,
                        blockSize - 1,
                        blockSize - 1,
                    );
                }
            }
        }

        if (isGhost) {
            ctx.restore();
        }
    }

    _calculateGhostY(piece, grid) {
        let ghostY = piece.y;
        while (this._canPlacePiece(piece, grid, piece.x, ghostY + 1)) {
            ghostY++;
        }
        return ghostY;
    }

    _canPlacePiece(piece, grid, checkX, checkY) {
        const shape = piece.shape;
        if (!shape) return false;

        const rows = grid.length || 0;
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (!shape[row][col]) continue;

                const boardX = Math.floor(checkX + col);
                const boardY = Math.floor(checkY + row);

                if (boardX < 0 || boardX >= 10 || boardY >= rows) {
                    return false;
                }

                if (boardY >= 0) {
                    const cell = grid[boardY]?.[boardX];
                    if (cell && cell !== 0) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Escape HTML to prevent XSS
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.playerBoards.clear();
        this.watchedPlayers = [];
        this.allPlayers = [];
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}
