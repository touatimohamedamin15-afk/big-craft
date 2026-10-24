import { AIR, blockDef, type TeamId } from './blocks'
import { checkBreak } from './beds'
import { ARROW, FIREBALL, PEARL } from './arsenal'
import { ATTACK_REACH, BLOCK_REACH, HURT_TICKS, TPS } from './constants'
import { countItem, HOTBAR } from '../../engine/inventory'
import { ARMOR_ORDER, type ArmorTier, item } from './items'
import { reachDistance, swingReaches } from '../../engine/melee'
import { forwardOf, IDLE_INPUT, lookDirection, playerBox, type MoveInput } from '../../engine/physics'
import { raycastBlock } from '../../engine/raycast'
import type { BotLevel } from './rules'
import { OFFERS, TOOL_TIER_COST, UPGRADES, type UpgradeId } from './shop'
import type { Brain, Player, Room } from './room'

type Goal = 'gather' | 'shop' | 'upgrade' | 'defend' | 'raid' | 'home' | 'guard'
type Cell = [number, number, number]

/** Things a bot may buy (a profile lists them in the order it buys them); `defence` is the blocks for its bed layers. */
type Purchase =
  | 'stone_sword'
  | 'iron_sword'
  | 'diamond_sword'
  | 'chain_armor'
  | 'iron_armor'
  | 'diamond_armor'
  | 'defence'
  | 'pickaxe'
  | 'axe'
  | 'shears'
  | 'golden_apple'
  | 'bow'
  | 'arrows'
  | 'fireball'
  | 'pearl'
  | 'wool'

export interface BotProfile {
  /** Ticks an enemy must be in range before the bot turns to fight it. */
  reactionTicks: number
  /** Largest aim error in radians, re-rolled every few ticks (pitch gets 60% of it). */
  aimError: number
  /** Ticks between clicks: [min, max]. */
  swingTicks: [number, number]
  /** Let go of forward for a moment after each hit so the next one carries sprint knockback. */
  wTap: boolean
  /** Strafe strength in a fight (0 to 1), and ticks before switching sides. */
  strafe: number
  strafeTicks: number
  /** Jump before swinging so the hit lands while falling (a critical hit). */
  jumpCrit: boolean
  /** Hold clicks while the target is still flashing red (invulnerable), rather than wasting them. */
  timeHits: boolean
  /** Ticks between placed blocks while bridging and building. */
  placeTicks: number
  /** Iron to save before the main shop trip of a life. */
  tripIron: number
  /** Wrap the bed in wool (four iron) before saving up for the main trip. */
  coverFirst: boolean
  /** Blocks to carry for bridging; the bot leaves base with at least half. */
  bridgeBlocks: number
  shop: Purchase[]
  /** Highest pickaxe and axe tier to buy (-1 for none), golden apples, arrows and fireballs to carry. */
  pickaxeTier: number
  axeTier: number
  apples: number
  arrows: number
  fireballs: number
  /** Team upgrades bought with diamonds, in order, when the bot has them. */
  upgrades: UpgradeId[]
  /** Block item for each layer around the bed, innermost first. */
  defence: string[]
  /** Below this health, back off and eat a golden apple (0: never). */
  retreatHealth: number
  /** Shoot arrows at, and throw fireballs at, enemies out on bridges. */
  bow: boolean
  fireball: boolean
  /** Throw a pearl back to safety when knocked into the void. */
  pearl: boolean
  /** Head home when an enemy comes this close to our bed (0: never). */
  guardRadius: number
}

/** Every difference between the levels, in one place. */
export const BOT_PROFILES: Record<BotLevel, BotProfile> = {
  easy: {
    reactionTicks: 16,
    aimError: 0.5,
    swingTicks: [10, 15],
    wTap: false,
    strafe: 0,
    strafeTicks: 0,
    jumpCrit: false,
    timeHits: false,
    placeTicks: 9,
    tripIron: 24,
    coverFirst: false,
    bridgeBlocks: 64,
    shop: ['stone_sword', 'wool'],
    pickaxeTier: -1,
    axeTier: -1,
    apples: 0,
    arrows: 0,
    fireballs: 0,
    upgrades: [],
    defence: [],
    retreatHealth: 0,
    bow: false,
    fireball: false,
    pearl: false,
    guardRadius: 0,
  },
  normal: {
    reactionTicks: 8,
    aimError: 0.24,
    swingTicks: [7, 11],
    wTap: false,
    strafe: 0.4,
    strafeTicks: 6,
    jumpCrit: false,
    timeHits: false,
    placeTicks: 7,
    tripIron: 46,
    coverFirst: false,
    bridgeBlocks: 128,
    shop: ['stone_sword', 'chain_armor', 'iron_sword', 'defence', 'shears', 'pickaxe', 'wool'],
    pickaxeTier: 0,
    axeTier: -1,
    apples: 0,
    arrows: 0,
    fireballs: 0,
    upgrades: [],
    defence: ['wool'],
    retreatHealth: 0,
    bow: false,
    fireball: false,
    pearl: false,
    guardRadius: 0,
  },
  hard: {
    reactionTicks: 4,
    aimError: 0.1,
    swingTicks: [4, 6],
    wTap: true,
    strafe: 0.8,
    strafeTicks: 14,
    jumpCrit: true,
    timeHits: true,
    placeTicks: 6,
    tripIron: 72,
    coverFirst: true,
    bridgeBlocks: 96,
    shop: ['stone_sword', 'chain_armor', 'iron_sword', 'pickaxe', 'defence', 'bow', 'arrows', 'iron_armor', 'golden_apple', 'axe', 'shears', 'wool'],
    pickaxeTier: 2,
    axeTier: 1,
    apples: 2,
    arrows: 16,
    fireballs: 0,
    upgrades: ['sharpness', 'protection', 'protection'],
    defence: ['wool', 'clay'],
    retreatHealth: 6,
    bow: true,
    fireball: false,
    pearl: false,
    guardRadius: 0,
  },
  expert: {
    reactionTicks: 2,
    aimError: 0.04,
    swingTicks: [3, 4],
    wTap: true,
    strafe: 1,
    strafeTicks: 12,
    jumpCrit: true,
    timeHits: true,
    placeTicks: 5,
    tripIron: 80,
    coverFirst: true,
    bridgeBlocks: 96,
    shop: ['stone_sword', 'diamond_sword', 'diamond_armor', 'chain_armor', 'iron_sword', 'pickaxe', 'defence', 'bow', 'arrows', 'iron_armor', 'golden_apple', 'pearl', 'fireball', 'axe', 'shears', 'wool'],
    pickaxeTier: 3,
    axeTier: 2,
    apples: 3,
    arrows: 16,
    fireballs: 2,
    upgrades: ['sharpness', 'protection', 'protection', 'protection'],
    defence: ['wool', 'clay', 'moonstone'],
    retreatHealth: 6,
    bow: true,
    fireball: true,
    pearl: true,
    guardRadius: 12,
  },
}

