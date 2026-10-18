/**
 * Spring — content budgets per quality tier. Every tier keeps the whole valley, the light, the
 * day and every gameplay beat; the tiers scale the plant and tree counts, the meshes and the
 * effect pools.
 *
 *   grassNear     clumps of spring grass on the knoll under the eye (curved blades)
 *   grassFar      clumps out to the knoll's edge and along the banks (single-piece blades)
 *   flowersNear   modelled flowers close to the lens; flowersFar simplified ones beyond
 *   patches       patches of bloom (one a lock) the flowers read at once
 *   landCols      columns of the ground fan across its bearings
 *   landRow       the fan's row spacing as a share of the distance (landMinRow its least, m)
 *   riverCols     vertices across the river ribbon; riverDetail its density along the river
 *   pourCols      columns of the fall's water across the lip; pourRows rows down its travel
 *   faceCols      columns of the step's rock face across it; faceRows rows down it
 *   clouds        cloud layers in the sky (1 = the cumulus deck, 2 = + high cirrus)
 *   banks         heaped cumulus standing on the horizon
 *   trees         modelled birches and spruces near the river (the woods carry the valley)
 *   foliage       share of each tree's sprays drawn; limbs whether the bark draws its limbs
 *   woods         the valley's trees beyond the modelled ones, out to the canopy's reach: cards
 *                 of the modelled trees (spring-impostors.js)
 *   impostorCell  the impostor atlas's texels across a tree (its height is half again)
 *   bankRocks     boulders along the banks; slabs granite slabs round the knoll's shoulder
 *   motes         spray and dew glints in the air at once
 *   mist          puffs of the fall's mist and the ledges' spray
 *   floes         ice floes a four-line clear can send down the river at once
 *   life          birds over the valley
 *   pixelRatioCap the theme's pixel-ratio cap (the adapter's table carries the same values)
 */
const tier = (o) => Object.freeze({ ...o });

export const QUALITY = Object.freeze({
    Minimal: tier({
        grassNear: 1800,
        grassFar: 2600,
        flowersNear: 900,
        flowersFar: 1600,
        patches: 4,
        landCols: 140,
        landRow: 0.03,
        landMinRow: 0.6,
        riverCols: 20,
        riverDetail: 0.45,
        pourCols: 70,
        pourRows: 70,
        faceCols: 120,
        faceRows: 80,
        clouds: 1,
        banks: 5,
        trees: 16,
        foliage: 0.35,
        limbs: false,
        woods: 1500,
        impostorCell: 128,
        bankRocks: 12,
        slabs: 4,
        motes: 256,
        mist: 120,
        floes: 16,
        life: 6,
        pixelRatioCap: 0.7,
    }),
    Low: tier({
        grassNear: 3400,
        grassFar: 5000,
        flowersNear: 1600,
        flowersFar: 3000,
        patches: 4,
        landCols: 180,
        landRow: 0.022,
        landMinRow: 0.45,
        riverCols: 28,
        riverDetail: 0.6,
        pourCols: 100,
        pourRows: 90,
        faceCols: 160,
        faceRows: 100,
        clouds: 1,
        banks: 6,
        trees: 28,
        foliage: 0.5,
        limbs: false,
        woods: 3000,
        impostorCell: 160,
        bankRocks: 20,
        slabs: 6,
        motes: 512,
        mist: 180,
        floes: 24,
        life: 10,
        pixelRatioCap: 0.85,
    }),
    Medium: tier({
        grassNear: 6000,
        grassFar: 8000,
        flowersNear: 2600,
        flowersFar: 5000,
        patches: 6,
        landCols: 240,
        landRow: 0.016,
        landMinRow: 0.38,
        riverCols: 32,
        riverDetail: 0.8,
        pourCols: 140,
        pourRows: 120,
        faceCols: 220,
        faceRows: 130,
        clouds: 2,
        banks: 7,
        trees: 45,
        foliage: 0.65,
        limbs: true,
        woods: 6000,
        impostorCell: 192,
        bankRocks: 28,
        slabs: 8,
        motes: 768,
        mist: 260,
        floes: 32,
        life: 16,
        pixelRatioCap: 1.0,
    }),
    High: tier({
        grassNear: 9000,
        grassFar: 12000,
        flowersNear: 3800,
        flowersFar: 7000,
        patches: 8,
        landCols: 300,
        landRow: 0.012,
        landMinRow: 0.3,
        riverCols: 40,
        riverDetail: 1,
        pourCols: 190,
        pourRows: 150,
        faceCols: 300,
        faceRows: 170,
        clouds: 2,
        banks: 8,
        trees: 70,
        foliage: 0.8,
        limbs: true,
        woods: 10000,
        impostorCell: 256,
        bankRocks: 36,
        slabs: 10,
        motes: 1024,
        mist: 360,
        floes: 40,
        life: 22,
        pixelRatioCap: 1.15,
    }),
    Ultra: tier({
        grassNear: 11500,
        grassFar: 15000,
        flowersNear: 4600,
        flowersFar: 9000,
        patches: 8,
        landCols: 360,
        landRow: 0.01,
        landMinRow: 0.25,
        riverCols: 48,
        riverDetail: 1.2,
        pourCols: 230,
        pourRows: 180,
        faceCols: 360,
        faceRows: 200,
        clouds: 2,
        banks: 9,
        trees: 100,
        foliage: 0.9,
        limbs: true,
        woods: 14000,
        impostorCell: 320,
        bankRocks: 44,
        slabs: 12,
        motes: 1536,
        mist: 480,
        floes: 48,
        life: 28,
        pixelRatioCap: 1.35,
    }),
    Extreme: tier({
        grassNear: 14000,
        grassFar: 18000,
        flowersNear: 5600,
        flowersFar: 11000,
        patches: 8,
        landCols: 420,
        landRow: 0.008,
        landMinRow: 0.22,
        riverCols: 56,
        riverDetail: 1.4,
        pourCols: 270,
        pourRows: 210,
        faceCols: 420,
        faceRows: 230,
        clouds: 2,
        banks: 10,
        trees: 140,
        foliage: 1,
        limbs: true,
        woods: 18000,
        impostorCell: 384,
        bankRocks: 52,
        slabs: 14,
        motes: 2048,
        mist: 600,
        floes: 56,
        life: 34,
        pixelRatioCap: 1.6,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(q) {
    return QUALITY[q] || QUALITY.High;
}
