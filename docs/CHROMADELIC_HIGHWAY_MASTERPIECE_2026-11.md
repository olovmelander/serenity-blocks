# Chromadelic Highway visual audit, November 2026

## Starting point

The Antigravity session *Chromadelic Highway Theme Audit And Improvement* (`29be2b7b-dd14-4a68-8872-85be51c1f508`) added five cosmic sectors and Blender-built arch supports to the seven-lane highway and its reactive planets. Its final two passes gave the small stars different magnitudes and depths, then reshaped the supports to meet the round, hexagonal and octagonal arches. Its `after-v5` captures are the starting point for this continuation.

That session recorded captures on WebGPU and WebGL2, in portrait and in live Single Player. The 252-test run in its original handoff preceded the final star and pylon changes. The final pylon pass recorded 89 passing Chromadelic tests.

## What the continuation changes

| Surface | Finding at the handoff | Current treatment |
| --- | --- | --- |
| Highway and glowing lanes | The bends and colored curbs gave a clear direction of travel. The repeated patches of light on the deck had little connection to the arches above. | Staggered joints break the seven lanes into cut-glass panes. Where reflections are enabled, a reflected view ray finds a passing arch on the road's curve and picks up its shape and palette. Refraction varies at the pane bevels, and distant reflections fade as they become too fine to resolve. |
| Arches and roadside architecture | The supports met the road convincingly, but a near arch still looked like a flat strip of light. | Dark metal channels, separate seats for double tubes and narrow highlighted ferrules give the lamps thickness at close range. The Blender export has **956 triangles per pylon** and **84 per curb winglet**. The paired pylons follow their arch's position, shape and color. |
| Rainbow planet and moon | The color bands carried well at gameplay size. The storm eye appeared painted over them, and latitude-dependent drift could pull its shape apart over a long run. | The colored jets curl around the eye, leaving a wake and finer cloud crests. The belts drift through a bounded angle as the planet rotates. The orbiting moon and its colored planetshine remain visible against the quieter sky. |
| Ringed planet | The fine outer rings nearly vanished against cyan haze. Their optical depth was applied twice. | The rings take their transparency from the optical-depth profile once. A cool ice-to-champagne tint separates the disc, broad bright ring, dark division and fine outer edge. Event colors can still travel across the rings. |
| Purple nebula and stars | Soft gray-violet light filled the horizon. Frequent bright glints flattened the depth between the nearer stars and the distant star dust. | A forked purple cloud bank follows the large planet when the layout mirrors. Its bright rims and knots border a dark dust pocket that also hides background stars. A tighter vanishing-point glow leaves space between the arches. The four star tiers keep their depth and color, with the brightest diffraction crosses reserved for occasional beacons. |
| Speed and depth | Bright speed streaks near the horizon competed with the leading edges of the arches. | Near streaks on the outer flanks have brighter heads and longer trails. Distant streaks recede to fine colored traces. Staggered glass joints, passing winglets and moving arch reflections provide distance cues between clears. |
| Pieces, board and HUD | The foreground needed to survive both large events and a narrow phone layout. | The seven solid piece colors have a thin highlight and shadow around the fused silhouette. The event ribbons and outlines feather at the live board and HUD bounds. On a narrow screen with little side clearance, the large planet scales into the headroom above the queue. |

Compare the glass and arch feet at the bottom of the frame, then the dust lane above the rainbow planet. [Before and after](chromadelic-highway-captures/highway-before-after.jpg)

The live board, next queue and score panel show how much of that scene the player sees. [Single Player](chromadelic-highway-captures/highway-solo.jpg)

## Variation during play

A sector lasts 73 seconds. Its sky gradually blends into the next while the six movements of the arch spectrum advance on their own travel clock. A level gain nudges the sector offset forward, so a familiar arch palette can return under a different sky.

| Sector | Visible change |
| --- | --- |
| Velvet Rift | Purple emission knots pick out the edges of a branching dark lane. |
| Aurora Slipstream | Emerald and cyan curtains cross the side windows. |
| Starlight Crossing | The nebula recedes and the diagonal star field becomes the dominant sky feature. |
| Ion Corridor | Pink ionization fronts brighten along the cloud's forks. |
| Nebula Heart | The cloud bank warms through rose and the vanishing point glows above the road. |

