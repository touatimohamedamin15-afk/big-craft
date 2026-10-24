# Buffcraft: a voxel bed-wars game and engine

A complete bed-wars game in the browser and on the desktop: four teams on
floating islands, beds to defend, forges and diamond and emerald generators,
a shop and team upgrades, bridging, melee with knockback, bots that play a
full round (and wrap their bed in wool first), bows, fireballs, TNT, rift
pearls, bridge eggs and potions, five themed arenas with a lobby vote,
team chat, sound effects and particles made in code, and a practice sandbox
with a station for every mechanic. It
runs on Freebuff Sites with browser-hosted casual multiplayer over managed
realtime, offline in the page against bots, on an optional authoritative Node
server, or as an Electron app.

It is built as a small game-agnostic voxel engine (`src/engine/`) plus the
bed-wars game on top (`src/games/bedwars/`), so the engine carries over to
other block games. The product name is `BRAND` in
`src/games/bedwars/constants.ts`.

## Run it

You need [Bun](https://bun.sh) (1.3.14 or later) and Node 22.14 or later for
the Sites development tooling. The optional Node game server supports Node 20+.

```sh
bun install
bun run dev            # Sites Worker + local realtime helper, http://127.0.0.1:5173
bun run dev:node       # original authoritative Node host with live reload
bun run desktop        # build, then open the desktop app (it runs its own local server)
bun run package        # installers in release/: .dmg/.zip on macOS, .exe on Windows, .AppImage on Linux
bun run build          # dist/client + dist/buffcraft/index.js, for Freebuff Sites
bun run build:node     # dist/node-client + dist/server/main.js, for Node/Electron
bun run start          # serve the build on :3000 (see "Hosting for friends" below)
```

Checks:

```sh
bun test               # every mechanic, headless (physics, combat, items, rooms, bots, settings, rendering)
bun run typecheck
bun run smoke:sites    # after build: local workerd + two Chromium players (install Playwright Chromium first)
bun run smoke          # after build:node: Node server, rooms route, health and headers
bun run desktop:smoke  # the desktop app boots an offline and an online room, headless
bun run loadtest       # capacity numbers (rooms, players, CPU, bandwidth)
```

## Playing

The menu offers three ways in:

- **Play online (Sites)**: Host creates a room; Join uses its code or invite link.
  Four people at most, including the host. The host must keep the tab visible
  and running; there is no host migration or persistent match history.
- **Play online (Node/Electron)**: shows how many people are on the server and every public
  room with its arena, state and open seats. Quick play joins the fullest lobby
  with room (or a round with a bot seat to take); Join picks one; Create makes a
  room, public or invite only. In a room, Esc opens the lobby: who is in it, an
  invite link to copy, team choice, the arena vote, and for the host bots, their
  level and Start. Anyone joining mid-round takes a bot's place, items and all,
  and only watches when every seat has a person in it. An invite link
  (`?room=name`) opens the room list ready to join that room.
- **Solo against bots**: the whole game runs in your window against three bots
  and starts by itself after five seconds. No server needed.
- **Practice sandbox**: a test platform with a station for each mechanic
  (jumps, fall heights, a sneak ledge, a bridging gap, a pillar pit, one of each
  block, dummies, generators and a shop) and every item in your kit. `/bot`
  spawns sparring bots (`/bot 2 hard` for two hard ones), `/nobots` clears
  them, `/help` lists the rest.

URL parameters skip the menu: `?play=1&world=sandbox`, `?play=1&offline=1`,
`&room=name`, `&private=1` (off the room list), `&fast=1` (the round's
timeline runs ten times faster). `GET /api/rooms` returns the room list as JSON.

### Controls

Every control is explained in Settings, Controls, where each action can take
two keys of your choice. The defaults:

| Action | Default | |
| --- | --- | --- |
| Move | W A S D or arrows | |
| Jump | Space | hold to keep jumping; jump and place under yourself to pillar |
| Sneak | Shift | slow, and you cannot fall off an edge: hold it to bridge |
| Sprint | Left Ctrl or R, or double-tap W | hold, toggle or always on (Settings, Game) |
| Attack, break | Left click | hold on a block to break it |
| Place, use | Right click | hold to keep placing; also eat, drink, throw, raise a shield, shop |
| Bow | Hold right click | release to fire; a full second is a full draw |
| Hotbar | 1 to 9, mouse wheel | |
| Drop | Q | throw one of what you hold; Ctrl+Q throws the stack |
| Inventory | E | click two slots to swap them |
| Nearest shop | B | |
| Chat | T or Enter | team chat in a round; start with ! for everyone, / for commands |
| Player list | Tab | |
| Debug | F3 | position, speed, target, frame rate |
| Pause, menus | Esc | the lobby screen before a round, the pause menu during one |

In a browser, Ctrl+W closes the tab, so sprint with R or a double-tap there
(the desktop app has no such problem).

### Moving and bridging

Movement is tuned to be forgiving: a fifth faster than the genre's classic
pace, jumps about 1.6 blocks high (over one block with room to spare, never
two), longer sprint-jumps, strong steering in the air, a short grace period to
jump just after walking off an edge, falls up to four blocks without damage,
and five blocks of reach. Bridging is the classic skill, with no assist: sneak
backwards to the edge (sneaking never walks off it), look down and place
against the side of the block you stand on.

### Looks

Open the Wardrobe from the menu or the pause screen: skin tone, hair style
and colour, eyes, an outfit and its colour, a cape (team, flame, galaxy,
checker, royal, leaf, sunset, frost), a movement trail (sparkle, flame, hearts,
notes, cloud) and a kill effect (burst, lightning, confetti). Skins are 64×64
textures painted in code (`client/avatar.ts`); in a round you also wear team
leather (headband, shoulder pads, vest edges, boots) and your bought armour
on your legs, so teams read at a glance. Name tags show a team prefix and a
health bar; teammates' tags show through walls; an enemy who sneaks hides
theirs. Press F5 (or V) to see yourself from behind. Looks travel as a short
code the server validates (`look.ts`); add a choice by appending to a list in
`look.ts` and teaching `paintSkin`/`paintCape` or the trail and effect code
to draw it.

### Bots

Bots fill empty teams when a round starts. They play by the same rules as
people: they move with the shared physics and act only through the messages a
client sends (buy, place, dig, attack, draw and release, throw, use, upgrade),
so the server checks everything they do. The lobby host picks their level
(Normal unless changed; solo play starts at Normal too). Every difference
lives in one table, `BOT_PROFILES` in `src/games/bedwars/bots.ts`:

| | Easy | Normal | Hard | Expert |
|---|---|---|---|---|
| Reaction before engaging | 0.8 s | 0.4 s | 0.2 s | 0.1 s |
| Aim error | ±0.5 rad | ±0.24 rad | ±0.1 rad | ±0.04 rad |
| Clicks per second | about 1.6 | about 2.2 | about 4 | about 6 |
| Sprint reset (w-tap), strafing, jump crits | none | light strafing | all | all, hits timed to the red flash |
| Shopping | stone sword, wool | + chain armour, iron sword, shears, pickaxe | + iron armour, pickaxe and axe tiers, bow and arrows, golden apples, sharpness and protection with diamonds | + diamond sword and armour when affordable, fireballs, a pearl |
| Bed defence | none | one wool layer | wool, then a clay layer | wool, clay, then moonstone |
| Tactics | | | eat a golden apple below 6 health; arrows at enemies 8 to 24 blocks away out on bridges | also fireballs at enemies on bridges, a pearl back when knocked into the void or stranded, and heads home when an enemy comes within 12 blocks of its bed |

All levels gather at their forge, bridge in axis-aligned legs, dig through bed
defences with the right tool, and never stay stuck: a skipped waypoint after
three seconds without progress, a fight given up when neither side can land a
hit, and a step off the edge (to respawn) after thirty seconds stranded with
no blocks while their bed stands.

### Settings

Game (mouse sensitivity, invert, field of view, sprint mode, double-tap
sprint, view bobbing, frame counter), Controls, Video (render distance,
quality, full screen) and Audio (volume). They apply at once and are kept in
the browser's (or the desktop app's) local storage.

