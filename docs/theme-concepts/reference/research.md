# Inspiration research: 33 candidate concepts

> **Snapshot taken at commit 5d3478d (main, 2026-10-11) during the Rainbark design; line numbers drift, verify against the current code.**
>
> Part of `docs/theme-concepts/`: the index is [`../README.md`](../README.md) and the shared build procedure is [`../PLAYBOOK.md`](../PLAYBOOK.md). PLAYBOOK wins where the two disagree; it was written later and folds in what the Rainbark build learned.
>
> This is the first round of the 2026-10-11 design competition: a broad search for subjects that a new theme could be built on, written to replace `cosmic-chimes` (now done: Rainbark took that slot in `585ab55`).
>
> **What became of the candidates.** #1 Prismatic Springs → **Iris Springs** ([`../iris-springs.md`](../iris-springs.md)); #4 Painted Strata → **Painted Ages** ([`../painted-ages.md`](../painted-ages.md)); #9 Liquid Rainbow → **Riverbloom** ([`../riverbloom.md`](../riverbloom.md)); #20 Haft Rang → **Haft Rang** ([`../haft-rang.md`](../haft-rang.md)); #19 Doline → **Sunfall** ([`../sunfall.md`](../sunfall.md)). The sixth concept was a free "wildcard" pick: its proposer chose the rainbow eucalyptus, the subject of #13 Rainbow Bark, and it became **Rainbark** ([`../rainbark.md`](../rainbark.md)), the winner. Every other candidate is still open; the README lists them all with their status.
>
> The "Similarity" lines compare against the fleet at `5d3478d`. Rainbark has joined the fleet since, so anything built on giant trees, bark, peeling or blue haze now also collides with `rainbark` (see its entry in [`catalog.md`](catalog.md)).

Research only (no repo files were changed): 49 web searches across geothermal and mineral sites, karst and water, living colour, caves, sky optics, and art and materials, plus a comparison of the existing themes from the header comment of each `src/themes/<id>/<id>-theme.js` file.

## 0. What to avoid, based on the current roster (read from the repo)

These patterns already appear in many themes. The new theme should avoid them, or the judges will see it as another variant.

1. **A still mirror of water under the board.** This shows up in halcyon-apex (lagoon), vesper-chrysalis (lake), lunara (mirror flats), chiral-gold (black water), ice-temple (frozen lake), golden-forest (mirror lake), summer (mirror lake), stillwater, crystal-cave (still pool), koi-pond, and sunset (lantern sea). Salt-flat mirrors such as Uyuni, and any "tufa or pillars standing in a still lake" idea, would land in the same place.
2. **Crystals and gems.** geode (jewel druzy), crystal-cave, lunara (crystal spires), halcyon-apex (the "Halcyon" diamond), vesper-chrysalis (cut-crystal chrysalis), ice-temple. Opal, Naica and quartz-led concepts are therefore high risk.
3. **Hexagonal columns.** cinder-drift (columnar basalt magma chamber) and ice-temple (hexagonal ice columns). Rules out Giant's Causeway and Fingal's Cave.
4. **Seas of clouds.** nimbus-veil (golden cloud sea) and rainbow-terraces (cloud sea). Tepui and Zhangjiajie concepts are only partly safe.
5. **Dusk and night palettes.** Almost every rebuild is set at dusk or night (lunara, vesper, ice-temple, stillwater, koi-pond moonwake, wolfhour, chiral-gold, plus the cosmic set). Only a few are bright and saturated: verdant-hills (windy day), summer, halcyon-apex (dawn) and nimbus-veil (golden). **A high-key, mineral-saturated daylight or golden-hour palette is the biggest open slot.**
6. **One shared gameplay grammar.** Nearly every masterpiece rebuild follows the same pattern: "a locking piece sends a spark or wisp of its own colour out of the card into X, which keeps that light; a clear fires the cleared rows out of the card as blades of light and sends a wave, one front per line; a chain of clears charges or wakes the world; four lines hold its breath." This is the wording in geode, lunara, vesper-chrysalis, halcyon-apex, bioluminescence, fluid-dreams, ice-temple, chiral-gold, cinder-drift, tornado and waves. **The new theme should use a different grammar,** where the world records, deposits, fills or erupts rather than absorbing sparks. The top picks below are chosen for this.
7. **Overlap checks in `src`.** No theme covers geothermal springs, travertine, rainbow strata, stained-glass light, tropical rivers, wisteria or tepuis. The word "geyser" appears only in shifting-sands' dust geysers (`src/themes/shifting-sands/shifting-sands-fx.js:15`) and in pyrestorm's ember geysers (`src/themes/pyrestorm/pyrestorm-theme.js:286-288`). Odyssey's terrain has faint value steps for rock strata (`src/rendering/odyssey/world/odyssey-ground-palette.js:193-205`, `ODYSSEY_GROUND_STRATA`), which is a minor overlap for a strata concept.
8. **Shared constraint for every concept.** Themes run one node scene on both the WebGPU and the WebGL2 fallback backends (`src/themes/summer/summer-theme.js` header). Favour particles that are instanced and animated in the vertex shader over compute-only paths, and favour analytic or projected light over extra render passes (transmission, planar reflection RTs, full-screen raymarching) on phones.

Phone risk ratings used below:
- **Low:** heightfield or plane shaders, a few sheets, instanced particles.
- **Moderate:** refraction faked by UV offset, several volume sheets, more geometry.
- **High:** transmission or dispersion passes, raymarched volumes, many lights.

---

## A. Geothermal and mineral worlds (the roster has none)

### 1. PRISMATIC SPRINGS (alt: Prismara, Thermal Prism, Caldera Bloom). Grand Prismatic Spring, Yellowstone
- **Sources:** https://en.wikipedia.org/wiki/Grand_Prismatic_Spring, https://www.smithsonianmag.com/travel/science-behind-yellowstones-rainbow-hot-spring-180950483/
- **The science:** The centre is too hot for life and looks deep blue from scattering. Each cooler ring holds different heat-loving microbes: yellow *Synechococcus*, then orange carotenoids, then red-brown at the edge. The mats are orange and red in summer and dark green in winter.
- **Scene:**
  - Foreground: wet silica flats beside the board. Orange microbial "fingers" fan out in braided runoff channels with a glossy wet sheen.
  - Midground: the spring as a huge ellipse in perspective. Deep cobalt eye, turquoise lip, pale cream-green silica rim, then yellow, orange and rust bands.
  - Background: steam rises in sheets, lit from below so it glows teal like the real spring. Lodgepole silhouettes and distant geysers venting into a haze.
  - Light: low golden sun backlighting the steam.
