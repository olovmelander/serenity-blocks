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
        this.active = false;
        this.destroyed = false;
        this.abortController = new AbortController();
        this.pendingTimers = new Map();
        this.countdownGeneration = 0;
        this.hudNodes = null;
        this.completedSession = null;
        this.focusReturn = null;
        this.journeySessionId = null;
        this.journeyPhaseIndex = null;
        this.journeyStages = [];
        this.sessionGeneration = 0;

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

        // The visual identity stays independent of manager timing and audio.
        this.SESSION_INFO = {
            BASE: {
                name: 'Hale Base',
                duration: '20 min',
                intensity: 'Moderate',
                mood: 'Come back to yourself',
                landscape: 'Still water',
                about: 'Settle into three rounds of rhythmic nasal breathing. Begin gently, explore the quiet between breaths, and finish with space to rest.',
                summary: 'Rhythmic nasal breathing, quiet holds, and a grounded finish.',
                breathingDesc: 'Nasal breathing · gradually quickening rhythm',
                holdsDesc: 'Stillness between rounds · up to 2 minutes',
                maxHold: '2 min',
                breathingType: 'Nasal',
            },
            ELIXIR: {
                name: 'Hale Elixir',
                duration: '25 min',
                intensity: 'High intensity',
                mood: 'Meet your inner spark',
                landscape: 'Warm light',
                about: 'A more active journey through connected mouth breathing, pauses, and recovery breaths. Three rounds build in pace before a spacious integration.',
                summary: 'Connected mouth breathing, brighter rhythm, and deep stillness.',
                breathingDesc: 'Mouth breathing · active, connected rhythm',
                holdsDesc: 'Stillness between rounds · up to 2 minutes',
                maxHold: '2 min',
                breathingType: 'Mouth',
            },
            REST: {
                name: 'Hale Rest',
                duration: '15 min',
                intensity: 'Gentle',
                mood: 'Let the day soften',
                landscape: 'Moonlit quiet',
                about: 'Give yourself time to unwind. Gentle nasal breathing and longer exhales lead into short pauses, soft recovery breaths, and a quiet closing rest.',
                summary: 'Gentle breathing and longer exhales for a quieter evening.',
                breathingDesc: 'Nasal breathing · soft, extended exhales',
                holdsDesc: 'Short, gentle pauses between rounds',
                maxHold: '30 sec',
                breathingType: 'Nasal',
            },
            FLOW: {
                name: 'Hale Flow',
                duration: '18 min',
                intensity: 'Moderate',
                mood: 'Find your own rhythm',
                landscape: 'Moving harmony',
                about: 'Follow the four even sides of a breath: inhale, hold, exhale, pause. Each round lengthens the rhythm, then gives you space to return to natural breathing.',
                summary: 'An even, four-part breath that opens into a spacious rhythm.',
                breathingDesc: 'Box breathing · equal inhale, hold, exhale, pause',
                holdsDesc: 'Even pauses, followed by a moment of stillness',
                maxHold: '1 min',
                breathingType: 'Box',
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

    getSessionDetails(sessionId) {
        const info = this.SESSION_INFO[sessionId];
        const session = this.sessionManager?.SESSIONS?.[sessionId];
        if (!info) return null;
        if (!session?.phases?.length) return { ...info, rounds: 3 };
        const duration = session.phases.reduce((total, phase) => total + (
            phase.type === 'active'
                ? phase.pattern.reduce((sum, seconds) => sum + seconds, 0) * phase.breaths
                : phase.duration
        ), 0);
        const maxHold = Math.max(0, ...session.phases
            .filter((phase) => phase.type === 'retention').map((phase) => phase.duration));
        return {
            ...info,
            duration: `${Math.ceil(duration / 60)} min`,
            rounds: session.totalRounds,
            maxHold: maxHold >= 60 ? `${maxHold / 60} min` : `${maxHold} sec`,
        };
    }

    renderSessionArt(sessionId, className = '') {
        return `<div class="session-landscape ${sessionId.toLowerCase()} ${className}" aria-hidden="true">
            <span class="landscape-halo"></span><span class="landscape-orbit orbit-one"></span>
            <span class="landscape-orbit orbit-two"></span><span class="landscape-orbit orbit-three"></span>
            <span class="landscape-core"></span><span class="landscape-horizon"></span>
            <span class="landscape-spark spark-one"></span><span class="landscape-spark spark-two"></span>
        </div>`;
    }

    render() {
        if (!this.container) return;

        const cards = Object.keys(this.SESSION_INFO).map((sessionId, index) => {
            const info = this.getSessionDetails(sessionId);
            return `<article class="session-card" data-session="${sessionId}">
                ${this.renderSessionArt(sessionId)}
                <div class="session-card-topline">
                    <span class="session-edition">0${index + 1} / ${info.landscape}</span>
                    <span class="session-icon ${sessionId.toLowerCase()}-icon">${this.getSessionIcon(sessionId, 22)}</span>
                </div>
                <div class="session-info">
                    <p class="session-mood">${info.mood}</p>
                    <h3>${info.name}</h3>
                    <p class="session-summary">${info.summary}</p>
                    <div class="session-meta">
                        <span class="duration">${csIcon('clock', 13)} ${info.duration}</span>
                        <span class="intensity ${this.getIntensityClass(sessionId)}">${info.intensity}</span>
                        <span>${info.rounds} rounds</span>
                    </div>
                </div>
                <button type="button" class="start-session-btn" data-session="${sessionId}">
                    Explore session <span aria-hidden="true">↗</span>
                </button>
            </article>`;
        }).join('');

        this.container.innerHTML = `
            <div class="sessions-introduction">
                <span class="session-eyebrow">Guided breathwork</span>
                <h2>A little time. A different state.</h2>
                <p>Four journeys into breath, rhythm, and stillness. Choose the space you need today.</p>
            </div>
            <div class="sessions-grid">${cards}</div>
            <div class="sessions-footnote">${csIcon('breath', 15)} Your breath sets the pace. Keep it comfortable.</div>

            <div class="session-prep-overlay" style="display: none;">
                <div class="session-prep" role="dialog" aria-modal="true" aria-labelledby="prep-session-title">
                    <button type="button" class="prep-close-btn" aria-label="Back to sessions"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 6l12 12M6 18L18 6"/></svg></button>
                    <div class="prep-story">
                        <div class="prep-art"></div>
                        <div class="prep-header">
                            <span class="session-eyebrow">Your next quiet moment</span>
                            <div class="prep-session-icon base"></div>
                            <h2 id="prep-session-title" class="prep-session-name">Hale Base</h2>
                            <p class="prep-mood"></p>
                            <div class="prep-session-meta"><span class="prep-duration"></span><span class="prep-intensity"></span></div>
                        </div>
                        <div class="prep-description"><p class="prep-about"></p></div>
                        <div class="prep-structure">
                            <div class="structure-item"><span class="structure-icon">${csIcon('breath', 16)}</span><span class="structure-text structure-breathing"></span></div>
                            <div class="structure-item"><span class="structure-icon">${csIcon('clock', 16)}</span><span class="structure-text structure-holds"></span></div>
                        </div>
                        <div class="prep-journey" aria-label="Session structure">
                            <span><i>01</i> Settle in</span><span><i>02</i> Three rounds</span><span><i>03</i> Integrate</span>
                        </div>
                    </div>
                    <div class="prep-choices">
                        <div class="prep-intention-section">
                            <span class="session-eyebrow">Make it yours</span>
                            <h3 class="prep-section-title">How would you like to arrive?</h3>
                            <p class="prep-section-desc">Choose an intention, or simply follow your breath.</p>
                            <div class="intention-grid" role="group" aria-label="Choose your intention"></div>
                        </div>
                        <div class="prep-preview">
                            <div class="preview-item"><span class="preview-value preview-rounds">3</span><span class="preview-label">Rounds</span></div>
                            <div class="preview-item"><span class="preview-value breathing-type">Nasal</span><span class="preview-label">Breathing</span></div>
                            <div class="preview-item"><span class="preview-value max-hold">2 min</span><span class="preview-label">Longest pause</span></div>
                        </div>
                        <p class="prep-comfort-note">Find a comfortable seat or lie down. Return to natural breathing whenever you need.</p>
                        <div class="prep-actions">
                            <button type="button" class="prep-begin-btn" disabled><span class="begin-text">Choose an intention</span><span aria-hidden="true">→</span></button>
                            <button type="button" class="prep-skip-btn">Begin without an intention</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="session-countdown-overlay" style="display: none;">
                <div class="countdown-art" aria-hidden="true"></div>
                <div class="countdown-content" role="status" aria-live="polite" aria-atomic="true">
                    <span class="session-eyebrow">A moment to arrive</span>
                    <p class="countdown-intention"></p>
                    <div class="countdown-number">3</div>
                    <p class="countdown-message">Find a comfortable position</p>
                    <span class="countdown-quiet">Nothing to achieve. Just be here.</span>
                    <button type="button" class="countdown-cancel-btn">Back to preparation</button>
                </div>
            </div>

            <div class="active-session-overlay" style="display: none;">
                <div class="session-hud">
                    <div class="session-hud-header">
                        <span class="session-eyebrow">Your breathing journey</span>
                        <span class="session-name">Session</span>
                        <span class="session-round">Round 1 of 3</span>
                    </div>
                    <div class="session-stage-trail" aria-label="Session stages"></div>
                    <div class="session-phase-scene">
                        <div class="session-progress-ring">
                            <span class="session-ring-aura" aria-hidden="true"></span>
                            <svg viewBox="0 0 100 100" aria-hidden="true">
                                <circle class="progress-background" cx="50" cy="50" r="45" fill="none" stroke-width="1"/>
                                <circle class="progress-fill" cx="50" cy="50" r="45" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="283" stroke-dashoffset="283"/>
                            </svg>
                            <div class="progress-center"><span class="phase-timer">0:00</span><span class="phase-label">Settle in</span><span class="phase-time-caption">remaining in this phase</span></div>
                        </div>
                        <div class="breath-counter"><span class="breath-current">0</span><span class="breath-separator">/</span><span class="breath-total">40</span><span class="breath-label">breaths</span></div>
                    </div>
                    <div class="session-guidance"><p class="guidance-main">Breathe</p><p class="guidance-sub">Follow the rhythm</p></div>
                    <div class="session-overall-progress"><span>Journey progress</span><span class="session-percent">0%</span></div>
                    <div class="phase-progress-bar" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="phase-fill"></div></div>
                    <div class="session-hud-actions"><button type="button" class="session-immerse-btn">Return to the experience <span aria-hidden="true">↗</span></button><button type="button" class="stop-session-btn">End session</button></div>
                </div>
            </div>

            <div class="session-completion-overlay" style="display: none;">
                <div class="session-completion" role="dialog" aria-modal="true" aria-labelledby="session-completion-title">
                    <div class="completion-art" aria-hidden="true"></div>
                    <span class="session-eyebrow">A moment, just for you</span>
                    <h2 id="session-completion-title">Carry this feeling with you.</h2>
                    <p class="completion-session-name"></p>
                    <div class="completion-stats"><div><strong class="completion-duration"></strong><span>Time for yourself</span></div><div><strong class="completion-rounds"></strong><span>Rounds completed</span></div></div>
                    <p class="completion-intention"></p>
                    <p class="completion-reflection">Notice your breath. Let your next moment begin gently.</p>
                    <button type="button" class="completion-close-btn">Back to your space <span aria-hidden="true">→</span></button>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        if (!this.container) return;

        // Start buttons - now show prep screen
        this.container.querySelectorAll('.start-session-btn').forEach((btn) => {
            this.listen(btn, 'click', (e) => {
                const sessionId = e.currentTarget.dataset.session;
                this.showPrepScreen(sessionId);
            });
        });

        this.listen(this.container.querySelector('.intention-grid'), 'click', (event) => {
            const card = event.target.closest?.('.intention-card');
            if (card && this.pendingSessionId) this.selectIntention(card.dataset.intention, this.pendingSessionId);
        });
        this.listen(this.container, 'keydown', (event) => this.handleOverlayKey(event));
        this.listen(this.container.querySelector('.countdown-cancel-btn'), 'click', () => {
            if (this.pendingSessionId) this.showPrepScreen(this.pendingSessionId);
        });
        this.listen(this.container.querySelector('.session-immerse-btn'), 'click', () => this.hub.hide());
        this.listen(this.container.querySelector('.completion-close-btn'), 'click', () => {
            this.setStyle(this.container.querySelector('.session-completion-overlay'), 'display', 'none');
            this.completedSession = null;
            this.focusReturn?.focus?.();
        });

        // Stop button
        const stopBtn = this.container.querySelector('.stop-session-btn');
        if (stopBtn) {
            this.listen(stopBtn, 'click', () => {
                this.stopSession();
            });
        }

        // Prep screen close button
        const closeBtn = this.container.querySelector('.prep-close-btn');
        if (closeBtn) {
            this.listen(closeBtn, 'click', () => {
                this.hidePrepScreen();
            });
        }

        // Begin button
        const beginBtn = this.container.querySelector('.prep-begin-btn');
        if (beginBtn) {
            this.listen(beginBtn, 'click', () => {
                this.startCountdown();
            });
        }

        // Skip intention button
        const skipBtn = this.container.querySelector('.prep-skip-btn');
        if (skipBtn) {
            this.listen(skipBtn, 'click', () => {
                this.selectedIntention = { id: 'none', label: 'Present Moment' };
                this.startCountdown();
            });
        }
    }

    handleOverlayKey(event) {
        // Native activation must not also reach Serenity Mode's guide shortcut.
        // Leave the default button/checkbox action intact.
        if (event.key === ' ' || event.key === 'Enter') {
            const control = event.target.closest?.('button, input');
            if (control && this.container.contains(control)) event.stopPropagation();
            return;
        }
        const overlay = ['.session-countdown-overlay', '.session-prep-overlay', '.session-completion-overlay']
            .map((selector) => this.container?.querySelector(selector))
            .find((element) => element?.style.display === 'flex');
        if (!overlay) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (overlay.classList.contains('session-countdown-overlay')) {
                if (this.pendingSessionId) this.showPrepScreen(this.pendingSessionId);
            } else if (overlay.classList.contains('session-prep-overlay')) {
                this.hidePrepScreen();
            } else overlay.querySelector('.completion-close-btn')?.click();
        } else if (event.key === 'Tab') {
            const buttons = [...overlay.querySelectorAll('button:not(:disabled)')];
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (!first) return;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }

    /**
     * Show the preparation screen for a session
     */
    showPrepScreen(sessionId) {
        if (this.destroyed) return;
        this.cancelPendingUI();
        const info = this.getSessionDetails(sessionId);
        if (!info) return;
        this.pendingSessionId = sessionId;
        this.selectedIntention = null;
        this.focusReturn = this.container.querySelector(`.start-session-btn[data-session="${sessionId}"]`);
        this.setStyle(this.container.querySelector('.session-completion-overlay'), 'display', 'none');
        this.completedSession = null;

        const prepOverlay = this.container.querySelector('.session-prep-overlay');
        const prep = this.container.querySelector('.session-prep');
        if (!prepOverlay || !prep) return;

        // Get session info
        const sessionType = sessionId.toLowerCase();
        prep.className = `session-prep session-${sessionType}`;
        prepOverlay.dataset.session = sessionId;
        prepOverlay.scrollTop = 0;
        const art = prep.querySelector('.prep-art');
        if (art) art.innerHTML = this.renderSessionArt(sessionId);
        this.setLabel(prep.querySelector('.prep-mood'), info.mood);
        this.setLabel(prep.querySelector('.preview-rounds'), info.rounds);

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
            breathingType.textContent = info.breathingType;
        }
        if (maxHold) maxHold.textContent = info.maxHold;

        // Populate intentions
        const intentionGrid = prep.querySelector('.intention-grid');
        if (intentionGrid) {
            const intentions = this.INTENTIONS[sessionId];
            intentionGrid.innerHTML = intentions.map((intent) => `
                <button type="button" class="intention-card" data-intention="${intent.id}" aria-pressed="false">
                    <span class="intention-icon">${intent.icon}</span>
                    <span class="intention-label">${intent.label}</span>
                    <span class="intention-desc">${intent.desc}</span>
                </button>
            `).join('');

            // Selection is delegated from the stable grid so repeated preparation
            // visits do not retain handlers for detached intention cards.
        }

        // Reset begin button
        const beginBtn = this.container.querySelector('.prep-begin-btn');
        if (beginBtn) {
            beginBtn.disabled = true;
            beginBtn.querySelector('.begin-text').textContent = 'Choose an intention';
        }

        // Show prep screen with animation
        prepOverlay.style.display = 'flex';
        this.scheduleUI(() => {
            prepOverlay.classList.add('visible');
            this.focusDialog(prepOverlay, '.prep-close-btn');
        }, 10);
    }

    /**
     * Hide the preparation screen
     */
    hidePrepScreen() {
        this.cancelPendingUI();
        const prepOverlay = this.container.querySelector('.session-prep-overlay');
        if (prepOverlay) {
            prepOverlay.classList.remove('visible');
            this.scheduleUI(() => {
                prepOverlay.style.display = 'none';
            }, 300);
        }
        this.pendingSessionId = null;
        this.selectedIntention = null;
        this.focusReturn?.focus?.();
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
                card.setAttribute('aria-pressed', String(card.dataset.intention === intentionId));
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

    listen(target, type, handler) {
        target?.addEventListener(type, handler, { signal: this.abortController.signal });
    }

    scheduleUI(callback, delay) {
        const timer = setTimeout(() => {
            this.pendingTimers.delete(timer);
            if (!this.destroyed) callback();
        }, delay);
        this.pendingTimers.set(timer, null);
        return timer;
    }

    waitForCountdown(delay) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingTimers.delete(timer);
                resolve(true);
            }, delay);
            this.pendingTimers.set(timer, resolve);
        });
    }

    cancelPendingUI() {
        this.countdownGeneration += 1;
        this.pendingTimers.forEach((resolve, timer) => {
            clearTimeout(timer);
            resolve?.(false);
        });
        this.pendingTimers.clear();
        const countdown = this.container?.querySelector('.session-countdown-overlay');
        countdown?.classList.remove('visible');
        this.setStyle(countdown, 'display', 'none');
    }

    setActive(active) {
        this.active = Boolean(active) && !this.destroyed;
        if (this.active) {
            const { overlay } = this.getHUDNodes();
            if (overlay) overlay.style.display = this.activeSessionData ? 'flex' : 'none';
            if (this.activeSessionData) this.updateHUD(this.activeSessionData);
        }
    }

    getHUDNodes() {
        if (this.hudNodes) return this.hudNodes;
        const overlay = this.container?.querySelector('.active-session-overlay');
        const hud = overlay?.querySelector('.session-hud');
        const selectors = ['session-name', 'session-round', 'phase-timer', 'phase-label',
            'progress-fill', 'breath-counter', 'breath-current', 'breath-total',
            'phase-fill', 'guidance-main', 'guidance-sub', 'session-stage-trail',
            'session-percent', 'phase-progress-bar'];
        this.hudNodes = { overlay, hud };
        selectors.forEach((name) => { this.hudNodes[name] = hud?.querySelector(`.${name}`); });
        const fill = this.hudNodes['phase-fill'];
        if (fill) {
            fill.style.width = '100%';
            fill.style.transformOrigin = 'left center';
            fill.style.transition = 'transform 0.2s ease';
            fill.style.transform = 'scaleX(0)';
        }
        return this.hudNodes;
    }

    setLabel(node, value) {
        const text = String(value);
        if (node && node.textContent !== text) node.textContent = text;
    }

    setStyle(node, key, value) {
        if (node && node.style[key] !== value) node.style[key] = value;
    }

    focusDialog(overlay, selector) {
        // These overlays are anchored inside a scrollable Hub content area.
        // Native focus scrolling would move that ancestor (and the entire overlay),
        // exposing the catalogue below and clipping the dialog above its viewport.
        const hubScroll = this.hub.panel.querySelector?.('.hub-tab-content');
        if (hubScroll) hubScroll.scrollTop = 0;
        if (overlay) overlay.scrollTop = 0;
        overlay?.querySelector(selector)?.focus?.({ preventScroll: true });
    }

    /**
     * Start the countdown before session
     */
    async startCountdown() {
        this.cancelPendingUI();
        const generation = this.countdownGeneration;
        const sessionId = this.pendingSessionId;
        if (!sessionId || !this.getSessionDetails(sessionId)) return;
        const prepOverlay = this.container.querySelector('.session-prep-overlay');
        const countdownOverlay = this.container.querySelector('.session-countdown-overlay');
        const countdownNumber = this.container.querySelector('.countdown-number');
        const countdownIntention = this.container.querySelector('.countdown-intention');
        const countdownMessage = this.container.querySelector('.countdown-message');

        if (!countdownOverlay || !countdownNumber) return;

        // Apply session theme
        const sessionType = sessionId.toLowerCase();
        countdownOverlay.className = `session-countdown-overlay ${sessionType}`;
        countdownOverlay.dataset.session = sessionId;
        const countdownArt = countdownOverlay.querySelector('.countdown-art');
        if (countdownArt) countdownArt.innerHTML = this.renderSessionArt(sessionId);

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
        this.scheduleUI(() => {
            countdownOverlay.classList.add('visible');
            this.focusDialog(countdownOverlay, '.countdown-cancel-btn');
        }, 10);

        // Countdown sequence
        const messages = [
            'Find a comfortable position',
            'Soften your shoulders',
            'Take a deep breath',
            'Begin',
        ];
        const sequence = ['3', '2', '1', 'Breathe'];

        for (let i = 0; i < sequence.length; i++) {
            countdownNumber.textContent = sequence[i];
            countdownNumber.className = 'countdown-number pulse';
            if (countdownMessage) countdownMessage.textContent = messages[i];

            // Countdown beats are intentionally sequential; cancellation resolves
            // the pending wait so teardown cannot strand this async flow.
            // eslint-disable-next-line no-await-in-loop
            const elapsed = await this.waitForCountdown(i === 3 ? 800 : 1000);
            if (!elapsed || this.destroyed || generation !== this.countdownGeneration) return;
        }

        // Hide countdown, start session
        countdownOverlay.classList.remove('visible');
        this.scheduleUI(() => {
            countdownOverlay.style.display = 'none';
            this.startSession(sessionId);
        }, 300);
    }

    /**
     * Format seconds into mm:ss display
     */
    formatTime(seconds) {
        const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
        const mins = Math.floor(safeSeconds / 60);
        const secs = Math.floor(safeSeconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Update the progress ring stroke-dashoffset
     * Progress is 0-1
     */
    updateProgressRing(progress) {
        if (!this.active || this.destroyed) return;
        this.setStyle(this.getHUDNodes()['progress-fill'], 'strokeDashoffset', String(283 * (1 - progress)));
    }

    /** Cache the latest state even while the session runs outside the Hub. */
    updateHUD(progress) {
        if (!progress || this.destroyed) return;
        this.activeSessionData = progress;
        if (!this.active) return;
        const nodes = this.getHUDNodes();
        const { hud } = nodes;
        if (!hud) return;
        const className = `session-hud ${progress.sessionId?.toLowerCase() || ''}`;
        if (hud.dataset.phase !== progress.phase) hud.dataset.phase = progress.phase || 'grounding';
        if (nodes.overlay.dataset.session !== progress.sessionId) nodes.overlay.dataset.session = progress.sessionId;
        if (hud.className !== className) hud.className = className;
        this.setLabel(nodes['session-name'], progress.sessionName || 'Session');
        this.setLabel(nodes['session-round'], `Round ${progress.round} of ${progress.totalRounds}`);
        this.setStyle(nodes['session-round'], 'display', progress.round > 0 ? 'block' : 'none');
        this.setLabel(nodes['phase-timer'], this.formatTime(progress.remainingTime));
        this.setLabel(nodes['phase-label'], progress.phaseLabel || 'Breathe');
        this.updateProgressRing(progress.phaseProgress);
        const breathCounter = nodes['breath-counter'];
        const activePhase = Boolean(progress.isActivePhase);
        if (breathCounter?.classList.contains('visible') !== activePhase) {
            breathCounter?.classList.toggle('visible', activePhase);
        }
        if (progress.isActivePhase) {
            this.setLabel(nodes['breath-current'], progress.breathCount || 0);
            this.setLabel(nodes['breath-total'], progress.totalBreaths || 0);
        }
        const sessionProgress = Math.max(0, Math.min(1, progress.sessionProgress ?? progress.phaseProgress));
        this.setStyle(nodes['phase-fill'], 'transform', `scaleX(${sessionProgress})`);
        this.setLabel(nodes['session-percent'], `${Math.round(sessionProgress * 100)}%`);
        const progressBar = nodes['phase-progress-bar'];
        const percentage = String(Math.round(sessionProgress * 100));
        if (progressBar && progressBar.getAttribute('aria-valuenow') !== percentage) {
            progressBar.setAttribute('aria-valuenow', percentage);
        }
        this.updateJourney(progress, nodes['session-stage-trail']);
        this.setLabel(nodes['guidance-main'], progress.prompt || '');
        this.setLabel(nodes['guidance-sub'], progress.subPrompt || '');
        this.setStyle(nodes['guidance-sub'], 'display', progress.subPrompt ? 'block' : 'none');
    }

    updateJourney(progress, trail) {
        const phases = this.sessionManager?.SESSIONS?.[progress.sessionId]?.phases;
        if (!trail || !phases) return;
        if (this.journeySessionId !== progress.sessionId) {
            trail.innerHTML = phases.map((phase, index) => {
                const name = phase.round > 0 ? `Round ${phase.round}: ${phase.type}` : phase.type;
                return `<span class="session-stage" data-index="${index + 1}" title="${name}"><i></i></span>`;
            }).join('');
            this.journeySessionId = progress.sessionId;
            this.journeyStages = [...trail.querySelectorAll('.session-stage')];
            this.journeyPhaseIndex = null;
        }
        if (this.journeyPhaseIndex === progress.phaseIndex) return;
        this.journeyPhaseIndex = progress.phaseIndex;
        this.journeyStages.forEach((stage) => {
            const index = Number(stage.dataset.index);
            let state = 'upcoming';
            if (index < progress.phaseIndex) state = 'complete';
            else if (index === progress.phaseIndex) state = 'current';
            if (stage.dataset.state !== state) {
                stage.dataset.state = state;
                if (state === 'current') stage.setAttribute('aria-current', 'step');
                else stage.removeAttribute('aria-current');
            }
        });
    }

    startSession(sessionId) {
        if (this.destroyed || !this.getSessionDetails(sessionId)) return;
        this.completedSession = null;
        this.journeySessionId = null;
        const generation = ++this.sessionGeneration;
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
                // Ignore reports from a session that was replaced or ended.
                if (generation === this.sessionGeneration) this.updateHUD(progress);
            },
            (stats) => {
                // On Complete
                if (this.destroyed || generation !== this.sessionGeneration) return;
                if (overlay) overlay.style.display = 'none';
                this.activeSessionData = null;
                this.hub.breathingTab?.refresh();

                this.showCompletionMessage({ ...stats, sessionId });
            },
        );
    }

    stopSession() {
        this.sessionGeneration += 1;
        this.cancelPendingUI();
        this.sessionManager.stopSession();
        this.hub.breathingTab?.refresh();
        const overlay = this.container.querySelector('.active-session-overlay');
        if (overlay) overlay.style.display = 'none';
        this.activeSessionData = null;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.active = false;
        this.sessionGeneration += 1;
        this.cancelPendingUI();
        this.abortController.abort();
        this.activeSessionData = null;
        this.hudNodes = null;
        this.completedSession = null;
        this.focusReturn = null;
        this.journeyStages = [];
        this.container = null;
    }

    showCompletionMessage(stats) {
        if (this.destroyed || !this.container) return;
        this.completedSession = stats;
        const overlay = this.container.querySelector('.session-completion-overlay');
        if (!overlay) return;
        overlay.dataset.session = stats.sessionId;
        overlay.scrollTop = 0;
        const art = overlay.querySelector('.completion-art');
        if (art) art.innerHTML = this.renderSessionArt(stats.sessionId || 'BASE');
        this.setLabel(overlay.querySelector('.completion-session-name'), `${stats.sessionName} · journey complete`);
        this.setLabel(overlay.querySelector('.completion-duration'), this.formatTime(stats.totalDuration));
        this.setLabel(overlay.querySelector('.completion-rounds'), stats.rounds || 3);
        this.setLabel(overlay.querySelector('.completion-intention'), this.selectedIntention?.id !== 'none'
            && this.selectedIntention ? `You arrived with: ${this.selectedIntention.label}` : 'One breath at a time.');
        this.setStyle(overlay, 'display', 'flex');
        this.hub.switchTab?.('sessions');
        this.hub.show?.();
        this.focusDialog(overlay, '.completion-close-btn');
    }
}
