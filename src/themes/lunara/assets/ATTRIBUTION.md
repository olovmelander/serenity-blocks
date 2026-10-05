# Lunara — asset attribution

Lunara ships one image it did not make: the moon map every moon in the fleet shares. Everything
else in the valley is generated in code when the theme starts — the noise field, the terrain's
heights, the ranges' skylines, every crystal spire and lantern flower, the sky, the aurora, the
water and the gameplay effects. The theme loads no model, no environment map and no other
texture.

## The moon map (CC BY 4.0 — attribution required)

| File | Author | Licence | Source |
| --- | --- | --- | --- |
| `public/textures/2k_moon.jpg` | **Solar System Scope** ("Textures by Solar System Scope") | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://www.solarsystemscope.com/textures/ |

The file is shared with other themes and is credited in the top-level `CREDITS.md`, which is the
authoritative entry. Lunara reads it as `./textures/2k_moon.jpg` (`MOON_MAP_URL` in
`lunara-world.js`).

**Modifications (CC BY requires stating changes):** the file itself is unchanged. At run time
both moons sample it for luminance only, tint it with the level's palette, and read its slope
for the relief along the terminator; the great moon's veins of light are drawn over it in the
shader.

The map loads off the frame. Until it arrives, or if it fails to load, the moons stand as smooth
lit spheres.