/** How far a bot reaches to place blocks: a person's reach, without the server's latency slack. */
const PLACE_REACH = BLOCK_REACH + 0.75
/** Ranges for ranged attacks, in blocks. */
const BOW_RANGE: [number, number] = [8, 24]
const FIREBALL_RANGE: [number, number] = [6, 30]
const MELEE_RANGE = 7
/** Ticks between ranged attempts, and between fireballs. */
const SHOT_COOLDOWN = 30
const FIREBALL_COOLDOWN = 3 * TPS
/** A stranded bot (no blocks, no way back) steps off after this long, as a person would. */
const STRANDED_TICKS = 30 * TPS
const STRANDED_GIVE_UP_TICKS = 3 * 60 * TPS
const DEFEND_TICKS = 45 * TPS
const STAND_TICKS = 8 * TPS
/** An enemy we neither hit nor get hit by for this long (behind a block, up a pillar) is ignored for a while; halfway there, jump for a clear swing. */
const FIGHT_STALL_TICKS = 5 * TPS
const IGNORE_TICKS = 10 * TPS
/** A hunting bot heads home while it still has this many blocks to bridge back with. */
const HOME_BLOCKS = 12
/** Iron that gear purchases leave over for blocks (two stacks of wool). */
const IRON_RESERVE = 8

const SWORDS = ['wood_sword', 'stone_sword', 'iron_sword', 'diamond_sword']
const ARMOR_OFFERS: Partial<Record<Purchase, ArmorTier>> = { chain_armor: 'chain', iron_armor: 'iron', diamond_armor: 'diamond' }

/**
 * A bed-wars bot that plays by the same rules as people: it moves with the
 * shared physics and acts only through the room messages a client sends, so
 * the server validates everything it does. It gathers at its forge, shops,
 * walls in its bed, then bridges in axis-aligned legs toward an enemy bed,
 * fighting anyone who comes close. Its level (`BOT_PROFILES`) sets how well.
 */
export class Bot implements Brain {
  readonly profile: BotProfile
  private goal: Goal = 'gather'
  private goalSince = 0
  private target: TeamId | null = null
  private path: [number, number][] = []
  private lastPlace = 0
  private nextSwing = 0
  private stuck = 0
  private lastPos: [number, number] = [0, 0]
  private legAxis: 'x' | 'z' | null = null
  /** Ticks spent out of blocks; a goal-independent safeguard against looping forever. */
  private strandedTicks = 0
  /** Ticks stranded since we last held a block, across re-checks. */
  private strandedTotal = 0
  /** Bed layers this life already built (or tried to), cells that refused a block, and where on the tour we stand. */
  private defended = new Set<number>()
  private coverFailures = new Map<string, number>()
  private stand = 0
  private standSince = 0
  /** Shop trips this life, whether the main (`tripIron`) one is done, and whether this trip visited the upgrades keeper. */
  private trips = 0
  private geared = false
  private upgraded = false
  /** Start and corner of the current trip out, to retrace on the way home. */
  private trail: [number, number][] = []
  /** Set by walkTo when a gap needs bridging and there is nothing to bridge with. */
  private outOfBlocks = false
  private deaths = -1
  // Fighting
  private noticed: { id: number; at: number } | null = null
  private stall = 0
  private ignored = new Map<number, number>()
  private aimOffset: [number, number] = [0, 0]
  private aimRollAt = 0
  private strafeSide = 1
  private strafeUntil = 0
  /** After a hit sprinting stops; a w-tapper lets go of forward until this tick, others walk until they disengage. */
  private wTapUntil = 0
  private sprintLost = false
  private retreatUntil = 0
  private drawing: { target: number; start: number } | null = null
  private nextShot = 0
  private nextFireball = 0
  private nextPearl = 0
  private lastGround: Cell | null = null

  constructor(
    private readonly team: TeamId,
    private readonly random: () => number,
    /** Sparring mode: ignore beds and generators, just find someone to fight. */
    private readonly duel = false,
    readonly level: BotLevel = 'normal',
  ) {
    this.profile = BOT_PROFILES[level] ?? BOT_PROFILES.normal
  }

  think(room: Room, p: Player): MoveInput {
    if (room.phase !== 'playing' || !p.alive) return { ...IDLE_INPUT, yaw: p.yaw }
    if (p.stats.deaths !== this.deaths) this.respawned(room, p)
    if (p.onGround) this.lastGround = [Math.floor(p.x), Math.floor(p.y + 0.01) - 1, Math.floor(p.z)]
    this.strandedTicks = this.outOfBlocks ? this.strandedTicks + 1 : 0
    this.strandedTotal = this.blocks(p) > 0 ? 0 : this.strandedTotal + (this.outOfBlocks ? 1 : 0)
    if (this.strandedTicks > TPS) {
      const pearl = this.pearlHome(room, p)
      if (pearl) return pearl
    }
    if (this.strandedTicks > STRANDED_TICKS) {
      // Still here after ten seconds of walking off: look at the situation afresh.
      if (this.strandedTicks > STRANDED_TICKS + 10 * TPS) this.outOfBlocks = false
      // Stranded with no blocks and no way back: step off and respawn, as a person
      // would. Without a bed that would be the end, so walk at whoever we can reach,
      // and only give up after a long while so a round can never stall.
      if (room.teams.get(this.team)?.bed || this.strandedTotal > STRANDED_GIVE_UP_TICKS) return { ...IDLE_INPUT, yaw: p.yaw, forward: 1 }
      const fight = this.engage(room, p)
      if (fight) return fight
      const prey = this.nearestEnemy(room, p, Infinity)
      if (prey) return this.walkTo(room, p, prey.x, prey.z, false, 2).input
    }

    const saved = this.voidSave(room, p)
    if (saved) return saved
    if (this.duel) {
      const target = this.nearestEnemy(room, p, 48)
      if (!target) return { ...IDLE_INPUT, yaw: p.yaw }
      const fight = this.engage(room, p)
      if (fight) return fight
      return this.walkTo(room, p, target.x, target.z, false, 2).input
    }

    const fight = this.engage(room, p)
    if (fight) return fight
    const eat = this.lowHealth(room, p) && this.eat(room, p)
    if (eat) return { ...IDLE_INPUT, yaw: p.yaw, pitch: p.pitch }
    const shot = this.ranged(room, p)
    if (shot) return shot
    this.checkGuard(room, p)

    switch (this.goal) {
      case 'gather':
        return this.gather(room, p)
      case 'shop':
        return this.shop(room, p)
      case 'upgrade':
        return this.upgrade(room, p)
      case 'defend':
        return this.defend(room, p)
      case 'raid':
        return this.raid(room, p)
      case 'guard':
        return this.guard(room, p)
      case 'home':
        return this.followPath(room, p, () => this.setGoal(room, 'gather'))
    }
  }

  /** A new life: start over from the forge. */
  private respawned(room: Room, p: Player) {
    this.deaths = p.stats.deaths
    this.setGoal(room, 'gather')
    this.defended.clear()
    this.coverFailures.clear()
    this.trips = 0
    this.geared = false
    this.trail = []
    this.path = []
    this.drawing = null
    this.sprintLost = false
    this.noticed = null
    this.lastGround = null
    this.outOfBlocks = false
    this.strandedTicks = 0
    this.strandedTotal = 0
  }

  private setGoal(room: Room, goal: Goal) {
    this.goal = goal
    this.goalSince = room.tickCount
    this.stuck = 0
    this.legAxis = null
    if (goal === 'defend') {
      this.stand = 0
      this.standSince = room.tickCount
    }
  }

