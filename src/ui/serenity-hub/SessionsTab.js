/**
 * SessionsTab - Breathwork Journeys/Sessions selection
 *
 * Enhanced with:
 * - Pre-session preparation screen with intention setting
 * - Immersive session HUD with progress tracking
 * - Circular progress ring with timer
 * - Breath counter for active phases
 * - Rich guidance display with sub-prompts
 */
import { csIcon } from '../components/cosmic-icons.js';

export class SessionsTab {
    constructor(hub, sessionManager) {
        this.hub = hub;
        this.sessionManager = sessionManager;
        this.container = hub.panel.querySelector('#tab-sessions');
        this.activeSessionData = null;
        this.selectedIntention = null;
        this.pendingSessionId = null;

        // Intention options for each session type
        this.INTENTIONS = {
            BASE: [
                {
                    id: 'calm', icon: csIcon('wave'), label: 'Find Calm', desc: 'Release stress and anxiety',
                },
                {
                    id: 'focus', icon: csIcon('target'), label: 'Sharpen Focus', desc: 'Clear mental fog',
                },
                {
                    id: 'ground', icon: csIcon('tree'), label: 'Ground Myself', desc: 'Feel centered and stable',
                },
                {
                    id: 'breathe', icon: csIcon('breath'), label: 'Just Breathe', desc: 'No goal, simply be',
                },
            ],
            ELIXIR: [
                {
                    id: 'energy', icon: csIcon('bolt'), label: 'Ignite Energy', desc: 'Wake up body and mind',
                },
                {
                    id: 'release', icon: csIcon('flame'), label: 'Release & Let Go', desc: 'Clear emotional blocks',
                },
                {
                    id: 'transform', icon: csIcon('butterfly'), label: 'Transform', desc: 'Catalyze inner change',
                },
                {
                    id: 'power', icon: csIcon('shield'), label: 'Build Power', desc: 'Strengthen willpower',
                },
            ],
            REST: [
                {
                    id: 'sleep', icon: csIcon('moon'), label: 'Prepare for Sleep', desc: 'Transition to deep rest',
                },
                {
                    id: 'unwind', icon: csIcon('leaf'), label: 'Unwind', desc: 'Release the day\'s tension',
                },
                {
                    id: 'restore', icon: csIcon('flower'), label: 'Restore', desc: 'Replenish your energy',
                },
                {
                    id: 'peace', icon: csIcon('cloud'), label: 'Find Peace', desc: 'Embrace stillness',
                },
            ],
            FLOW: [
                {
                    id: 'balance', icon: csIcon('balance'), label: 'Find Balance', desc: 'Harmonize mind and body',
                },
                {
                    id: 'clarity', icon: csIcon('gem'), label: 'Gain Clarity', desc: 'See with fresh perspective',
                },
                {
                    id: 'presence', icon: csIcon('star'), label: 'Be Present', desc: 'Anchor in the now',
                },
                {
                    id: 'rhythm', icon: csIcon('note'), label: 'Find Rhythm', desc: 'Sync with your flow',
                },
            ],
        };

        // Detailed session information
        this.SESSION_INFO = {
            BASE: {
                name: 'Hale Base',
                duration: '20 min',
                intensity: 'Moderate',
                about: 'A grounding practice using slow, rhythmic nose breathing to activate your parasympathetic nervous system. Each round builds CO2 tolerance, calms the mind, and brings you into a state of focused relaxation.',
                breathingDesc: 'Slow nasal breathing (4 sec in, 4 sec out)',
                holdsDesc: 'Breath holds from 1-2 min between rounds',
                maxHold: '2 min',
            },
            ELIXIR: {
                name: 'Hale Elixir',
                duration: '25 min',
                intensity: 'High Intensity',
                about: 'An energizing practice using powerful mouth breathing to flood your body with oxygen. This technique alkalizes the blood, creates tingling sensations, and can lead to profound physical and emotional release.',
                breathingDesc: 'Active mouth breathing (fast, connected)',
                holdsDesc: 'Extended breath holds up to 2 min',
                maxHold: '2 min',
            },
            REST: {
                name: 'Hale Rest',
                duration: '15 min',
                intensity: 'Gentle',
                about: 'A soothing practice designed to activate deep relaxation. Extended exhales stimulate the vagus nerve, slowing your heart rate and calming the nervous system. Perfect for winding down or preparing for sleep.',
                breathingDesc: 'Extended exhale breathing (4 sec in, 8 sec out)',
                holdsDesc: 'Gentle pauses between breaths',
                maxHold: '30 sec',
            },
            FLOW: {
                name: 'Hale Flow',
                duration: '18 min',
                intensity: 'Moderate',
                about: 'A balanced box breathing practice that creates equilibrium in your nervous system. Equal inhales, holds, exhales, and pauses build focus, reduce anxiety, and cultivate a meditative state of rhythmic awareness.',
                breathingDesc: 'Box breathing (4 sec each phase)',
                holdsDesc: 'Holds after inhale and exhale',
                maxHold: '1 min',
            },
        };

        this.render();
        this.setupEventListeners();
    }

