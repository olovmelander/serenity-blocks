/**
 * @fileoverview Odyssey legacy level-select navigator scaffold (header + chapters host + back).
 *
 * Extracted verbatim from OdysseyMode._createLevelSelectUI (masterplan E1). Builds the static
 * shell (header/progress bar, empty #odyssey-chapters host, back button) + its de-duped <style>,
 * mounts them, and returns the container. The DATA (chapters/levels/progress) is populated
 * separately by OdysseyMode._updateLevelSelectUI, and the back-button handler (which needs
 * mode state) is wired by the caller — so this module stays view-only + dependency-free.
 */

/**
 * Build + mount the level-select shell.
 * @returns {HTMLElement} the container (caller wires #odyssey-back-btn and populates chapters)
 */
export function createLevelSelectOverlay() {
    const container = document.createElement('div');
    container.id = 'odyssey-level-select';
    container.className = 'odyssey-level-select';
    container.innerHTML = `
        <div class="odyssey-header">
            <h1>Odyssey Mode</h1>
            <div class="odyssey-progress">
                <span class="odyssey-stars">Stars: <span id="odyssey-total-stars">0</span>/<span id="odyssey-max-stars">168</span></span>
                <span class="odyssey-completion">Progress: <span id="odyssey-progress-pct">0</span>%</span>
            </div>
            <div class="odyssey-progress-bar"><div class="odyssey-progress-fill" id="odyssey-progress-fill"></div></div>
        </div>
        <div class="odyssey-chapters" id="odyssey-chapters"></div>
        <div class="odyssey-actions">
            <button id="odyssey-back-btn" class="odyssey-btn">Back to Menu</button>
        </div>
    `;

    // Add styles (Cosmic Serenity — gold "Odyssey" accent; guard against dupes)
    const styleId = 'odyssey-level-select-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
        .odyssey-level-select {
            --cs-accent: #fcd17a;
            --cs-accent-rgb: 252, 209, 122;
            --cs-accent-2: #ffb75e;
            --cs-done-rgb: 94, 234, 212;
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            background:
                radial-gradient(120% 80% at 50% -10%, rgba(var(--cs-accent-rgb), 0.10), transparent 60%),
                radial-gradient(90% 70% at 12% 0%, rgba(142, 162, 255, 0.08), transparent 60%),
                linear-gradient(180deg, #0c0e1c 0%, #07080f 100%);
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 2.4rem 2rem;
            z-index: 1002;
            overflow-y: auto;
            box-sizing: border-box;
            animation: ods-fade 0.4s ease both;
            scrollbar-width: thin;
            scrollbar-color: rgba(var(--cs-accent-rgb), 0.6) rgba(0, 0, 0, 0.2);
        }

        .odyssey-level-select::-webkit-scrollbar { width: 10px; }
        .odyssey-level-select::-webkit-scrollbar-track { background: transparent; }
        .odyssey-level-select::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, rgba(var(--cs-accent-rgb), 0.7), rgba(255, 183, 94, 0.5));
            border: 2px solid transparent;
            background-clip: padding-box;
            border-radius: 6px;
        }

        .odyssey-header {
            text-align: center;
            margin-bottom: 2rem;
        }

        .odyssey-header h1 {
            font-family: 'Orbitron', monospace;
            font-size: clamp(2rem, 4vw, 2.6rem);
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: transparent;
            -webkit-text-fill-color: transparent;
            background: linear-gradient(100deg,
                    #fff3d6 0%, var(--cs-accent) 38%, var(--cs-accent-2) 64%, #fffaf0 100%);
            background-size: 220% auto;
            -webkit-background-clip: text;
            background-clip: text;
            filter: drop-shadow(0 0 20px rgba(var(--cs-accent-rgb), 0.32));
            margin: 0 0 0.6rem;
            animation: ods-shimmer 8s ease-in-out infinite;
        }

        .odyssey-progress {
            display: flex;
            gap: 1.6rem;
            justify-content: center;
            font-family: 'Space Mono', monospace;
            font-size: 0.95rem;
            color: rgba(211, 219, 245, 0.55);
        }

        .odyssey-stars {
            color: var(--cs-accent);
            font-weight: 700;
        }

        .odyssey-progress-bar {
            width: 260px;
            height: 6px;
            margin: 0.85rem auto 0;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(var(--cs-accent-rgb), 0.18);
            overflow: hidden;
        }

        .odyssey-progress-fill {
            height: 100%;
            width: 0%;
            border-radius: 999px;
            background: linear-gradient(90deg, var(--cs-accent), var(--cs-accent-2));
            box-shadow: 0 0 12px rgba(var(--cs-accent-rgb), 0.5);
            transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .odyssey-chapters {
            display: flex;
            flex-direction: column;
            gap: 1.1rem;
            max-width: 840px;
            width: 100%;
        }

        .odyssey-chapter {
            position: relative;
            background:
                radial-gradient(120% 100% at 0% 0%, rgba(var(--cs-accent-rgb), 0.05), transparent 55%),
                linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(8, 10, 23, 0.45));
            border: 1px solid rgba(150, 180, 255, 0.10);
            border-radius: 16px;
            padding: 1.1rem 1.2rem;
            box-shadow:
                inset 0 1px 0 rgba(255, 255, 255, 0.04),
                0 14px 32px rgba(0, 0, 0, 0.18);
            transition: border-color 0.25s ease, box-shadow 0.25s ease;
        }

        .odyssey-chapter:hover {
            border-color: rgba(var(--cs-accent-rgb), 0.28);
            box-shadow:
                inset 0 1px 0 rgba(255, 255, 255, 0.05),
                0 18px 40px rgba(0, 0, 0, 0.24),
                0 0 26px rgba(var(--cs-accent-rgb), 0.08);
        }

        .odyssey-chapter.current {
            border-color: rgba(var(--cs-accent-rgb), 0.45);
            box-shadow:
                inset 0 1px 0 rgba(255, 255, 255, 0.05),
                0 0 28px rgba(var(--cs-accent-rgb), 0.14);
        }

        .odyssey-chapter.complete {
            border-color: rgba(var(--cs-accent-rgb), 0.22);
        }

        .odyssey-chapter-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 0.9rem;
        }

        .odyssey-chapter-name {
            font-family: 'Orbitron', monospace;
            font-size: 1.05rem;
            color: #eef3ff;
            letter-spacing: 0.01em;
        }

        .odyssey-chapter-stars {
            flex-shrink: 0;
            color: var(--cs-accent);
            font-family: 'Space Mono', monospace;
            font-size: 0.82rem;
            font-weight: 700;
            white-space: nowrap;
            padding: 3px 11px;
            border-radius: 999px;
            background: rgba(var(--cs-accent-rgb), 0.10);
            border: 1px solid rgba(var(--cs-accent-rgb), 0.28);
        }

        .odyssey-chapter.complete .odyssey-chapter-stars {
            background: rgba(var(--cs-accent-rgb), 0.20);
            border-color: rgba(var(--cs-accent-rgb), 0.50);
            color: #fff3d6;
            box-shadow: 0 0 14px rgba(var(--cs-accent-rgb), 0.25);
        }

        .odyssey-levels {
            display: flex;
            flex-wrap: wrap;
            gap: 0.55rem;
        }

        .odyssey-level-btn {
            width: 52px;
            height: 52px;
            border-radius: 11px;
            border: 1px solid rgba(150, 180, 255, 0.18);
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(10, 13, 27, 0.55));
            color: #eef3ff;
            font-family: 'Orbitron', monospace;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 1px;
        }

        .odyssey-level-btn:hover:not(.locked) {
            border-color: rgba(var(--cs-accent-rgb), 0.60);
            background: rgba(var(--cs-accent-rgb), 0.12);
            transform: translateY(-2px) scale(1.04);
            box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35), 0 0 16px rgba(var(--cs-accent-rgb), 0.30);
        }

        .odyssey-level-btn:focus-visible {
            outline: none;
            box-shadow:
                0 0 0 2px rgba(var(--cs-accent-rgb), 0.90),
                0 0 0 5px rgba(var(--cs-accent-rgb), 0.20);
        }

        .odyssey-level-btn.locked {
            opacity: 0.4;
            cursor: not-allowed;
            border-color: rgba(150, 180, 255, 0.08);
            background: rgba(10, 13, 27, 0.40);
            color: rgba(211, 219, 245, 0.45);
        }

        .odyssey-level-btn.completed {
            border-color: rgba(var(--cs-done-rgb), 0.50);
            background: linear-gradient(180deg, rgba(var(--cs-done-rgb), 0.12), rgba(10, 13, 27, 0.50));
            color: #d8fff5;
        }

        .odyssey-level-btn.completed:hover {
            border-color: rgba(var(--cs-done-rgb), 0.80);
            box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35), 0 0 16px rgba(var(--cs-done-rgb), 0.35);
        }

        .odyssey-level-btn.current {
            border-color: rgba(var(--cs-accent-rgb), 0.85);
            background: linear-gradient(180deg, rgba(var(--cs-accent-rgb), 0.20), rgba(10, 13, 27, 0.50));
            color: #ffffff;
            animation: ods-pulse 2s ease-in-out infinite;
        }

        .odyssey-level-stars {
            font-size: 0.55rem;
            letter-spacing: 0.5px;
            margin-top: 1px;
            color: var(--cs-accent);
        }

        .odyssey-level-btn.locked .odyssey-level-stars { color: rgba(211, 219, 245, 0.30); }
        .odyssey-level-btn.completed .odyssey-level-stars { color: var(--cs-accent); }

        .odyssey-actions {
            margin: 2rem 0 1rem;
        }

        .odyssey-btn {
            padding: 0.8rem 2rem;
            font-family: 'Space Mono', monospace;
            font-size: 0.95rem;
            font-weight: 600;
            letter-spacing: 0.04em;
            border: 1px solid rgba(var(--cs-accent-rgb), 0.45);
            background:
                linear-gradient(180deg, rgba(var(--cs-accent-rgb), 0.14), rgba(var(--cs-accent-rgb), 0.05)),
                rgba(8, 10, 23, 0.50);
            color: #ffe9c2;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.22s ease;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }

        .odyssey-btn:hover {
            border-color: rgba(var(--cs-accent-rgb), 0.70);
            color: #ffffff;
            transform: translateY(-1px);
            box-shadow: 0 0 20px rgba(var(--cs-accent-rgb), 0.25);
        }

        .odyssey-btn:focus-visible {
            outline: none;
            box-shadow: 0 0 0 3px rgba(var(--cs-accent-rgb), 0.28);
        }

        @keyframes ods-shimmer {
            0%, 100% { background-position: 0% center; }
            50% { background-position: 200% center; }
        }

        @keyframes ods-pulse {
            0%, 100% { box-shadow: 0 0 0 1px rgba(var(--cs-accent-rgb), 0.50), 0 0 10px rgba(var(--cs-accent-rgb), 0.40); }
            50% { box-shadow: 0 0 0 1px rgba(var(--cs-accent-rgb), 0.80), 0 0 22px rgba(var(--cs-accent-rgb), 0.70); }
        }

        @keyframes ods-fade {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
            .odyssey-level-select,
            .odyssey-header h1,
            .odyssey-level-btn.current {
                animation: none !important;
            }
        }
    `;
        document.head.appendChild(style);
    }

    // Add to DOM
    document.body.appendChild(container);

    return container;
}

export default createLevelSelectOverlay;
