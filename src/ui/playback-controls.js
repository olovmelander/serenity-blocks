// Helper function to format time
function formatTime(ms) {
    if (!ms || isNaN(ms)) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export class PlaybackControls {
    constructor(demoPlayer) {
        this.demoPlayer = demoPlayer;
        this.container = document.getElementById('playback-controls');

        // Inject new HTML structure matching the horizontal design
        if (this.container) {
            this.container.innerHTML = `
                <div class="playback-buttons">
                    <button id="pb-play-pause" class="control-btn" title="Play/Pause">⏸</button>
                    <button id="pb-stop" class="control-btn" title="Stop Playback">⏹</button>
                </div>
                <div class="playback-info">
                    <span id="playback-time">00:00</span> <span class="separator">/</span> <span id="playback-duration">00:00</span>
                </div>
                <div class="playback-progress-container">
                    <input type="range" id="pb-progress" min="0" max="100" value="0" step="0.1">
                </div>
                <div class="playback-speed">
                    <select id="pb-speed" class="speed-select" title="Playback Speed">
                        <option value="0.5">0.5x</option>
                        <option value="1.0" selected>1.0x</option>
                        <option value="2.0">2.0x</option>
                        <option value="4.0">4.0x</option>
                    </select>
                </div>
            `;
        }

        this.playPauseBtn = document.getElementById('pb-play-pause');
        this.stopBtn = document.getElementById('pb-stop');
        this.restartBtn = document.getElementById('pb-restart');
        this.speedSelect = document.getElementById('pb-speed');
        this.timeDisplay = document.getElementById('playback-time');
        this.durationDisplay = document.getElementById('playback-duration');
        this.progressBar = document.getElementById('pb-progress');

        this.updateInterval = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        if (!this.container) return;

        if (this.playPauseBtn) {
            this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        }

        if (this.stopBtn) {
            this.stopBtn.addEventListener('click', () => this.stop());
        }

        if (this.restartBtn) {
            this.restartBtn.addEventListener('click', () => this.restart());
        }

        if (this.speedSelect) {
            this.speedSelect.addEventListener('change', (e) => {
                const speed = parseFloat(e.target.value);
                this.demoPlayer.setPlaybackSpeed(speed);
            });
        }

        // progressBar is now part of the dynamically set innerHTML
        if (this.progressBar) {
            this.progressBar.addEventListener('input', (e) => {
                this.isDragging = true;
                const time = parseFloat(e.target.value) * 1000; // Convert seconds to ms
                this.timeDisplay.textContent = formatTime(time);
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
            this.startUpdateLoop();
            this.updateUI();
        }
    }

    hide() {
        if (this.container) {
            this.container.style.display = 'none';
            this.stopUpdateLoop();
        }
    }

    togglePlayPause() {
        if (this.demoPlayer.isPaused) {
            this.demoPlayer.resumePlayback();
            this.playPauseBtn.textContent = '⏸';
        } else {
            this.demoPlayer.pausePlayback();
            this.playPauseBtn.textContent = '▶';
        }
    }

    stop() {
        this.demoPlayer.stopPlayback();
        this.hide();
        // Trigger game over or return to menu?
        // SinglePlayerMode handles stopPlayback, which sets isPlayingDemo = false.
        // But we might want to trigger onStop in SinglePlayerMode.
        // For now, let's assume the user manually stopping means they want to quit the replay.
        // We can dispatch an event or rely on SinglePlayerMode to handle it.
        // Ideally, we should call a callback passed to constructor.
        if (this.onStopCallback) this.onStopCallback();
    }

    restart() {
        // Restart logic would require reloading the demo in SinglePlayerMode
        // For now, maybe just reset speed and resume?
        // Implementing full restart is complex because we need to reset game state.
        // Let's leave it for now or implement if easy.
        // Actually, DemoPlayer doesn't have a restart method exposed easily without re-init.
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

        this.timeDisplay.textContent = formatTime(currentTime);
        this.durationDisplay.textContent = formatTime(totalDuration);

        if (this.progressBar && !this.isDragging) {
            this.progressBar.max = totalDuration / 1000;
            this.progressBar.value = currentTime / 1000;
        }

        // Update play/pause button state if changed externally
        if (this.playPauseBtn) {
            this.playPauseBtn.textContent = this.demoPlayer.isPaused ? '▶' : '⏸';
        }
    }

    setOnStop(callback) {
        this.onStopCallback = callback;
    }
}
