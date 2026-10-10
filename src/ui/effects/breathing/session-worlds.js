/**
 * The world each stage of each Hale session is set in. One journey per session, the same every
 * time: the scenery is part of the practice, not decoration to shuffle. An array is indexed by
 * round. A round breathes the technique of the world it is set in (or a gentler form of it, named
 * as such), and `featured` is the world a session opens with on the path (breath-collection.js):
 * its poster. Each session passes only through worlds that are open by the time it opens.
 *
 * Boot-safe data (no audio, no three.js): the session manager, the Hale tab and the breath
 * collection read it.
 */
export const SESSION_WORLDS = Object.freeze({
    FIRST: {
        featured: 'coherence',
        grounding: 'zen-garden',
        active: ['coherence', 'box-breathing', 'calm-sleep'],
        integration: 'zen-garden',
    },
    TIDE: {
        featured: 'ocean-breath',
        grounding: 'ocean-breath',
        active: 'ocean-breath',
        carry: 'ocean-breath',
        integration: 'calm-sleep',
    },
    ROOTS: {
        featured: 'forest-breath',
        grounding: 'forest-breath',
        active: 'forest-breath',
        carry: 'forest-breath',
        integration: 'coherence',
    },
    UNWIND: {
        featured: 'deep-relaxation',
        grounding: 'deep-relaxation',
        active: 'deep-relaxation',
        integration: 'calm-sleep',
    },
    SUNRISE: {
        featured: 'energizing',
        grounding: 'energizing',
        active: 'energizing',
        integration: 'coherence',
    },
    REST: {
        featured: 'cosmic-breath',
        grounding: 'cosmic-breath',
        active: 'calm-sleep',
        carry: 'cosmic-breath',
        integration: 'cosmic-breath',
    },
    FLOW: {
        featured: 'triangle',
        grounding: 'zen-garden',
        active: ['box-breathing', 'triangle', 'box-breathing'],
        carry: ['box-breathing', 'triangle', 'box-breathing'],
        integration: 'ocean-breath',
    },
    BASE: {
        featured: 'electric-storm',
        grounding: 'forest-breath',
        active: 'electric-storm',
        retention: 'cosmic-breath',
        recovery: 'coherence',
        integration: 'calm-sleep',
    },
    ELIXIR: {
        featured: 'wim-hof',
        grounding: 'zen-garden',
        active: ['wim-hof', 'energizing', 'electric-storm'],
        retention: 'cosmic-breath',
        recovery: 'coherence',
        integration: 'deep-relaxation',
    },
});