    getSessionIcon(sessionId, size = 26) {
        const iconMap = {
            BASE: 'hale-base',
            ELIXIR: 'hale-elixir',
            REST: 'hale-rest',
            FLOW: 'hale-flow',
        };
        return csIcon(iconMap[sessionId] || 'breath', size);
    }

    getIntensityClass(sessionId) {
        const intensityMap = {
            ELIXIR: 'high',
            REST: 'gentle',
        };
        return intensityMap[sessionId] || 'moderate';
    }

    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="sessions-grid">
                <!-- Base Session Card -->
                <div class="session-card" data-session="BASE">
                    <div class="session-icon base-icon">
                        ${this.getSessionIcon('BASE')}
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
                        ${this.getSessionIcon('ELIXIR')}
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

                <!-- Rest Session Card -->
                <div class="session-card" data-session="REST">
                    <div class="session-icon rest-icon">
                        ${this.getSessionIcon('REST')}
                    </div>
                    <div class="session-info">
                        <h3>Hale Rest</h3>
                        <div class="session-meta">
                            <span class="duration">15 min</span>
                            <span class="intensity gentle">Gentle</span>
                        </div>
                        <p>Extended exhale breathing for deep relaxation. Perfect for winding down or sleep preparation.</p>
                    </div>
                    <button class="start-session-btn" data-session="REST">Start Session</button>
                </div>

                <!-- Flow Session Card -->
                <div class="session-card" data-session="FLOW">
                    <div class="session-icon flow-icon">
                        ${this.getSessionIcon('FLOW')}
                    </div>
                    <div class="session-info">
                        <h3>Hale Flow</h3>
                        <div class="session-meta">
                            <span class="duration">18 min</span>
                            <span class="intensity moderate">Moderate</span>
                        </div>
                        <p>Box breathing for balance and focus. Equal phases create rhythm and cultivate presence.</p>
                    </div>
                    <button class="start-session-btn" data-session="FLOW">Start Session</button>
                </div>
            </div>

            <!-- Pre-Session Preparation Screen -->
            <div class="session-prep-overlay" style="display: none;">
                <div class="session-prep">
                    <!-- Close button -->
                    <button class="prep-close-btn" aria-label="Cancel">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"></path>
                        </svg>
                    </button>

                    <!-- Session Info Header -->
                    <div class="prep-header">
                        <div class="prep-session-icon base"></div>
                        <h2 class="prep-session-name">Hale Base</h2>
                        <div class="prep-session-meta">
                            <span class="prep-duration">20 min</span>
                            <span class="prep-intensity">Moderate</span>
                        </div>
                    </div>

                    <!-- Session Description -->
                    <div class="prep-description">
                        <p class="prep-about"></p>
                    </div>