- **Palette:** #0B3C7D cobalt eye, #1FA9C9 vent turquoise, #CFE7B8 silica rim, #F4C431 Synechococcus yellow, #F07F23 carotenoid orange, #9C3418 mat rust, #F3EEE6 steam.
- **Moves:** Steam veils billow and drift. Convection shimmer at the centre. Runoff sheen flows outward along the channels. A distant geyser puffs now and then. Bubbles. Occasional gusts tear the steam open to show the colours underneath.
- **Gameplay:**
  - Lock: a thermal pulse ring runs out through the colour bands from the point nearest the piece's column, and tints one band in the piece's colour for a moment. A hard drop adds a small jet.
  - Clear: a sheet of steam lifts from the cleared row's height and sweeps across, and the spring sends out one ring per line.
  - Combo: the spring heats up. The blue core grows, the bands march outward (temperature drives the ring radii), steam thickens and the channels glow.
  - Four lines: the great geyser behind the spring erupts. A column of water and steam, a sunlit rainbow in the spray, glittering fall-back rain, and the ground goes wet and glossy.
  - T-spin: a convection vortex twists the core into a spiral and the steam corkscrews.
  - Perfect clear: the whole basin flashes through the spectrum.
- **Why it would be breathtaking:** It may be the most colourful natural object on Earth, it is daylight-saturated, and backlit steam gives real volumetric drama.
- **Techniques:** A temperature field T(r,θ) from distance to the vent plus domain-warped fbm, mapped through a 1D colour ramp. Parallax or height on the mats. Wet PBR roughness. Fresnel sky reflection on the core only, not a mirror of the scene. Steam as 4 to 8 camera-facing noise sheets with Beer-law absorption and a Henyey-Greenstein forward-scatter term toward the sun. Ridged-noise channel mask with flow-map animation. The geyser as an instanced particle column plus a textured volume billboard. Bloom and a filmic grade.
- **Phone risk:** Low. One large ground shader plus steam sheets that scale with the quality tier.
- **Similarity:** Low. Closest are pyrestorm (geysers, but dark volcanic orange) and halcyon-apex (turquoise lagoon water).

### 2. TRAVERTINE / COTTON CASTLE. Pamukkale, Huanglong and Mammoth Hot Springs terraces
- **Sources:** https://mymodernmet.com/pamukkale-turkey-turquoise-pools/, https://goturkiye.com/blog/pamukkale-travertines-characteristics
- **The facts:** A 200 m cliff of calcium-carbonate terraces. "Pamukkale" means cotton castle. The pools glow gold at sunset.
- **Scene:**
  - Foreground: the rim of a terrace pool beside the board, with calcite "frozen waterfall" curtains dripping over the lip.
  - Midground: a fan of scalloped white terraces stepping down the hillside. Each pool holds the sky gradient in a different tint, from turquoise to peach to rose.
  - Background: a valley plain in haze, far ridges, and optional ruined colonnades.
  - Light: sunset.
- **Palette:** #F7F4EE travertine white, #E8D8C6 warm cream, #86DCD4 shallow turquoise, #2AA6B6 deep pool teal, #FFB48A peach sun, #E58DA8 rose sky, #6E8ED8 dusk blue.
- **Moves:** Thin water sheets trickle over the rims (flow streaks). Ripples. Steam wisps off the warm pools. Sparkle on the calcite. Swallows.
- **Gameplay** (rows map to terraces):
  - Lock: water spills over the rim at the piece's column and leaves a ripple.
  - Clear: the terrace at that height fills and overflows down the cascade, one tier per line.
  - Combo: the flow grows and more tiers turn turquoise and glow.
  - Four lines: the whole hillside overflows into a shimmering veil waterfall, with mist and a rainbow.
  - T-spin: a whirlpool opens in one pool.
- **Why it would be breathtaking:** White, turquoise and rose is an airy, pristine palette that nothing in the roster has.
- **Techniques:** Terraces from quantised noise height with a rim mask (pools sit inside noise contours). Each pool is a flat water level with a sky-only reflection sampled from the sky function, so no render target is needed. Wrap lighting for calcite subsurface scattering. Flow-streak shader on the curtains. Procedural caustics in the shallows.
- **Phone risk:** Low to moderate.
- **Similarity:** Low to moderate. The pools reflect sky, but this is still water near the board, so it sits close to halcyon-apex and golden-forest. Terraces in place of a single lake keep it distinct. **Best merged into #1** (see the top picks).

### 3. DALLOL ACID GARDEN (alt: Sulfur Bloom). Danakil Depression, Ethiopia
- **Sources:** https://en.wikipedia.org/wiki/Dallol_(hydrothermal_system), https://dallolproject.csic.es/the-dallol-project
- **The facts:** Green acid ponds below pH 1, yellow sulfur, iron oxide and salt plains, and springs at 108 °C.
- **Scene:**
  - Foreground: a salt-crust polygon floor with egg-shaped micro-chimneys and lacy salt pillars crusted in yellow.
  - Midground: neon chartreuse terraces, steaming acid pools ringed with rust, and knobby crystal "flowers".
  - Background: salt canyons, a heat-hazed plain, and a camel-caravan silhouette.
  - Light: pink dawn through vapour.
- **Palette:** #DDF53D chartreuse, #F7D21C sulfur, #3BD18F acid green, #10A39B teal brine, #F0891C ochre, #9B2C15 iron rust, #F4ECDF salt white.
- **Moves:** Bubbling pools, crystals growing in time-lapse, heat haze, vapour wisps, crust cracking.
- **Gameplay:**
  - Lock: a salt flower crystallises in the piece's colour.
  - Clear: a new terrace lip precipitates along the ground.
  - Combo: chimneys spit, and pools shift from green to yellow.
  - Four lines: the basin floods with brine and recrystallises in a wave of neon.
  - T-spin: a vapour vortex.
