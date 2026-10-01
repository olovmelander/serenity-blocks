/** Original Ocean models authored and animated through the Blender MCP addon. */
const common = {
    modelVersion: 'ocean-atelier-2026-10',
    sourceMode: 'blender-mcp-project-authored',
    license: 'MIT-project-local',
    author: 'Serenity Blocks',
    yUp: true,
    textureCount: 0,
    sourcePriority: 100,
};

export const OCEAN_JELLYFISH_MODEL_URL = new URL('./assets/blender-reef/jellyfish.glb', import.meta.url).href;

export function getBlenderCoralRecords() {
    return [
        {
            id: 'atelier-sponge',
            kind: 'purple-tube-sponge',
            triangleCount: 1512,
            byteSize: 38300,
            runtimeScale: 2.6,
            url: new URL('./assets/blender-reef/coral-sponge.glb', import.meta.url).href,
        },
        {
            id: 'atelier-staghorn',
            kind: 'branching-coral',
            triangleCount: 2002,
            byteSize: 52596,
            runtimeScale: 2.3,
            url: new URL('./assets/blender-reef/coral-staghorn.glb', import.meta.url).href,
        },
        {
            id: 'atelier-foliose',
            kind: 'table-coral',
            triangleCount: 1244,
            byteSize: 31872,
            runtimeScale: 2.8,
            url: new URL('./assets/blender-reef/coral-foliose.glb', import.meta.url).href,
        },
        {
            id: 'atelier-fan',
            kind: 'fan-coral',
            triangleCount: 2142,
            byteSize: 121180,
            runtimeScale: 2.6,
            animated: true,
            url: new URL('./assets/blender-reef/coral-fan.glb', import.meta.url).href,
        },
    ].map((record) => ({ ...common, placementRole: 'hero-colony', ...record }));
}

export function getBlenderKelpRecords() {
    return [{
        ...common,
        id: 'atelier-ribbon-kelp',
        kind: 'ribbon-kelp-grove',
        triangleCount: 1496,
        byteSize: 101260,
        runtimeScale: 1.7,
        animated: true,
        url: new URL('./assets/blender-reef/kelp.glb', import.meta.url).href,
    }];
}

export function getBlenderReefRecords() {
    return [
        {
            id: 'atelier-buttress',
            kind: 'sun-pillar',
            triangleCount: 1868,
            byteSize: 46420,
            runtimeScale: 4.4,
            url: new URL('./assets/blender-reef/reef-buttress.glb', import.meta.url).href,
        },
        {
            id: 'atelier-outcrop',
            kind: 'left-canyon-wall',
            triangleCount: 1376,
            byteSize: 34604,
            runtimeScale: 6.4,
            url: new URL('./assets/blender-reef/reef-outcrop.glb', import.meta.url).href,
        },
    ].map((record) => ({ ...common, ...record }));
}
