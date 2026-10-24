# Feature tracker

Every feature is built in a phase, has a test that proves it, and is ticked
only when that test passes (`bun test`). Features marked "browser" were also
driven through the real client. Numbers (speeds, costs, timers) live in
`src/engine/constants.ts`, `src/games/bedwars/constants.ts`,
`src/games/bedwars/items.ts`, `src/games/bedwars/rules.ts` and
`src/games/bedwars/shop.ts`.

Legend: `[x]` done and tested, `[ ]` not yet, `(later)` deliberately out of
scope for the first version.

## Phase 1: core mechanics and the test harness

The simulation (`src/engine/` and `src/games/bedwars/`) is pure TypeScript with no DOM, so every
mechanic runs headless in `bun test` exactly as it runs in the game.

Movement and physics (`engine/physics.ts`, tests `physics.test.ts`; browser: walking)
- [x] Fixed 20 tick/s simulation, rendered with interpolation
- [x] Gravity, terminal velocity, air drag, ground friction
- [x] Walk, sprint, sneak speeds; sprint stops when sneaking or walking backwards
- [x] Jump (about 1.25 blocks high), no jumping mid-air, sprint-jump boost
- [x] Axis-separated AABB collision against voxels (walls, ceilings, floors)
- [x] Sneaking shrinks the hitbox, lowers the eye and stops you walking off edges
- [x] Fall distance tracking and fall damage beyond 3 blocks
- [x] Void: falling below the world kills
- [x] Stand on, walk along and jump up placed blocks (stacking/pillaring)

Looking, breaking and placing (`engine/raycast.ts`, `engine/building.ts`, `bedwars/beds.ts`, tests `building.test.ts`; browser: place, break, a nine-block bridge)
- [x] Voxel ray cast (DDA) returning block, face and distance
- [x] Reach limits: blocks 4.5, players 3 (server allows a little slack)
- [x] Break progress by block hardness and tool; resets if you look away
- [x] Place against a face; refused inside any player, outside the world, above the build limit
- [x] Bridging: place against the side of the block you stand on while sneaking at its edge
- [x] Only blocks placed during the round can be broken; map blocks cannot

Combat (`engine/melee.ts`, `bedwars/combat.ts`, tests `combat.test.ts`, `game.test.ts`; browser: hitting a dummy)
- [x] Melee hit with reach and a line-of-sight check
- [x] Damage by weapon, critical hits while falling, armour reduction
- [x] Knockback away from the attacker, stronger when sprinting
- [x] Hurt invulnerability window (no double hits)
- [x] Health, death, kill credit (last attacker within 10 s, including void knocks)
- [x] Shield: raised shield blocks frontal melee and slows you

Test harness
- [x] `bun test` covers every mechanic headless
- [x] A sandbox world (`maps/sandbox.ts`) with stations for each mechanic: a jump course,
      a fall tower, a sneak ledge over the void, a pillar pit, a bridge gap and a training dummy
- [x] F3 debug overlay: position, velocity, on-ground, sneaking, fall distance, target block, tick
- [x] `?world=sandbox` opens the sandbox; `/give`, `/tp`, `/heal`, `/kit`, `/kill` chat commands in it

## Phase 2: blocks, items and beds

Blocks (`bedwars/blocks.ts`)
- [x] Map blocks: grass, dirt, stone, bedrock, planks floor, glass rail
- [x] Buildable: wool (team coloured), hardened clay, planks, glass, moonstone, obsidian
- [x] Hardness and preferred tool per block; obsidian very slow without a pickaxe
- [x] Beds: two-block team beds, breakable only by other teams
- [x] Procedural, original 16×16 textures drawn at startup (no external assets)