- **Why:** It looks alien but is real.
- **Techniques:** Voronoi and cellular terraces, SDF bubble knobs, a heat-haze UV-offset post pass, vapour particles.
- **Phone risk:** Low to moderate.
- **Similarity:** Low. Closest are pyrestorm and geode. **Aesthetic risk:** neon chartreuse can look toxic and can fight with yellow and green pieces. Better used as an accent inside #1.

### 4. PAINTED STRATA (alt: Danxia, Stratumlands, Rainbow Ridge). Zhangye Danxia, with notes from Vinicunca and Landmannalaugar
- **Sources:** https://www.atlasobscura.com/places/zhangye-national-geopark, https://intotravelchina.com/en/attractions/zhangye_attraction/zhangye-colorful-danxia.html, https://guidetoiceland.is/travel-iceland/drive/landmannalaugar
- **The facts:** Ferric iron makes purplish and brick reds. Ferrous iron makes grey-green and blue-grey. Limonite gives yellow and chlorite gives sage. The layers were tilted by Tibetan uplift, and rain makes the colours noticeably richer.
- **Scene:**
  - Foreground: a crisp ridge crest beside the board with a weathered boardwalk.
  - Midground: rows of sawtooth ridges striped with tilted bands of colour, each ridge silhouetted against the next.
  - Background: pale snow peaks in golden haze.
  - Light: raking golden hour, with warm sunlit faces and lavender shadow faces.
  - Optional Iceland variant: steam vents, black obsidian and green moss.
- **Palette:** #C2412E ferric red, #E5834B apricot, #F2C46B limonite gold, #F6E6C8 cream sandstone, #74ADA0 chlorite sage, #9B83B6 lavender grey, #3A2E4D plum shadow.
- **Moves:** Cloud shadows sweep the ridges. The sun angle drifts slowly as in a time-lapse. Dust devils. Sand veils off the crests. Hawks circling. Distant rain curtains.
- **Gameplay** (the world records the game):
  - Lock: a thin glint of sediment in the piece's colour settles on the ridge at the same height.
  - Clear: the cleared row becomes a new stratum painted into the nearest ridge in the colours of its blocks. Done with a 1D DataTexture palette that is updated on each clear, so it costs almost nothing.
  - Combo: tectonic uplift. The ridges rise and tilt a little and dust falls.
  - Four lines: a rain squall passes, everything turns wet and deeply saturated, and a rainbow arches over the ridges before the sun breaks through.
  - T-spin: a dust devil spirals up carrying coloured sand.
- **Why:** Very readable, saturated natural colour, and over a session the landscape becomes your game history.
- **Techniques:** Heightfield of domain-warped ridged noise oriented as monoclines. Strata from dot(worldPos, tiltedNormal) plus warp, sampled from the palette texture. Triplanar erosion detail. Aerial perspective and height fog. Cloud shadows projected in light space. A wetness lerp (lower roughness, darker and more saturated albedo).
- **Phone risk:** Low to moderate. A 128² to 256² grid per tier.
- **Similarity:** Low to moderate. Closest are mountain and himalayan-peak (cool and snowy), shifting-sands (warm desert) and the faint strata in Odyssey.

### 5. BLUE FIRE CALDERA (alt: Ijen, Sulfur Lantern). Kawah Ijen, Java
- **Sources:** https://www.smithsonianmag.com/smart-news/indonesian-volcano-contains-electric-blue-streams-molten-sulfur-180956512/, https://explorersweb.com/natural-wonders-the-blue-fire-of-kawah-ijen/
- **The facts:** Sulfur gas at up to 600 °C burns blue, flames reach 5 m, and liquid sulfur flows burning down the slopes. It is visible only in darkness.
- **Scene:**
  - Foreground: yellow sulfur crusts with pipes and stalactites.
  - Midground: rivers of electric-blue flame running down black slopes.
  - Background: a milky turquoise acid lake under a pre-dawn sky, with white vapour plumes.
- **Palette:** #00B4FF electric blue, #3DF2FF cyan, #6A36FF violet core, #F5D200 sulfur, #4FE0C2 acid lake, #0B0D16 basalt, #D6DBE5 vapour.
- **Moves:** Flame tongues licking, flowing blue rivulets, vapour plumes, dawn slowly creeping in.
- **Gameplay:**
  - Lock: a blue flame ignites at the piece's height.
  - Clear: rivers of fire run downhill, one per line.
  - Combo: the vents roar and the flames climb.
  - Four lines: a blue firefall cascade and the lake glows.
  - T-spin: a flame whirl.
- **Techniques:** Flame billboards from noise, emissive ribbons with a flow map, volumetric plume sheets, bloom.
- **Phone risk:** Low to moderate.
- **Similarity:** Moderate. Volcano themes are cinder-drift and pyrestorm. Electric glow at night is close to voltage-storm and the neon set. Night again.

### 6. MINERAL MOSAIC. Spotted Lake (British Columbia) and Champagne Pool and Devil's Bath (Wai-O-Tapu)
- **Sources:** https://explorersweb.com/natural-wonders-spotted-lake/, https://www.hikespeak.com/trails/waiotapu-thermal-wonderland-nz/
- **The facts:** Evaporation leaves hundreds of pools in green, blue, yellow and pink. Champagne Pool has an orange arsenic and antimony rim. Devil's Bath is a fluorescent lime green.
- **Scene:** An aerial-oblique basin of polka-dot pools in many hues, separated by pale salt, with a lime pool and an orange-rimmed champagne pool bubbling with CO2.
- **Palette:** #7ACB9A jade, #3E8FC0 mineral blue, #E6C65A yellow, #E6A3B9 pink, #9FD13A lime, #E2742B antimony orange, #EEE8DA salt.
- **Gameplay:** Each cleared line evaporates into a new pool tinted by its blocks, so the basin becomes a record. Lock makes bubbles and a ring. Four lines: rain refills everything and the pools shuffle colour.
- **Techniques:** A Voronoi pool mask with per-cell colour from a DataTexture, bubble particles.
- **Phone risk:** Low.
- **Similarity:** Low. The weakness is depth and drama, so it works better as a detail layer inside #1.

