# Making a Minecraft-like Game: A Plan and Guide

This guide explains how to build a Minecraft-style game from the ground up:
block worlds, mining, building, crafting, survival, mobs, and multiplayer.
It is written for someone with basic programming knowledge who is new to game
development.

There is a special advantage to reading it *here*: this repository already
contains a working, tested, custom voxel engine that runs in the browser
(`src/engine/`), with a full game built on top (`src/games/bedwars/`). Every
idea in this guide points at the real code that implements it, so you can
study a concept and immediately see a production example. The path "from this
template to a Minecraft-like survival game" is mostly *adding content on top
of an engine that already works*, not rewriting anything.

---

## 1. Define the scope and core features

Minecraft is a huge game; nobody builds it in one pass. The first step of any
clone is deciding *which loop* you are cloning, because every system you build
must serve that loop. The candidates, in increasing order of work:

- **Creative/building sandbox.** Fly, unlimited blocks, no danger. The whole
  game is world rendering, block placement, and eventually save/load. This is
  the smallest complete game and the best first milestone.
- **Survival.** Add mining (blocks take time to break and drop items),
  crafting (turn drops into tools and building materials), health, hunger,
  hostile mobs, and a day/night cycle. This is the classic Minecraft loop:
  *gather → craft → build → survive → explore.*
- **Multiplayer survival.** The same rules, but one authoritative simulation
  shared by many players, with chat, permissions, and anti-cheat. This
  multiplies the engineering work because every rule must be enforced on a
  server instead of trusted to the client.

