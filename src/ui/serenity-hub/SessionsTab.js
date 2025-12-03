/**
 * SessionsTab - Breathwork Journeys/Sessions selection
 */
export class SessionsTab {
    constructor(hub, sessionManager) {
        this.hub = hub;
        this.sessionManager = sessionManager;
        this.container = hub.panel.querySelector('#tab-sessions');

        this.render();
        this.setupEventListeners();
    }

    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="sessions-grid">
                <!-- Base Session Card -->
                <div class="session-card" data-session="BASE">
                    <div class="session-icon base-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M12 8v8M8 12h8"></path>
                        </svg>
                    </div>
                    <div class="session-info">
                        <h3>Hale Base</h3>
                        <div class="session-meta">
                            <span class="duration">20 min</span>
                            <span class="intensity moderate">Moderate</span>
                        </div>
                        <p>Foundational session for stress regulation and CO2 tolerance. Rhythmic nose breathing.</p>
                    </div>
                    <button class="start-session-btn" data-session="BASE">Start Session</button>
                </div>

                <!-- Elixir Session Card -->
                <div class="session-card" data-session="ELIXIR">
                    <div class="session-icon elixir-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                        </svg>
                    </div>
                    <div class="session-info">
                        <h3>Hale Elixir</h3>
                        <div class="session-meta">
                            <span class="duration">25 min</span>
                            <span class="intensity high">High Intensity</span>
                        </div>
                        <p>Active mouth breathing to alkalize the blood and clear the mind. Powerful release.</p>
                    </div>
                    <button class="start-session-btn" data-session="ELIXIR">Start Session</button>
                </div>
            </div>

            <div class="active-session-overlay" style="display: none;">
                <div class="active-session-content">
                    <h3 class="active-session-title">Session in Progress</h3>
                    <div class="active-session-status">Phase 1: Grounding</div>
                    <button class="stop-session-btn">End Session</button>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        if (!this.container) return;

        // Start buttons
        this.container.querySelectorAll('.start-session-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sessionId = e.target.dataset.session;
                this.startSession(sessionId);
            });
        });

        // Stop button
        const stopBtn = this.container.querySelector('.stop-session-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                this.stopSession();
            });
        }
    }

    startSession(sessionId) {
        // Hide hub to show the breathing indicator
        this.hub.hide();

        // Show active session overlay in tab (for when they come back)
        const overlay = this.container.querySelector('.active-session-overlay');
        const status = overlay.querySelector('.active-session-status');
        const title = overlay.querySelector('.active-session-title');

        if (overlay) overlay.style.display = 'flex';

        this.sessionManager.startSession(
            sessionId,
            (progress) => {
                // On Progress
                if (status) status.textContent = `${progress.prompt}`;
            },
            () => {
                // On Complete
                if (overlay) overlay.style.display = 'none';
                // Maybe show a completion modal or notification?
                console.log('Session completed!');
            }
        );
    }

    stopSession() {
        this.sessionManager.stopSession();
        const overlay = this.container.querySelector('.active-session-overlay');
        if (overlay) overlay.style.display = 'none';
    }
}
