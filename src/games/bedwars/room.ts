import { AIR, BED, blockTeam, isBed, TEAM_NAMES, type TeamId } from './blocks'
import { breakTicks, checkPlace } from '../../engine/building'
import { PositionHistory, rewindTick } from '../../engine/net/lag-comp'
import { bedPartner, checkBreak, placeBed } from './beds'
import { armorReduction, canBeHurt, knockback, reachDistance, shieldBlocks, weaponDamage, CRIT_MULTIPLIER } from './combat'
import {
  ATTACK_REACH,
  BLOCK_REACH,
  EYE_HEIGHT,
  HURT_TICKS,
  KILL_CREDIT_TICKS,
  MAX_HEALTH,
  PICKUP_RADIUS,
  DROP_GRAVITY,
  REACH_SLACK,
  SAFE_FALL,
  SNEAK_EYE_HEIGHT,
  SPAWN_PROTECTION_TICKS,
  TPS,
} from './constants'
import { addItem, canFit, countItem, emptyInventory, HOTBAR, INVENTORY_SIZE, removeFromSlot, removeItem, replaceItem, swapSlots, type Inventory } from '../../engine/inventory'
import { ARMOR_ORDER, type ArmorTier, AXES, type Effect, item, JUMP_BOOST, PICKAXES, placedBlock, RESOURCES, SPEED_BOOST } from './items'
import { Arsenal } from './arsenal'
import { decodeLook, DEFAULT_LOOK, encodeLook, randomLook } from './look'
import { arenaLayout, createArena } from './maps/arena'
import { createSandbox } from './maps/sandbox'
import type { MapDef, MapMeta } from './maps/types'
import type { RoomSummary } from '../../engine/net/room'
import type { RoomParams } from './server'
import { collides, groundBelow, lookDirection, playerBox, stepDrop, stepMovement, type MoveInput, type Mover } from '../../engine/physics'
import type { ClientMessage, DropView, EventKind, GameView, Phase, PlayerDelta, PlayerView, SelfView, ServerMessage } from './protocol'
import { raycastBlock } from '../../engine/raycast'
import { rng } from '../../engine/random'
import { toBase64 } from '../../engine/world'
import {
  BASE_RADIUS,
  FORGE_EMERALD_INTERVAL,
  GENERATOR_CAP,
  GENERATOR_INTERVAL,
  HEAL_POOL_INTERVAL,
  REGEN_DELAY,
  REGEN_INTERVAL,
  BOT_LEVELS,
  type BotLevel,
  type GameRules,
  type GeneratorKind,
} from './rules'
import { NO_UPGRADES, OFFERS, TOOL_TIER_COST, UPGRADES, type TeamUpgrades, type UpgradeId } from './shop'

export type Sink = (msg: ServerMessage) => void

/** Bots and dummies: called once a tick, returns the movement for that tick. */
export interface Brain {
  think(room: Room, p: Player): MoveInput
}

export interface Player extends Mover {
  id: number
  name: string
  sink: Sink | null
  brain: Brain | null
  team: TeamId | null
  health: number
  /** Has a body in the world (false while dead or spectating). */
  alive: boolean
  eliminated: boolean
  respawnAt: number | null
  inventory: Inventory
  selected: number
  armor: ArmorTier
  /** Index into PICKAXES / AXES, -1 for none. Kept (one tier lower) through deaths. */
  pickaxeTier: number
  axeTier: number
  shears: boolean
  hurtTicks: number
  protectedTicks: number
  lastHurtTick: number
  lastAttacker: { id: number; tick: number } | null
  shield: boolean
  dig: { x: number; y: number; z: number; progress: number } | null
  lastSwing: number
  lastAttackTick: number
  lastEatTick: number
  /** Teleport sequence; inputs from before the latest teleport are ignored. */
  tp: number
  /** Ticks during which bigger moves are accepted (after knockback). */
  kbGrace: number
  inputBudget: number
  /** The `seq` of the last input applied; null until one arrives (and after a teleport). */
  lastSeq: number | null
  stats: { kills: number; finals: number; beds: number; deaths: number }
  lastSelf: string
  /** Sandbox dummies stand still and respawn where they were. */
  home: [number, number, number, number] | null
  /** Tick the bow draw began, or null. */
  drawStart: number | null
  lastThrowTick: number
  /** Tick each potion effect ends on (0 for none). */
  effects: Record<Effect, number>
  /** Cosmetics, as a validated look code. */
  look: string
}

export type DamageCause = 'melee' | 'fall' | 'arrow' | 'explosion'

interface TeamState {
  team: TeamId
  bed: boolean
  upgrades: TeamUpgrades
  eliminated: boolean
}

interface Generator {
  kind: GeneratorKind
  team?: TeamId
  pos: [number, number, number]
  next: number
}

interface Drop {
  id: number
  item: string
  count: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** The generator that made it, so its cap counts only its own pile; -1 for a thrown item. */
  source: number
  /** Thrown items: nobody picks them up before this tick, and they vanish at `expires`. */
  pickupAt?: number
  expires?: number
}

/** How far behind the client's dig timer the server's may be when the client says it is done (half a second). */
const DIG_GRACE_TICKS = 10
/** Input ticks a player may bank (a second of bunched-up packets), refilled one per tick. */
const INPUT_BUDGET = 20
/** The most ticks one input may stand for after a gap. */
const MAX_INPUT_GAP = 10

/** A thrown item waits a second before anyone can pick it up, and lasts five minutes. */
const THROWN_PICKUP_DELAY = TPS
const THROWN_LIFETIME = 5 * 60 * TPS
/** Beyond this many thrown items in a room, the oldest goes. */
const MAX_THROWN = 200

export interface RoomOptions {
  rules: GameRules
  seed?: number
  createMap?: () => MapDef
}

export class Room {
  readonly rules: GameRules
  map!: MapDef
  tickCount = 0
  phase: Phase = 'waiting'
  phaseStart = 0
  players = new Map<number, Player>()
  teams = new Map<TeamId, TeamState>()
  generators: Generator[] = []
  drops: Drop[] = []
  winner: TeamId | 'draw' | null = null
  botsEnabled: boolean
  /** Level for bots made from now on; the host changes it in the lobby. */
  botLevel: BotLevel
  hostId: number | null = null
  readonly random: () => number
  /** How the room was asked for (its name, world, speed, privacy); set by the server, for the room list. */
  params: RoomParams | null = null
  /** Brain factory for bots; set by the server (kept out of here so tests can stub it). */
  createBot: ((room: Room, team: TeamId, duel?: boolean, level?: BotLevel) => Brain) | null = null
  createDummy: ((room: Room, shield: boolean) => Brain) | null = null
  /** What the last tick broadcast said, for deltas and for a joiner's first frame. */
  private sent: { players: Map<number, PlayerView>; drops: string; game: string; full: ServerMessage | null } = { players: new Map(), drops: '', game: '', full: null }
  private history = new PositionHistory()
  /** Bows, throwables, TNT and potions. */
  readonly arsenal = new Arsenal(this)
  /** The arena layout loaded now, and each lobby player's vote for the next round. */
  mapId: string
  private votes = new Map<number, string>()
  private nextId = 1
  private nextDropId = 1
  private pendingBlocks: [number, number, number, number][] = []
  private timelineIndex = 0
  private diamondTier = 0
  private emeraldTier = 0
  private bedRegenAt: number | null = null
  private unsubscribeWorld: (() => void) | null = null
  private readonly createMap: () => MapDef