                    <!-- Session Structure -->
                    <div class="prep-structure">
                        <div class="structure-item">
                            <span class="structure-icon">${csIcon('breath', 16)}</span>
                            <span class="structure-text structure-breathing"></span>
                        </div>
                        <div class="structure-item">
                            <span class="structure-icon">${csIcon('cycle', 16)}</span>
                            <span class="structure-text">3 rounds with progressive intensity</span>
                        </div>
                        <div class="structure-item">
                            <span class="structure-icon">${csIcon('clock', 16)}</span>
                            <span class="structure-text structure-holds"></span>
                        </div>
                    </div>

                    <!-- Divider -->
                    <div class="prep-divider"></div>

                    <!-- Intention Setting -->
                    <div class="prep-intention-section">
                        <h3 class="prep-section-title">Set Your Intention</h3>
                        <p class="prep-section-desc">An intention focuses your practice. Choose what resonates with you today.</p>
                        
                        <div class="intention-grid">
                            <!-- Intentions will be populated dynamically -->
                        </div>
                    </div>

                    <!-- Session Preview Stats -->
                    <div class="prep-preview">
                        <div class="preview-item">
                            <span class="preview-value">3</span>
                            <span class="preview-label">Rounds</span>
                        </div>
                        <div class="preview-item">
                            <span class="preview-value breathing-type">Nose</span>
                            <span class="preview-label">Breathing</span>
                        </div>
                        <div class="preview-item">
                            <span class="preview-value max-hold">2 min</span>
                            <span class="preview-label">Max Hold</span>
                        </div>
                    </div>

                    <!-- Begin Button -->
                    <button class="prep-begin-btn" disabled>
                        <span class="begin-text">Select an Intention</span>
                    </button>

                    <!-- Skip intention option -->
                    <button class="prep-skip-btn">Skip intention & begin</button>
                </div>
            </div>

            <!-- Countdown Overlay -->
            <div class="session-countdown-overlay" style="display: none;">
                <div class="countdown-content">
                    <p class="countdown-intention"></p>
                    <div class="countdown-number">3</div>
                    <p class="countdown-message">Find a comfortable position</p>
                </div>
            </div>

            <!-- Enhanced Active Session Overlay -->
            <div class="active-session-overlay" style="display: none;">
                <div class="session-hud">
                    <!-- Session Header -->
                    <div class="session-hud-header">
                        <span class="session-name">Session</span>
                        <span class="session-round">Round 1 of 3</span>
                    </div>
                    
                    <!-- Circular Progress Ring -->
                    <div class="session-progress-ring">
                        <svg viewBox="0 0 100 100">
                            <circle class="progress-background" cx="50" cy="50" r="45" fill="none" stroke-width="4"/>
                            <circle class="progress-fill" cx="50" cy="50" r="45" fill="none" stroke-width="4" 
                                    stroke-linecap="round" stroke-dasharray="283" stroke-dashoffset="283"/>
                        </svg>
                        <div class="progress-center">
                            <span class="phase-timer">0:00</span>
                            <span class="phase-label">Hold</span>
                        </div>
                    </div>
                    
                    <!-- Breath Counter (for active phases) -->
                    <div class="breath-counter">
                        <span class="breath-current">0</span>
                        <span class="breath-separator">/</span>
                        <span class="breath-total">40</span>
                        <span class="breath-label">breaths</span>
                    </div>
                    
                    <!-- Phase Progress Bar -->
                    <div class="phase-progress-bar">
                        <div class="phase-fill"></div>
                    </div>
                    
                    <!-- Session Guidance -->
                    <div class="session-guidance">
                        <p class="guidance-main">Breathe</p>
                        <p class="guidance-sub">Follow the rhythm</p>
                    </div>
                    
                    <!-- Stop Button -->
                    <button class="stop-session-btn">End Session</button>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        if (!this.container) return;

