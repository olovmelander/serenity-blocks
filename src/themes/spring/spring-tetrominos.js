/**
 * Spring — the board wears the knoll's flowers, one for each piece: globeflower lemon (I), marsh
 * marigold gold (O), wood anemone white (T), hepatica blue (S), red campion pink (Z), lady's smock
 * lilac (J) and dog violet orchid (L); a lock lights its own flowers in the meadow (spring-meadow.js).
 * Deliberately reassigned (1/7 in the conventional bands), solid in every board and preview.
 * Every pair stays ΔE > 14 under protan, deutan and tritan simulation, and every colour is at
 * least L* 56 so it reads on the dark card.
 */
export const SPRING_TETROMINOS = {
    version: 2,
    colors: {
        I: '#F6E76E',
        O: '#EE8512',
        T: '#F8F4EC',
        S: '#279DF1',
        Z: '#E8508C',
        J: '#D9BDF5',
        L: '#C756D2',
        GARBAGE: '#2E3826',
        CLEAN_GARBAGE: '#E6E1D3',
    },
    renderMode: 'solid',
    effects: {
        premium: true,
        phaser: {
            gradient: true,
            highlight: 0.16,
            shadow: 0.2,
            rim: true,
            rimAlpha: 0.4,
            rimWidthFactor: 0.05,
            gloss: true,
            glossAlpha: 0.14,
        },
    },
    rendererOverrides: {},
};