### 7. IRON RIVER. Río Tinto, Spain
- **Sources:** https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4206857/, https://www.nbcnews.com/id/wbna24409823
- **The facts:** pH 1.5 to 3, a blood-red iron river, and a Mars analogue.
- **Scene:** A wine-red and orange river over ochre and black mud terraces, with chalk-white and jade banks and green pines.
- **Palette:** #7A1020 wine, #C2361B rust, #E8892C ochre, #F0D9A8 bank, #3B9E86 jade seep, #1C1A1E black mud.
- **Gameplay:** The current carries coloured ribbons; a clear deposits iron terraces.
- **Phone risk:** Low.
- **Similarity:** Moderate. Could read as desert (shifting-sands) or a blood palette (blood-moon in name only). Less beautiful than the others.

### 8. FIREFALL. Horsetail Fall, Yosemite, in February
- **Sources:** https://accuweather.com/en/weather-news/photos-firefall-ignites-in-yosemite-national-park-during-sunset/336030, https://sunset.com/syndication/yosemite-national-park-firefall
- **The facts:** About two minutes of backlit sunset makes the waterfall look molten.
- **Scene:** A blue-grey granite wall (El Capitan) in winter shade with a single thread of waterfall glowing molten orange, plus snow and pines.
- **Palette:** #2B3A4E granite shade, #6E7F95 granite light, #FF7A1A molten orange, #FFC15A gold, #F2F5F8 snow, #1E3B2E pine.
- **Gameplay:** Each clear brightens the fall; four lines set the full firefall.
- **Phone risk:** Low.
- **Similarity:** Moderate. It has a single hero element, and the lava-like look is close to cinder-drift.

## B. Water, karst and tropical rivers

### 9. LIQUID RAINBOW (alt: Cristales, River of Five Colours). Caño Cristales, Colombia
- **Sources:** https://www.geographyrealm.com/cano-cristales-rainbow-river/, https://www.worldbook.com/behind-the-headlines/Colombia-s-Liquid-Rainbow
- **The facts:** The riverweed *Macarenia clavigera* turns the river crimson from about July to November, alongside yellow sand, green algae, black rock and blue water.
- **Scene:**
  - Foreground: shallow clear rapids over pale, pocked sandstone with round potholes. Crimson and magenta fronds stream in the current.
  - Midground: rock shelves and small falls.
  - Background: the table-mountain silhouette of the Serranía de la Macarena, savanna, and tall cumulus.
  - Light: tropical late afternoon, with caustics everywhere.
- **Palette:** #D81E4A crimson, #FF5F7A coral pink, #F4C430 sand yellow, #3FA34D algae green, #1A1A1F black rock, #6FD3E8 water blue, #F2E8D5 pale stone.
- **Moves:** Fronds wave with the flow. A caustic net shimmers on the bed. Foam streaks, sparkle, hummingbirds, mist off the falls.
- **Gameplay:**
  - Lock: a ribbon of the piece's colour is released into the current and streams downstream through the fronds.
  - Clear: the river surges and the fronds flare.
  - Combo: the river blooms. Each step adds one of the five colours to the plants (red, pink, yellow, green, blue).
  - Four lines: a surge carries spray and a rainbow down the whole reach.
  - T-spin: an eddy whirlpool.
- **Why:** Moving, saturated colour in real water, unlike anything in the roster.
- **Techniques:** Water surface with flow map and normals. Refraction faked with a UV offset on the bed. Procedural Voronoi caustics on the bed. Instanced frond strips with vertex sway along the flow. Depth tint.
- **Phone risk:** Moderate.
- **Similarity:** Low to moderate. Closest are koi-pond (water garden), ocean (reef plants) and waves.

### 10. LENÇÓIS LAGOONS (alt: Bedsheet Dunes). Lençóis Maranhenses, Brazil
- **Sources:** https://www.frommers.com/destinations/lencois-maranhenses/, https://www.amusingplanet.com/2011/10/lencois-maranhenses-national-park.html?m=0
- **The facts:** Rain collects on impermeable rock between white dunes, forming thousands of turquoise lagoons up to about 90 m long.
- **Scene:**
  - Foreground: a white dune crest with wind ripples.
  - Midground: crescent dunes and turquoise, emerald and cobalt lagoons in the hollows.
  - Background: the ocean horizon, towering cumulus and a passing shower.
- **Palette:** #FBF8F1 dune white, #E7D9C3 sand, #43D1C7 turquoise, #138F8C emerald, #2E62B8 deep lagoon, #FFCF8F warm light, #4E5B8A dune shadow.
- **Moves:** Sand veils blowing off the crests, lagoon sparkle, cloud shadows, rain curtains.
- **Gameplay:**
  - Lock: a sand slip into a lagoon makes a ripple.
  - Clear: a gust sends sand ribbons sweeping across.
  - Combo: a rain cloud gathers.
  - Four lines: a downpour fills new lagoons (water rises in the hollows), then sun and a rainbow.
  - T-spin: a sand devil.
- **Techniques:** Heightfield dunes, a water level with depth-based colour, sand ripple normals, glints.
- **Phone risk:** Low.
- **Similarity:** Moderate. Closest is shifting-sands (dunes), but the palette is the opposite (white and turquoise, not orange).

### 11. MARBLE CHAPELS. Capillas de Mármol, General Carrera Lake, Patagonia
- **Sources:** https://www.yachtcharterfleet.com/south-america/see-and-do/attraction/marble-caves.htm, https://weblogtheworld.com/formats/photos/marble-caves-patagonia
- **Scene:** Seen from boat level, swirled blue, white and grey marble arches with caustics dancing on the walls over glacial turquoise water. Snowy Andes through the arches.
- **Palette:** #0F6FA3 lake blue, #48C4E0 glacial turquoise, #E9EEF2 marble white, #8B98A8 vein grey, #2C3E57 shadow, #F2D7B0 warm stone.
- **Gameplay:** Lock flares the caustics; a clear rushes a wave through the arch; four lines bring a sunburst through the arch.
- **Techniques:** Domain-warped marble veins, projected caustics, water.
- **Phone risk:** Low to moderate.
- **Similarity:** Moderate. A cave over water is close to crystal-cave and geode.

