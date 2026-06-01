import { eventBus, EVENTS } from '../events/event-bus.js';
import { introAnimation } from './intro-animation.js';

// Helper function to format time
function formatTime(ms) {
    if (!ms || isNaN(ms)) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export class DemoBrowser {
    constructor(demoManager, gameModeManager) {
        this.demoManager = demoManager;
        this.gameModeManager = gameModeManager;
        this.modal = document.getElementById('demo-browser-modal');
        this.listContainer = document.getElementById('demo-list');
        this.importInput = document.getElementById('import-demo-input');

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Close button
        const closeBtn = document.getElementById('close-demo-browser');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hide();
                // Return to main menu (intro + start modal)
                eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
            });
        }

        // Import button
        const importBtn = document.getElementById('import-demo-btn');
        if (importBtn && this.importInput) {
            importBtn.addEventListener('click', () => this.importInput.click());
            this.importInput.addEventListener('change', (e) => this.handleFileImport(e));
        }

    }

    show() {
        if (this.modal) {
            this.modal.classList.add('visible');
            this.refreshList();
        }
    }

    hide() {
        if (this.modal) {
            this.modal.classList.remove('visible');
        }
    }

    async refreshList() {
        if (!this.listContainer) return;

        this.listContainer.innerHTML = '<div class="loading-spinner">Loading...</div>';

        try {
            const demos = await this.demoManager.listDemos();

            if (demos.length === 0) {
                this.listContainer.innerHTML = '<div class="empty-state">No replays found. Play a game to record one!</div>';
                return;
            }

            // Sort by date descending
            demos.sort((a, b) => b.timestamp - a.timestamp);

            this.listContainer.innerHTML = '';

            demos.forEach((demo) => {
                const card = this.createDemoCard(demo);
                this.listContainer.appendChild(card);
            });
        } catch (err) {
            console.error('Failed to load demos:', err);
            this.listContainer.innerHTML = '<div class="error-state">Failed to load replays.</div>';
        }
    }

    createDemoCard(demo) {
        const card = document.createElement('div');
        card.className = 'demo-card';

        const date = new Date(demo.timestamp);
        const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        const duration = demo.metadata?.duration ? formatTime(demo.metadata.duration) : '??:??';
        const score = demo.metadata?.score?.toLocaleString() || '0';

        card.innerHTML = `
            <div class="demo-info">
                <div class="demo-header">
                    <span class="demo-mode">${demo.gameMode || 'Single Player'}</span>
                    <span class="demo-date">${dateStr}</span>
                </div>
                <div class="demo-stats">
                    <span class="stat stat--score">
                        <span class="stat-value">${score}</span>
                        <span class="stat-label">Score</span>
                    </span>
                    <span class="stat">
                        <span class="stat-value">${demo.metadata?.level || 1}</span>
                        <span class="stat-label">Level</span>
                    </span>
                    <span class="stat">
                        <span class="stat-value">${duration}</span>
                        <span class="stat-label">Duration</span>
                    </span>
                </div>
            </div>
            <div class="demo-actions">
                <button class="btn-play" title="Watch Replay">▶</button>
                <button class="btn-share" title="Share Link">🔗</button>
                <button class="btn-delete" title="Delete">🗑️</button>
            </div>
        `;

        // Add listeners
        const playBtn = card.querySelector('.btn-play');
        playBtn.addEventListener('click', () => this.playDemo(demo.id));

        const shareBtn = card.querySelector('.btn-share');
        shareBtn.addEventListener('click', () => this.shareDemo(demo));

        const deleteBtn = card.querySelector('.btn-delete');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Are you sure you want to delete this replay?')) {
                this.deleteDemo(demo.id);
            }
        });

        return card;
    }

    async playDemo(id) {
        try {
            const demo = await this.demoManager.loadDemo(id);
            if (!demo) throw new Error('Demo not found');

            this.hide();

            // Close all other modals (e.g. Start Modal)
            if (this.gameModeManager.deps && this.gameModeManager.deps.modalManager) {
                this.gameModeManager.deps.modalManager.hideAll();
            }

            if (introAnimation) {
                introAnimation.dismiss();
            }

            // Switch to single player mode and start playback
            // We assume SinglePlayerMode handles 'demo' option in onStart
            await this.gameModeManager.activateMode('single');
            await this.gameModeManager.startCurrentMode({ demo });
        } catch (err) {
            console.error('Failed to play demo:', err);
            alert('Failed to play replay.');
        }
    }

    async shareDemo(demo) {
        try {
            // If full demo data isn't in the list item, load it
            let fullDemo = demo;
            if (!demo.inputs) {
                fullDemo = await this.demoManager.loadDemo(demo.id);
            }

            const url = await this.demoManager.exportToURL(fullDemo);
            await navigator.clipboard.writeText(url);
            alert('Replay link copied to clipboard!');
        } catch (err) {
            console.error('Failed to share demo:', err);
            alert('Failed to generate share link.');
        }
    }

    async deleteDemo(id) {
        try {
            await this.demoManager.deleteDemo(id);
            this.refreshList();
        } catch (err) {
            console.error('Failed to delete demo:', err);
        }
    }

    async handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const demo = await this.demoManager.importFromJSON(text);
            await this.demoManager.saveDemo(demo);
            this.refreshList();
            alert('Replay imported successfully!');
        } catch (err) {
            console.error('Import failed:', err);
            alert('Failed to import replay. Invalid file format.');
        }

        // Reset input
        event.target.value = '';
    }

}