  private base(room: Room) {
    return room.map.bases.find((b) => b.team === this.team)!
  }

  // Economy ------------------------------------------------------------------

  private gather(room: Room, p: Player): MoveInput {
    const { forge, center } = this.base(room)
    if (Math.hypot(p.x - center[0], p.z - center[2]) > 12) {
      this.trail = []
      return this.goHome(room, p)
    }
    const iron = countItem(p.inventory, 'iron')
    const waited = room.tickCount - this.goalSince
    const cover = this.profile.coverFirst && !this.defended.has(0) && room.teams.get(this.team)?.bed
    const want = this.geared ? 16 : cover ? 4 : this.profile.tripIron
    if (iron >= want || (waited > 90 * TPS && iron >= 16)) {
      if (iron >= this.profile.tripIron || waited > 90 * TPS) this.geared = true
      this.setGoal(room, 'shop')
      return this.shop(room, p)
    }
    return this.walkTo(room, p, forge[0], forge[2], false).input
  }

  private shop(room: Room, p: Player): MoveInput {
    const npc = room.map.npcs.find((n) => n.kind === 'shop' && n.team === this.team)
    if (!npc) return this.leave(room, p)
    const walk = this.walkTo(room, p, npc.x, npc.z, false, 2.5)
    if (!walk.arrived) return walk.input
    this.trips++
    this.upgraded = false
    for (const want of this.profile.shop) this.buyAll(room, p, want)
    return this.afterShop(room, p)
  }

  /** Where to go once shopping is done: upgrades, the bed cover, more blocks, or out. */
  private afterShop(room: Room, p: Player): MoveInput {
    if (!this.upgraded && this.nextUpgrade(room, p)) {
      this.upgraded = true
      this.setGoal(room, 'upgrade')
      return this.upgrade(room, p)
    }
    if (this.layersToBuild(p).length && room.teams.get(this.team)?.bed) {
      this.setGoal(room, 'defend')
      return this.defend(room, p)
    }
    if (this.blocks(p) < this.profile.bridgeBlocks / 2 && this.trips < 4) {
      // Not enough to bridge with: another trip to the forge first.
      this.setGoal(room, 'gather')
      return { ...IDLE_INPUT, yaw: p.yaw }
    }
    return this.leave(room, p)
  }

  /** Buys one kind of thing until the bot has what it wants or cannot afford more. */
  private buyAll(room: Room, p: Player, want: Purchase) {
    const gear = want !== 'defence' && want !== 'wool'
    for (let i = 0; i < 12; i++) {
      const offer = this.offerFor(room, p, want)
      if (!offer || !this.affords(p, offer, gear ? IRON_RESERVE : 0)) return
      const before = JSON.stringify([p.inventory, p.armor, p.pickaxeTier, p.axeTier])
      room.receive(p.id, { t: 'buy', offer })
      if (JSON.stringify([p.inventory, p.armor, p.pickaxeTier, p.axeTier]) === before) return
    }
  }

  /** The offer that moves the bot toward `want`, or null when it has enough. */
  private offerFor(room: Room, p: Player, want: Purchase): string | null {
    const prof = this.profile
    const has = (id: string) => countItem(p.inventory, id)
    const swordTier = Math.max(...SWORDS.map((s, i) => (has(s) ? i : -1)))
    const armor = ARMOR_OFFERS[want]
    if (armor) return ARMOR_ORDER.indexOf(p.armor) < ARMOR_ORDER.indexOf(armor) ? want : null
    switch (want) {
      case 'stone_sword':
        return swordTier < 1 ? want : null
      case 'iron_sword':
        return swordTier < 2 ? want : null
      case 'diamond_sword':
        return swordTier < 3 ? want : null
      case 'pickaxe':
        return p.pickaxeTier < prof.pickaxeTier ? want : null
      case 'axe':
        return p.axeTier < prof.axeTier ? want : null
      case 'shears':
        return p.shears ? null : want
      case 'golden_apple':
        return has('golden_apple') < prof.apples ? want : null
      case 'bow':
        return has('bow') === 0 ? want : null
      case 'arrows':
        return has('bow') > 0 && has('arrow') < prof.arrows ? want : null
      case 'fireball':
        return has('fireball') < prof.fireballs ? want : null
      case 'pearl':
        return has('pearl') === 0 ? want : null
      case 'wool':
        return has('wool') < prof.bridgeBlocks ? want : null
      case 'defence': {
        // Blocks for the first layer that still has holes and that we are short of.
        for (const [i, block] of prof.defence.entries()) {
          const open = this.shell(room, i + 1).filter(([x, y, z]) => room.world.get(x, y, z) === AIR).length
          if (open > 0 && has(block) < open) return block
        }
        return null
      }
    }
    return null
  }

  private affords(p: Player, offerId: string, ironReserve: number): boolean {
    const offer = OFFERS.find((o) => o.id === offerId)
    if (!offer) return false
    let cost = offer.cost
    if (offer.give.kind === 'pickaxe' || offer.give.kind === 'axe') {
      const tier = offer.give.kind === 'pickaxe' ? p.pickaxeTier : p.axeTier
      if (tier >= 3) return false
      cost = TOOL_TIER_COST[tier + 1]
    }
    return cost.every((c) => countItem(p.inventory, c.resource) >= c.amount + (c.resource === 'iron' ? ironReserve : 0))
  }

  private nextUpgrade(room: Room, p: Player): UpgradeId | null {
    const team = room.teams.get(this.team)
    if (!team) return null
    const counts = new Map<UpgradeId, number>()
    for (const id of this.profile.upgrades) {
      // The list names each level wanted: ['protection', 'protection'] is level 2.
      const wanted = (counts.get(id) ?? 0) + 1
      counts.set(id, wanted)
      const level = team.upgrades[id]
      if (level >= wanted) continue
      const cost = UPGRADES.find((u) => u.id === id)?.levels[level]
      return cost !== undefined && countItem(p.inventory, 'diamond') >= cost ? id : null
    }
    return null
  }

  private upgrade(room: Room, p: Player): MoveInput {
    const npc = room.map.npcs.find((n) => n.kind === 'upgrades' && n.team === this.team)
    if (!npc || room.tickCount - this.goalSince > 20 * TPS) return this.afterShop(room, p)
    const walk = this.walkTo(room, p, npc.x, npc.z, false, 2.5)
    if (!walk.arrived) return walk.input
    for (let id = this.nextUpgrade(room, p); id; id = this.nextUpgrade(room, p)) {
      const before = room.teams.get(this.team)!.upgrades[id]
      room.receive(p.id, { t: 'upgrade', id })
      if (room.teams.get(this.team)!.upgrades[id] === before) break
    }
    return this.afterShop(room, p)
  }

  private blocks(p: Player): number {
    return p.inventory.reduce((n, s) => n + (s && item(s.id)?.kind === 'block' ? s.count : 0), 0)
  }

  // Bed defence ----------------------------------------------------------------