The five captures hold the road and camera at the same phase to show the change in atmosphere. [Sector comparison](chromadelic-highway-captures/highway-sectors.jpg)

## Event hierarchy

A placement starts on the deck. Ordinary clears travel along the road and into the planets. Larger events gain distinct silhouettes in the open sky. The earlier renderer shaded four full-screen portal quads. The current renderer builds five narrow indexed outlines in one mesh and selects the active range for drawing. A cascade and a consecutive clear have separate outlines and triggers.

| Gameplay event | Visual response |
| --- | --- |
| Piece lock | The lane matching the tetromino lights up and a short pulse runs along the curb. |
| Hard drop | A V-shaped compression wave cuts across all seven lanes. Repeated slams share a cooldown. |
| Single | One band runs down the road, with an arch chase and one planetary lightning strike. |
| Double | Two road bands are answered by a pair of meteors on opposing flanks. |
| Triple | Three road bands lead into lit outer tunnel rails and a stronger aurora. |
| Quad | A timed sequence of four bands ignites the prism arches, then opens the rainbow warp tunnel. |
| Cascade | Successive waves from one piece send stacked chevrons up both flanks. Deep cascades can send a comet across the sky. |
| Consecutive clear | Scoring on successive locks builds a necklace of interlocking outlines. Longer chains advance the spectrum and can introduce prism arches. |
| Twist | A double helix turns down the tunnel. A diagonal shear crosses the glass, with alternating bank direction on successive twists. |
| Back-to-back | Two opposed gold crescents lead a delayed gold echo through the arches and planetary rings. |
| Level up | A bracketed octagon expands from the vanishing point as the next movement repaints the tunnel. |
| Perfect clear | Twelve faceted prisms open around the board. The rails, planetary auroras and paired gold and cyan comets share the finale. |
| Game over and new run | Travel and event energy coast down into an ember glow. Active play rekindles the road. |

The silhouettes and their placement can be compared in the same frame. [Event comparison](chromadelic-highway-captures/highway-events.jpg)

## Rendering cost

On the first visit, a worker bakes the rainbow giant and, on tiers that use it, the nebula atlas while the renderer initializes. Re-entry wraps the cached pixel buffers in fresh textures. The world can compute the same bytes synchronously if the worker is unavailable. The small ice-ring profile and its mip chain remain local.

The sky reuses its existing atlas reads for the dust and ionization filaments. Minimal skips the nebula atlas. The warp-blur pass takes its extra scene samples only during a rush and only on affected pixels outside the board and HUD.

## Verification on November 26

The shipping theme ran in a live High-quality solo game. A physical hard drop updated the score and lit the apron. A perfect clear sent through the gameplay event bus opened the prism crown around the well. The isolated playground also covered every event, all five sectors, High on WebGPU and WebGL2, Minimal, and a 390 × 844 Low-quality portrait layout. With Reduce Flashing enabled, the arch chase, road waves, warp rails and crown dim together. Reduce Motion holds the crown's radius and eases the helix rotation down.

The following measurements used the playground profiler at 1200 × 750, High, seed 27, on the local NVIDIA Blackwell WebGPU adapter with a 30 FPS cap. The live sequence advanced the clock and locked a piece every half second while layering clears, twists, cascades, back-to-backs and perfect clears. GPU samples came from resolved timestamp queries. [Timing records](chromadelic-highway-captures/highway-profile.json)

| Scene | GPU p95 | Frame interval p95 | Longest frame interval |
| --- | ---: | ---: | ---: |
| Rest, fixed time | 0.27 ms | 33.9 ms | 64.7 ms |
| Perfect clear, fixed at 0.24 s | 1.90 ms | 34.0 ms | 195.3 ms |
| Moving highway with overlapping events | 1.04 ms | 34.1 ms | 88.1 ms |

The longer frame intervals were observed in headless Chrome. Their cause was not isolated. These figures cover one desktop GPU.

The production build and its boot-closure check passed, along with 323 tests across 18 suites, TypeScript and scoped ESLint. On the integration branch, all 64 themes passed the project-wide palette check.