## Maps

Every arena is generated in code from an `ArenaLayout` in
`src/games/bedwars/maps/arena.ts` (where the bases, diamond islands and middle
sit, a theme, a seed), so the same layout always builds the same world, in a
few milliseconds. The lobby vote offers them all; Skyreach is the default.

- **Skyreach** (forest): bases on a cross. Stone-and-wood houses, mossy
  yards, flowers and young trees; big oaks and birches on the diamond islands;
  in the middle a ring of mossy flagstones under a floating grove with a great
  oak, chained to four lamp posts.
- **Lanterns** (a village at dusk): corner bases with plastered, tile-roofed
  houses and a side wing, lantern posts, cobbled yards and hay; in the middle a
  brick square with a fountain basin, cottages and lamp posts.
- **Dunes** (desert): sandstone houses with flat crenellated roofs and domes on
  banded sand-and-terracotta islands, cacti, palms and small gold-capped
  pyramids; an oasis middle of sunken pools and palms under a floating pyramid.
- **Frostpeak** (snow and ice): corner bases under snow-laden roofs with
  icicles, snowy spruces, ice spikes and frozen puddles; a frozen tower with a
  gate on each side and a quartz spire in the middle.
- **Ruins** (a mossy castle): broken stone-brick houses with ivy, columns and
  rubble, diamonds in a pinwheel; the old keep's footings on the ground and the
  keep itself, towers and all, floating above them.