Items (`bedwars/items.ts`, `engine/inventory.ts`, tests `items.test.ts`)
- [x] Swords: wood, stone, iron, diamond
- [x] Pickaxes and axes in tiers; shears
- [x] Armour sets: leather (default), chain, iron, diamond, with reduction values
- [x] Shield
- [x] Golden apple (heals, simple consumable)
- [x] Resources: iron, gold, diamond, emerald
- [x] Nine-slot hotbar plus storage, stacking limits, scroll and number keys
- [x] Generator piles and pickup; a killer collects the victim's resources directly
- [x] Bow and arrows: the server times the draw; damage by charge, armour applies (`arsenal.test.ts`; browser)
- [x] Fireballs and TNT: explosions break placed blocks by blast resistance; glass, obsidian, beds and map blocks hold; knockback; reduced self-damage for fireball jumps (`arsenal.test.ts`; browser)
- [x] Rift pearls (teleport, two damage) and bridge eggs (a wool line over the void) (`arsenal.test.ts`)
- [x] Speed, jump and invisibility potions; the server widens its move checks while they last (`arsenal.test.ts`)
- (later) Traps and other team-upgrade traps

## Phase 3: worlds

- [x] World storage with a per-block "placed this round" flag, run-length snapshot for joins
- [x] Sandbox world (above)
- [x] Arena: four team islands over the void, four diamond islands, an emerald centre, generated in code
- [x] Lobby platform above the arena, removed when the round starts
- [x] Protected zones: no building on spawns, generators or shopkeepers; build height and border limits
- [x] Chunk meshing with face culling, Voxelize-style vertex AO and smooth sunlight; remeshing only changed chunks (`render.test.ts`)

## Phase 4: gameplay

- [x] Lobby: join, team pick or auto-balance, minimum players, start countdown, host "start now" (browser)
- [x] Bots fill empty seats so solo play works (walk, gather, bridge, fight, break beds; `bots.test.ts` plays full rounds)
- [x] Team spawn points, spawn protection shield for 3 s after each spawn
- [x] Base forge (iron and gold) and diamond/emerald generators with tiers and caps
- [x] Currency: buying spends resources from the inventory
- [x] Item shop (blocks, melee, armour, tools, utility) and team upgrades (sharpened swords,
      reinforced armour, forge levels, heal pool) (browser: bought a sword)
- [x] Beds: breaking an enemy bed announces it; a team without a bed cannot respawn
- [x] Respawn: 5 s countdown as a spectator, then back at base with permanent gear and downgraded tools
- [x] Final kills, team elimination, last team standing wins
- [x] Round timeline: generator upgrades, all beds destroyed, sudden death, game end (draw by time)
- [x] Scoreboard (Tab) and sidebar with teams, beds, timers; kill feed; chat
- [x] End screen and automatic return to the lobby with a fresh world

## Phase 5: running it

- [x] Authoritative server: 20 TPS rooms, validates movement, reach, placement, purchases
- [x] Web: `bun run dev` serves the game and the server on one port (browser)
- [x] Offline: the same room runs in the page (`?offline=1`), no server needed (Electron smoke)
- [x] Electron: `bun run desktop` starts the server in the main process and opens a window (`bun run desktop:smoke`)
- [x] Production: `bun run build && bun run start` (any Node 20+ host) (`bun run smoke`)
- (later) Freebuff Sites deploy through a Durable Object room

## Phase 6: polish and content

- [x] Bots wrap their own bed in wool after their first shop trip, and buy shears and pickaxes (`bots.test.ts`)
- [x] Team chat during a round; `!` shouts to everyone (`game.test.ts`)
- [x] End-of-round stats table: finals, kills, beds, deaths (`game.test.ts`; summary message)
- [x] Pause menu: resume, leave, live mouse sensitivity and field of view (browser)
- [x] Synthesised sound effects (hits, breaks, places, pickups, kills, beds, countdown, shop) with distance falloff
- [x] Block-break and hit particles (browser)
- [x] Team-coloured first-person sleeve (browser)
- [x] A second arena, Lanterns (corner bases, brick plaza), and a lobby map vote (`game.test.ts`, `bots.test.ts`; browser)
- [x] Blocky voxel interface: pixel font (Pixelify Sans, OFL), stone buttons, slot grids, light bevelled windows (browser)
- [x] Lobby opens with Esc like a game menu, so its buttons are always clickable (browser: clicked Start now)
- [x] `/bot [n]` and `/nobots` in the sandbox: sparring bots that come and fight (`bots.test.ts`)

