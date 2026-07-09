/**
 * @fileoverview Odyssey board-view HUD overlay (header bar + chapter-arrival card + level panel).
 *
 * Extracted verbatim from OdysseyMode._createBoardInfoOverlay (masterplan E1). Pure DOM/CSS: it
 * builds and returns the overlay + its <style> element. OdysseyMode keeps the wiring (mounting,
 * header-progress refresh, and the play-button → launchOdysseyLevel handler) since those need
 * mode state — so this module stays dependency-free and view-only.
 */

/**
 * Build the board-view HUD overlay.
 * @returns {{overlay: HTMLElement, style: HTMLStyleElement}} the overlay + its style element
 *   (caller appends both, wires the #level-panel-play-btn, and refreshes header progress)
 */
export function createBoardInfoOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'odyssey-board-overlay';
    overlay.innerHTML = `
        <div class="odyssey-header-bar">
            <h1>Odyssey Mode</h1>
            <div class="odyssey-progress-info">
                <span id="odyssey-header-stars">⭐ 0/168</span>
                <span id="odyssey-header-progress">Progress: 0%</span>
            </div>
        </div>
        <div id="odyssey-chapter-arrival-card" class="odyssey-chapter-arrival-card" aria-live="polite">
            <div id="odyssey-arrival-kicker" class="odyssey-arrival-kicker">Chapter 1</div>
            <div id="odyssey-arrival-title" class="odyssey-arrival-title">Earth Core</div>
            <div id="odyssey-arrival-subtitle" class="odyssey-arrival-subtitle">Find your first rhythm</div>
        </div>
        <div id="odyssey-level-panel" class="odyssey-level-panel hidden">
            <div id="level-panel-number" class="level-number-badge">LEVEL 1</div>
            <h2 id="level-panel-name">Level Name</h2>
            <p id="level-panel-chapter" class="level-chapter">Chapter 1</p>
            <p id="level-panel-description" class="level-description">Description...</p>
            <div id="level-panel-stars" class="level-stars">☆☆☆</div>
            <div id="level-panel-objectives" class="level-objectives"></div>
            <button id="level-panel-play-btn" class="level-play-btn">▶ Play</button>
        </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.id = 'odyssey-board-overlay-styles';
    style.textContent = `
        #odyssey-board-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1001;
        }
        .odyssey-header-bar {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem 2rem;
            background: linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%);
            pointer-events: auto;
        }
        .odyssey-header-bar h1 {
            font-family: 'Orbitron', sans-serif;
            font-size: 1.5rem;
            color: #00ffcc;
            text-shadow: 0 0 10px #00ffcc;
            margin: 0;
        }
        .odyssey-progress-info {
            display: flex;
            gap: 2rem;
            font-size: 1rem;
            color: #88aaff;
        }
        .odyssey-chapter-arrival-card {
            position: absolute;
            left: 50%;
            top: 18%;
            transform: translate(-50%, -10px);
            min-width: min(460px, calc(100vw - 48px));
            max-width: min(620px, calc(100vw - 48px));
            text-align: center;
            opacity: 0;
            pointer-events: none;
            color: #eef7ff;
            text-shadow: 0 0 18px rgba(0, 255, 204, 0.42);
            transition: opacity 260ms ease, transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .odyssey-chapter-arrival-card.visible {
            opacity: 1;
            transform: translate(-50%, 0);
        }
        .odyssey-arrival-kicker {
            font-family: 'Space Mono', monospace;
            font-size: 0.78rem;
            letter-spacing: 0;
            text-transform: uppercase;
            color: rgba(180, 226, 255, 0.78);
            margin-bottom: 0.35rem;
        }
        .odyssey-arrival-title {
            font-family: 'Orbitron', sans-serif;
            font-size: clamp(1.45rem, 4vw, 2.6rem);
            line-height: 1.05;
            color: #ffffff;
        }
        .odyssey-arrival-subtitle {
            margin-top: 0.45rem;
            font-size: clamp(0.85rem, 2vw, 1.05rem);
            color: rgba(208, 226, 255, 0.76);
        }
        .odyssey-level-panel {
            position: absolute;
            right: 2rem;
            top: 50%;
            transform: translateY(-50%);
            width: 320px;
            background: rgba(10, 20, 40, 0.95);
            border: 1px solid rgba(100, 150, 255, 0.3);
            border-radius: 12px;
            padding: 1.5rem;
            pointer-events: auto;
            box-shadow: 0 0 30px rgba(0, 100, 255, 0.2);
        }
        .odyssey-level-panel.hidden {
            display: none;
        }
        .level-number-badge {
            display: inline-block;
            padding: 0.35rem 0.75rem;
            background: linear-gradient(135deg, rgba(0, 170, 255, 0.2), rgba(0, 255, 204, 0.2));
            border: 1px solid rgba(0, 255, 204, 0.4);
            border-radius: 6px;
            font-family: 'Orbitron', sans-serif;
            font-size: 0.7rem;
            font-weight: 600;
            letter-spacing: 1.5px;
            color: #00ffcc;
            text-shadow: 0 0 8px rgba(0, 255, 204, 0.5);
            margin-bottom: 0.75rem;
            box-shadow: 0 0 15px rgba(0, 255, 204, 0.15);
        }
        .odyssey-level-panel h2 {
            margin: 0 0 0.5rem 0;
            font-size: 1.4rem;
            color: #00ffcc;
            font-family: 'Orbitron', sans-serif;
        }
        .level-chapter {
            color: #88aaff;
            font-size: 0.9rem;
            margin: 0 0 1rem 0;
        }
        .level-description {
            color: #aabbcc;
            font-size: 0.95rem;
            line-height: 1.4;
            margin: 0 0 1rem 0;
        }
        .level-stars {
            font-size: 2rem;
            text-align: center;
            margin: 1rem 0;
            letter-spacing: 0.5rem;
        }
        .level-objectives {
            margin: 1rem 0;
            padding: 0.75rem;
            background: rgba(0,0,0,0.3);
            border-radius: 6px;
        }
        .level-objectives div {
            padding: 0.3rem 0;
            font-size: 0.9rem;
            color: #aabbcc;
        }
        .level-play-btn {
            width: 100%;
            padding: 1rem;
            background: linear-gradient(135deg, #00aa88, #0088aa);
            border: none;
            border-radius: 8px;
            color: white;
            font-size: 1.2rem;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
        }
        .level-play-btn:hover {
            background: linear-gradient(135deg, #00ccaa, #00aacc);
            transform: scale(1.02);
        }
        .level-play-btn:disabled {
            background: #444;
            cursor: not-allowed;
        }
        @keyframes btn-click-pulse {
            0% { transform: scale(1); box-shadow: 0 0 0 rgba(255, 255, 255, 0); }
            20% { transform: scale(0.92); box-shadow: 0 0 20px rgba(0, 255, 200, 0.8); background: #ffffff; color: #000; }
            50% { transform: scale(1.05); box-shadow: 0 0 10px rgba(0, 255, 200, 0.5); background: #ccffee; }
            100% { transform: scale(1); box-shadow: 0 0 15px rgba(0, 255, 200, 0.4); }
        }
        @keyframes btn-launch-shimmer {
            0% { background-position: 0% 50%; }
            100% { background-position: 200% 50%; }
        }
        .level-play-btn:active {
            transform: scale(0.95);
        }
        .level-play-btn.clicked {
            /* Dynamic gradient background */
            background: linear-gradient(110deg, #00aa88 20%, #00ffcc 30%, #ffffff 50%, #00ffcc 70%, #00aa88 80%);
            background-size: 200% 100%;
            color: #003322;
            text-shadow: 0 0 5px rgba(255, 255, 255, 0.5);
            font-weight: 800;
            
            /* Sequence: Pulse (0.6s) then Shimmer (loop) */
            animation: 
                btn-click-pulse 0.6s ease-out forwards,
                btn-launch-shimmer 2s linear infinite;
            
            pointer-events: none;
            border: 1px solid #ffffff;
        }
    `;

    return { overlay, style };
}

export default createBoardInfoOverlay;