  /**
   * Cells of layer `n` around our bed: everything at Manhattan distance `n`
   * from the nearer bed half, from bed level up. Layer 1 is the classic
   * single wrap; each layer sits on the one inside it.
   */
  private shell(room: Room, n: number): Cell[] {
    const b = this.base(room).bed
    const halves = [[b.x, b.z], [b.x + b.dx, b.z + b.dz]]
    const out: Cell[] = []
    for (let dy = 0; dy <= n; dy++) {
      const r = n - dy
      for (let x = b.x - r - 1; x <= b.x + r + 1; x++)
        for (let z = b.z - r - 1; z <= b.z + r + 1; z++) {
          const d = Math.min(...halves.map(([hx, hz]) => Math.abs(x - hx) + Math.abs(z - hz)))
          if (d === r) out.push([x, b.y + dy, z])
        }
    }
    return out
  }

  /**
   * Where to stand while building, outside the outermost layer: behind the
   * bed, then round one side and back round the other, so walking between
   * stands never crosses the cover.
   */
  private stands(room: Room): [number, number][] {
    const b = this.base(room).bed
    const r = this.profile.defence.length + 1
    // u runs from the bed's foot toward its head, v across it.
    const at = (u: number, v: number): [number, number] => [b.x + 0.5 + u * b.dx - v * b.dz, b.z + 0.5 + u * b.dz + v * b.dx]
    if (r <= 2) return [at(-2.5, 0)]
    return [at(-r, 0), at(-r, -r), at(1, -r), at(-r, -r), at(-r, r), at(1, r)]
  }