  constructor(options: RoomOptions) {
    this.rules = options.rules
    this.random = rng(options.seed ?? 1)
    this.botsEnabled = options.rules.bots
    this.botLevel = options.rules.botLevel
    this.mapId = options.rules.maps[0] ?? 'skyreach'
    this.createMap = options.createMap ?? (() => (options.rules.mode === 'sandbox' ? createSandbox() : createArena(this.rules.teams, arenaLayout(this.mapId))))
    this.resetWorld()
    if (this.rules.mode === 'sandbox') this.phase = 'playing'
  }

  get world() {
    return this.map.world
  }

  // Connections ------------------------------------------------------------

  connect(name: string, sink: Sink | null, brain: Brain | null = null): Player {
    const id = this.nextId++
    const p: Player = {
      id,
      name: cleanName(name, id),
      sink,
      brain,
      team: null,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      onGround: false,
      sneaking: false,
      sprinting: false,
      fallDistance: 0,
      health: MAX_HEALTH,
      alive: false,
      eliminated: false,
      respawnAt: null,
      inventory: emptyInventory(),
      selected: 0,
      armor: 'leather',
      pickaxeTier: -1,
      axeTier: -1,
      shears: false,
      hurtTicks: 0,
      protectedTicks: 0,
      lastHurtTick: -9999,
      lastAttacker: null,
      shield: false,
      dig: null,
      lastSwing: -9999,
      lastAttackTick: -9999,
      lastEatTick: -9999,
      tp: 0,
      kbGrace: 0,
      inputBudget: INPUT_BUDGET,
      lastSeq: null,
      stats: { kills: 0, finals: 0, beds: 0, deaths: 0 },
      lastSelf: '',
      home: null,
      drawStart: null,
      lastThrowTick: -9999,
      effects: { speed: 0, jump: 0, invisible: 0 },
      // Bots dress at random (their own stream, so looks never shift gameplay); people send theirs after joining.
      look: encodeLook(brain ? randomLook(rng(id * 7919)) : DEFAULT_LOOK),
    }
    this.players.set(id, p)
    if (!brain && this.hostId === null) this.hostId = id
    this.send(p, { t: 'welcome', id, world: toBase64(this.world.encode()), map: this.meta(), tp: p.tp })
    if (this.sent.full) this.send(p, this.sent.full)
    if (this.rules.mode === 'arena') this.send(p, this.votesMessage())
    this.send(p, { t: 'lobby', botLevel: this.botLevel })

    if (this.rules.mode === 'sandbox') {
      p.team = brain ? p.team : 'red'
      if (!brain) this.spawn(p)
    } else if (this.phase === 'playing' && !brain && this.takeBotSeat(p)) {
      // Dropped straight into the round in a bot's place.
    } else if (this.phase === 'playing' || this.phase === 'ended') {
      p.eliminated = true
      this.event(p, 'system', 'A round is in progress and every seat has a person in it. You are watching; you play in the next round.')
    } else {
      this.toLobby(p)
    }
    if (!brain) this.broadcastEvent('system', `${p.name} joined`)
    return p
  }

  /** Restore a relay stream after ticket renewal without changing the player's inventory or seat. */
  resync(id: number): void {
    const p = this.players.get(id)
    if (!p) return
    this.send(p, { t: 'welcome', id, world: toBase64(this.world.encode()), map: this.meta(), tp: p.tp })
    if (this.sent.full) this.send(p, this.sent.full)
    if (this.rules.mode === 'arena') this.send(p, this.votesMessage())
    this.send(p, { t: 'lobby', botLevel: this.botLevel })
    this.send(p, { t: 'self', self: this.selfView(p) })
  }

  /**
   * Someone joining mid-round takes over a bot: its team, place, items, armour,
   * tools and score, and the bot leaves. Bots on teams that still have a bed go
   * first. Returns false when there is no bot to replace.
   */
  private takeBotSeat(p: Player): boolean {
    const bots = [...this.players.values()].filter((q) => q.brain && q.team && !q.eliminated)
    const bedFirst = (q: Player) => (this.teams.get(q.team!)?.bed ? 0 : 1)
    const bot = bots.sort((a, b) => bedFirst(a) - bedFirst(b))[0]
    if (!bot) return false
    this.players.delete(bot.id)
    this.history.forget(bot.id)
    Object.assign(p, {
      team: bot.team,
      health: bot.health,
      alive: bot.alive,
      respawnAt: bot.respawnAt,
      inventory: bot.inventory,
      selected: bot.selected,
      armor: bot.armor,
      pickaxeTier: bot.pickaxeTier,
      axeTier: bot.axeTier,
      shears: bot.shears,
      stats: bot.stats,
      effects: bot.effects,
    })
    if (p.alive) this.teleport(p, bot.x, bot.y, bot.z, bot.yaw, bot.pitch)
    this.broadcastEvent('system', `${p.name} took ${bot.name}'s place on ${TEAM_NAMES[bot.team!]}`)
    return true
  }

  disconnect(id: number): void {
    const p = this.players.get(id)
    if (!p) return
    this.players.delete(id)
    this.history.forget(id)
    if (this.votes.delete(id)) this.broadcast(this.votesMessage())
    if (!p.brain) this.broadcastEvent('system', `${p.name} left`)
    if (this.hostId === id) this.hostId = [...this.players.values()].find((q) => !q.brain)?.id ?? null
    if (this.phase === 'playing') this.checkEliminations()
  }

  /** What the public room list shows; private rooms (and rooms made outside the server) are not listed. */
  summary(): RoomSummary | null {
    const p = this.params
    if (!p || p.private) return null
    const players = this.humans().length
    // Sandbox training dummies are scenery, not seats: only real bots count.
    const bots = [...this.players.values()].filter((q) => q.brain && !q.home).length
    return {
      room: p.room,
      world: p.world,
      fast: p.fast,
      phase: this.phase,
      map: this.map.name,
      players,
      bots,
      capacity: this.rules.mode === 'sandbox' ? 16 : this.rules.teams.length * this.rules.teamSize,
    }
  }

  humans(): Player[] {
    return [...this.players.values()].filter((p) => !p.brain)
  }

  // Messages ---------------------------------------------------------------

  receive(id: number, msg: ClientMessage): void {
    const p = this.players.get(id)
    if (!p || typeof msg !== 'object' || msg === null) return
    switch (msg.t) {
      case 'hello':
        p.name = cleanName(msg.name, p.id)
        return
      case 'input':
        return this.onInput(p, msg)
      case 'select':
        if (Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < HOTBAR) {
          p.selected = msg.slot
          p.dig = null
        }
        return
      case 'drop':
        return this.onDrop(p, msg.all === true)
      case 'dig':
        return msg.done ? this.onDigDone(p, msg.target) : this.onDig(p, msg.target)
      case 'place':
        return this.onPlace(p, msg)
      case 'attack':
        return this.onAttack(p, msg.target, msg.seen)
      case 'use':
        return this.onUse(p)
      case 'buy':
        return this.onBuy(p, msg.offer)
      case 'upgrade':
        return this.onUpgrade(p, msg.id)
      case 'swap':
        if (Number.isInteger(msg.a) && Number.isInteger(msg.b) && msg.a < INVENTORY_SIZE && msg.b < INVENTORY_SIZE) swapSlots(p.inventory, msg.a, msg.b)
        return
      case 'team':
        return this.onTeam(p, msg.team)
      case 'start':
        if (p.id === this.hostId && this.phase === 'waiting') this.beginCountdown(true)
        return
      case 'settings':
        if (p.id !== this.hostId || this.phase === 'playing') return
        this.botsEnabled = !!msg.bots
        if (BOT_LEVELS.includes(msg.botLevel as BotLevel) && msg.botLevel !== this.botLevel) {
          this.botLevel = msg.botLevel as BotLevel
          this.broadcast({ t: 'lobby', botLevel: this.botLevel })
        }
        return
      case 'chat':
        return this.onChat(p, String(msg.text ?? '').slice(0, 200))
      case 'look':
        p.look = encodeLook(decodeLook(msg.look))
        return
      case 'draw':
        return this.arsenal.draw(p)
      case 'release':
        return this.arsenal.release(p)
      case 'throw':
        return this.arsenal.throw(p)
      case 'vote':
        if (this.rules.mode !== 'arena' || (this.phase !== 'waiting' && this.phase !== 'countdown') || !this.rules.maps.includes(msg.map)) return
        this.votes.set(p.id, msg.map)
        this.broadcast(this.votesMessage())
        return
    }
  }