**Recommendation:** ship each loop as a milestone. A creative sandbox that
feels good to build in is a complete, releasable game; survival layers on
top; multiplayer layers on top of that. This repository followed exactly that
shape — the engine (`src/engine/`) is game-agnostic, the bed-wars game
(`src/games/bedwars/`) is one "ruleset" layered on it, and a survival game
would be a second ruleset reusing the same engine (see "Making another game
on the engine" in the README).

Pick 3–5 "signature features" to define your variant early (this template's
are: bed-wars objectives, five procedurally generated arenas, and full-parity
bots). They keep your scope from silently growing into "all of Minecraft."

---

## 2. Choose the technology stack and development environment

### The options, honestly compared

| Approach | Pros | Cons | Best for |
| --- | --- | --- | --- |
| **Unity** (C#) | Mature editor, huge tutorial base, one-click builds to PC/mobile/web, physics and UI toolkits included | Voxel *rendering* is still custom work (Unity's mesh tools assume ordinary models); heavier installs; C# loop perf needs care | Teams wanting editor-driven content and console/mobile targets |
| **Unreal** (C++) | Best-in-class visuals, Niagara particles, Blueprint for rapid logic | Vast complexity; C++ build times; voxel games fight its rendering assumptions; overkill for blocky visuals | Photorealistic or very large 3D games, not block games |
| **Custom engine** (this repo: TypeScript + WebGL2 via three.js) | Total control of the hot path (meshing, lighting, networking); zero toolchain friction — a URL is a build; the same code runs headless for tests, on a server for multiplayer, and in an Electron desktop app | You write the renderer, mesher, UI glue; no editor — worlds are generated in code | Browser games, learning engine programming, small teams shipping fast |
| **Established voxel engines** (e.g. Voxelize — Rust server + TS client; or Godot) | Ready-made chunk streaming and meshing | Big dependencies with their own opinions; Voxelize's Rust server adds a toolchain and per-platform binaries (this repo deliberately borrows techniques from it rather than depending on it — see "Relationship to Voxelize" in the README) | Teams that need infinite streamed worlds *now* |

**Why this template is a custom TypeScript engine:** a voxel game's cost is
concentrated in three places — meshing chunks, lighting them, and moving
world state between server and clients. Owning those three files means every
cycle goes into your game. It also means the *same* simulation code runs in
four places with no porting: the browser (with client-side prediction), the
Node game server, the headless test runner (`bun test` runs 210 tests of the
real physics and game rules), and the desktop app. If you are new to game
development, the loop "edit a file → the browser hot-reloads → a headless
test proves the rule still holds" is the fastest teacher.

### The stack this project uses

- **Language:** TypeScript everywhere. Types catch protocol drift between
  client and server at compile time.
- **Rendering:** three.js (raw WebGL2 would work; three.js saves you the
  matrix/buffer boilerplate without hiding the parts that matter — shaders
  are still plain GLSL in `src/engine/render/`).
- **Build:** Vite. Dev server in milliseconds; production build in under a
  second.
- **Tests:** `bun test`, running the simulation headless.
- **Server:** the same TypeScript compiled for Node, or a Cloudflare Worker
  for the hosted build.
- **Desktop:** Electron wraps the same server + client.

If you prefer Unity, the *architecture* of this guide transfers unchanged:
the world data structure (§3), the tick loop (§5), the authoritative-server
model (§11), and the test strategy (§12) are language-independent.

---

## 3. Design the block and world system

### The core data structure

A voxel world is a 3D grid of *cells*, each holding a block id. The single
most important early decision is the cell representation. This repo's choice
(`src/engine/world.ts`) is instructive:

- **One `Uint8Array` for the whole world, one byte per cell.** Block ids
  0–127 plus one high bit meaning "this block was placed by a player" (so
  terrain can be regenerated while player builds survive). One byte per cell
  makes a 96×48×96 arena cost ~442 KB — small enough to hold several in
  memory, fast enough to iterate with plain array indexing.
- **Coordinates are clamped, not streamed.** `world.get(x, y, z)` returns
  `AIR` outside the grid. Fixed-size worlds (per arena, per room) sidestep
  the hardest problems of infinite worlds — chunk streaming, interest
  management — at the cost of a finite play space.

```ts
// The shape of the idea (real code: src/engine/world.ts)
const AIR = 0
class World {
  readonly w: number; readonly h: number; readonly d: number
  cells: Uint8Array                    // index = x + w * (z + d * y)
  get(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return AIR
    return this.cells[x + this.w * (z + this.d * y)]
  }
  set(x: number, y: number, z: number, id: number, playerPlaced = false) { /* ... */ }
}
```

**Scaling to infinite worlds later:** swap the flat array for a `Map` of
chunks (each chunk its own `Uint8Array`, e.g. 16³ or 32³), keyed by chunk
coordinate. Keep the one-byte cell; everything above the world layer
(rendering, physics, raycasts) only asks "what block is at (x,y,z)?" and does
not care how it is stored. This is why the engine can grow from arena-sized
to infinite without touching game code.

**Saving:** serialize runs, not cells (run-length encoding: `[id, count]`
pairs compress a voxel world spectacularly because blocks come in large
contiguous regions). Minecraft's own region format is the same idea at
larger scale. A first save format can literally be JSON
`{ seed, chunks: [[x,y,z,id,count], ...] }`; upgrade to a binary RLE file
when it gets slow.

### Block and item registries

Blocks and items are *data*, not classes. A game registers its content at
startup (`src/engine/blocks.ts`, `src/engine/items.ts`), and the engine never
imports a game — `tests/architecture.test.ts` enforces that boundary. A block
definition carries what the engine needs to simulate and render it:

```ts
defineBlock({
  id: 21, name: 'Oak log',
  pattern: { color: '#6b5330', face: 'side' },   // painted in code, 16×16 px
  hardness: 2.0,                                  // seconds to break bare-handed scales this
  tool: 'axe',                                    // right tool speeds it up, wrong tool drops nothing
  solid: true, lightLevel: 0, blastResistance: 6,
})
```

For a Minecraft-like survival game, the two fields that matter most are
**hardness** (mining time) and **tool class** (what breaks it fastest and
what it drops) — they turn "click a block, it vanishes" into the mining
progression loop.

---

## 4. Design world generation

Minecraft's worlds feel endless because generation is *procedural and
deterministic*: a seed plus an algorithm always produces the same world.
This repo generates every arena in code from a layout description
(`src/games/bedwars/maps/`, a few milliseconds per map); a survival game
swaps the fixed layout for layered noise.

### The standard recipe

1. **Noise source.** Perlin/simplex noise, seeded. Use several octaves
   ("fractal brownian motion") at different frequencies: one for continent
   shape, one for hills, one for detail.
2. **Heightmap.** `height(x, z) = base + fbm(x, z) * amplitude` gives the
   surface column. Everything above it is air, below it stone.
3. **Layers.** Walk down each column: top N blocks become grass/dirt, the
   rest stone; below sea level fill with water; sprinkle ores by depth
   (coal common and shallow, diamond rare and deep — the "resource by depth"
   curve is what makes caving feel rewarding).
4. **Carving and features.** Caves: a second 3D noise threshold removes
   stone in blobs. Then trees (a deterministic per-column hash decides which
   grass columns get one, so trees regenerate identically every load), then
   biome decoration.
5. **Biomes.** A low-frequency temperature/moisture noise pair picks a
   biome per column; the biome decides surface block, tree type, and grass
   color. Start with three biomes; the data-driven block registry from §3
   means a new biome is data, not code.

The engine already has the layer that terrain generation feeds:
`src/engine/terrain.ts` builds *floating islands* from a heightmap (surface,
soil, rock, uneven rims, hanging undersides) — read it as a worked example
of "turn math into a solid, believable landform."

### Test your generator like code

Because generation is deterministic, it is testable: this repo's
`tests/maps.test.ts` proves for every arena that beds have headroom, spawn
areas are protected, and no route is walled in. For a survival world, the
analogous property tests are "every surface column is reachable from spawn"
and "no floating one-block islands of lava above bedrock."

---

## 5. Implement player movement and interaction with blocks

### A fixed tick, and one physics function for everything

The game moves at a **fixed 20 ticks per second** (TPS) on the server, and
the client simulates at frame rate but through the *same physics code*
(`src/engine/physics.ts`). Sharing that one function is the single highest-
leverage decision in this codebase: the server can validate the client's
moves because they are produced by identical code; the bots move exactly
like players; and the headless tests test the real movement.

Player physics, in order of how they read in `physics.ts`:

```ts
// Pseudocode for one tick of voxel player physics
function stepPlayer(p: Player, input: Input, world: World, dt: number) {
  // 1. Desired horizontal velocity from input, scaled by state
  let speed = WALK_SPEED
  if (input.sprint) speed *= SPRINT_MULT
  if (input.sneak)  speed *= SNEAK_MULT
  p.vel.x = input.forwardX * speed
  p.vel.z = input.forwardZ * speed

  // 2. Gravity and jumping (jump velocity chosen so the arc clears one block
  //    with room to spare, but never two — tuning that single constant is what
  //    makes the game feel Minecraft-like)
  p.vel.y -= GRAVITY * dt
  if (input.jump && p.onGround) p.vel.y = JUMP_SPEED

  // 3. Integrate with collision, axis by axis: move X, resolve; move Y,
  //    resolve (set onGround when landing); move Z, resolve.
  p.onGround = false
  moveAxis(p, 'y', p.vel.y * dt, world)
  moveAxis(p, 'x', p.vel.x * dt, world)
  moveAxis(p, 'z', p.vel.z * dt, world)

  // 4. Sneak edge guard: while sneaking, refuse any horizontal move that
  //    would leave you standing on air. (This one rule makes bridge-building
  //    a skill, exactly as in Minecraft.)
  if (input.sneak && p.onGround && !standingOnSolid(p, world)) revertHorizontal(p)

  // 5. Fall damage judged from distance fallen since leaving the ground
  if (p.onGround) { if (p.fallDistance > SAFE_FALL) damage(p, fallDamage(p.fallDistance)); p.fallDistance = 0 }
  else p.fallDistance += -p.vel.y * dt
}
```

The collision resolver is the part beginners find hardest; the trick is that
a player is an **axis-aligned box (AABB)**, moved one axis at a time, and
after each axis you test the box against every cell it overlaps and push it
back out. No rotation, no physics engine needed.

### Client prediction, server validation

On a networked game, running physics only on the server makes movement feel
like driving a car through a phone line. The solution this repo uses (and
Minecraft-like games should): **the client simulates its own player
immediately (prediction), sends its inputs to the server, and the server
runs the same function and corrects the client if the two ever disagree.**
The details that make it feel perfect are in `src/engine/net/lag-comp.ts`
and the "Playing well over a slow link" README section: inputs carry the
tick they were meant for, corrections are smooth, and remote players are
drawn two ticks in the past so late packets don't make them stutter.

### Mining and placing: raycast + rules

Two small systems give you Minecraft's hands:

- **Raycast** (`src/engine/raycast.ts`): step a ray from the eye through
  the voxel grid (a "voxel DDA" — at each step, advance along whichever axis
  the ray crosses next) and return the first solid cell and the face hit.
  Five blocks of reach, like Minecraft.
- **Building rules** (`src/engine/building.ts`): a placement is legal iff
  the target cell is air, is adjacent to a solid face, is inside the world,
  and **does not overlap any player's box** (otherwise you could place blocks
  inside enemies — or inside yourself while pillaring, which is why the
  client checks its own body where it *actually* is, not where the
  server's trailing copy thinks it is).

Breaking is timed, not instant: hold the button, watch a progress fraction
(and, in this repo, cracking overlay), and on completion apply the drop and
tool rules from §3. For networked play, *predict the break locally and let
the server agree if its own timer is within half a second* — beds in this
game no longer wait a round trip for a satisfying break.

```ts
// Pseudocode: the interaction loop
onUse held:                    onAttack held:
  target = raycast(eye, dir, 5)  target = raycast(eye, dir, 5)
  if target.block is air:        if target.block is breakable:
    cell = adjacentCell(...)       progress += dt / breakTime(block, heldTool)
    if legalPlacement(cell):       if progress >= 1:
      world.set(cell, heldItem.block)  world.set(cell, AIR)
      send({place, cell})            send({break, cell})
```

---

## 6. Develop crafting and inventory systems

### Inventory

An inventory is an array of slots, each `{ id, count }`, with a hotbar slice
at the front (`src/engine/inventory.ts`: 9 hotbar + storage). Stacking rules
live on the item definition (max stack size, tools don't stack). The
existing shop UI (`renderInventory` in `src/games/bedwars/client/hud.ts`)
is already a working drag-free inventory screen — click two slots to swap —
and is the natural place to start a crafting UI.

### Crafting: data, not code

Crafting is a lookup. The two standard forms:

- **Shaped:** the recipe only matches in a specific shape (a pickaxe is
  "two sticks vertical, three material across the top").
- **Shapeless:** only the ingredients matter (no ordering, e.g. dyes).

```ts
// Pseudocode: recipes as data, matching as a scan
type Recipe = { shaped: (string | null)[][]; result: { id: string; count: number } }
// null = empty cell; letters index into `key`
const RECIPES: Recipe[] = [
  { shaped: [['MMM', null, 'SS', 'SS']], key: { M: 'iron_ingot', S: 'stick' },
    result: { id: 'iron_pickaxe', count: 1 } },
  { shaped: [['W', 'W']], key: { W: 'plank' }, result: { id: 'stick', count: 4 } },
]

function matchCrafting(grid: (Item | null)[], recipe: Recipe): boolean {
  // Trim the grid's empty rows/columns, then compare cell-by-cell against
  // the recipe shape (its trimmed form), consulting recipe.key for each letter.
}

function craft(grid: (Item | null)[]): Item | null {
  for (const r of RECIPES) if (matchCrafting(grid, r)) return r.result
  return null
}
```

The implementation work is UI-side: a 2×2 player grid (plus a 3×3 crafting
table block you must stand near — a *station* requirement, like this game's
shops), a recipe book so players discover recipes, and consuming ingredients
on craft. The economy data in `src/games/bedwars/shop.ts` and `rules.ts`
(prices, tiers, generator rates) shows how this repo keeps every number in
one reviewable table — do the same for recipes; balance by editing data.

**Progression design note:** the mining/crafting loop is a *tech tree made
of materials*. Wood → planks → sticks → wooden pickaxe → stone → stone
pickaxe → iron … Each tier gates the next because each material requires
the previous tier's tool to mine efficiently. Write this table down before
implementing; it is your game's spine.

---

## 7. Add survival mechanics: health, hunger, mobs

The bed-wars game already contains the damage/health substrate: max health,
fall damage, melee with knockback and reach checks, armour tiers, spawn
protection, and status effects (`src/engine/melee.ts`,
`src/games/bedwars/room.ts`). Survival mode layers three systems on it:

- **More damage sources.** Drowning (oxygen ticks underwater), drowning in
  lava (instant, plus fire), burning, suffocation (a solid block in your
  head box), poisoning, void fall. Each is a small function that subtracts
  health on a tick; keep them all in one `damageSources` table so armor and
  potions can interact with them uniformly.
- **Hunger.** An integer 0–20 drained by actions (sprinting, jumping,
  regenerating) and refilled by food items. It gates *regeneration* (you
  only heal above 18 hunger, like Minecraft) and at 0 causes damage — two
  small rules that make food matter without any complex simulation. Food
  values belong in the recipe/economy table from §6.
- **Day/night cycle.** A world clock (this repo's timeline system in
  `room.ts` is a ready example of scheduled world events). Daylight drives
  the sky/shader (`src/engine/render/` already has a sun and sky gradient)
  and, crucially, mob spawning: hostile mobs spawn in darkness below a light
  threshold. The `lightLevel` field on blocks (lanterns already use it) is
  the hook.

**Design reasoning:** every survival rule should answer "what does the player
*do* differently because of this?" Hunger makes safehouses with farms worth
building; darkness makes torches worth crafting; fall damage makes bridges
and water buckets skills. If a mechanic doesn't change a decision, cut it.

---

## 8. Enemy AI

Minecraft's mobs are simple individually and dangerous in aggregate; copy
that. The architecture to aim for:

- **A goal/utility layer, not scripted paths.** Each mob picks a *goal*
  each second (eat, flee, attack, wander, follow) by scoring the situation,
  then executes it with the shared physics. This repo's bots
  (`src/games/bedwars/bots.ts`) are exactly this pattern with a dial:
  everything that differs between Easy and Expert lives in one
  `BOT_PROFILES` table (reaction time, aim error, clicks per second,
  shopping policy). A zombie and a skeleton are the same shape of table.
- **Pathfinding on the voxel grid.** A* over walkable cells (solid floor,
  two blocks of headroom, jump ≤ 1 block, fall ≤ 3). Because the world is a
  grid, the heuristic is Manhattan distance and the neighbor function is
  six-plus-jumps. Keep paths short-horizon (8–16 blocks) and re-plan often;
  mobs look alive when they *react*, not when they compute.
- **Same rules as players.** The bots here move with the shared physics and
  act only through the same action messages a client sends, so the server
  checks them for free — no ghost-passing-through-walls bugs, no "AI cheats"
  bugs. Mobs should collide, jump, and fall exactly like players do.
- **Spawning/despawning.** Hostile mobs spawn just outside the light radius
  of players in dark cells and despawn beyond ~48 blocks or in light. This
  keeps entity counts bounded — the same "bounded world, many small rooms"
  philosophy the README's scaling section describes.

Start with one mob done well (a zombie that tracks, jumps, and swipes) and
one spawner; the second mob is mostly data.

---

## 9. Create the user interface

Voxel games need a *lot* of UI: hotbar, hearts/hunger, inventory, crafting,
chest screens, chat, pause/settings. This repo's recipe
(`src/games/bedwars/client/hud.ts`) is worth copying wholesale:

- **Plain DOM over the canvas.** The HUD is ordinary HTML elements layered
  on top of the WebGL canvas. You get free text layout, accessible focus,
  CSS animations (the heart-shake on damage, the hit marker), and no
  immediate-mode UI library to learn. The cost — DOM writes are expensive —
  is managed by a render key: each panel re-renders only when its inputs
  change (`if (this.modal.dataset.key === key) return`), and per-frame work
  is throttled to 10 Hz.
- **Pixel-art styling as CSS.** The Minecraft look comes from the 16×16
  textures (painted in code in `src/engine/render/textures.ts` — no art
  files, no licenses) plus hard-edged, offset-shadow CSS panels. Icons for
  items are generated from the same tile painter, tinted per team.
- **Settings persist themselves** (`src/games/bedwars/client/settings.ts` →
  localStorage) and apply live. Do this from day one; retro-fitting
  remappable keys is miserable.

Screens you will need, in build order: HUD (hotbar + health) → pause menu →
inventory → crafting → chest/container → death screen → settings.

---

## 10. Incorporate multiplayer

Multiplayer is where amateur voxel games die, so be deliberate. The model
that works — and that this repo implements end-to-end — is
**authoritative server, thin clients**:

1. **One simulation, one owner.** The server runs `room.ts` (the game rules)
   at a fixed 20 TPS on its own clock. Clients send *inputs and intents*
   ("I want to place a block here", "I swing at tick N"), never state. The
   server validates and broadcasts results. Cheating becomes "convince the
   server," not "edit memory."
2. **Rooms, not one world.** `src/engine/net/host.ts` manages many rooms,
   each a self-contained simulation on its own 20 TPS loop with rate limits
   and encode-once broadcasting. This scales by *lots of small worlds*
   (Minecraft's own servers work the same way) rather than one giant one.
3. **Delta snapshots.** Each tick, send only what changed (a moving player
   is a few numbers); idle rooms heartbeat. This repo measured a 14–38×
   bandwidth drop from this alone. Joiners get one full snapshot first.
4. **Binary where it counts.** The two hot messages (tick snapshots, player
   inputs) use a hand-rolled binary codec (`bedwarsCodec` in
   `protocol.ts`: field masks, zigzag varint positions); everything else
   stays JSON in text frames. Encoding costs were measured at ~0.5 µs per
   room — the real cost is sockets, so *batch* (this repo sends at most ten
   frames/second per client, each under 12 KiB).
5. **Lag compensation for combat.** Keep a short pose history per player and
   judge hits against where the target was when the attacker saw it, capped
   at ~500 ms (`src/engine/net/lag-comp.ts`).
6. **Pick a transport by deployment:**
   - *Your own server* (Node, or this repo's Worker host): WebSockets, the
     simplest correct choice. Put a reverse proxy with TLS in front; the
     client then upgrades to `wss://` automatically.
   - *Serverless/browser-hosted* (this repo's Sites mode):
     `src/sites/relay.ts` runs the authoritative room **in the host's
     browser** through managed realtime (WebTransport-style broadcast with
     tickets). Guests' actions still pass through the same server-side rule
     checks — but the host is trusted, so this mode is explicitly casual,
     with no ranked/competitive integrity. It is a brilliant way to ship
     multiplayer with zero ops, and an honest ceiling to know about.

**Threat model, plainly:** validate *everything* (this repo's server checks
movement speed, jump height, collisions, reach, line of sight, placement,
and purchases — see `room.ts`), rate-limit per client, and never trust a
client-supplied identity. World snapshots are visible to room members; don't
put secrets in them.

---

## 11. Testing and iterating

This repository's test posture is the argument for the whole custom-engine
approach, so adopt it wholesale:

- **Test the simulation headless.** `bun test` runs 210 tests in ~10 s with
  no browser, no GPU, no server: physics (gravity, jump height, speeds,
  collision, sneak edge guard, fall damage, pillaring), raycasts, break
  times, placement rules, combat (damage, crits, armor, knockback, reach,
  line of sight, lag compensation), rooms (lobby, teams, deaths, respawns,
  generators, shop), maps, and the engine/game boundary. Because the tests
  run the *same code the game runs*, they are specifications: when you
  change a movement constant, the physics tests fail loudly instead of the
  game quietly feeling wrong.
- **Play whole rounds as a test.** `tests/bots.test.ts` runs complete bot-vs-
  bot rounds on every arena. This is the highest-value test in the repo: it
  exercises generation, physics, combat, economy, and win conditions
  together, in seconds, every build. For a survival game the analog is a
  scripted "survive N nights" headless run asserting the player's health,
  resources, and structure state.
- **Property-test your generator.** Deterministic generation means
  "generate 100 seeds, assert invariants" is cheap and catches the bug you
  would have found by hand 40 hours later (unreachable areas, spawn inside
  a mountain, floating bedrock).
- **Measure the network for real.** `bun run loadtest` produces rooms-per-
  core and KB/s-per-player numbers; `scripts/netprobe.ts` plays against a
  server under artificial 150 ms latency + jitter and reports rubber-banding
  and reverted blocks. The README's "slow link" section documents a real
  bug found exactly this way (an input skipped by a correction looked like
  a two-tick jump and tripped the fly check) and its fix — proof that
  network testing finds what local testing cannot.
- **Smoke-test the built artifact.** `bun run smoke:sites` boots the real
  production build in workerd and drives two Chromium players through live
  multiplayer. Test what you ship, not just what you develop.
- **Then play it, constantly, with humans.** Instruments tell you what is
  broken; players tell you what is *boring*. Keep a "feel" checklist —
  jump height, mining time per material, knockback, mob reaction time — and
  tune those numbers first; in a Minecraft-like, feel is almost entirely
  constants. This repo keeps every tunable in one table (`rules.ts`,
  `BOT_PROFILES`) precisely so tuning is a five-minute edit with an
  automated safety net underneath.

**The iteration loop to institutionalize:** change → headless tests (10 s) →
dev-server playtest (instant, hot reload) → load/net probe if networking
touched → ship to a small group → write the next change from what you saw.

---

## 12. A concrete roadmap from *this template* to a survival game

Because the engine, renderer, physics, HUD, inventory, shop UI, networking,
and test harness already exist and pass, a Minecraft-like survival mode is
mostly content and rules, in this order:

1. **Creative mode first (a weekend).** A flat/skyblock arena with the
   sandbox's infinite-ish block palette and no combat — proves the build
   loop feels good. The practice sandbox (`?play=1&world=sandbox`) is
   already 80% of this.
2. **Mining drops + tools (a weekend).** Add `drops` and `tool` to block
   definitions; make breaking grant items; make tools consume durability.
3. **Inventory + crafting table (3–4 days).** Recipe data from §6, the §9 UI
   pattern, a table block with a station radius.
4. **Survival ruleset (1–2 weeks).** A new game folder beside bed-wars
   (`src/games/survival/`) implementing `RoomLike`: health/hunger/food,
   day/night clock, mob spawners, death → respawn-with-inventory-rules.
   The README's "Making another game on the engine" section is the checklist.
5. **One mob done well (a weekend).** The zombie from §8, driven by the
   bot profile table pattern.
6. **World generator (1–2 weeks).** §4's heightmap recipe with 2–3 biomes;
   property tests from day one.
7. **Persistence (several days).** RLE save format from §3, per-room saves.
8. **Multiplayer last (weeks).** Only once the loop is fun solo: point the
   existing host/WebSocket transport at the survival room factory. The
   validation you must add (inventory grants, mob damage) is the same
   discipline bed-wars already demonstrates in `room.ts`.

Every step leaves a runnable game. That is not a stylistic preference — it
is how you keep a months-long project from becoming unplayable on the day it
finally compiles.

---

## Appendix: where each idea lives in this repository

| Idea | File(s) |
| --- | --- |
| World grid, one byte per cell | `src/engine/world.ts` |
| Block/item registries | `src/engine/blocks.ts`, `items.ts` |
| Physics: gravity, sneak, collision, fall damage | `src/engine/physics.ts` |
| Raycast, mining times, placement rules | `src/engine/raycast.ts`, `building.ts` |
| Melee, knockback, reach, shields | `src/engine/melee.ts` |
| Terrain/island generation | `src/engine/terrain.ts` |
| Arena layouts and themed maps | `src/games/bedwars/maps/` |
| Inventory and stacking | `src/engine/inventory.ts` |
| Economy, prices, generator rates (tuning table) | `src/games/bedwars/shop.ts`, `rules.ts` |
| Authoritative game rules | `src/games/bedwars/room.ts` |
| Bots: goals + one profile table | `src/games/bedwars/bots.ts` |
| HUD, shop, inventory screens | `src/games/bedwars/client/hud.ts` |
| Textures painted in code (16×16) | `src/engine/render/textures.ts` |
| Chunk meshing off the main thread | `src/engine/render/mesh-worker.ts` |
| Rooms, 20 TPS loops, rate limits | `src/engine/net/host.ts` |
| Binary/JSON wire codecs | `src/engine/net/codec.ts`, `bedwars/protocol.ts` |
| Client prediction, transports | `src/engine/net/client.ts` |
| Lag compensation | `src/engine/net/lag-comp.ts` |
| Browser-hosted multiplayer relay | `src/sites/relay.ts` |
| Headless test suites (210 tests) | `tests/` |
| Load and latency tooling | `bun run loadtest`, `scripts/netprobe.ts` |