  private defend(room: Room, p: Player): MoveInput {
    const stands = this.stands(room)
    const done = () => {
      for (const layer of this.layersToBuild(p)) this.defended.add(layer)
      return this.afterShop(room, p)
    }
    if (this.stand >= stands.length || room.tickCount - this.goalSince > DEFEND_TICKS) return done()
    const [sx, sz] = stands[this.stand]
    const next = () => {
      this.stand++
      this.standSince = room.tickCount
      return { ...IDLE_INPUT, yaw: p.yaw }
    }
    const walk = this.walkTo(room, p, sx, sz, false, 0.4)
    if (!walk.arrived) return room.tickCount - this.standSince > STAND_TICKS ? next() : walk.input
    const failures = (x: number, y: number, z: number) => this.coverFailures.get(`${x},${y},${z}`) ?? 0
    const eye = room.eye(p)
    // The innermost layer with holes we can reach from here, lowest cells first.
    let cell: Cell | null = null
    let block = ''
    for (const [i, id] of this.profile.defence.entries()) {
      if (countItem(p.inventory, id) === 0 || this.defended.has(i)) continue
      const open = this.shell(room, i + 1).filter(
        ([x, y, z]) => room.world.get(x, y, z) === AIR && failures(x, y, z) < 2 && Math.hypot(x + 0.5 - eye[0], y + 0.5 - eye[1], z + 0.5 - eye[2]) <= PLACE_REACH,
      )
      open.sort((a, c) => a[1] - c[1])
      if (open.length) {
        cell = open[0]
        block = id
        break
      }
    }
    if (!cell) return next()
    const [x, y, z] = cell
    const yaw = Math.atan2(-(x + 0.5 - p.x), -(z + 0.5 - p.z))
    const pitch = Math.atan2(y + 0.5 - eye[1], Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z))
    if (room.tickCount - this.lastPlace >= this.profile.placeTicks) {
      this.lastPlace = room.tickCount
      const slot = this.hotbarSlot(room, p, (id) => id === block)
      const against = supportFor(room, x, y, z)
      if (slot >= 0 && against) {
        this.select(room, p, slot)
        room.receive(p.id, { t: 'place', x: against[0], y: against[1], z: against[2], face: [x - against[0], y - against[1], z - against[2]], slot })
      }
      // A cell that will not take a block (protected, someone standing in it) is given up after two tries.
      if (room.world.get(x, y, z) === AIR) this.coverFailures.set(`${x},${y},${z}`, failures(x, y, z) + 1)
    }
    return { ...IDLE_INPUT, yaw, pitch }
  }

  private atOurBed(room: Room, q: Player): boolean {
    const b = this.base(room).bed
    return !!room.teams.get(this.team)?.bed && Math.hypot(q.x - b.x - 0.5, q.z - b.z - 0.5) < 4 && Math.abs(q.y - b.y) < 4
  }

  /** Whether a cell is part of the cover our bed's layers would fill. */
  private ownCover(room: Room, x: number, y: number, z: number): boolean {
    const b = this.base(room).bed
    const layers = Math.max(1, this.profile.defence.length)
    const d = Math.min(Math.abs(x - b.x) + Math.abs(z - b.z), Math.abs(x - b.x - b.dx) + Math.abs(z - b.z - b.dz)) + (y - b.y)
    return y >= b.y && d >= 1 && d <= layers
  }

  /** Layers (0 innermost) not yet built this life that we hold blocks for. */
  private layersToBuild(p: Player): number[] {
    return this.profile.defence.flatMap((id, i) => (!this.defended.has(i) && countItem(p.inventory, id) > 0 ? [i] : []))
  }

  /** Expert bots go home to meet anyone who comes near their bed. */
  private checkGuard(room: Room, p: Player) {
    if (!this.profile.guardRadius || this.goal === 'guard' || this.goal === 'home') return
    const intruder = this.intruder(room)
    if (!intruder) return
    const { center } = this.base(room)
    if (Math.hypot(p.x - center[0], p.z - center[2]) < 14) return this.setGoal(room, 'guard')
    // Already at an enemy bed: finish it first.
    const at = this.target && room.map.bases.find((b) => b.team === this.target)?.bed
    if (this.goal === 'raid' && at && Math.hypot(p.x - at.x - 0.5, p.z - at.z - 0.5) < 5) return
    this.goHome(room, p)
  }

  private intruder(room: Room): Player | null {
    const b = this.base(room).bed
    if (!room.teams.get(this.team)?.bed) return null
    let best: Player | null = null
    let bestD = this.profile.guardRadius
    for (const q of this.enemies(room)) {
      const d = Math.hypot(q.x - b.x - 0.5, q.z - b.z - 0.5)
      if (d < bestD && Math.abs(q.y - b.y) < 8) {
        best = q
        bestD = d
      }
    }
    return best
  }

  private guard(room: Room, p: Player): MoveInput {
    const intruder = this.intruder(room)
    if (!intruder || room.tickCount - this.goalSince > 60 * TPS) {
      this.setGoal(room, 'gather')
      return { ...IDLE_INPUT, yaw: p.yaw }
    }
    return this.walkTo(room, p, intruder.x, intruder.z, false, 1.5).input
  }

  // Raids ------------------------------------------------------------------------

  private leave(room: Room, p: Player): MoveInput {
    const targets = [...room.teams.values()].filter((t) => t.team !== this.team && !t.eliminated)
    if (targets.length === 0) return { ...IDLE_INPUT, yaw: p.yaw }
    // Prefer a team that still has a bed.
    const withBed = targets.filter((t) => t.bed)
    const pick = (withBed.length ? withBed : targets)[Math.floor(this.random() * (withBed.length || targets.length))]
    this.target = pick.team
    const base = room.map.bases.find((b) => b.team === pick.team)!
    const goal: [number, number] = pick.bed ? [base.bed.x + 0.5 - base.bed.dx * 2, base.bed.z + 0.5 - base.bed.dz * 2] : [base.spawn[0], base.spawn[2]]
    // Leave along our own base's axis (through the middle), then turn toward the target.
    const own = this.base(room)
    const alongZ = Math.abs(own.center[0] - room.world.sx / 2) < 1
    const here: [number, number] = [Math.floor(p.x) + 0.5, Math.floor(p.z) + 0.5]
    const corner: [number, number] = alongZ ? [here[0], goal[1]] : [goal[0], here[1]]
    this.path = [here, corner, goal]
    this.trail = [here, corner]
    this.setGoal(room, 'raid')
    return this.raid(room, p)
  }

  private raid(room: Room, p: Player): MoveInput {
    const state = this.target ? room.teams.get(this.target) : undefined
    if (!state || state.eliminated) return this.goHome(room, p)
    const base = room.map.bases.find((b) => b.team === this.target)!
    if (state.bed) {
      const bx = base.bed.x + 0.5
      const bz = base.bed.z + 0.5
      if (Math.hypot(p.x - bx, p.z - bz) < 3.2) return this.breakBed(room, p, base.bed.x, base.bed.y, base.bed.z)
    } else if (this.path.length === 0) {
      // Bed gone: hunt whoever is left.
      const prey = this.blocks(p) >= HOME_BLOCKS ? this.nearestEnemy(room, p, Infinity) : null
      const hunt = prey && this.walkTo(room, p, prey.x, prey.z, true).input
      // Out of blocks on the way: home to restock first.
      return hunt && !this.outOfBlocks ? hunt : this.goHome(room, p)
    }
    // Out of waypoints short of the bed (a leg was skipped): plan again from here.
    if (state.bed && this.path.length === 0) return this.leave(room, p)
    const input = this.followPath(room, p, () => {})
    if (this.outOfBlocks) return this.goHome(room, p)
    return input
  }

  private goHome(room: Room, p: Player): MoveInput {
    // Walk back over the bridge we built: the legs of the way out, reversed.
    const [origin, corner] = this.trail
    const pastCorner = this.path.length <= 1
    this.path = origin ? (pastCorner ? [corner, origin] : [origin]) : [[this.base(room).spawn[0], this.base(room).spawn[2]]]
    this.setGoal(room, 'home')
    return this.followPath(room, p, () => this.setGoal(room, 'gather'))
  }

  private followPath(room: Room, p: Player, done: () => void): MoveInput {
    const next = this.path[0]
    if (!next) {
      done()
      return { ...IDLE_INPUT, yaw: p.yaw }
    }
    const walk = this.walkTo(room, p, next[0], next[1], true, 0.45)
    // No progress for three seconds (an undiggable block, a missing ledge): give up on this waypoint.
    if (Math.hypot(p.x - this.lastPos[0], p.z - this.lastPos[1]) < 0.01) this.stuck++
    else this.stuck = 0
    this.lastPos = [p.x, p.z]
    if (walk.arrived || this.stuck > 60) {
      this.path.shift()
      this.stuck = 0
      this.legAxis = null
    }
    return walk.input
  }

  /** Walks toward a point, bridging over gaps with blocks when allowed, jumping or digging through obstacles. */
  private walkTo(room: Room, p: Player, tx: number, tz: number, bridge: boolean, near = 0.6): { input: MoveInput; arrived: boolean } {
    this.outOfBlocks = false
    let dx = tx - p.x
    let dz = tz - p.z
    let strafe = 0
    if (bridge) {
      // Bridges run along one axis at a time (an L to a diagonal target). Keep the
      // current leg's axis until it is done so a near-diagonal target cannot flip it.
      const adx = Math.abs(dx)
      const adz = Math.abs(dz)
      if (adx < near && adz < near) return { input: { ...IDLE_INPUT, yaw: p.yaw }, arrived: true }
      if (this.legAxis === null) this.legAxis = adx >= adz ? 'x' : 'z'
      if (this.legAxis === 'x' && adx < near) this.legAxis = 'z'
      else if (this.legAxis === 'z' && adz < near) this.legAxis = 'x'
      // Strafe toward the centre of the cell row we are on.
      if (this.legAxis === 'x') {
        strafe = Math.max(-1, Math.min(1, Math.sign(dx) * (Math.floor(p.z) + 0.5 - p.z) * 4))
        dz = 0
      } else {
        strafe = Math.max(-1, Math.min(1, -Math.sign(dz) * (Math.floor(p.x) + 0.5 - p.x) * 4))
        dx = 0
      }
    }
    const dist = Math.hypot(dx, dz)
    if (dist < near) return { input: { ...IDLE_INPUT, yaw: p.yaw }, arrived: true }
    const yaw = Math.atan2(-dx, -dz)
    const ux = dx / dist
    const uz = dz / dist
    const feet = Math.floor(p.y + 0.01)
    const ahead = (d: number) => [Math.floor(p.x + ux * d), Math.floor(p.z + uz * d)] as const
    const [ax, az] = ahead(0.9)
    const input: MoveInput = { ...IDLE_INPUT, yaw, pitch: -0.3, forward: 1, strafe, sprint: !bridge }

    // Obstacles at body height: jump a single block, dig anything taller.
    const blockedLow = blockDef(room.world.get(ax, feet, az)).solid
    const blockedHigh = blockDef(room.world.get(ax, feet + 1, az)).solid
    if (blockedHigh || (blockedLow && blockDef(room.world.get(ax, feet + 2, az)).solid)) {
      this.dig(room, p, ax, blockedHigh ? feet + 1 : feet, az)
      return { input: { ...input, forward: 0 }, arrived: false }
    }
    if (blockedLow) input.jump = p.onGround

    // A gap ahead: place a block against the one we stand on, or stop at the edge.
    // Stepping down up to three blocks is fine; anything deeper is a gap.
    const hasGround = (x: number, z: number) => [1, 2, 3].some((d) => blockDef(room.world.get(x, feet - d, z)).solid)
    const groundAhead = hasGround(ax, az)
    if (p.onGround && !groundAhead && !blockedLow) {
      const [cx, cz] = [Math.floor(p.x), Math.floor(p.z)]
      const slot = this.hotbarSlot(room, p, (id) => item(id)?.kind === 'block')
      if (bridge && slot < 0) this.outOfBlocks = true
      if (!bridge || slot < 0) return { input: { ...input, forward: 0, sprint: false }, arrived: false }
      // Normally we stand on a block and build out from its side. At a rounded
      // corner we can be held up by a neighbour instead: fill in under us first.
      let against: Cell = [cx, feet - 1, cz]
      let target: Cell = [ax, feet - 1, az]
      if (!blockDef(room.world.get(cx, feet - 1, cz)).solid) {
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([ox, oz]) => blockDef(room.world.get(cx + ox, feet - 1, cz + oz)).solid)
        if (!n) return { input: { ...input, forward: 0, sprint: false }, arrived: false }
        against = [cx + n[0], feet - 1, cz + n[1]]
        target = [cx, feet - 1, cz]
      }
      const face: Cell = [target[0] - against[0], 0, target[2] - against[2]]
      if (Math.abs(face[0]) + Math.abs(face[2]) !== 1) return { input: { ...input, forward: 0, sprint: false }, arrived: false }
      if (room.tickCount - this.lastPlace >= this.profile.placeTicks) {
        this.lastPlace = room.tickCount
        this.select(room, p, slot)
        room.receive(p.id, { t: 'place', x: against[0], y: against[1], z: against[2], face, slot })
      }
      return { input: { ...input, forward: 0, sneak: true, sprint: false }, arrived: false }
    }

    if (this.stuck > 30) input.jump = p.onGround
    // Sneak while walking out to a bridge's end so the edge guard catches any overshoot.
    return { input: { ...input, sneak: bridge && !hasGround(Math.floor(p.x + ux * 1.6), Math.floor(p.z + uz * 1.6)) }, arrived: false }
  }

  /** Digs whatever is between us and the bed, then the bed. */
  private breakBed(room: Room, p: Player, x: number, y: number, z: number): MoveInput {
    const eye = room.eye(p)
    const to = [x + 0.5 - eye[0], y + 0.3 - eye[1], z + 0.5 - eye[2]]
    const len = Math.hypot(...to)
    const dir = to.map((v) => v / len)
    const hit = raycastBlock(room.world, eye, dir, 5)
    const yaw = Math.atan2(-to[0], -to[2])
    const pitch = Math.asin(dir[1])
    if (hit) this.dig(room, p, hit.x, hit.y, hit.z)
    return { ...IDLE_INPUT, yaw, pitch }
  }

  /** Starts digging a block with the right tool in hand; never one of our own bed's layers. */
  private dig(room: Room, p: Player, x: number, y: number, z: number) {
    if (p.dig && p.dig.x === x && p.dig.y === y && p.dig.z === z) return
    if (room.world.get(x, y, z) === AIR || checkBreak(room.world, room.map.build, x, y, z, p.team) || this.ownCover(room, x, y, z)) return
    const wanted = blockDef(room.world.get(x, y, z)).tool
    const tool = this.hotbarSlot(room, p, (id) => item(id)?.kind === 'tool' && item(id)?.tool === wanted)
    if (tool >= 0) this.select(room, p, tool)
    room.receive(p.id, { t: 'dig', target: [x, y, z] })
  }

  // Fighting -----------------------------------------------------------------------

  /** The melee fight, once the bot has noticed the nearest enemy for its reaction time. */
  private engage(room: Room, p: Player): MoveInput | null {
    const enemy = this.nearestEnemy(room, p, MELEE_RANGE)
    if (!enemy) {
      this.noticed = null
      return null
    }
    if (this.noticed?.id !== enemy.id) {
      this.noticed = { id: enemy.id, at: room.tickCount }
      this.stall = 0
    }
    if (room.tickCount - this.noticed.at < this.profile.reactionTicks) return null
    // Across a gap and out of reach: nothing to fight yet, carry on (home, or bridging over).
    const eye = room.eye(p)
    const dist = Math.hypot(enemy.x - p.x, enemy.z - p.z) || 1
    const feet = Math.floor(p.y + 0.01)
    const towardGround = [1, 2].some((d) => blockDef(room.world.get(Math.floor(p.x + ((enemy.x - p.x) / dist) * 0.9), feet - d, Math.floor(p.z + ((enemy.z - p.z) / dist) * 0.9))).solid)
    if (!towardGround && reachDistance(eye, enemy.x, enemy.y, enemy.z, enemy.sneaking) > ATTACK_REACH) return null
    if (this.stall > FIGHT_STALL_TICKS) {
      this.ignored.set(enemy.id, room.tickCount + IGNORE_TICKS)
      this.noticed = null
      return null
    }
    return this.fight(room, p, enemy)
  }

  private fight(room: Room, p: Player, enemy: Player): MoveInput {
    const prof = this.profile
    const tick = room.tickCount
    this.drawing = null
    if (p.dig) room.receive(p.id, { t: 'dig', target: null })
    // Hard and expert bots back off and eat when low.
    if (this.lowHealth(room, p) && this.eat(room, p)) this.retreatUntil = tick + 12
    const sword = this.hotbarSlot(room, p, (id) => item(id)?.kind === 'sword')
    if (sword >= 0) this.select(room, p, sword)

    const dx = enemy.x - p.x
    const dz = enemy.z - p.z
    const dist = Math.hypot(dx, dz)
    const eye = room.eye(p)
    if (tick >= this.aimRollAt) {
      this.aimOffset = [(this.random() * 2 - 1) * prof.aimError, (this.random() * 2 - 1) * prof.aimError * 0.6]
      this.aimRollAt = tick + 3 + Math.floor(this.random() * 4)
    }
    const yaw = Math.atan2(-dx, -dz) + this.aimOffset[0]
    const pitch = Math.atan2(enemy.y + 1 - eye[1], dist) + this.aimOffset[1]
    const feet = Math.floor(p.y + 0.01)
    const solidAt = (x: number, y: number, z: number) => blockDef(room.world.get(Math.floor(x), y, Math.floor(z))).solid
    const groundAt = (ox: number, oz: number) => solidAt(p.x + ox, feet - 1, p.z + oz)
    /** Ground all round within `r`: safe to strafe hard or jump without sliding off an edge. */
    const firm = (r: number) => [0, 1, 2, 3, 4, 5, 6, 7].every((i) => groundAt(Math.cos((i * Math.PI) / 4) * r, Math.sin((i * Math.PI) / 4) * r))
    const [fx, fz] = forwardOf(yaw)

    if (tick < this.retreatUntil) return { ...IDLE_INPUT, yaw, pitch, forward: groundAt(-fx * 0.9, -fz * 0.9) ? -1 : 0 }

    // Clicks: only a swing whose crosshair is on the target is sent, as from a client.
    const inReach = reachDistance(eye, enemy.x, enemy.y, enemy.z, enemy.sneaking) <= ATTACK_REACH
    const rising = !p.onGround && p.vy >= 0
    const flashing = tick - enemy.lastHurtTick < HURT_TICKS
    if (inReach && tick >= this.nextSwing && !(prof.jumpCrit && rising) && !(prof.timeHits && flashing)) {
      this.nextSwing = tick + prof.swingTicks[0] + Math.floor(this.random() * (prof.swingTicks[1] - prof.swingTicks[0] + 1))
      p.yaw = yaw
      p.pitch = pitch
      if (swingReaches(room.world, eye, lookDirection(yaw, pitch), playerBox(enemy.x, enemy.y, enemy.z, enemy.sneaking), ATTACK_REACH)) {
        room.receive(p.id, { t: 'attack', target: enemy.id })
        if (enemy.lastHurtTick === tick) {
          // The hit stopped our sprint: w-tap to get it back, or walk until we disengage.
          this.sprintLost = true
          if (prof.wTap) this.wTapUntil = tick + 2
        }
      }
    }

    // Movement: close in, keep off edges, strafe, jump for crits.
    const ux = dx / (dist || 1)
    const uz = dz / (dist || 1)
    const ground = groundAt(ux * 0.9, uz * 0.9)
    // Neither side landing anything: count toward giving up on them.
    this.stall = enemy.lastHurtTick === tick || tick - p.lastHurtTick < 2 ? 0 : this.stall + 1
    let forward = dist > (prof.wTap ? 1.2 : 2.2) && ground ? 1 : 0
    if (tick < this.wTapUntil) forward = 0
    if (forward === 0 && prof.wTap) this.sprintLost = false
    if (dist > 4.5) this.sprintLost = false
    const sprint = ground && !this.sprintLost
    let strafe = 0
    if (prof.strafe > 0) {
      if (tick >= this.strafeUntil) {
        this.strafeSide = this.random() < 0.5 ? -1 : 1
        this.strafeUntil = tick + prof.strafeTicks
      }
      // Right is forward turned a quarter clockwise; never strafe off an edge.
      const side = (s: number) => groundAt(-fz * s * 0.9, fx * s * 0.9) && groundAt(-fz * s * 1.6, fx * s * 1.6)
      if (!side(this.strafeSide)) this.strafeSide = -this.strafeSide
      strafe = side(this.strafeSide) ? this.strafeSide * prof.strafe : 0
    }
    const step = ground && solidAt(p.x + ux * 0.9, feet, p.z + uz * 0.9) && p.onGround
    const crit = prof.jumpCrit && p.onGround && dist < 3.4 && tick + 6 >= this.nextSwing && !flashing && firm(1.6)
    const unstick = this.stall > FIGHT_STALL_TICKS / 2 && p.onGround && firm(0.9)
    return { ...IDLE_INPUT, yaw, pitch, forward, strafe, sprint, jump: step || crit || unstick }
  }

  private lowHealth(room: Room, p: Player): boolean {
    return this.profile.retreatHealth > 0 && p.health < this.profile.retreatHealth && room.tickCount - p.lastHurtTick < 5 * TPS
  }

  private eat(room: Room, p: Player): boolean {
    if (room.tickCount - p.lastEatTick < TPS / 2) return false
    const slot = this.hotbarSlot(room, p, (id) => id === 'golden_apple')
    if (slot < 0) return false
    this.select(room, p, slot)
    room.receive(p.id, { t: 'use' })
    return p.lastEatTick === room.tickCount
  }

  /** Arrows and fireballs at enemies out on bridges, who cannot dodge far. */
  private ranged(room: Room, p: Player): MoveInput | null {
    const prof = this.profile
    if (!prof.bow && !prof.fireball) return null
    const tick = room.tickCount
    if (this.drawing) {
      const target = room.players.get(this.drawing.target)
      const aim = target?.alive && this.inRange(room, p, target, BOW_RANGE[0] - 2, BOW_RANGE[1] + 4) ? this.aimShot(room, p, target, ARROW.speed, ARROW.gravity, ARROW.drag, 1) : null
      if (!aim || room.held(p)?.kind !== 'bow') {
        // Lost the shot: keep the arrow (there is no release without a draw).
        this.drawing = null
        this.nextShot = tick + SHOT_COOLDOWN
        return null
      }
      if (tick - this.drawing.start >= TPS) {
        p.yaw = aim.yaw + (this.random() - 0.5) * prof.aimError
        p.pitch = aim.pitch + (this.random() - 0.5) * prof.aimError * 0.5
        room.receive(p.id, { t: 'release' })
        this.drawing = null
        this.nextShot = tick + SHOT_COOLDOWN
        return { ...IDLE_INPUT, yaw: p.yaw, pitch: p.pitch, sneak: true }
      }
      return { ...IDLE_INPUT, yaw: aim.yaw, pitch: aim.pitch, sneak: true }
    }
    if (tick < this.nextShot || !p.onGround) return null
    const fireballs = prof.fireball && tick >= this.nextFireball && countItem(p.inventory, 'fireball') > 0
    const bow = prof.bow && countItem(p.inventory, 'bow') > 0 && countItem(p.inventory, 'arrow') > 0
    if (!fireballs && !bow) return null
    for (const q of this.enemies(room)) {
      if (!this.exposed(room, q)) continue
      if (fireballs && this.inRange(room, p, q, ...FIREBALL_RANGE)) {
        // Aim under their feet: the blast takes the bridge with it.
        const aim = this.aimShot(room, p, q, FIREBALL.speed, 0, 1, -0.2)
        const slot = aim ? this.hotbarSlot(room, p, (id) => id === 'fireball') : -1
        if (aim && slot >= 0) {
          this.select(room, p, slot)
          p.yaw = aim.yaw
          p.pitch = aim.pitch
          room.receive(p.id, { t: 'throw' })
          this.nextFireball = tick + FIREBALL_COOLDOWN
          this.nextShot = tick + 10
          return { ...IDLE_INPUT, yaw: aim.yaw, pitch: aim.pitch }
        }
      }
      if (bow && this.inRange(room, p, q, ...BOW_RANGE)) {
        const aim = this.aimShot(room, p, q, ARROW.speed, ARROW.gravity, ARROW.drag, 1)
        const slot = aim ? this.hotbarSlot(room, p, (id) => item(id)?.kind === 'bow') : -1
        if (!aim || slot < 0) continue
        this.select(room, p, slot)
        room.receive(p.id, { t: 'draw' })
        if (p.drawStart !== tick) return null
        this.drawing = { target: q.id, start: tick }
        return { ...IDLE_INPUT, yaw: aim.yaw, pitch: aim.pitch, sneak: true }
      }
    }
    return null
  }

  private inRange(room: Room, p: Player, q: Player, min: number, max: number): boolean {
    const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)
    if (d < min || d > max) return false
    // A clear line from our eye to their body.
    const eye = room.eye(p)
    const to = [q.x - eye[0], q.y + 1 - eye[1], q.z - eye[2]]
    const len = Math.hypot(...to)
    const hit = raycastBlock(room.world, eye, to.map((v) => v / len), len, true)
    return !hit || hit.distance > len - 1
  }

  /** On a bridge or over the void: no map ground anywhere near under their feet. */
  private exposed(room: Room, q: Player): boolean {
    const fx = Math.floor(q.x)
    const fy = Math.floor(q.y + 0.01)
    const fz = Math.floor(q.z)
    for (let dy = 1; dy <= 3; dy++)
      for (let ox = -1; ox <= 1; ox++)
        for (let oz = -1; oz <= 1; oz++) {
          const [x, y, z] = [fx + ox, fy - dy, fz + oz]
          if (blockDef(room.world.get(x, y, z)).solid && !room.world.isPlaced(x, y, z)) return false
        }
    return true
  }

  /** Yaw and pitch that land a projectile on `q` (leading their movement), or null if out of reach. */
  private aimShot(room: Room, p: Player, q: Player, speed: number, gravity: number, drag: number, height: number) {
    const eye = room.eye(p)
    const from = [eye[0], eye[1] - 0.1, eye[2]]
    let t = Math.hypot(q.x - from[0], q.z - from[2]) / speed
    let solved: { pitch: number; ticks: number } | null = null
    let tx = q.x
    let tz = q.z
    for (let i = 0; i < 3; i++) {
      const lead = Math.min(t, 40)
      tx = q.x + q.vx * lead
      tz = q.z + q.vz * lead
      solved = solvePitch(Math.hypot(tx - from[0], tz - from[2]), q.y + height - from[1], speed, gravity, drag)
      if (!solved) return null
      t = solved.ticks
    }
    return solved && { yaw: Math.atan2(-(tx - from[0]), -(tz - from[2])), pitch: solved.pitch }
  }

  /** Expert bots knocked into the void throw a pearl back toward where they last stood. */
  private voidSave(room: Room, p: Player): MoveInput | null {
    const g = this.lastGround
    if (!this.profile.pearl || !g || p.onGround || p.vy > -0.2 || room.tickCount < this.nextPearl || p.y > g[1] - 1.5) return null
    const fx = Math.floor(p.x)
    const fz = Math.floor(p.z)
    for (let y = Math.floor(p.y); y > room.map.killY; y--) if (blockDef(room.world.get(fx, y, fz)).solid) return null
    const slot = this.hotbarSlot(room, p, (id) => id === 'pearl')
    if (slot < 0) return null
    const eye = room.eye(p)
    // Over the edge we fell from and a little beyond, so the pearl clears the edge and comes down on top.
    const back = Math.hypot(g[0] + 0.5 - p.x, g[2] + 0.5 - p.z) || 1
    const tx = g[0] + 0.5 + ((g[0] + 0.5 - p.x) / back) * 1.5
    const tz = g[2] + 0.5 + ((g[2] + 0.5 - p.z) / back) * 1.5
    const solved = solvePitch(Math.hypot(tx - eye[0], tz - eye[2]), g[1] + 2.5 - (eye[1] - 0.1), PEARL.speed, PEARL.gravity, PEARL.drag)
    if (!solved) return null
    this.nextPearl = room.tickCount + 2 * TPS
    this.select(room, p, slot)
    p.yaw = Math.atan2(-(tx - eye[0]), -(tz - eye[2]))
    p.pitch = solved.pitch
    room.receive(p.id, { t: 'throw' })
    return { ...IDLE_INPUT, yaw: p.yaw, pitch: p.pitch }
  }

  /** Stranded with no blocks: an expert throws its pearl back to base. */
  private pearlHome(room: Room, p: Player): MoveInput | null {
    if (!this.profile.pearl || !p.onGround || room.tickCount < this.nextPearl) return null
    const slot = this.hotbarSlot(room, p, (id) => id === 'pearl')
    if (slot < 0) return null
    const eye = room.eye(p)
    const [tx, ty, tz] = this.base(room).center
    const solved = solvePitch(Math.hypot(tx - eye[0], tz - eye[2]), ty + 0.3 - (eye[1] - 0.1), PEARL.speed, PEARL.gravity, PEARL.drag)
    if (!solved) return null
    this.nextPearl = room.tickCount + 5 * TPS
    this.select(room, p, slot)
    p.yaw = Math.atan2(-(tx - eye[0]), -(tz - eye[2]))
    p.pitch = solved.pitch
    room.receive(p.id, { t: 'throw' })
    this.trail = []
    this.setGoal(room, 'gather')
    return { ...IDLE_INPUT, yaw: p.yaw, pitch: p.pitch }
  }

  private enemies(room: Room): Player[] {
    return [...room.players.values()].filter((q) => q.alive && q.team && q.team !== this.team && !q.home)
  }

  private nearestEnemy(room: Room, p: Player, range: number): Player | null {
    let best: Player | null = null
    let bestD = range
    for (const q of this.enemies(room)) {
      const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)
      // Invisible enemies are only noticed up close, as a person would.
      if (q.effects.invisible > room.tickCount && d > 3) continue
      // Ignored after a stalled fight, unless they come and hit us or reach our bed.
      const hitUs = p.lastAttacker?.id === q.id && room.tickCount - p.lastAttacker.tick < TPS
      if ((this.ignored.get(q.id) ?? 0) > room.tickCount && !hitUs && !this.atOurBed(room, q)) continue
      if (d < bestD) {
        best = q
        bestD = d
      }
    }
    return best
  }

  // Hands -------------------------------------------------------------------------

  private select(room: Room, p: Player, slot: number) {
    if (p.selected !== slot) room.receive(p.id, { t: 'select', slot })
  }

  /** A hotbar slot holding a matching item, moving one up from storage if needed (as a player would). */
  private hotbarSlot(room: Room, p: Player, match: (id: string) => boolean): number {
    const index = p.inventory.findIndex((s) => s !== null && match(s.id))
    if (index < 0 || index < HOTBAR) return index
    const free = p.inventory.findIndex((s, i) => i < HOTBAR && (s === null || item(s.id)?.kind === 'resource'))
    const to = free >= 0 ? free : HOTBAR - 1
    room.receive(p.id, { t: 'swap', a: index, b: to })
    return to
  }
}