Each base has the same plan, dressed by its theme: a two-winged house on the
back rim with team-glass windows, a team-wool band and banners, joined over an
open sky gate; a paved yard with the forge between lamps, the spawn ringed in
team wool and striped awnings over the shopkeepers; the bed under a
team-coloured tent, open front and back.

Bots cannot dig map blocks and walk in straight, axis-aligned legs, so the
maps keep out of their way: the lanes they bridge along are reserved before
anything is built (`walkways` in `maps/plan.ts`), and every island in line with
a base or a lane gets nothing solid at body height beyond one-high blocks you
can hop: houses stand on the rims no route crosses, tents, awnings, lamp posts
and young trees stand on non-solid poles, and the middle of a cross arena
floats its landmark overhead. `tests/maps.test.ts` checks all of this for
every arena, and `tests/bots.test.ts` plays a round on each.

New blocks for the themes (sand, sandstone, snow, ice, cobblestone, stone
bricks, woods, quartz, terracotta, lanterns with `lightLevel`, team-stained
glass and more) are map blocks only; each has its own pattern painted in
`render/textures.ts`. The game uses 66 of the 128 block ids a cell can hold.

## Freebuff Sites

`bun run build` produces the ordinary Worker manifest in `deploy.json`, with
`realtime: true`. The only public assets are `dist/client`; the local helper,
source maps, Node server and Electron files are not uploaded. The default build
and Publish button therefore target Sites. `build:node`, Docker and Electron
continue to use the original Node server.

Local development starts the platform's generated realtime helper in a separate
Wrangler process on an available loopback port, then Vite/workerd on 5173 (or
`--port`). The launcher and Vite use a project-specific local helper name so
other Sites projects on the same machine cannot supply this game's binding.
The app proxies the reserved socket path to the local helper, so the browser
uses the app's one origin. Both child processes stop when you stop `dev`.
Without auth configuration, **loopback only** uses a development identity; each
tab still has its own player. Non-loopback previews need real development auth
or a deployed Sites Preview; they never receive this fallback.

When deployment is explicitly authorized:

1. Create the site and enable **Sign in with Freebuff**. Sites supplies the
   existing `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER` and `APP_ORIGIN` bindings.
   There is no new secret, D1 database, R2 bucket or dedicated game service.
2. Build, then deploy `deploy.json` to Preview. The platform attaches `REALTIME`.
   Do not upload `freebuff-realtime/worker.js`: that file is local-only;
   the platform supplies its own managed helper.
3. Verify sign-in with two accounts, create/join, game start, movement/building,
   a five-minute ticket renewal, reconnect and host departure before publishing.
   A local workerd smoke does not verify hosted OIDC or dispatcher routing.

Every online ticket requires the signed-in server identity and same-origin
JSON. Codes identify open rooms for signed-in visitors; they are not access
control or private invitations. Solo and sandbox remain public/offline.

`src/sites/relay.ts` runs the unchanged 20 TPS room in the creator's browser.
All guests' actions still pass through its game-rule checks. The relay's sender
identity chooses the player; a guest cannot name someone else's player ID.
The host remains trusted, and relayed per-player data is visible to room members.
Do not use this transport for hidden information, money or ranked scores.

The transport sends at most ten batched frames/second per browser, each below
12 KiB (the managed limit is 16 KiB). It splits large world snapshots across
ordered fragments and caps each queue at 512 KB. Packet gaps and overload fail
explicitly. There is no unbounded retry queue. Ticket renewal preserves the host
room and guest seat/inventory, replacing each guest's stream with a full snapshot.
After an actual page reload the player joins afresh. Host disconnects get a
15-second grace period, then guests leave; they never elect a replacement.