### 12. TURQUOISE CASCADES. Plitvice and Jiuzhaigou (Five Flower Lake)
- **Sources:** https://np-plitvicka-jezera.hr/en/?p=3209, https://www.mdpi.com/2073-4441/12/3/771/html
- **The facts:** Calcium-carbonate barriers on moss build 16 stepped lakes, and suspended CaCO3 scatters the light into turquoise.
- **Scene:** Stepped lakes joined by hundreds of small falls through forest, with sunken trees visible in clear water.
- **Palette:** #36C5C1, #0E8F9C, #BFE7D7, #F2E3B3, #4E7D3A, #A9612C.
- **Gameplay:** A clear makes a lake overflow into the next one down.
- **Phone risk:** Moderate.
- **Similarity:** Moderate. Forest and lake overlap with golden-forest and fall. Absorbed into #2.

## C. Living colour (plants and animals)

### 13. RAINBOW BARK (alt: Deglupta). Rainbow eucalyptus grove, Maui and Mindanao
- **Sources:** https://www.sciencefriday.com/articles/rainbow-in-a-tree/, https://www.australiangeographic.com.au/?p=341247
- **The facts:** New bark is chartreuse and ages through purple, red and orange to brown before it peels.
- **Scene:** Misty rainforest of colossal trunks streaked green, blue, purple and orange, with ferns and light shafts.
- **Palette:** #9BE04A chartreuse, #2F8F5B green, #3F6FD0 blue, #7D4BB5 purple, #E0662B orange, #8A4B2A brown, #DDE8D8 mist.
- **Gameplay:** Each cleared line peels a strip of bark, revealing fresh chartreuse that then ages over the session (driven by an age texture). Combo peels faster; four lines peel the whole grove at once.
- **Phone risk:** Moderate.
- **Similarity:** Moderate. Trees overlap with forest, golden-forest and moonlit-forest (Spring replaced it on 2026-10-18).

### 14. DESERT BLOOM (alt: Desierto Florido). Atacama flowering desert
- **Sources:** https://www.csmonitor.com/layout/set/amphtml/Environment/2015/1030/Why-carpets-of-flowers-are-now-thriving-in-the-driest-place-on-earth, https://www.bluewin.ch/en/news/a-rare-sea-of-flowers-in-the-middle-of-the-desert-whats-behind-it-li.2921256
- **The facts:** About every 5 to 7 years, El Niño rain wakes pink malva and around 200 other species.
- **Scene:** Ochre hills carpeted in magenta, with snowy Andes volcanoes and an ultra-clear sky.
- **Palette:** #E0418F magenta malva, #F59AC6, #F5C542 yellow, #8E5BC4 violet, #C99A5B ochre, #EDE3D4 volcano snow, #5D87C9 sky.
- **Gameplay:** A clear sends a wave of bloom across the hillside. Four lines bring El Niño rain and a full bloom with petals lifting.
- **Phone risk:** Low to moderate.
- **Similarity:** Moderate. Meadows are in summer and verdant-hills; desert is in shifting-sands.

### 15. WISTERIA VEIL. Kawachi Fuji wisteria tunnels
- **Sources:** https://en.japantravel.com/view/kawachi-wisteria-tunnels, https://jw-webmagazine.com/tips/kawachi-wisteria-garden
- **Scene:** A tunnel of hanging purple, pink and white racemes with dappled light.
- **Palette:** #8E6CD1, #C59BE8, #F2B6D6, #FFFFFF, #6B8F4E, #FFE6A8.
- **Gameplay:** Racemes sway; a clear ripples a wind wave down the tunnel.
- **Phone risk:** Moderate (many instances).
- **Similarity:** **High** with sakura-twilight (blossoms, Japanese, pink and purple). Reject.

### 16. NEMOPHILA HILLS. Hitachi Seaside Park
- **Source:** https://gardenstory.jp/en/area/ibaraki/
- **Scene:** Hills of baby-blue flowers merging with sea and sky; red kochia in autumn.
- **Palette:** #8EC9F0, #5FA8E8, #FFFFFF, #E23B3B, #3E7F4A, #F5F0E1.
- **Similarity:** **High** with verdant-hills (rolling hills on a bright day). Reject.

### 17. FLAMINGO SALT PANS. Lake Natron and Lake Hillier pink lakes
- **Sources:** https://earthobservatory.nasa.gov/images/5465/lake-natron-tanzania, https://www.worldatlas.com/articles/why-is-lake-hillier-pink.html
- **The facts:** Salt-loving microbes tint the crusts red and pink. Natron is the main breeding site for lesser flamingos. Hillier is bubblegum pink beside a dark blue sea.
- **Scene:** Crimson and pink brine patterns and white salt polygons, with a volcano (Ol Doinyo Lengai) in haze and flocks of flamingos.
- **Palette:** #FF8FC1 bubblegum, #E24A5E crimson brine, #FBF7F1 salt, #0F4C8C sea, #2F6B3C scrub, #FFB27A haze.
- **Gameplay:** A clear lifts a flock as a pink ribbon. Four lines fill the sky with flamingos.
- **Phone risk:** Low to moderate.
- **Similarity:** Moderate. Flocks overlap with murmuration and the salt plain with the mirror trope.

### 18. DRAGONBLOOD PLATEAU. Socotra
- **Sources:** https://www.nationalgeographic.com/magazine/article/socotra, https://discovery.com/exploration/the-lost-world-of-socotra-archipelago
- **Scene:** Umbrella-crowned dragon's blood trees on knife-edged limestone, bottle trees and desert roses, with sea fog rolling up at dusk.
- **Palette:** #2E4A3A canopy, #A3271F resin red, #E0A75E limestone, #F7D9A8 dusk, #7A6EA8 fog lavender, #23233A night.
- **Gameplay:** A lock makes resin beads glow; a clear rolls fog through; combo lights the resin veins.
- **Phone risk:** Low to moderate.
- **Similarity:** Low to moderate. The colour is muted, so it is less spectacular.

## D. Caves and architecture of light

### 19. DOLINE (alt: Skylight Jungle). Hang Sơn Đoòng, Vietnam
- **Sources:** https://www.nationalgeographic.com/magazine/2011/01/vietnam-cave, https://silverkris.singaporeair.com/inspiration/nature-adventure/sightseeing/danang-son-doong
- **The facts:** Two ceiling collapses let shafts of sun in through openings at least 90 m across. A jungle grows underneath, and clouds form inside the cave from temperature differences. The main chamber is about 200 m high.
- **Scene:**
  - Foreground: wet limestone and a calcite rim pool by the board.
  - Midground: a colossal cave with a jungle under the skylight.
  - Background: a vertical sunbeam pouring in "like a waterfall", with cloud wisps near the ceiling and a river below.