## Phase 9: feel, looks and graphics

- [x] Friendlier movement: faster, higher and longer jumps, strong air control, coyote time, reach 5, safe fall 4 (`physics.test.ts`)
- [x] Painted 64×64 skins from a look (skin, hair, eyes, outfit), team leather and armour tiers on the outer layer (browser)
- [x] Capes (eight designs), movement trails, kill effects; looks validated by the server (`look.test.ts`)
- [x] Name tags with a team prefix and health, through walls for teammates, hidden for sneaking enemies
- [x] Wardrobe with a live turning preview; third-person camera (F5 or V); the first-person arm wears your skin
- [x] Warm block light from lamps, flooded like sunlight and drawn by the chunk shader (`render.test.ts`)
- [x] Floating generator gems with tier and countdown; ground shadows under players; pixel-art item drops (browser)

## Bot levels

Every number below is in `BOT_PROFILES` (`bedwars/bots.ts`); tests in `bots.test.ts`.
- [x] Four levels, easy, normal (the default, also for solo play), hard and expert, set by the lobby host; the server checks the level and tells every client (`{ t: 'lobby', botLevel }`)
- [x] Lobby buttons for the level next to Bots on/off (browser not yet driven)
- [x] `/bot [n] [level]` in the sandbox, as in `/bot 2 hard`
- [x] Reaction time, aim error (only a swing on target is sent), clicks per second, w-tap sprint resets, strafing and jump crits by level
- [x] Shopping by level, in priority order, keeping iron for blocks; hard and expert wrap the bed in wool first, then save for the main trip; team upgrades with diamonds
- [x] Layered bed defence built from stands outside the cover: none, wool, wool and clay, wool, clay and moonstone; bots never dig their own cover
- [x] Hard and expert eat a golden apple below 6 health, and shoot arrows (server-timed draw) at enemies 8 to 24 blocks away out on bridges
- [x] Expert throws fireballs at enemies on bridges, pearls back from the void or home when stranded, and goes home to meet anyone within 12 blocks of its bed
- [x] Every level plays a full round to a winner; an expert beats an easy bot in most two-team rounds
- [x] Never stuck: skipped waypoints, stalled fights given up, enemies across a gap left until reachable, hunters go home while they still have blocks, stranded bots step off (bedless ones only as a last resort)

## Phase 8: production

- [x] Settings: Game, Controls, Video, Audio, applied live and validated on load (`settings.test.ts`; browser)
- [x] Every keyboard action rebindable (two keys each) with an explanation; mouse controls explained (browser: rebound Jump)
- [x] Sprint: hold, toggle or always, plus double-tap forward; R as a browser-safe sprint key
- [x] Smooth first-person swing arc, equip dip, eased bobbing (browser)
- [x] Hit feedback: hit marker (yellow on crits), damage numbers, crit sparks, hurt flash, shaking hearts, a camera tilt and an arrow toward the attacker (browser)
- [x] Loading screen, Try again after a disconnect, a clear message without WebGL
- [x] Server: `--port/--host/--workers`, `/healthz`, security headers, 405 for other methods, graceful shutdown, LAN addresses at startup (`bun run smoke`)
- [x] Desktop: app menu (Cmd+Q, full screen, back to menu), single instance, remembered window, locked-down navigation, generated icon
- [x] Installers with electron-builder: `bun run package` (unpacked macOS app booted its smoke test)

## Phase 7: engine and scale