  private onInput(p: Player, msg: Extract<ClientMessage, { t: 'input' }>): void {
    if (!p.alive || p.brain || msg.tp !== p.tp) return
    if (![msg.x, msg.y, msg.z, msg.yaw, msg.pitch, msg.vx, msg.vy, msg.vz].every(Number.isFinite)) return
    // How many client ticks this input covers. Inputs the server skipped (in flight across a
    // teleport, or over budget) leave a gap, and the next one carries their movement too, so it
    // is judged against that many ticks instead of looking like a speed or fly hack. Each tick
    // costs budget, which refills one per server tick, so the sustained speed limit holds.
    const gap = typeof msg.seq === 'number' && p.lastSeq !== null && msg.seq > p.lastSeq ? Math.min(msg.seq - p.lastSeq, MAX_INPUT_GAP) : 1
    const steps = Math.min(gap, p.inputBudget)
    if (steps <= 0) return
    p.inputBudget -= steps
    if (typeof msg.seq === 'number') p.lastSeq = msg.seq
    const dx = msg.x - p.x
    const dy = msg.y - p.y
    const dz = msg.z - p.z
    const grace = p.kbGrace > 0
    // Potions raise the limits by what they add to walking and jumping.
    const fast = p.effects.speed > this.tickCount ? SPEED_BOOST : 1
    const high = p.effects.jump > this.tickCount ? JUMP_BOOST : 0
    const tooFar = Math.hypot(dx, dz) > (grace ? 3 : 1.1 * fast) * steps || dy > (grace ? 2 : 0.65 + high) * steps
    if (tooFar || collides(this.world, playerBox(msg.x, msg.y, msg.z, !!msg.sneak))) {
      this.teleport(p, p.x, p.y, p.z, p.yaw, p.pitch)
      return
    }
    p.x = msg.x
    p.y = msg.y
    p.z = msg.z
    p.vx = msg.vx
    p.vy = msg.vy
    p.vz = msg.vz
    p.yaw = msg.yaw
    p.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, msg.pitch))
    p.sneaking = !!msg.sneak
    p.sprinting = !!msg.sprint
    p.shield = !!msg.shield && this.held(p)?.kind === 'shield'
    // Fall damage is judged here from positions, not taken from the client.
    p.onGround = groundBelow(this.world, p.x, p.y, p.z, p.sneaking)
    if (p.onGround) {
      if (p.fallDistance > SAFE_FALL) this.hurt(p, Math.ceil(p.fallDistance - SAFE_FALL), 'fall')
      p.fallDistance = 0
    } else if (dy < 0) p.fallDistance -= dy
  }

  private onDig(p: Player, target: [number, number, number] | null): void {
    if (!target) {
      p.dig = null
      return
    }
    if (!this.canAct(p) || !Array.isArray(target) || !target.every(Number.isInteger)) return
    const [x, y, z] = target
    if (this.eyeDistance(p, x + 0.5, y + 0.5, z + 0.5) > BLOCK_REACH + REACH_SLACK + 0.9) return
    if (checkBreak(this.world, this.map.build, x, y, z, this.rules.mode === 'sandbox' && p.team === 'red' ? 'red' : p.team)) {
      this.pendingBlocks.push([x, y, z, this.world.raw(x, y, z)])
      return
    }
    p.lastSwing = this.tickCount
    p.dig = { x, y, z, progress: 0 }
    this.stepDig(p)
  }

  /**
   * The client finished breaking a block on its own clock and already shows it gone. Its timer
   * started half a round trip before ours, and its message took the other half, so ours should
   * be about done too: accept within DIG_GRACE_TICKS, else put the block back on that client.
   */
  private onDigDone(p: Player, target: [number, number, number] | null): void {
    if (!Array.isArray(target) || !target.every(Number.isInteger)) return
    const [x, y, z] = target
    const d = p.dig
    if (this.world.get(x, y, z) === AIR) return
    if (d && d.x === x && d.y === y && d.z === z && this.canAct(p)) {
      const ticks = breakTicks(this.world.get(x, y, z), this.held(p))
      if ((1 - d.progress) * ticks <= DIG_GRACE_TICKS) {
        p.dig = null
        this.breakBlock(p, x, y, z)
        return
      }
    }
    this.send(p, { t: 'blocks', changes: [[x, y, z, this.world.raw(x, y, z)]] })
  }

  private stepDig(p: Player): void {
    const d = p.dig
    if (!d) return
    if (!this.canAct(p) || this.eyeDistance(p, d.x + 0.5, d.y + 0.5, d.z + 0.5) > BLOCK_REACH + REACH_SLACK + 0.9) {
      p.dig = null
      return
    }
    const id = this.world.get(d.x, d.y, d.z)
    if (id === AIR) {
      p.dig = null
      return
    }
    const ticks = breakTicks(id, this.held(p))
    d.progress += ticks === 0 ? 1 : 1 / ticks
    if (d.progress >= 1 - 1e-9) {
      p.dig = null
      this.breakBlock(p, d.x, d.y, d.z)
    }
  }

  breakBlock(p: Player, x: number, y: number, z: number): void {
    const id = this.world.get(x, y, z)
    const team = blockTeam(id)
    if (isBed(id) && team) {
      const partner = bedPartner(this.world, x, y, z)
      this.world.set(x, y, z, AIR)
      if (partner) this.world.set(partner[0], partner[1], partner[2], AIR)
      this.onBedBroken(team, p)
      return
    }
    this.world.set(x, y, z, AIR)
  }

  private onPlace(p: Player, msg: Extract<ClientMessage, { t: 'place' }>): void {
    if (![msg.x, msg.y, msg.z, msg.slot].every(Number.isInteger) || !Array.isArray(msg.face)) return
    const [fx, fy, fz] = msg.face
    if (Math.abs(fx) + Math.abs(fy) + Math.abs(fz) !== 1) return
    const x = msg.x + fx
    const y = msg.y + fy
    const z = msg.z + fz
    const refuse = (why: string) => {
      this.pendingBlocks.push([x, y, z, this.world.raw(x, y, z)])
      if (why) this.event(p, 'error', why)
    }
    if (!this.canAct(p) || msg.slot < 0 || msg.slot >= HOTBAR) return refuse('')
    const slot = p.inventory[msg.slot]
    const def = item(slot?.id)
    if (def?.kind === 'tnt') {
      if (this.world.get(msg.x, msg.y, msg.z) === AIR || !this.arsenal.placeTnt(p, x, y, z, msg.slot)) refuse('')
      return
    }
    const block = def?.kind === 'block' && p.team ? placedBlock(def, p.team) : undefined
    if (block === undefined) return refuse('')
    if (this.world.get(msg.x, msg.y, msg.z) === AIR) return refuse('')
    if (this.eyeDistance(p, x + 0.5, y + 0.5, z + 0.5) > BLOCK_REACH + REACH_SLACK + 0.9) return refuse('')
    // The placer's own body is left out: the client checked it where it really is, while the
    // server's copy trails by the network delay, which refused blocks while pillaring and bridging.
    const bodies = [...this.players.values()].filter((q) => q.alive && q !== p).map((q) => playerBox(q.x, q.y, q.z, q.sneaking))
    const why = checkPlace(this.world, this.map.build, x, y, z, bodies)
    if (why) return refuse(why === 'protected' ? 'You cannot build here.' : why === 'height' ? 'Build height limit reached.' : '')
    this.world.set(x, y, z, block, true)
    removeFromSlot(p.inventory, msg.slot)
    p.lastSwing = this.tickCount
  }

  private onAttack(p: Player, targetId: number, seen?: number): void {
    const v = this.players.get(targetId)
    if (!v || v === p || !this.canAct(p) || !v.alive) return
    if (this.tickCount - p.lastAttackTick < 2) return
    p.lastAttackTick = this.tickCount
    p.lastSwing = this.tickCount
    if (p.team && v.team === p.team) return
    const eye = this.eye(p)
    // Judge reach and sight against where the target was when the attacker saw it.
    const at = rewindTick(this.tickCount, seen)
    const then = at >= this.tickCount ? v : (this.history.at(v.id, at) ?? v)
    if (reachDistance(eye, then.x, then.y, then.z, then.sneaking) > ATTACK_REACH + REACH_SLACK) return
    const center = [then.x, then.y + 0.9, then.z]
    const toward = [center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]]
    const dist = Math.hypot(...toward)
    const block = raycastBlock(this.world, eye, toward.map((c) => c / dist), dist, true)
    if (block && block.distance < dist - 0.6) return
    p.protectedTicks = 0
    if (!canBeHurt(v)) return
    if (v.shield && shieldBlocks(v, p)) {
      this.applyKnockback(v, knockback(v, p, false, true))
      v.hurtTicks = HURT_TICKS
      return
    }
    const upgrades = (t: TeamId | null) => (t ? this.teams.get(t)?.upgrades : undefined) ?? NO_UPGRADES
    let damage = weaponDamage(this.held(p), upgrades(p.team).sharpness)
    if (!p.onGround && p.vy < 0) damage *= CRIT_MULTIPLIER
    damage *= 1 - armorReduction(v.armor, upgrades(v.team).protection)
    v.lastAttacker = { id: p.id, tick: this.tickCount }
    this.applyKnockback(v, knockback(v, p, p.sprinting, false))
    p.sprinting = false
    this.hurt(v, damage, 'melee', p)
  }

  applyKnockback(v: Player, vel: { vx: number; vy: number; vz: number }): void {
    v.vx = vel.vx
    v.vy = vel.vy
    v.vz = vel.vz
    v.onGround = false
    v.kbGrace = 30
    this.send(v, { t: 'velocity', ...vel })
  }

  private onUse(p: Player): void {
    if (!this.canAct(p)) return
    if (this.arsenal.drink(p)) return
    const slot = p.inventory[p.selected]
    if (slot?.id !== 'golden_apple' || this.tickCount - p.lastEatTick < TPS / 2) return
    p.lastEatTick = this.tickCount
    removeFromSlot(p.inventory, p.selected)
    p.health = Math.min(MAX_HEALTH, p.health + 8)
  }

  // Shop -------------------------------------------------------------------

  private nearNpc(p: Player, kind: 'shop' | 'upgrades'): boolean {
    return this.map.npcs.some((n) => n.kind === kind && Math.hypot(n.x - p.x, n.z - p.z) < 5 && Math.abs(n.y - p.y) < 3)
  }

  onBuy(p: Player, offerId: string): void {
    const offer = OFFERS.find((o) => o.id === offerId)
    if (!offer || !this.canAct(p)) return
    if (!this.nearNpc(p, 'shop')) return this.event(p, 'error', 'Walk up to your shopkeeper to buy.')
    let cost = offer.cost
    const give = offer.give
    if (give.kind === 'pickaxe' || give.kind === 'axe') {
      const tier = give.kind === 'pickaxe' ? p.pickaxeTier : p.axeTier
      if (tier >= 3) return this.event(p, 'error', 'Already at the best tier.')
      cost = TOOL_TIER_COST[tier + 1]
    }
    if (give.kind === 'armor' && ARMOR_ORDER.indexOf(give.tier) <= ARMOR_ORDER.indexOf(p.armor)) return this.event(p, 'error', 'You already have that armour or better.')
    if (give.kind === 'shears' && p.shears) return this.event(p, 'error', 'You already have shears.')
    if (give.kind === 'item' && !canFit(p.inventory, give.item, give.count)) return this.event(p, 'error', 'Your inventory is full.')
    for (const c of cost) if (countItem(p.inventory, c.resource) < c.amount) return this.event(p, 'error', `You need ${c.amount} ${c.resource}.`)
    for (const c of cost) removeItem(p.inventory, c.resource, c.amount)

    switch (give.kind) {
      case 'item':
        addItem(p.inventory, give.item, give.count)
        break
      case 'sword':
        if (countItem(p.inventory, 'wood_sword') > 0) replaceItem(p.inventory, (id) => id === 'wood_sword', give.item)
        else addItem(p.inventory, give.item, 1)
        break
      case 'armor':
        p.armor = give.tier
        break
      case 'shears':
        p.shears = true
        addItem(p.inventory, 'shears', 1)
        break
      case 'pickaxe':
        p.pickaxeTier++
        replaceItem(p.inventory, (id) => PICKAXES.includes(id), PICKAXES[p.pickaxeTier])
        break
      case 'axe':
        p.axeTier++
        replaceItem(p.inventory, (id) => AXES.includes(id), AXES[p.axeTier])
        break
    }
  }

  onUpgrade(p: Player, id: UpgradeId): void {
    const def = UPGRADES.find((u) => u.id === id)
    const team = p.team ? this.teams.get(p.team) : undefined
    if (!def || !team || !this.canAct(p)) return
    if (!this.nearNpc(p, 'upgrades')) return this.event(p, 'error', 'Walk up to your upgrades keeper.')
    const level = team.upgrades[id]
    if (level >= def.levels.length) return this.event(p, 'error', 'Already at the highest level.')
    const cost = def.levels[level]
    if (!removeItem(p.inventory, 'diamond', cost)) return this.event(p, 'error', `You need ${cost} diamonds.`)
    team.upgrades[id] = level + 1
    for (const q of this.players.values())
      if (q.team === team.team) this.event(q, 'system', `${p.name} bought ${def.name}${def.levels.length > 1 ? ` ${level + 1}` : ''}`)
  }

  private onTeam(p: Player, team: TeamId): void {
    if (this.phase !== 'waiting' && this.phase !== 'countdown') return
    if (!this.rules.teams.includes(team)) return
    const count = [...this.players.values()].filter((q) => q.team === team && q !== p).length
    if (count >= this.rules.teamSize) return this.event(p, 'error', `${TEAM_NAMES[team]} is full.`)
    p.team = team
  }

  private onChat(p: Player, text: string): void {
    text = text.trim()
    if (!text) return
    if (text.startsWith('/')) return this.command(p, text.slice(1).split(/\s+/))
    // During a round, chat goes to your team; start with ! to shout to everyone.
    const shout = text.startsWith('!')
    if (shout) text = text.slice(1).trim()
    if (!text) return
    if (this.phase === 'playing' && this.rules.mode === 'arena' && p.team && !shout) {
      for (const q of this.players.values()) if (q.team === p.team) this.send(q, { t: 'event', kind: 'chat', text: `[Team] ${p.name}: ${text}`, team: p.team })
      return
    }
    this.broadcast({ t: 'event', kind: 'chat', text: `${p.name}: ${text}`, team: p.team ?? undefined })
  }

  private command(p: Player, [name, ...args]: string[]): void {
    if (name === 'help') return this.event(p, 'system', this.rules.cheats ? 'Commands: /give <item> [count], /tp <x> <y> <z>, /heal, /kit, /kill, /bot [n] [easy|normal|hard|expert], /nobots, /start' : 'Commands: /start (host)')
    if (name === 'start') return void (p.id === this.hostId && this.phase === 'waiting' && this.beginCountdown(true))
    if (!this.rules.cheats) return this.event(p, 'error', 'Commands are off in this room.')
    switch (name) {
      case 'give': {
        const id = args[0]
        if (!item(id)) return this.event(p, 'error', `No item "${id}".`)
        addItem(p.inventory, id, Math.max(1, Math.min(640, Number(args[1]) || 1)))
        return
      }
      case 'tp': {
        const [x, y, z] = args.map(Number)
        if ([x, y, z].every(Number.isFinite)) this.teleport(p, x, y, z, p.yaw, p.pitch)
        return
      }
      case 'heal':
        p.health = MAX_HEALTH
        return
      case 'kit':
        this.giveKit(p)
        return
      case 'kill':
        return this.die(p, 'void')
      case 'bot': {
        // Sandbox sparring: bots that come for you and fight, on the other team.
        // `/bot 2 hard`: a count and a level, either optional, in any order.
        const n = Math.max(1, Math.min(4, Number(args.find((a) => Number(a) > 0)) || 1))
        const level = BOT_LEVELS.find((l) => args.includes(l)) ?? this.botLevel
        for (let i = 0; i < n; i++) {
          if (!this.createBot) return this.event(p, 'error', 'Bots are not available in this room.')
          const taken = new Set([...this.players.values()].map((q) => q.name))
          const team: TeamId = p.team === 'blue' ? 'red' : 'blue'
          const bot = this.connect(botName(this.random, taken), null, this.createBot(this, team, true, level))
          bot.team = team
          this.spawn(bot)
          this.teleport(bot, p.x + 6 + i, p.y, p.z, p.yaw + Math.PI, 0)
        }
        return this.event(p, 'system', `${n} ${level} sparring bot${n === 1 ? '' : 's'} on their way. /kill them with your sword, or /nobots.`)
      }
      case 'nobots':
        for (const q of [...this.players.values()]) if (q.brain && !q.home) this.disconnect(q.id)
        return
      default:
        this.event(p, 'error', `Unknown command /${name}`)
    }
  }

  // Health and death -------------------------------------------------------

  hurt(p: Player, amount: number, cause: DamageCause, attacker?: Player): void {
    if (!p.alive || amount <= 0 || this.phase === 'waiting' || this.phase === 'countdown') return
    if (p.protectedTicks > 0) return
    if (cause !== 'fall') p.hurtTicks = HURT_TICKS
    p.lastHurtTick = this.tickCount
    p.health -= amount
    if (p.health <= 0.0001) this.die(p, cause, attacker)
  }

  die(p: Player, cause: DamageCause | 'void', attacker?: Player): void {
    if (!p.alive) return
    if (!attacker && p.lastAttacker && this.tickCount - p.lastAttacker.tick <= KILL_CREDIT_TICKS) attacker = this.players.get(p.lastAttacker.id)
    if (attacker === p) attacker = undefined
    p.alive = false
    p.dig = null
    p.shield = false
    p.drawStart = null
    p.effects = { speed: 0, jump: 0, invisible: 0 }
    p.health = 0
    p.stats.deaths++

    const team = p.team ? this.teams.get(p.team) : undefined
    const final = this.rules.mode === 'arena' && (!team || !team.bed)
    // The killer collects the victim's resources; everything else is lost.
    for (const r of RESOURCES) {
      const n = countItem(p.inventory, r)
      if (n > 0 && attacker?.alive) addItem(attacker.inventory, r, n)
    }
    p.inventory = emptyInventory()
    p.pickaxeTier = p.pickaxeTier > 0 ? p.pickaxeTier - 1 : p.pickaxeTier
    p.axeTier = p.axeTier > 0 ? p.axeTier - 1 : p.axeTier

    // The killer's chosen kill effect plays where the victim fell.
    const effect = attacker ? decodeLook(attacker.look).killEffect : 0
    if (attacker && effect > 0) this.broadcast({ t: 'effect', effect, x: p.x, y: p.y, z: p.z })
    if (attacker) {
      attacker.stats.kills++
      if (final) attacker.stats.finals++
    }
    const a = attacker?.name
    const text =
      cause === 'void'
        ? a ? `${p.name} was knocked into the void by ${a}` : `${p.name} fell into the void`
        : cause === 'fall'
          ? a ? `${p.name} was knocked off a ledge by ${a}` : `${p.name} hit the ground too hard`
          : cause === 'arrow'
            ? `${p.name} was shot by ${a ?? 'someone'}`
            : cause === 'explosion'
              ? a ? `${p.name} was blown up by ${a}` : `${p.name} blew up`
              : `${p.name} was slain by ${a ?? 'someone'}`
    this.broadcast({ t: 'event', kind: 'kill', text: final ? `${text}. Final kill!` : text, team: p.team ?? undefined })

    if (final) {
      p.eliminated = true
      p.respawnAt = null
      this.event(p, 'title', 'You died', 'Your bed is gone, so you are spectating.')
      this.checkEliminations()
    } else {
      p.respawnAt = this.tickCount + (p.home ? TPS : this.rules.respawnTicks)
      this.event(p, 'title', 'You died', `Respawning in ${Math.round(this.rules.respawnTicks / TPS)} seconds`)
    }
  }

  private spawn(p: Player): void {
    const base = this.map.bases.find((b) => b.team === p.team) ?? this.map.bases[0]
    const [x, y, z, yaw] = p.home ?? base.spawn
    p.alive = true
    p.eliminated = false
    p.respawnAt = null
    p.health = MAX_HEALTH
    p.vx = p.vy = p.vz = 0
    p.fallDistance = 0
    p.hurtTicks = 0
    p.lastAttacker = null
    p.protectedTicks = p.home ? 0 : SPAWN_PROTECTION_TICKS
    p.dig = null
    this.giveKit(p)
    this.teleport(p, x, y, z, yaw, 0)
  }

  private giveKit(p: Player): void {
    if (p.home) return
    if (countItem(p.inventory, 'wood_sword') === 0 && !p.inventory.some((s) => s && item(s.id)?.kind === 'sword')) addItem(p.inventory, 'wood_sword', 1)
    if (p.pickaxeTier >= 0 && !p.inventory.some((s) => s && PICKAXES.includes(s.id))) addItem(p.inventory, PICKAXES[p.pickaxeTier], 1)
    if (p.axeTier >= 0 && !p.inventory.some((s) => s && AXES.includes(s.id))) addItem(p.inventory, AXES[p.axeTier], 1)
    if (p.shears && countItem(p.inventory, 'shears') === 0) addItem(p.inventory, 'shears', 1)
    if (this.rules.mode === 'sandbox') {
      for (const [id, n] of [
        ['wool', 64], ['bow', 1], ['fireball', 4], ['tnt', 4], ['pearl', 2], ['bridge_egg', 4], ['wood_pickaxe', 1], ['shears', 1],
        ['clay', 32], ['wood_axe', 1], ['shield', 1], ['golden_apple', 4], ['arrow', 32], ['speed_potion', 1], ['jump_potion', 1], ['invisibility_potion', 1],
        ['iron', 64], ['gold', 32], ['diamond', 16], ['emerald', 8],
      ] as const)
        if (countItem(p.inventory, id) < (n > 1 ? n / 2 : 1)) addItem(p.inventory, id, n - countItem(p.inventory, id))
      p.shears = true
    }
  }

  teleport(p: Player, x: number, y: number, z: number, yaw: number, pitch: number): void {
    p.x = x
    p.y = y
    p.z = z
    p.yaw = yaw
    p.pitch = pitch
    p.vx = p.vy = p.vz = 0
    p.fallDistance = 0
    p.tp++
    p.lastSeq = null
    this.send(p, { t: 'teleport', x, y, z, yaw, pitch, tp: p.tp })
  }

  private toLobby(p: Player): void {
    const lobby = this.map.lobby
    p.alive = true
    p.eliminated = false
    p.respawnAt = null
    p.health = MAX_HEALTH
    p.inventory = emptyInventory()
    p.armor = 'leather'
    p.pickaxeTier = p.axeTier = -1
    p.shears = false
    if (lobby) this.teleport(p, ...lobby.spawn, 0)
  }

  // Beds and teams ---------------------------------------------------------

  private onBedBroken(team: TeamId, by: Player): void {
    const state = this.teams.get(team)
    if (!state) return
    state.bed = false
    by.stats.beds++
    this.broadcast({ t: 'event', kind: 'bed', text: `${TEAM_NAMES[team]} bed was destroyed by ${by.name}!`, team })
    for (const q of this.players.values())
      if (q.team === team) this.event(q, 'title', 'Bed destroyed', 'You will no longer respawn')
      else if (!q.brain) this.event(q, 'title', `${TEAM_NAMES[team]} bed destroyed`, `by ${by.name}`)
    if (this.rules.mode === 'sandbox') this.bedRegenAt = this.tickCount + 10 * TPS
  }

  private checkEliminations(): void {
    if (this.rules.mode !== 'arena' || this.phase !== 'playing') return
    for (const state of this.teams.values()) {
      if (state.eliminated) continue
      const members = [...this.players.values()].filter((p) => p.team === state.team)
      if (members.every((p) => p.eliminated)) {
        state.eliminated = true
        this.broadcastEvent('system', `${TEAM_NAMES[state.team]} team has been eliminated!`)
      }
    }
    const standing = [...this.teams.values()].filter((t) => !t.eliminated)
    if (standing.length <= 1) this.endRound(standing[0]?.team ?? 'draw')
  }

  // Round flow ---------------------------------------------------------------

  private beginCountdown(forced: boolean): void {
    if (this.phase !== 'waiting') return
    if (!forced && this.humans().length < this.rules.minPlayers) return
    this.phase = 'countdown'
    this.phaseStart = this.tickCount
  }

  votesMessage(): ServerMessage {
    const count = (id: string) => [...this.votes.values()].filter((v) => v === id).length
    return { t: 'votes', maps: this.rules.maps.map((id) => ({ id, name: arenaLayout(id).name, votes: count(id) })), current: this.mapId }
  }

  /** The most-voted layout; ties keep the current one, then the first listed. */
  private votedMap(): string {
    const count = (id: string) => [...this.votes.values()].filter((v) => v === id).length
    const best = Math.max(0, ...this.rules.maps.map(count))
    if (best === 0 || count(this.mapId) === best) return this.mapId
    return this.rules.maps.find((id) => count(id) === best) ?? this.mapId
  }

  startRound(): void {
    const chosen = this.votedMap()
    if (chosen !== this.mapId) {
      // Load the winning arena; everyone is still on the (identical) lobby deck above it.
      this.mapId = chosen
      this.resetWorld()
      const world = toBase64(this.world.encode())
      for (const p of this.players.values()) {
        this.send(p, { t: 'world', world, map: this.meta() })
        if (!p.brain) this.toLobby(p)
      }
    }
    const lobby = this.map.lobby
    if (lobby) {
      const [x0, y0, z0, x1, y1, z1] = lobby.box
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.world.set(x, y, z, AIR)
    }
    const members = (team: TeamId) => [...this.players.values()].filter((p) => p.team === team).length
    for (const p of this.humans()) {
      if (p.team) continue
      const open = this.rules.teams.filter((t) => members(t) < this.rules.teamSize)
      if (open.length === 0) {
        p.eliminated = true
        p.alive = false
        continue
      }
      open.sort((a, b) => members(a) - members(b))
      p.team = open[0]
    }
    if (this.botsEnabled && this.createBot)
      for (const team of this.rules.teams)
        while (members(team) < this.rules.teamSize) {
          const taken = new Set([...this.players.values()].map((q) => q.name))
          const bot = this.connect(botName(this.random, taken), null, this.createBot(this, team))
          bot.team = team
        }

    for (const state of this.teams.values()) {
      if (members(state.team) > 0) continue
      state.eliminated = true
      this.removeBed(state)
    }
    this.phase = 'playing'
    this.phaseStart = this.tickCount
    this.timelineIndex = 0
    for (const g of this.generators) g.next = this.tickCount + 20
    for (const p of this.players.values()) if (p.team) this.spawn(p)
    this.broadcastEvent('title', 'Protect your bed', 'Destroy enemy beds and be the last team standing')
    this.checkEliminations()
  }

  private removeBed(state: TeamState): void {
    state.bed = false
    const b = this.map.bases.find((x) => x.team === state.team)?.bed
    if (b && this.world.get(b.x, b.y, b.z) === BED[state.team]) {
      this.world.set(b.x, b.y, b.z, AIR)
      this.world.set(b.x + b.dx, b.y, b.z + b.dz, AIR)
    }
  }

  private endRound(winner: TeamId | 'draw'): void {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    this.phaseStart = this.tickCount
    this.winner = winner
    this.broadcastEvent('title', winner === 'draw' ? 'Draw' : `${TEAM_NAMES[winner]} wins!`, 'Back to the lobby shortly')
    const players = [...this.players.values()]
      .filter((p) => p.team)
      .map((p) => ({ id: p.id, name: p.name, team: p.team as TeamId, bot: !!p.brain, ...p.stats }))
      .sort((a, b) => b.finals - a.finals || b.kills - a.kills || b.beds - a.beds)
    this.broadcast({ t: 'summary', winner, players, lobbyIn: this.rules.endTicks })
  }

  private resetToLobby(): void {
    for (const p of [...this.players.values()]) if (p.brain) this.players.delete(p.id)
    this.resetWorld()
    this.phase = 'waiting'
    this.winner = null
    this.votes.clear()
    this.broadcast(this.votesMessage())
    const world = toBase64(this.world.encode())
    for (const p of this.players.values()) {
      p.team = null
      p.stats = { kills: 0, finals: 0, beds: 0, deaths: 0 }
      this.send(p, { t: 'world', world, map: this.meta() })
      this.toLobby(p)
    }
  }

  private resetWorld(): void {
    this.unsubscribeWorld?.()
    this.map = this.createMap()
    this.unsubscribeWorld = this.world.onChange((x, y, z) => this.pendingBlocks.push([x, y, z, this.world.raw(x, y, z)]))
    this.pendingBlocks = []
    this.drops = []
    this.arsenal?.reset()
    this.diamondTier = this.emeraldTier = 0
    this.teams = new Map(this.rules.teams.map((team) => [team, { team, bed: true, upgrades: { ...NO_UPGRADES }, eliminated: false }]))
    this.generators = this.map.generators.map((g) => ({ kind: g.kind, team: g.team, pos: [...g.pos], next: this.tickCount + 20 }))
    if (this.rules.mode === 'sandbox') {
      for (const n of this.map.npcs) {
        if (n.kind !== 'dummy') continue
        const shield = this.map.npcs.filter((m) => m.kind === 'dummy').indexOf(n) === 1
        const brain: Brain = { think: (room, p) => this.createDummy?.(room, shield).think(room, p) ?? { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: p.yaw, pitch: 0, shield } }
        const d = this.connect(shield ? 'Shield dummy' : 'Dummy', null, brain)
        d.team = n.team ?? 'blue'
        d.home = [n.x, n.y, n.z, n.yaw]
        if (shield) addItem(d.inventory, 'shield', 1)
        this.spawn(d)
      }
    }
  }

  // Tick -------------------------------------------------------------------

  tick(): void {
    this.tickCount++
    for (const p of this.players.values()) if (p.alive) this.history.record(p.id, this.tickCount, p)
    for (const p of this.players.values()) this.stepPlayer(p)
    if (this.phase === 'playing') this.arsenal.step()
    this.stepGenerators()
    this.stepDrops()
    this.stepPhase()
    this.flush()
  }

  private stepPlayer(p: Player): void {
    p.inputBudget = Math.min(INPUT_BUDGET, p.inputBudget + 1)
    if (p.kbGrace > 0) p.kbGrace--
    if (!p.alive) {
      if (p.respawnAt !== null && this.tickCount >= p.respawnAt) this.spawn(p)
      return
    }
    if (p.hurtTicks > 0) p.hurtTicks--
    if (p.protectedTicks > 0) p.protectedTicks--

    if (p.brain) {
      const input = p.brain.think(this, p)
      p.shield = !!input.shield && this.held(p)?.kind === 'shield'
      const r = stepMovement(this.world, p, input)
      if (r.fallDamage > 0) this.hurt(p, r.fallDamage, 'fall')
      if (!p.alive) return
    }
    this.stepDig(p)

    if (p.y < this.map.killY) {
      if (this.phase === 'waiting' || this.phase === 'countdown') return this.toLobby(p)
      return this.die(p, 'void')
    }

    // Natural regeneration, faster in the heal pool.
    if (p.health < MAX_HEALTH && this.tickCount - p.lastHurtTick > REGEN_DELAY) {
      const base = this.map.bases.find((b) => b.team === p.team)
      const pool = !!(p.team && this.teams.get(p.team)?.upgrades.healPool && base && Math.hypot(p.x - base.center[0], p.z - base.center[2]) < BASE_RADIUS)
      if (this.tickCount % (pool ? HEAL_POOL_INTERVAL : REGEN_INTERVAL) === 0) p.health = Math.min(MAX_HEALTH, p.health + 1)
    }
  }

  private stepGenerators(): void {
    if (this.phase !== 'playing') return
    for (const [index, g] of this.generators.entries()) {
      if (this.tickCount < g.next) continue
      const forge = g.team ? (this.teams.get(g.team)?.upgrades.forge ?? 0) : 0
      const interval =
        g.kind === 'diamond' ? GENERATOR_INTERVAL.diamond[this.diamondTier] : g.kind === 'emerald' ? GENERATOR_INTERVAL.emerald[this.emeraldTier] : GENERATOR_INTERVAL[g.kind][forge]
      g.next = this.tickCount + interval
      if (g.team && this.teams.get(g.team)?.eliminated && this.rules.mode === 'arena') continue
      this.spawnDrop(index, g.kind, g.pos)
      // Forge level 3 and up also makes emeralds, on the iron generator's schedule.
      if (g.kind === 'iron' && forge >= 3 && this.tickCount % FORGE_EMERALD_INTERVAL[forge] < interval) this.spawnDrop(index, 'emerald', g.pos)
    }
  }

  private spawnDrop(source: number, kind: string, pos: [number, number, number]): void {
    const pile = this.drops.find((d) => d.source === source && d.item === kind)
    const cap = GENERATOR_CAP[kind as GeneratorKind] ?? 64
    if (pile) {
      if (pile.count < cap) pile.count++
      return
    }
    this.drops.push({ id: this.nextDropId++, item: kind, count: 1, x: pos[0], y: pos[1] + 0.3, z: pos[2], vx: 0, vy: 0, vz: 0, source })
  }

  /** Throws the held item (one, or the stack) where the player is looking. */
  private onDrop(p: Player, all: boolean): void {
    if (!p.alive || p.home || !p.team) return
    const slot = p.inventory[p.selected]
    if (!slot) return
    const count = all ? slot.count : 1
    const id = slot.id
    removeFromSlot(p.inventory, p.selected, count)
    const [dx, dy, dz] = lookDirection(p.yaw, p.pitch)
    this.drops.push({
      id: this.nextDropId++,
      item: id,
      count,
      x: p.x + dx * 0.3,
      y: p.y + 1.3,
      z: p.z + dz * 0.3,
      vx: dx * 0.32,
      vy: dy * 0.32 + 0.12,
      vz: dz * 0.32,
      source: -1,
      pickupAt: this.tickCount + THROWN_PICKUP_DELAY,
      expires: this.tickCount + THROWN_LIFETIME,
    })
    const thrown = this.drops.filter((d) => d.source === -1)
    if (thrown.length > MAX_THROWN) this.drops.splice(this.drops.indexOf(thrown[0]), 1)
  }

  private stepDrops(): void {
    for (const d of this.drops) stepDrop(this.world, d, DROP_GRAVITY)
    this.drops = this.drops.filter((d) => {
      if (d.y < this.map.killY) return false
      if (d.expires !== undefined && this.tickCount >= d.expires) return false
      if (d.pickupAt !== undefined && this.tickCount < d.pickupAt) return true
      for (const p of this.players.values()) {
        if (!p.alive || p.home || !p.team) continue
        if (Math.hypot(p.x - d.x, p.y + 0.9 - d.y, p.z - d.z) > PICKUP_RADIUS) continue
        d.count = addItem(p.inventory, d.item, d.count)
        if (d.count === 0) return false
      }
      return true
    })
  }

  private stepPhase(): void {
    const elapsed = this.tickCount - this.phaseStart
    if (this.bedRegenAt !== null && this.tickCount >= this.bedRegenAt) {
      this.bedRegenAt = null
      for (const base of this.map.bases) {
        const state = this.teams.get(base.team)
        if (state && !state.bed) {
          placeBed(this.world, base.team, base.bed.x, base.bed.y, base.bed.z, base.bed.dx, base.bed.dz)
          state.bed = true
        }
      }
    }
    switch (this.phase) {
      case 'waiting':
        this.beginCountdown(false)
        return
      case 'countdown':
        if (this.humans().length === 0) {
          this.phase = 'waiting'
          return
        }
        if (elapsed >= this.rules.countdownTicks) this.startRound()
        return
      case 'playing': {
        if (this.rules.mode !== 'arena') return
        const event = this.rules.timeline[this.timelineIndex]
        if (!event || elapsed < event.at) return
        this.timelineIndex++
        this.runTimeline(event.kind, event.label)
        return
      }
      case 'ended':
        if (elapsed >= this.rules.endTicks) this.resetToLobby()
        return
    }
  }

  private runTimeline(kind: string, label: string): void {
    switch (kind) {
      case 'diamond-2':
      case 'diamond-3':
        this.diamondTier = kind === 'diamond-2' ? 1 : 2
        break
      case 'emerald-2':
      case 'emerald-3':
        this.emeraldTier = kind === 'emerald-2' ? 1 : 2
        break
      case 'beds-gone':
        for (const state of this.teams.values()) if (state.bed) this.removeBed(state)
        this.broadcastEvent('title', 'All beds destroyed', 'Nobody respawns from now on')
        return
      case 'game-end': {
        const standing = [...this.teams.values()].filter((t) => !t.eliminated)
        const alive = (t: TeamId) => [...this.players.values()].filter((p) => p.team === t && !p.eliminated).length
        standing.sort((a, b) => alive(b.team) - alive(a.team))
        const winner = standing.length === 1 || (standing.length > 1 && alive(standing[0].team) > alive(standing[1].team)) ? standing[0].team : 'draw'
        this.endRound(winner)
        return
      }
    }
    this.broadcastEvent('system', `${label} generators`)
  }

  // Output -----------------------------------------------------------------

  private flush(): void {
    if (this.pendingBlocks.length) {
      this.broadcast({ t: 'blocks', changes: this.pendingBlocks })
      this.pendingBlocks = []
    }
    const projectiles = this.arsenal.views()
    if (projectiles) this.broadcast({ t: 'projectiles', list: projectiles })
    // Generator countdowns for the floating displays, once a second while playing.
    if (this.phase === 'playing' && this.tickCount % TPS === 0) {
      const list: [number, number, number][] = []
      this.generators.forEach((g, i) => {
        if (g.kind === 'diamond' || g.kind === 'emerald') list.push([i, Math.max(0, g.next - this.tickCount), (g.kind === 'diamond' ? this.diamondTier : this.emeraldTier) + 1])
      })
      if (list.length) this.broadcast({ t: 'gens', list })
    }
    // Deltas against what was last broadcast, so idle players and settled
    // drops cost nothing. Everyone shares one stream; joiners get a keyframe.
    const deltas: PlayerDelta[] = []
    const seen = new Set<number>()
    for (const p of this.players.values()) {
      const view = this.playerView(p)
      seen.add(p.id)
      const prev = this.sent.players.get(p.id)
      this.sent.players.set(p.id, view)
      if (!prev) {
        deltas.push(view)
        continue
      }
      const delta: PlayerDelta = { id: p.id }
      let changed = false
      for (const k of Object.keys(view) as (keyof PlayerView)[]) {
        if (JSON.stringify(view[k]) === JSON.stringify(prev[k])) continue
        ;(delta as Record<string, unknown>)[k] = view[k]
        changed = true
      }
      if (changed) deltas.push(delta)
    }
    const gone = [...this.sent.players.keys()].filter((id) => !seen.has(id))
    for (const id of gone) this.sent.players.delete(id)
    const drops: DropView[] = this.drops.map((d) => ({ id: d.id, item: d.item, count: d.count, x: round(d.x), y: round(d.y), z: round(d.z) }))
    const dropsJson = JSON.stringify(drops)
    const game = this.gameView()
    // The clock is extrapolated by clients; resend the game view when anything else moves, or once a second.
    const gameJson = JSON.stringify({ ...game, clock: 0, clockTick: 0, next: game.next?.label })
    const msg: Extract<ServerMessage, { t: 'tick' }> = { t: 'tick', tick: this.tickCount, players: deltas }
    if (gone.length) msg.gone = gone
    if (dropsJson !== this.sent.drops) msg.drops = drops
    if (gameJson !== this.sent.game || this.tickCount % TPS === 0) msg.game = game
    this.sent.drops = dropsJson
    this.sent.game = gameJson
    this.sent.full = { t: 'tick', tick: this.tickCount, players: [...this.sent.players.values()], drops, game }
    // Nothing changed: skip the message, but keep a heartbeat so clients' clocks advance.
    const empty = deltas.length === 0 && !msg.gone && !msg.drops && !msg.game
    if (!empty || this.tickCount % 4 === 0) this.broadcast(msg)
    for (const p of this.players.values()) {
      if (!p.sink) continue
      const self = this.selfView(p)
      const json = JSON.stringify(self)
      if (json !== p.lastSelf) {
        p.lastSelf = json
        p.sink({ t: 'self', self })
      }
    }
  }

  playerView(p: Player): PlayerView {
    const held = p.inventory[p.selected]
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      bot: !!p.brain,
      x: round(p.x, 100),
      y: round(p.y, 100),
      z: round(p.z, 100),
      yaw: round(p.yaw, 100),
      pitch: round(p.pitch, 100),
      sneak: p.sneaking,
      health: Math.ceil(p.health),
      armor: p.armor,
      held: held?.id ?? null,
      alive: p.alive,
      shield: p.shield,
      hurtAt: p.lastHurtTick,
      swingAt: p.lastSwing,
      dig: p.dig ? [p.dig.x, p.dig.y, p.dig.z, Math.round(p.dig.progress * 20) / 20] : null,
      invisible: p.effects.invisible > this.tickCount,
      look: p.look,
    }
  }

  gameView(): GameView {
    const elapsed = this.tickCount - this.phaseStart
    const next = this.phase === 'playing' ? this.rules.timeline[this.timelineIndex] : undefined
    return {
      phase: this.phase,
      mode: this.rules.mode,
      clock: this.phase === 'countdown' ? Math.max(0, this.rules.countdownTicks - elapsed) : elapsed,
      clockTick: this.tickCount,
      next: next ? { label: next.label, in: next.at - elapsed } : null,
      teams: [...this.teams.values()].map((t) => {
        const members = [...this.players.values()].filter((p) => p.team === t.team)
        return { team: t.team, bed: t.bed, players: members.length, alive: members.filter((p) => !p.eliminated).length, eliminated: t.eliminated }
      }),
      host: this.hostId,
      bots: this.botsEnabled,
      winner: this.winner,
    }
  }

  selfView(p: Player): SelfView {
    return {
      inventory: p.inventory,
      selected: p.selected,
      health: Math.ceil(p.health),
      armor: p.armor,
      team: p.team,
      alive: p.alive,
      respawnIn: p.respawnAt === null ? null : wholeSeconds(Math.max(0, p.respawnAt - this.tickCount)),
      eliminated: p.eliminated,
      protectedTicks: wholeSeconds(p.protectedTicks),
      upgrades: (p.team && this.teams.get(p.team)?.upgrades) || NO_UPGRADES,
      pickaxeTier: p.pickaxeTier,
      axeTier: p.axeTier,
      stats: p.stats,
      effects: p.effects,
    }
  }

  meta(): MapMeta {
    const { world: _world, ...meta } = this.map
    return meta
  }

  send(p: Player, msg: ServerMessage): void {
    p.sink?.(msg)
  }

  broadcast(msg: ServerMessage): void {
    for (const p of this.players.values()) p.sink?.(msg)
  }

  event(p: Player, kind: EventKind, text: string, sub?: string): void {
    this.send(p, { t: 'event', kind, text, sub })
  }

  broadcastEvent(kind: EventKind, text: string, sub?: string): void {
    this.broadcast({ t: 'event', kind, text, sub })
  }

  // Helpers ----------------------------------------------------------------

  held(p: Player) {
    return item(p.inventory[p.selected]?.id)
  }

  eye(p: Player): [number, number, number] {
    return [p.x, p.y + (p.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT), p.z]
  }

  look(p: Player): [number, number, number] {
    return lookDirection(p.yaw, p.pitch)
  }

  private eyeDistance(p: Player, x: number, y: number, z: number): number {
    const e = this.eye(p)
    return Math.hypot(x - e[0], y - e[1], z - e[2])
  }

  /** Alive, in a team and in a phase where building and fighting count. */
  canAct(p: Player): boolean {
    return p.alive && !p.eliminated && p.team !== null && this.phase === 'playing'
  }
}

function wholeSeconds(ticks: number): number {
  return Math.ceil(ticks / TPS) * TPS
}

function round(n: number, scale = 1000): number {
  // `+ 0` turns -0 into 0, which is all the wire can carry (as JSON could not either).
  return Math.round(n * scale) / scale + 0
}

function cleanName(name: unknown, id: number): string {
  const s = String(name ?? '').replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, 16)
  return s || `Player${id}`
}

const BOT_NAMES = ['Pip', 'Moss', 'Rook', 'Juniper', 'Flint', 'Wren', 'Basalt', 'Clover', 'Ember', 'Quill', 'Sorrel', 'Tansy']
function botName(random: () => number, taken: Set<string>): string {
  const free = BOT_NAMES.map((n) => `${n} bot`).filter((n) => !taken.has(n))
  return free.length ? free[Math.floor(random() * free.length)] : `Bot ${taken.size}`
}