- **Palette:** #0D1311 cave dark, #2D5A38 jungle, #A3D46A sunlit leaves, #FFF0C4 beam, #C9D3D2 cloud, #6B7782 limestone, #3B8FA0 river.
- **Moves:** The beam drifts with the sun, motes and mist swirl, swifts circle in the shaft, drips fall.
- **Gameplay:**
  - Lock: a drop of light falls through the beam and the leaves shiver.
  - Clear: the beam brightens and a cloud forms at the ceiling.
  - Combo: the sun aligns and the beam widens. Swifts swarm.
  - Four lines: the sun stands overhead and floods the cave with light. The cloud bank glows.
  - T-spin: a mist vortex in the shaft.
- **Techniques:** An additive cone or slab beam with 3D noise and depth fade (or a half-resolution raymarch in a cylinder), height fog, instanced foliage cards.
- **Phone risk:** Moderate to high (volumes).
- **Similarity:** Moderate. Caves are in crystal-cave and bioluminescence; jungle is in the forest themes. Daylight sets it apart.

### 20. HAFT RANG (alt: Orosi, Prism Pavilion, Rose Light). Nasir al-Mulk's stained-glass morning light, combined with Turrell's light-as-material
- **Sources:** https://mymodernmet.com/nasir-al-mulk-mosque/, https://www.lacma.org/sites/default/files/James%20Turrell%20didactics.pdf
- **The facts:** Qajar-era coloured glass throws pinks, purples and blues across Persian carpets in the morning. The interior uses haft-rangi (seven-colour) tilework.
- **Keep it secular:** Make it a garden pavilion with *orosi* sash windows, not a mosque.
- **Scene:**
  - Foreground: a carpet floor where pools of projected coloured light slide.
  - Midground: carved columns, rose and lapis tile walls, and muqarnas. The board stands before tall lattice windows.
  - Background: a dawn-hazed garden of cypresses through the glass.
- **Palette:** #E34D7C rose, #F7A531 saffron, #2C6FD1 lapis, #22A39F turquoise tile, #7B3FA0 violet, #F4E6C8 plaster, #8A1C2B carpet crimson.
- **Moves:** Light patterns creep as the sun rises, dust glitters in the beams, gauze curtains breathe, pigeons.
- **Gameplay:**
  - Lock: a pane in the piece's colour lights in the lattice at the piece's height, and its patch of light lands on the carpet.
  - Clear: a horizontal band of light sweeps the hall, one per line.
  - Combo: the sun climbs, beams lengthen and the muqarnas glow.
  - Four lines: the great shamseh (sunburst medallion) ignites and a kaleidoscopic projection wheels across every surface.
  - T-spin: the projection twists like a kaleidoscope.
- **Why:** A jewel-box interior made of light, unlike any landscape theme.
- **Techniques:** An analytic gobo, projecting world position onto the window plane and sampling the window pattern (no shadow maps). Additive beam slabs with noise. Procedural girih and star tiles as SDFs. A procedural carpet. Mote particles.
- **Phone risk:** Low to moderate.
- **Similarity:** Low. serenity-warp only has stained-glass pieces, and chromatic-impasto is paint. **Risk:** cultural and religious sensitivity, so keep it secular.

### 21. GLASS GARDEN. Chihuly installations (Persians, chandeliers, reeds)
- **Sources:** https://www.tatlerasia.com/lifestyle/arts/highlights-dale-chihuly-glass-in-bloom-exhibition-gardens-by-the-bay-singapore, https://Chihuly.com/work/persian-installations
- **Scene:** A dusk garden of towering blown-glass forms: sunburst chandeliers, red reeds, floats on a pond, sea-shell Persians.
- **Palette:** #FF5A1F tangerine, #FFC93C amber, #D7268D magenta, #2D7BF0 cobalt, #23C4A8 jade, #9B5DE5 violet, #1B1D2A dusk.
- **Gameplay:** A lock blows a glass bud in the piece's colour. A clear makes the reeds ring and coloured caustics sweep. Combo assembles the chandelier. Four lines ignite the sunburst.
- **Techniques:** `MeshPhysicalNodeMaterial` transmission, thickness and dispersion, with faked caustics.
- **Phone risk:** **High** (transmission pass). An environment-only refraction fallback is needed.
- **Similarity:** Moderate. Closest are moonlit-greenhouse (conservatory) and crystal-cave and geode.

### 22. NAUTILUS NACRE. Mother-of-pearl iridescence and the chambered nautilus
- **Sources:** https://en.wikipedia.org/wiki/Nacre, https://museum.wa.gov.au/explore/lustre-online-text-panels/mother-pearl
- **The facts:** Aragonite platelets about 0.5 µm thick give angle-dependent thin-film colour.
- **Scene:** Inside the logarithmic chambers of a colossal nautilus with nacre walls shifting pink, green, blue and gold, and pearls.
- **Palette:** #F4EDE4 pearl, #F2C6D3 rose sheen, #BDE6D4 mint sheen, #9DBDF0 blue sheen, #E8D29A gold, #3B3550 depth.
- **Gameplay:** Each four-line clear grows a new chamber, as a real nautilus adds chambers. A lock lays a pearl layer.
- **Techniques:** TSL thin-film iridescence (`iridescence` and `iridescenceThickness` on the physical node material), a log-spiral mesh.
- **Phone risk:** Low to moderate.
- **Similarity:** Moderate to high. Geode is "inside a cavity", and the spiral is close to serenity-warp.

## E. Sky and atmosphere phenomena (most collide with the roster)

### 23. TEPUI FALLS (alt: Lost World, Roraima). Mount Roraima and Kerepakupai Merú (Angel Falls)
- **Sources:** https://en.wikipedia.org/wiki/Tepui, https://www.pbs.org/wnet/nature/living-edens-the-lost-world-photo-essay/1990
- **The facts:** 1,000 m cliffs, a black-rock summit, quartz crystals "in profusion", and pitcher plants.
- **Scene:**
  - Foreground: sculpted black hoodoos, rose-quartz pools and pitcher plants.
  - Midground: a waterfall leaping off the edge and dissolving into mist in mid-air.
  - Background: a sea of clouds with other tepuis as islands, at sunrise.