- [x] Engine/game split: `src/engine/` never imports a game (`architecture.test.ts`)
- [x] Block and item registries a game fills at startup
- [x] Delta snapshots with keyframes for joiners and a heartbeat when idle (`snapshots.test.ts`)
- [x] Encode each broadcast once
- [x] `WORKERS=n`: rooms pinned to worker processes by key (`bun run smoke`)
- [x] Melee lag compensation with a clamped rewind (`game.test.ts`)
- [x] Load test with CPU and bandwidth per player (`bun run loadtest`, `--json` for the old encoding)
- [x] Chunk meshing and sunlight in a Web Worker with its own copy of the world; meshes match meshing in place through edits (`render.test.ts`; Electron smoke)
- [x] Binary tick snapshots and inputs, JSON for rare messages; clients rebuild state exactly through it (`snapshots.test.ts`)
- [x] Self-view countdowns in whole seconds, so the self view is not resent every tick
- (later) Greedy meshing, multi-machine matchmaker

## Phase 10: playing with others

- [x] Online room list: people online, every public room with arena, state and open seats, Quick play, Create (public or invite only) (`lobby.test.ts`, browser)
- [x] Invite links (`?room=name`) and a lobby that shows the room, the link to copy, who is in it and what happens next (browser)
- [x] Late joiners take a bot's seat, items and all; with no bot left they watch (`lobby.test.ts`)
- [x] `GET /api/rooms` from every worker process (`bun run smoke` server, checked with two workers)
- [x] Inputs carry their tick number, so a skipped input never trips the movement check (`netcode.test.ts`; `scripts/netprobe.ts` at 150 ms lag and jitter)
- [x] Placing is never refused for overlapping your own (trailing) server body (`netcode.test.ts`)
- [x] Predicted breaks: the block goes when the client's timer ends; the server agrees within half a second or restores it (`netcode.test.ts`)
- [x] Others drawn on the server timeline through an adaptive jitter buffer; attacks report the tick they aimed at (`netcode.test.ts`)
- [x] Any team's shopkeeper sells to you; flowers, poles and chains no longer block clicks, swings, arrows or sight (`netcode.test.ts`)
- [x] Everyone sees a title when a bed is broken (`netcode.test.ts`)
- [x] Drop items with Q (Ctrl+Q for a stack), a second before anyone can pick them up (`game.test.ts`)
- [x] Translucent glass in its own blended pass, with a simple tinted pane texture (browser)
- [x] A faster default mouse; saved settings with the old default move to it (`settings.test.ts`)
- [x] Bridging is the classic skill again: the bridge assist is gone

## Phase 7: themed arenas

Maps (`src/games/bedwars/maps/`, tests `maps.test.ts`, `bots.test.ts`)
- [x] Five arenas generated from layouts, all in the lobby vote: Skyreach (forest), Lanterns (village at dusk), Dunes (desert), Frostpeak (snow and ice), Ruins (mossy castle) (`maps.test.ts`)
- [x] Layered floating islands: surface, soil and rock strata, uneven rims, overhangs, hanging undersides and accents, from seeded noise; a layout always builds the same world (`maps.test.ts`)
- [x] Themed bases: a house on the back rim with team-glass windows, a team-wool band and banners; a forge yard with lamps; the spawn ringed in team wool; striped awnings over the shopkeepers; the bed under a team-coloured tent, open front and back (`maps.test.ts`)
- [x] Decorated diamond islands and a landmark in every middle: a floating grove, a fountain square, an oasis under a floating pyramid, a frozen tower, a floating keep
- [x] Theme blocks (sand, sandstone, snow, ice, cobblestone, stone bricks, woods, quartz, terracotta, team-stained glass, lanterns with `lightLevel`, plants and poles you walk through), each with its own procedural texture; 66 of the 128 block ids (`maps.test.ts`)
- [x] Bot-safe by construction: bridging lanes reserved before building, nothing at body height where bots walk but one-high blocks; checked per arena, and a bot round plays out on each (`maps.test.ts`, `bots.test.ts`)
