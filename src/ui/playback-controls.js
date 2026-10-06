/**
 * @fileoverview Replay playback bar: play/pause, stop, position and speed while a
 * recorded game plays back (SinglePlayerMode shows and hides it).
 *
 * Keystone styling (public/styles/keystone-overlays.css, `#playback-controls`): one
 * night bar, play/pause is the warm primary, the position fills with the spectrum and
 * speed is a row of tiles. The shell lives in index.html; this module owns its content.
 */

const SPEEDS = [0.5, 1, 2, 4];
const ARROW_STEPS = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
};

const svg = (body) => '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" '
    + `aria-hidden="true">${body}</svg>`;
const ICONS = {
    pause: svg('<rect x="6.4" y="5" width="3.8" height="14" rx="1.3"/>'
        + '<rect x="13.8" y="5" width="3.8" height="14" rx="1.3"/>'),
    play: svg('<path d="M8.2 5.7v12.6c0 .7.8 1.2 1.4.8l10-6.3c.6-.4.6-1.2 0-1.6l-10-6.3c-.6-.4-1.4.1-1.4.8Z"/>'),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="2.6"/>'),
};

// Helper function to format time
function formatTime(ms) {
    if (!ms || Number.isNaN(ms)) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function speedLabel(speed) {
    return `${speed}×`;
}

export class PlaybackControls {
    constructor(demoPlayer) {
        this.demoPlayer = demoPlayer;
        this.container = document.getElementById('playback-controls');
        this.isDragging = false;
        this.isPausedShown = null;
        this.speedShown = null;

        if (this.container) {
            this.container.setAttribute('role', 'group');
            this.container.setAttribute('aria-label', 'Replay controls');
            this.container.innerHTML = `
                <div class="playback-buttons">
                    <button type="button" id="pb-play-pause" class="pb-btn pb-btn--primary">
                        <span class="pb-btn__icon"></span><span class="pb-btn__label"></span>
                    </button>
                    <button type="button" id="pb-stop" class="pb-btn">
                        ${ICONS.stop}<span class="pb-btn__label">Stop</span>
                    </button>
                </div>
                <div class="playback-info">
                    <span class="pb-eyebrow">Replay</span>
                    <span id="playback-time">00:00</span><span class="separator">/</span>
                    <span id="playback-duration">00:00</span>
                </div>
                <div class="playback-progress-container">
                    <input type="range" id="pb-progress" min="0" max="100" value="0" step="0.1"
                        aria-label="Replay position">
                </div>
                <div class="playback-speed" id="pb-speed" role="radiogroup" aria-label="Playback speed">
                    ${SPEEDS.map((speed) => `<button type="button" class="pb-speed" role="radio" data-speed="${speed}"
                        aria-checked="false">${speedLabel(speed)}</button>`).join('')}
                </div>
            `;
        }

        this.playPauseBtn = document.getElementById('pb-play-pause');
        this.stopBtn = document.getElementById('pb-stop');
        this.speedGroup = document.getElementById('pb-speed');
        this.speedButtons = Array.from(this.container?.querySelectorAll('.pb-speed') || []);
        this.timeDisplay = document.getElementById('playback-time');
        this.durationDisplay = document.getElementById('playback-duration');
        this.progressBar = document.getElementById('pb-progress');

        this.updateInterval = null;

        this.renderPlayPause(false);
        this.renderSpeed(1);
        this.setupEventListeners();
    }

    setupEventListeners() {
        if (!this.container) return;

        this.playPauseBtn?.addEventListener('click', () => this.togglePlayPause());
        this.stopBtn?.addEventListener('click', () => this.stop());

        this.speedButtons.forEach((button, index) => {
            button.addEventListener('click', () => this.setSpeed(Number(button.dataset.speed)));
            // A radio group moves with the arrow keys.
            button.addEventListener('keydown', (e) => {
                const step = ARROW_STEPS[e.key];
                if (!step) return;
                e.preventDefault();
                const next = this.speedButtons[(index + step + this.speedButtons.length) % this.speedButtons.length];
                this.setSpeed(Number(next.dataset.speed));
                next.focus();
            });
        });

        if (this.progressBar) {
            this.progressBar.addEventListener('input', (e) => {
                this.isDragging = true;
                const time = parseFloat(e.target.value) * 1000; // Convert seconds to ms
                this.timeDisplay.textContent = formatTime(time);
                this.renderProgressFill();
            });

            this.progressBar.addEventListener('change', (e) => {
                this.isDragging = false;
                const time = parseFloat(e.target.value) * 1000; // Convert seconds to ms
                if (this.demoPlayer.seek) {
                    this.demoPlayer.seek(time);
                }
            });
        }
    }

    show() {
        if (this.container) {
            this.container.style.display = 'flex';
            // Lets other chrome (the Hale tile) step aside while a replay plays.
            document.body.classList.add('replay-playing');
            this.startUpdateLoop();
            this.updateUI();
        }
    }

    hide() {
        if (this.container) {
            this.container.style.display = 'none';
            document.body.classList.remove('replay-playing');
            this.stopUpdateLoop();
        }
    }

    togglePlayPause() {
        if (this.demoPlayer.isPaused) {
            this.demoPlayer.resumePlayback();
        } else {
            this.demoPlayer.pausePlayback();
        }
        this.renderPlayPause(Boolean(this.demoPlayer.isPaused));
    }

    setSpeed(speed) {
        const applied = this.demoPlayer.setPlaybackSpeed?.(speed);
        this.renderSpeed(typeof applied === 'number' ? applied : speed);
    }

    stop() {
        this.demoPlayer.stopPlayback();
        this.hide();
        // A manual stop means the person is done with this replay.
        if (this.onStopCallback) this.onStopCallback();
    }

    startUpdateLoop() {
        this.stopUpdateLoop();
        this.updateInterval = setInterval(() => this.updateUI(), 100);
    }

    stopUpdateLoop() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    updateUI() {
        if (!this.demoPlayer || !this.timeDisplay || !this.durationDisplay) return;

        const currentTime = this.demoPlayer.getCurrentTime();
        const totalDuration = this.demoPlayer.getDuration();

        if (!this.isDragging) this.timeDisplay.textContent = formatTime(currentTime);
        this.durationDisplay.textContent = formatTime(totalDuration);

        if (this.progressBar && !this.isDragging) {
            this.progressBar.max = totalDuration / 1000;
            this.progressBar.value = currentTime / 1000;
            this.renderProgressFill();
        }

        // Follow the player when its state changes elsewhere (a new replay starts at 1×).
        this.renderPlayPause(Boolean(this.demoPlayer.isPaused));
        if (typeof this.demoPlayer.playbackSpeed === 'number') this.renderSpeed(this.demoPlayer.playbackSpeed);
    }

    renderPlayPause(isPaused) {
        if (!this.playPauseBtn || this.isPausedShown === isPaused) return;
        this.isPausedShown = isPaused;
        const label = isPaused ? 'Play' : 'Pause';
        this.playPauseBtn.querySelector('.pb-btn__icon').innerHTML = isPaused ? ICONS.play : ICONS.pause;
        this.playPauseBtn.querySelector('.pb-btn__label').textContent = label;
        this.playPauseBtn.classList.toggle('is-paused', isPaused);
    }

    renderSpeed(speed) {
        if (this.speedShown === speed) return;
        this.speedShown = speed;
        this.speedButtons.forEach((button) => {
            const current = Number(button.dataset.speed) === speed;
            button.setAttribute('aria-checked', String(current));
            button.tabIndex = current ? 0 : -1;
            button.classList.toggle('is-current', current);
        });
    }

    renderProgressFill() {
        const max = Number(this.progressBar.max) || 0;
        const pct = max > 0 ? Math.min(100, (Number(this.progressBar.value) / max) * 100) : 0;
        this.progressBar.style.setProperty('--pb-fill', `${pct.toFixed(2)}%`);
    }

    setOnStop(callback) {
        this.onStopCallback = callback;
    }
}