- **Palette:** #1C1B22 black rock, #E8B4C8 rose quartz, #F6F2EA quartz, #6FA86B bromeliad, #C84A3A pitcher red, #FFD3A0 sunrise, #8FA6C9 cloud shade.
- **Gameplay:** A clear sends a slug of water off the cliff to atomise. Combo opens more falls. Four lines part the clouds and put a rainbow at the base of the falls.
- **Phone risk:** Moderate.
- **Similarity:** Moderate to high. The cloud sea is in nimbus-veil and rainbow-terraces; quartz overlaps geode and lunara.

### 24. PILLAR MIST (alt: Shan Shui). Wulingyuan and Zhangjiajie
- **Source:** https://en.wikipedia.org/wiki/Wulingyuan
- **The facts:** More than 3,000 quartzite-sandstone pillars, many over 200 m, in valley mist.
- **Scene:** Pillars rising from mist, possibly drawn in the style of an ink landscape.
- **Palette:** #2B3A35, #6F8B7C, #C9D6CF, #F2EFE6, #D96A4A.
- **Similarity:** Moderate. Mist and clouds are in nimbus-veil; painted style is close to chromatic-impasto; peaks are in himalayan-peak.

### 25. ROLL CLOUD DAWN. The Morning Glory cloud, Burketown
- **Source:** https://weatherzone.com.au/news/morning-glory-cloud-crosses-gulf-of-carpentaria/1449970
- **The facts:** A roll cloud up to 700 km long; glider pilots ride its leading edge.
- **Similarity:** **High** with nimbus-veil and rainbow-terraces (cloud themes). Reject.

### 26. KELVIN-HELMHOLTZ BILLOWS and mammatus at sunset
- **Source:** https://earthsky.org/earth/kelvin-helmholtz-clouds/
- **Similarity:** **High** with nimbus-veil, tornado (storm-base mammatus) and voltage-storm. Reject.

## F. Abstract art and materials

### 27. SUMINAGASHI ("floating ink"). Japanese marbling, 12th century
- **Sources:** https://oab.lib.utah.edu/suminagashi/, https://journal.rikumo.com/journal/2017/2/16/liquid-marble-the-meditative-appeal-of-suminagashi
- **Scene:** An infinite pale water surface on washi. Ink rings spread, gold leaf drifts, and a brush rests in the distance.
- **Palette:** #F3EEE3 washi, #1E2230 sumi, #2F4E8C indigo, #B33A3A vermilion, #D6B25E gold leaf, #7E9C8E celadon.
- **Gameplay:** A lock drops ink, making concentric rings in the piece's colour. A clear combs the rings into a marbled pattern. Combo: breath (wind) swirls them. Four lines lift the paper and the print is revealed.
- **Phone risk:** Low (a 2D advection or ring-field shader).
- **Similarity:** Moderate. chromatic-impasto is paint, fluid-dreams is liquid and koi-pond is a Japanese pond. It would also be fairly flat and 2D.

### 28. THIN FILM (alt: Bubbleglass). Soap-film interference and Marangoni swirls
- **Sources:** https://annex.exploratorium.edu/ronh/bubbles/bubble_colors.html, https://www.explainthatstuff.com/thin-film-interference.html
- **Scene:** Giant drifting soap films and bubbles over a pale landscape, with swirling interference bands, black spots before popping, and gravity drainage stripes.
- **Palette:** #F2F0FF, #FFC7E8, #FFE59A, #9CF0D8, #8AA8FF, #1A1426 (the black film).
- **Gameplay:** A lock blows a bubble in the piece's colour. A clear pops a row of bubbles into a mist of iridescence. Four lines: one enormous bubble envelops the board.
- **Techniques:** Analytic thin-film interference in TSL (thickness field from advected noise), fresnel.
- **Phone risk:** Low.
- **Similarity:** Moderate with fluid-dreams (liquid light drops).

### 29. OSCILLATOR GARDEN. Belousov-Zhabotinsky reaction waves
- **Source:** https://en.wikipedia.org/wiki/Belousov%E2%80%93Zhabotinsky_reaction
- **The facts:** Ferroin indicator dots expand into rings, and shear turns them into spirals.
- **Scene:** A vast petri landscape of travelling chemical spirals in orange and blue.
- **Gameplay:** A lock seeds a wave and a T-spin seeds a spiral (shear is the trigger in real experiments, which makes a neat fit).
- **Phone risk:** Low to moderate. A ping-pong reaction-diffusion texture needs render targets.
- **Similarity:** Moderate. It is abstract and 2D, close to nebula-flow and fluid-dreams.

### 30. TOPOGRAPHIC ARCHES. Roger Dean's floating islands and arches
- **Source:** https://en.wikipedia.org/wiki/Roger_Dean_(artist)
- **Scene:** Biomorphic stone arches and floating islands with waterfalls pouring off into the void, and alien flora.
- **Similarity:** Moderate to high. Floating islands are in rainbow-terraces and the halcyon-apex sanctuary, and the look reads as derivative of Avatar.

### 31. TEN LARGEST. Hilma af Klint's pastel spirals and petals (1907)
- **Source:** https://guggenheim-bilbao.eus/en/exhibition/the-ten-largest-1907
- **Scene:** A 3D walk through her tempera forms: spirals, petals and looping script in salmon, lilac, ochre and blue.
- **Palette:** #F2A07B salmon, #C8A2D6 lilac, #E9C46A ochre, #6C8EBF blue, #F6EEDC ground.
- **Similarity:** Moderate. Painterly worlds are already covered by chromatic-impasto, and the art-historical reference is niche.

### 32. GANZFELD (alt: Skyspace). James Turrell
- **Source:** https://www.lacma.org/sites/default/files/James%20Turrell%20didactics.pdf
- **Scene:** A minimal elliptical room whose oculus frames a sky that shifts through impossible gradients.
- **Similarity:** Low. But it is too sparse to be "breathtaking". Better borrowed as the lighting idea inside #20.

