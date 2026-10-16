/**
 * The keyboard's media keys and the system's media controls (Media Session API) in Serenity
 * Mode: play and pause the music, next and previous song, with the song's title and its
 * theme's artwork. Only while the mode runs; on leaving, the handlers are given back.
 */
const ACTIONS = ['play', 'pause', 'nexttrack', 'previoustrack'];

export class SerenityMediaSession {
    /**
     * @param {object} handlers
     * @param {() => void} handlers.play
     * @param {() => void} handlers.pause
     * @param {() => void} handlers.next
     * @param {() => void} handlers.previous
     */
    constructor(handlers) {
        this.handlers = handlers;
        this.active = false;
    }

    get session() {
        return globalThis.navigator?.mediaSession || null;
    }

    start() {
        const { session } = this;
        if (!session?.setActionHandler || this.active) return;
        this.active = true;
        const map = {
            play: this.handlers.play,
            pause: this.handlers.pause,
            nexttrack: this.handlers.next,
            previoustrack: this.handlers.previous,
        };
        ACTIONS.forEach((action) => {
            try { session.setActionHandler(action, () => map[action]()); } catch { /* not supported here */ }
        });
    }

    /** @param {{title: string, artwork?: string}} song */
    describe(song) {
        const { session } = this;
        const Metadata = globalThis.MediaMetadata;
        if (!this.active || !session || typeof Metadata !== 'function' || !song?.title) return;
        try {
            session.metadata = new Metadata({
                title: song.title,
                artist: 'Serenity Blocks',
                album: 'Serenity Mode',
                artwork: song.artwork ? [{ src: song.artwork, sizes: '512x512', type: 'image/png' }] : [],
            });
        } catch { /* metadata is a courtesy */ }
    }

    stop() {
        const { session } = this;
        if (!this.active || !session) return;
        this.active = false;
        ACTIONS.forEach((action) => {
            try { session.setActionHandler(action, null); } catch { /* not supported here */ }
        });
        try { session.metadata = null; } catch { /* read-only here */ }
    }
}
