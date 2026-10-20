/**
 * Sunfall Theme — Piece Palette Configuration (v2 solid + Phaser bevel/rim/gloss)
 *
 * Piece hues are drawn from Hang Sơn Đoòng's botanical and mineral palette:
 * anthocyanin-flushed young tropical leaves (crimson, bronze, chartreuse, jade, orchid),
 * iridescent blue Selaginella spikemoss on shaded rimstone gours, and white-gold
 * sunfall light through the cave cloud deck.
 *
 * Palette gate: 0/7 CVD warnings across Normal, Protanopia, Deuteranopia, Tritanopia,
 * and Achromatopsia (min ΔE = 19.5).
 */

export const SUNFALL_TETROMINOS = {
    version: 2,
    renderMode: 'solid',

    colors: {
        I: '#E8385E', // Flush Crimson — young Syzygium canopy leaf shoot
        O: '#4781F6', // Peacock Fern — iridescent blue Selaginella spikemoss in gour shade
        T: '#8BC85F', // New-Growth Chartreuse — uncurling Asplenium bird's-nest fern frond
        S: '#FFC23E', // Sunfall Gold — direct noon light on wet travertine rimstone
        Z: '#45BC90', // Canopy Jade — mature banana-leaf lamina in emerald pool bounce
        J: '#DE6A27', // Bronze Flush — newly unfurled Cinnamon leaf in the warm shaft
        L: '#C168C4', // Doline Orchid — epiphytic slipper-orchid petal on sunlit karst
        GARBAGE: '#3A4640', // Wet Karst Slate — damp limestone wall in chamber shadow
        CLEAN_GARBAGE: '#E6DDC9', // Travertine Rim — dry pale calcite dam crest
    },

    effects: {
        glowRadius: 0,
        glowIntensity: 0,
        chrome: false,
        caustics: false,
        pulseSpeed: 0,
        pulseAmplitude: 0,
        bevelIntensity: 0.34,
        shadowIntensity: 0.28,
        colorSaturation: 1.0,
        colorBrightness: 1.0,
        phaser: {
            gradient: true,
            highlight: 0.22,
            shadow: 0.24,
            rim: true,
            rimAlpha: 0.5,
            rimWidthFactor: 0.05,
            gloss: true,
            glossAlpha: 0.18,
        },
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 0,
            glowIntensity: 0,
        },
        phaser: {
            glowRadius: 0,
            glowIntensity: 0,
        },
    },
};