### 33. WEATHER PROJECT. Olafur Eliasson at Tate Modern (2003)
- **Source:** https://www.tate.org.uk/press/press-releases/unilever-series-olafur-eliasson-weather-project
- **The facts:** About 200 mono-frequency lamps behind a semicircle, doubled by a mirror ceiling, in mist, leaving a yellow and black duotone.
- **Similarity:** Moderate to high. Big-sun pictures already exist in parhelion, solar-eclipse, sunset and synthwave-sunset. Reject.

### High-risk rejects (checked; each collides with a named theme)
| Idea | Source | Closest existing theme |
|---|---|---|
| Waitomo glow-worm cave | https://explorersweb.com/natural-wonders-waitomo-glowworm-caves/ | **bioluminescence** (already has "glow-worms picking out the vault") |
| Naica crystal cave | https://en.wikipedia.org/wiki/Cave_of_the_Crystals | crystal-cave, geode |
| Opal play-of-colour | https://archive.gia.edu/opal | geode |
| Giant's Causeway / Fingal's Cave | https://www.historyhit.com/locations/fingals-cave/ | cinder-drift (columnar basalt), ice-temple |
| Salar de Uyuni mirror | https://gearjunkie.com/adventure/beautiful-earths-largest-mirror | halcyon-apex, lunara, vesper-chrysalis (mirror trope) |
| Abraham Lake bubbles / Baikal ice | https://amp.cbc.ca/news/canada/calgary/abraham-lake-north-saskatchewan-river-methane-bubbles-frozen-ice-1.5424865, https://mymodernmet.com/lake-baikal-russia-ice-hummocks/ | ice-temple (black ice, cracks under the surface) |
| Vatnajökull blue ice cave | https://guidetoiceland.is/connect-with-locals/regina/visit-a-sapphire-blue-ice-cave-in-vatnajokull | ice-temple, winter |
| Brinicle | https://bigthink.com/hard-science/brinicles-icy-fingers-of-death/ | ice-temple and ocean (also too obscure to read) |
| Catatumbo lightning | https://en.wikipedia.org/wiki/Catatumbo_lightning | voltage-storm |
| Light pillars / Brocken glory | https://winnipeg.ctvnews.ca/cold-causes-laser-like-beams-to-light-up-winnipeg-sky-1.4236354, https://atoptics.co.uk/fz29.htm | parhelion (ice-crystal halo optics) |
| Noctilucent clouds | https://scied.ucar.edu/noctilucent-clouds | aurora, nimbus-veil |
| Mono Lake tufa | https://www.livescience.com/16018-tufa-towers-mono-lake-california/2.html | mirror trope |
| Kusama infinity rooms | https://crystalbridges.org/artworks/2019-2 | starlight, galaxy (fields of infinite points), kaleidosonic (a jewel in every cell of an endless lattice) |
| Ferrofluid | https://flowvis.org/OldGalleries/2009/Team-2/Reports/Ives.pdf | cosmic-noir, void-ember (dark and black) |
| Cymatics | https://www.sciencefriday.com/articles/seeing-the-patterns-in-sound/ | kaleidosonic (Chladni floors and standing-wave veins; singing-bowl before it) |
| Tsingy limestone needles | https://www.nationalgeographic.com/magazine/article/stone-forest | No collision, but grey and hostile with little colour payoff |

---

## Top 5, ranked

**1. PRISMATIC SPRINGS (#1, with #2 terraces in the foreground and #3 and #6 as mineral accents).** Working names: **"Prismatic Springs"**, "Prismara" or "Caldera Prism". One coherent hydrothermal basin. Yellowstone really does hold Grand Prismatic, the Mammoth travertine terraces and geysers together, so the fusion is grounded in a real place.
- **Composition:**
  - Foreground: white travertine terraces with turquoise pools and orange runoff fingers beside the board.
  - Midground: the great spring's blue eye and rings in perspective, with backlit steam.
  - Background: geysers, lodgepole silhouettes and gold haze.
- **Why first:**
  - It fills the empty high-key daylight slot (§0.5).
  - The palette spans the whole spectrum yet comes from nature, so it never looks neon.
  - There are no crystals, no mirrors and no cosmos.
  - Steam gives depth and spectacular backlighting cheaply (sheets, not raymarching).
  - The gameplay grammar is new. Heat raises the temperature, which expands the rings; clears raise steam and fill terraces; four lines erupt a geyser with a rainbow in the spray; a T-spin twists a convection vortex; a perfect clear flashes the spectrum.
  - Phone risk is low (one ground shader, steam sheets that scale by tier, instanced spray).
- **Main risks:** The aerial "eye" must stay readable beside the card, so use an oblique overlook camera, not top-down. Steam must not wash out the board.

**2. PAINTED STRATA (#4).** The best metaphor: cleared rows literally become geological layers painted in the blocks' colours, so each session leaves its record on the land. The colour is rich and varied, the heightfield is cheap, and golden hour gives strong form. Rain on four lines ("wet rock is more vivid" is a real effect) makes a dramatic, earned payoff. It risks reading as "another mountain theme" if the stripes are not bold, so commit to saturated bands and lavender shadows.

**3. LIQUID RAINBOW (#9).** The only candidate whose spectacle is moving colour inside clear running water. The caustics, streaming crimson fronds and five-colour combo ladder are very original and very joyful. It ranks below #1 and #2 because believable shallow water (refraction, caustics, flow) costs more and is harder to get right on phones, and because it sits a little near koi-pond and ocean.

**4. HAFT RANG (#20).** The most surprising idea: an interior made entirely of coloured light, with no landscape. Projected gobo light is cheap and analytic, and the lock-pane-lights-up and four-line shamseh payoffs are excellent. It ranks fourth because of cultural sensitivity (it must be a secular pavilion, never a mosque) and because a closed interior gives less "extraordinary landscape" depth than the user asked for.

**5. DOLINE (#19).** A sunbeam falling into a lost jungle inside a cave, with its own clouds, is maximum atmosphere and depth, and daylight shafts set it apart from the night caves (crystal-cave, bioluminescence). It ranks fifth because volumetric light is the main phone risk and because "cave" and "jungle" each brush against existing themes.

**Runners-up:** Travertine (#2), which is better merged into #1. Blue Fire Caldera (#5), spectacular but another night volcano. Lençóis Lagoons (#10), a lovely airy palette but too close to shifting-sands in genre.