/** A solid neighbour to place a block at (x, y, z) against: below first, then the sides, then above. */
function supportFor(room: Room, x: number, y: number, z: number): Cell | null {
  const options: Cell[] = [[x, y - 1, z], [x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1], [x, y + 1, z]]
  return options.find(([ax, ay, az]) => room.world.get(ax, ay, az) !== AIR) ?? null
}

/**
 * The launch pitch (low arc) that brings a projectile `rise` blocks up at
 * `dist` blocks away, by stepping it as the server does (move, then gravity
 * and drag); null when it cannot get there.
 */
export function solvePitch(dist: number, rise: number, speed: number, gravity: number, drag: number): { pitch: number; ticks: number } | null {
  const heightAt = (pitch: number) => {
    let x = 0
    let y = 0
    let vx = speed * Math.cos(pitch)
    let vy = speed * Math.sin(pitch)
    for (let t = 1; t <= 120; t++) {
      if (x + vx >= dist) {
        const f = (dist - x) / vx
        return { y: y + vy * f, ticks: t - 1 + f }
      }
      x += vx
      y += vy
      vy = (vy - gravity) * drag
      vx *= drag
      if (vx < 1e-3) return null
    }
    return null
  }
  // Height at `dist` rises with pitch over this whole range for every projectile here.
  let lo = -1.2
  let hi = 1.4
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    const h = heightAt(mid)
    if (!h || h.y > rise) hi = mid
    else lo = mid
  }
  const h = heightAt(lo)
  return h && Math.abs(h.y - rise) < 0.5 ? { pitch: lo, ticks: h.ticks } : null
}

/** Sandbox training dummy: stands still and faces the nearest player; one keeps its shield up. */
export function dummyBrain(shield: boolean): Brain {
  return {
    think(room, p) {
      let yaw = p.yaw
      let best = 8
      for (const q of room.players.values()) {
        if (q === p || !q.alive || q.home) continue
        const d = Math.hypot(q.x - p.x, q.z - p.z)
        if (d < best) {
          best = d
          yaw = Math.atan2(-(q.x - p.x), -(q.z - p.z))
        }
      }
      if (shield) p.selected = Math.max(0, p.inventory.findIndex((s) => s?.id === 'shield'))
      return { ...IDLE_INPUT, yaw, shield }
    },
  }
}

/** Bots for a room, at the level its host picked (or the one `/bot` asks for). */
export function installBots(room: Room): void {
  room.createBot = (r, team, duel, level) => new Bot(team, r.random, duel, level ?? r.botLevel)
  room.createDummy = (_r, shield) => dummyBrain(shield)
}