For the local built-artifact check, install Playwright Chromium once with
`bunx playwright install chromium`, then `bun run build && bun run smoke:sites`.
An existing Chromium binary can be selected with `--chromium=/absolute/path`.
The smoke uses in-memory workerd state, opens two browser tabs, tests live
movement and ticket renewal (with an accelerated expiry in the test fixture), and saves
`dist/review/sites-multiplayer.png`; it provisions nothing remotely.

This repository change does **not** publish the template catalogue or deploy a
site. The full Buffcraft template is prepared here; `bedwars-lite` remains the
separate Node-only starter.

## Desktop app

`bun run desktop` runs it from source; `bun run package` builds installers
into `release/` for the machine you run it on (`--mac`, `--win`, `--linux` to
choose; see electron-builder's docs for building for other platforms). The app
starts its own game server on a free local port, remembers its window, allows
one copy at a time, and has a menu with full screen (F11, or Ctrl+Cmd+F on a
Mac) and Back to menu. `LAN_HOST=0.0.0.0` lets others on your network join
the room you are in.

The builds are not code-signed. On macOS, open an unsigned download with
right click, Open the first time; Windows shows a SmartScreen prompt. To sign,
add your certificates as electron-builder describes and change nothing else.
The icon is `build/icon.png`, drawn by `bun run icon` (scripts/make-icon.mjs).

## Hosting for friends on Node

```sh
bun run build:node
node dist/server/main.js --port 3000 --host 0.0.0.0 --workers auto
```

It prints the address to share on your network. `--workers auto` uses every
core but one, with each room on one worker; `/healthz` answers for uptime
checks; Ctrl+C (or SIGTERM) closes connections and exits. Behind the internet,
put it behind a reverse proxy that passes WebSocket upgrades on `/game`, with
TLS (the page then connects over `wss://` by itself).

### On a host with Docker

The `Dockerfile` builds the client and server with Bun and runs them on Node:

```sh
docker build -t buffcraft . && docker run -p 3000:3000 buffcraft
```

Any host that runs a container and passes WebSocket upgrades works. Keep it to
one instance: rooms live in memory, so two instances would split players
between two sets of rooms. Scale up with `WORKERS=auto` on a bigger machine
instead.

The hosted copy at `buffcraft.freebuff.app` is this Dockerfile on Render (one
starter instance, health check `/healthz`).

### The Freebuff promotion

On a page served over https, the menu shows a "Built with Freebuff" card, the
pause menu a Remix button, and the round summary a line, all linking to
freebuff.com with `utm_source=buffcraft`. Local and desktop runs (http) never
show them; add `?promo=1` to see them locally. They live in
`src/games/bedwars/client/promo.ts`; delete it and its three call sites to
remove them.

## Troubleshooting

- **"3D graphics are not available"**: turn on hardware acceleration in the
  browser, update graphics drivers, or use the desktop app.
- **Port in use**: `--port 3001` (or `PORT=3001`).
- **Disconnected**: Try again rejoins the same room; rooms close a minute after
  the last person leaves.
- **Slow frame rate**: Settings, Video: lower the render distance or quality.

## How it fits together

```
src/engine/                  game-agnostic; never imports a game (tests/architecture.test.ts)
  blocks.ts, items.ts        registries: a game registers its blocks and items at startup
  world.ts                   fixed-size voxel grid; one byte per cell (id + "placed by a player")
  physics.ts                 player movement: gravity, jumping, sprint, sneak edge guard, collision
  raycast.ts, building.ts    block picking, break times, placement rules
  melee.ts                   knockback, reach, line of sight, shields
  projectile.ts, explosion.ts  swept projectiles against blocks and bodies; blast resistance
  terrain.ts                 layered floating islands (surface, soil, rock, uneven rims, hanging undersides)
  net/room.ts                RoomLike and RoomFactory: what a game exposes to the transports
  net/codec.ts               wire codecs: binary frames for a game's hot messages, JSON for the rest
  net/host.ts                WebSocket host: rooms by key, 20 TPS loops, rate limits, encode-once
  net/client.ts              WebSocket and in-page transports for the browser
  net/lag-comp.ts            pose history and rewind for hit checks
  render/                    three.js: atlas, sunlight, AO mesher, chunk meshes, shaders, sky, entities
  render/mesh-worker.ts      the Web Worker that relights and meshes chunks off the main thread
src/games/bedwars/
  blocks.ts, items.ts        content: blocks, team wool and beds, weapons, tools, resources
  room.ts                    the authoritative game: lobby, teams, beds, generators, shop, deaths, timeline
  arsenal.ts                 bows, throwables (fireball, pearl, egg), lit TNT, explosions, potions
  rules.ts, shop.ts          numbers: timers, generator rates and caps, prices, upgrades
  bots.ts                    bots that gather, shop, bridge, fight and break beds
  maps/                      five themed arenas and the sandbox, generated in code (see Maps):
                             arena.ts (layouts, createArena), themes.ts, base.ts, parts.ts, plan.ts (lanes)
  protocol.ts                messages between client and room, and their binary wire format
  server.ts                  the room factory the host and the page use
  client/                    the browser game: prediction, input, HUD, shop, models, view model
src/server/main.ts           Node server: static files + game host, optional worker processes
electron/main.mjs            desktop shell: runs the server in-process and opens a window
```

The simulation is shared: the server, bots, the offline room and `bun test`
all run the same `physics.ts` and `room.ts`. The client predicts its own
movement with the same code and the server checks every move (speed, height,
collisions), judges fall damage from positions, and validates reach, line of
sight, placement and purchases.

On the client, sunlight and chunk meshing run in a Web Worker
(`render/mesh-worker.ts`) that keeps its own copy of the world. The page
mirrors each batch of block edits to it; the worker relights, remeshes the
touched chunks nearest the camera first, and posts the geometry back as
transferred typed arrays, which `ChunkRenderer` swaps in a few per frame. The
main thread never meshes, so a burst of edits or a fresh world costs it only
buffer uploads.

## Scaling

Measured with `bun run loadtest` on the development Mac, one core, bots in
every seat and one watching player per room (`20 30 1 1` and `10 30 4 1`).
Downstream is message payload; "before" is JSON throughout, as `--json` still
measures it:

| Room | Simulation per tick | Rooms per core (simulation) | Downstream per player, before | After |
| --- | --- | --- | --- | --- |
| Solos, 4 players | 0.013 ms | about 3,800 | 2.07 KB/s | 0.30 KB/s |
| 4v4, 16 players | 0.040 ms | about 1,250 | 1.76 KB/s | 0.20 KB/s |

Of that drop, binary ticks took the snapshot stream from 1.14 to 0.25 KB/s
(solos) and 0.83 to 0.15 KB/s (4v4); the rest was the self view, which a
per-tick countdown had been resending 20 times a second after every death.
Encoding a tick in binary costs about 0.5 µs per room against 0.1 µs for
`JSON.stringify`, both noise beside simulation. At about six messages a
second, payload is now smaller than its TCP/IP and WebSocket framing
(roughly 50 bytes a packet), so the next saving is fewer messages (one frame
per tick for everything a player gets), not smaller ones.

Simulation is cheap; the cost that grows with players is sockets and
encoding. What the server does about that:

- **Delta snapshots.** Each tick sends only the fields that changed (a moving
  player is a few numbers); idle rooms send a heartbeat every fourth tick.
  Joiners get the last state in full. This cut bandwidth about 14× (solos)
  and 38× (4v4) against full snapshots.
- **Binary hot path.** `tick` and `input`, sent 20 times a second each way,
  are binary WebSocket frames (`bedwarsCodec` in `protocol.ts`): a field
  mask per player delta, positions as hundredths in zigzag varints that
  decode to exactly the rounded value the room sent, and inputs with float64
  positions (the server collides the box the client predicted) and float32
  velocity and look. Every other message stays JSON in text frames, so the
  two never need a marker. The offline room goes through the same encoding.
- **Encode once.** A broadcast is serialised once, not once per player.
- **Rooms pinned to processes.** `WORKERS=n` forks game workers; the primary
  hashes each room key to a worker and hands it the socket, so every player
  of a room meets in one process and rooms spread over cores. Past one
  machine, run several servers behind a matchmaker that assigns rooms to
  servers the same way (not included).
- **Lag compensation.** Melee is judged against where the target was when
  the attacker saw it, at most 500 ms back.

### Playing well over a slow link

`bun scripts/netprobe.ts <server>` plays against a server the way the browser
does (pillaring ten blocks, then sneak-bridging) and reports placements the
server reverted, teleports, confirmation times and how evenly a second client
saw the first move; `LAG=150 JITTER=150` adds a one-way delay with jitter.
With 150 ms each way and 150 ms of jitter it first showed reverted blocks, a
pillar two blocks short and rubber-band teleports; now it shows none. What
changed, and why each matters at a distance:

- **Inputs carry their tick number.** Movement is checked per tick against
  speed and jump limits. An input the server skipped (one still in flight
  when a correction went out) made the next one look like a two-tick jump,
  which tripped the fly check and teleported the player back. Now an input
  is judged against the ticks since the last one applied, each tick costing
  budget that refills one per server tick, so the sustained limit holds.
- **Your own body never blocks your block.** The server's copy of you trails
  the client, so it refused blocks placed under your feet while pillaring.
  The client checks its own body where it really is; the server checks
  everyone else's.
- **Breaks are predicted.** The client breaks a block when its own timer
  ends and says so; the server agrees if its timer (started half a round
  trip later) is within half a second, and otherwise puts the block back.
  Beds no longer wait a round trip after the cracks finish.
- **Others are drawn on the server's timeline.** Each snapshot is stamped
  with its tick; the client keeps a short buffer and draws everyone two
  ticks behind a typical arrival, plus up to four more on a jittery link, so
  late or bunched packets do not make players stutter or vanish. Attacks
  report the tick they were aimed at, for lag compensation.

Bed wars scales by running many small rooms, not one big world, which is why
the engine keeps a fixed-size world per room and spends its effort on rooms
per process and bytes per player.

## Relationship to Voxelize

[Voxelize](https://github.com/voxelize/voxelize) (MIT) is a full-stack voxel
engine: a Rust authoritative server with ECS worlds, chunk streaming for
infinite terrain, and a TypeScript/three.js client with a WASM mesher. This
template borrows from it rather than running on it:

- Taken (adapted, see `THIRD_PARTY_NOTICES.md`): the chunk shader's lighting
  model (packed sun and AO per vertex, face shades, hemisphere ambient, its
  light curve, sky-gradient fog), the vertex AO and quad flip rule, sunlight
  seeding and flood, the sky dome and cloud shading, atlas padding against
  bleeding, and the shape of its lag compensation.
- Not taken, and why: its game logic lives in Rust systems on its server, so
  every rule (and every game built on this template) would be Rust, and the
  template would need a Rust toolchain and a compiled server binary per
  platform for Electron. Its strengths (infinite streamed worlds, chunk
  interest sets, server-side meshing) solve problems a bed-wars arena does
  not have, while its controls are tuned for building, not PvP. Its 16×16
  texture pack is CC BY-SA and its other packs carry no license, so no art is
  copied.
- If a future game needs huge streamed worlds, the ported pieces (mesher,
  light, shader) are the ones to swap for Voxelize's own, and its chunk
  interest sets are the model for sending players only nearby chunks.

## Making another game on the engine

1. Make `src/games/<name>/` with its blocks and items (register them with
   `defineBlock` and `defineItems`), a room that implements `RoomLike`, and a
   `RoomFactory` like `games/bedwars/server.ts`.
2. Point `vite.config.ts` and `src/server/main.ts` at the new factory (or
   choose by URL).
3. Reuse `engine/render` for the world and write the game's own HUD.

## Tests

`tests/` runs headless with `bun test`: physics (gravity, jump height, walk,
sprint and sneak speeds, walls, ceilings, sneak edge guard, fall damage,
pillaring, bridges), ray casting, break times, placement and breaking rules,
beds, combat (damage, crits, armour, knockback, reach, line of sight,
shields, spawn protection, lag compensation), the room (lobby, teams, start,
beds, deaths, respawn, final kills, winning, reset, generators, caps, shop,
upgrades, timeline, sandbox), full rounds played by bots at every level on
every arena (and an expert beating an easy bot), delta snapshots against the
room's truth, the sunlight and mesher, every arena's layout (beds, headroom,
protected zones, clear lanes, nothing that walls a bot in, the textures of
every block), and the engine/game
boundary. `FEATURES.md` tracks every feature against its test.

## Known gaps

- Bots do not use potions, TNT or bridge eggs yet; traps are not in.
- Desktop builds are unsigned (see Desktop app).
- Meshing is per face. Greedy merging of same-tile faces with equal AO and
  light would cut vertices several times on flat ground, with per-block UVs
  rebuilt in the shader from `fract(worldPos)` as Voxelize does.
- Each tick a player can get a `tick`, a `self` and a `blocks` message as
  separate frames; folding them into one would save more than shrinking them.
- Sites multiplayer trusts the host browser. It is for casual matches, with no
  competitive integrity or persistent rankings. A closed/sleeping host ends play
  after a 15-second grace period; a background tab may slow the simulation.
- Realtime budgets are shared by the whole site. Several busy rooms can exhaust
  the delivery budget; overload ends the stream explicitly instead of losing
  world edits silently. Use the Node server for larger or competitive games.