        // Start buttons - now show prep screen
        this.container.querySelectorAll('.start-session-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const sessionId = e.target.dataset.session;
                this.showPrepScreen(sessionId);
            });
        });

        // Stop button
        const stopBtn = this.container.querySelector('.stop-session-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                this.stopSession();
            });
        }

        // Prep screen close button
        const closeBtn = this.container.querySelector('.prep-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hidePrepScreen();
            });
        }

        // Begin button
        const beginBtn = this.container.querySelector('.prep-begin-btn');
        if (beginBtn) {
            beginBtn.addEventListener('click', () => {
                this.startCountdown();
            });
        }

        // Skip intention button
        const skipBtn = this.container.querySelector('.prep-skip-btn');
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                this.selectedIntention = { id: 'none', label: 'Present Moment' };
                this.startCountdown();
            });
        }
    }

    /**
     * Show the preparation screen for a session
     */
    showPrepScreen(sessionId) {
        this.pendingSessionId = sessionId;
        this.selectedIntention = null;

        const prepOverlay = this.container.querySelector('.session-prep-overlay');
        const prep = this.container.querySelector('.session-prep');
        if (!prepOverlay || !prep) return;

        // Get session info
        const info = this.SESSION_INFO[sessionId];
        const sessionType = sessionId.toLowerCase();
        prep.className = `session-prep session-${sessionType}`;

        // Update session header
        const sessionName = prep.querySelector('.prep-session-name');
        const sessionIcon = prep.querySelector('.prep-session-icon');
        const duration = prep.querySelector('.prep-duration');
        const intensity = prep.querySelector('.prep-intensity');

        if (sessionName) sessionName.textContent = info.name;
        if (sessionIcon) {
            sessionIcon.className = `prep-session-icon ${sessionType}`;
            sessionIcon.innerHTML = this.getSessionIcon(sessionId, 24);
        }
        if (duration) duration.textContent = info.duration;
        if (intensity) {
            intensity.textContent = info.intensity;
            intensity.className = `prep-intensity ${this.getIntensityClass(sessionId)}`;
        }

        // Update session description
        const aboutText = prep.querySelector('.prep-about');
        if (aboutText) aboutText.textContent = info.about;

        // Update session structure
        const breathingDesc = prep.querySelector('.structure-breathing');
        const holdsDesc = prep.querySelector('.structure-holds');
        if (breathingDesc) breathingDesc.textContent = info.breathingDesc;
        if (holdsDesc) holdsDesc.textContent = info.holdsDesc;

        // Update preview stats
        const breathingType = prep.querySelector('.breathing-type');
        const maxHold = prep.querySelector('.max-hold');
        if (breathingType) {
            const breathTypes = {
                BASE: 'Nose', ELIXIR: 'Mouth', REST: 'Nose', FLOW: 'Box',
            };
            breathingType.textContent = breathTypes[sessionId] || 'Nose';
        }
        if (maxHold) maxHold.textContent = info.maxHold;

        // Populate intentions
        const intentionGrid = prep.querySelector('.intention-grid');
        if (intentionGrid) {
            const intentions = this.INTENTIONS[sessionId];
            intentionGrid.innerHTML = intentions.map((intent) => `
                <button class="intention-card" data-intention="${intent.id}">
                    <span class="intention-icon">${intent.icon}</span>
                    <span class="intention-label">${intent.label}</span>
                    <span class="intention-desc">${intent.desc}</span>
                </button>
            `).join('');

            // Add click listeners to intention cards
            intentionGrid.querySelectorAll('.intention-card').forEach((card) => {
                card.addEventListener('click', () => {
                    this.selectIntention(card.dataset.intention, sessionId);
                });
            });
        }

        // Reset begin button
        const beginBtn = this.container.querySelector('.prep-begin-btn');
        if (beginBtn) {
            beginBtn.disabled = true;
            beginBtn.querySelector('.begin-text').textContent = 'Select an Intention';
        }

        // Show prep screen with animation
        prepOverlay.style.display = 'flex';
        setTimeout(() => prepOverlay.classList.add('visible'), 10);
    }

    /**
     * Hide the preparation screen
     */
    hidePrepScreen() {
        const prepOverlay = this.container.querySelector('.session-prep-overlay');
        if (prepOverlay) {
            prepOverlay.classList.remove('visible');
            setTimeout(() => {
                prepOverlay.style.display = 'none';
            }, 300);
        }
        this.pendingSessionId = null;
        this.selectedIntention = null;
    }

    /**
     * Select an intention
     */
    selectIntention(intentionId, sessionId) {
        const intentions = this.INTENTIONS[sessionId];
        this.selectedIntention = intentions.find((i) => i.id === intentionId);

        // Play intention sound
        if (this.sessionManager && this.sessionManager.audioManager) {
            const filename = `intentions/${sessionId.toLowerCase()}_${intentionId}.wav`;
            this.sessionManager.audioManager.playVoice(filename);
        }

        // Update UI - highlight selected card
        const intentionGrid = this.container.querySelector('.intention-grid');
        if (intentionGrid) {
            intentionGrid.querySelectorAll('.intention-card').forEach((card) => {
                if (card.dataset.intention === intentionId) {
                    card.classList.add('selected');
                } else {
                    card.classList.remove('selected');
                }
            });
        }

        // Enable begin button
        const beginBtn = this.container.querySelector('.prep-begin-btn');
        if (beginBtn && this.selectedIntention) {
            beginBtn.disabled = false;
            beginBtn.querySelector('.begin-text').textContent = `Begin with "${this.selectedIntention.label}"`;
        }
    }

    /**
     * Start the countdown before session
     */
    async startCountdown() {
        const prepOverlay = this.container.querySelector('.session-prep-overlay');
        const countdownOverlay = this.container.querySelector('.session-countdown-overlay');
        const countdownNumber = this.container.querySelector('.countdown-number');
        const countdownIntention = this.container.querySelector('.countdown-intention');
        const countdownMessage = this.container.querySelector('.countdown-message');

        if (!countdownOverlay || !countdownNumber) return;

        // Apply session theme
        const sessionType = this.pendingSessionId.toLowerCase();
        countdownOverlay.className = `session-countdown-overlay ${sessionType}`;

        // Set intention text
        if (countdownIntention && this.selectedIntention) {
            countdownIntention.textContent = `Your intention: ${this.selectedIntention.label}`;
        }

        // Hide prep, show countdown
        if (prepOverlay) {
            prepOverlay.classList.remove('visible');
            prepOverlay.style.display = 'none';
        }
        countdownOverlay.style.display = 'flex';
        setTimeout(() => countdownOverlay.classList.add('visible'), 10);

        // Countdown sequence
        const messages = [
            'Find a comfortable position',
            'Close your eyes',
            'Take a deep breath',
            'Begin',
        ];
        const sequence = ['3', '2', '1', 'Breathe'];

        for (let i = 0; i < sequence.length; i++) {
            countdownNumber.textContent = sequence[i];
            countdownNumber.className = 'countdown-number pulse';
            if (countdownMessage) countdownMessage.textContent = messages[i];

            // Force reflow for animation
            void countdownNumber.offsetWidth;
            countdownNumber.classList.add('pulse');

            await new Promise((resolve) => setTimeout(resolve, i === 3 ? 800 : 1000));
        }

        // Hide countdown, start session
        countdownOverlay.classList.remove('visible');
        setTimeout(() => {
            countdownOverlay.style.display = 'none';
            this.startSession(this.pendingSessionId);
        }, 300);
    }

    /**
     * Format seconds into mm:ss display
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Update the progress ring stroke-dashoffset
     * Progress is 0-1
     */
    updateProgressRing(progress) {
        const fill = this.container.querySelector('.progress-fill');
        if (fill) {
            // Circle circumference is 2 * PI * 45 ≈ 283
            const offset = 283 * (1 - progress);
            fill.style.strokeDashoffset = offset;
        }
    }

    /**
     * Update the HUD with current session progress
     */
    updateHUD(progress) {
        if (!progress) return;

        const overlay = this.container.querySelector('.active-session-overlay');
        const hud = overlay?.querySelector('.session-hud');
        if (!hud) return;

        // Apply session theme class
        hud.className = `session-hud ${progress.sessionId?.toLowerCase() || ''}`;

        // Session name and round
        const sessionName = hud.querySelector('.session-name');
        const sessionRound = hud.querySelector('.session-round');
        if (sessionName) sessionName.textContent = progress.sessionName || 'Session';
        if (sessionRound) {
            if (progress.round > 0) {
                sessionRound.textContent = `Round ${progress.round} of ${progress.totalRounds}`;
                sessionRound.style.display = 'block';
            } else {
                sessionRound.style.display = 'none';
            }
        }

        // Timer
        const timer = hud.querySelector('.phase-timer');
        if (timer) {
            timer.textContent = this.formatTime(progress.remainingTime);
        }

        // Phase label
        const phaseLabel = hud.querySelector('.phase-label');
        if (phaseLabel) {
            phaseLabel.textContent = progress.phaseLabel || 'Breathe';
        }

        // Progress ring
        this.updateProgressRing(progress.phaseProgress);

        // Breath counter visibility and values
        const breathCounter = hud.querySelector('.breath-counter');
        if (breathCounter) {
            if (progress.isActivePhase) {
                breathCounter.classList.add('visible');
                const current = breathCounter.querySelector('.breath-current');
                const total = breathCounter.querySelector('.breath-total');
                if (current) current.textContent = progress.breathCount || 0;
                if (total) total.textContent = progress.totalBreaths || 0;
            } else {
                breathCounter.classList.remove('visible');
            }
        }

        // Phase progress bar
        const phaseFill = hud.querySelector('.phase-fill');
        if (phaseFill) {
            phaseFill.style.width = `${progress.phaseProgress * 100}%`;
        }

        // Guidance text
        const guidanceMain = hud.querySelector('.guidance-main');
        const guidanceSub = hud.querySelector('.guidance-sub');
        if (guidanceMain) guidanceMain.textContent = progress.prompt || '';
        if (guidanceSub) {
            guidanceSub.textContent = progress.subPrompt || '';
            guidanceSub.style.display = progress.subPrompt ? 'block' : 'none';
        }
    }

    startSession(sessionId) {
        // Hide hub to show the breathing indicator
        this.hub.hide();

        // Show active session overlay in tab (for when they come back)
        const overlay = this.container.querySelector('.active-session-overlay');
        if (overlay) overlay.style.display = 'flex';

        // Reset HUD to initial state
        this.updateProgressRing(0);

        this.sessionManager.startSession(
            sessionId,
            (progress) => {
                // On Progress - update HUD
                this.activeSessionData = progress;
                this.updateHUD(progress);
            },
            (stats) => {
                // On Complete
                if (overlay) overlay.style.display = 'none';
                this.activeSessionData = null;

                // Show completion notification
                console.log('Session completed!', stats);

                // Could show a completion modal here
                this.showCompletionMessage(stats);
            },
        );
    }

    stopSession() {
        this.sessionManager.stopSession();
        const overlay = this.container.querySelector('.active-session-overlay');
        if (overlay) overlay.style.display = 'none';
        this.activeSessionData = null;
    }

    /**
     * Show a brief completion message
     */
    showCompletionMessage(stats) {
        // For now, just log. Could be enhanced with a modal
        console.log(`[SessionsTab] Completed ${stats.sessionName} in ${this.formatTime(stats.totalDuration)}`);
    }
}
