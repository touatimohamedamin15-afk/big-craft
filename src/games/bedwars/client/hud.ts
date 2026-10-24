import { TEAM_COLORS, TEAM_NAMES, TEAMS, type TeamId } from '../blocks'
import { BRAND, MAX_HEALTH, TPS } from '../constants'
import { OFFERS, TOOL_TIER_COST, UPGRADES, type Offer, type OfferCategory } from '../shop'
import { countItem, HOTBAR, INVENTORY_SIZE } from '../../../engine/inventory'
import { ARMOR_ORDER, AXES, item, PICKAXES } from '../items'
import type { ServerMessage } from '../protocol'
import { BOT_LEVELS, type BotLevel } from '../rules'
import type { Game } from './game'
import { keyLabel, type Action } from './settings'
import { openSettings } from './settings-ui'
import { openWardrobe } from './wardrobe'
import { inviteLink } from './rooms'

const RESOURCE_COLORS: Record<string, string> = { iron: '#e8e8e8', gold: '#f2cf4a', diamond: '#5fe0d8', emerald: '#38d36b' }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

function clock(ticks: number): string {
  const s = Math.max(0, Math.ceil(ticks / TPS))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const HEART = (fill: 'full' | 'half' | 'empty') =>
  `<svg viewBox="0 0 9 9" class="heart ${fill}"><path d="M1 1h2v1h1v1h1V2h1V1h2v1h1v3H8v1H7v1H6v1H5v1H4V8H3V7H2V6H1V5H0V2h1z"/>${fill === 'half' ? '<path class="half-cover" d="M5 2h1V1h2v1h1v3H8v1H7v1H6v1H5z"/>' : ''}</svg>`

/** All screen-space UI, as plain DOM over the canvas. */
export class Hud {
  private root = el('div', 'hud')
  private crosshair = el('div', 'crosshair')
  private charge = el('div', 'charge')
  private marker = el('div', 'hitmarker')
  private direction = el('div', 'damage-dir')
  private fps = el('div', 'fps')
  private hotbar = el('div', 'hotbar')
  private hearts = el('div', 'hearts')
  private armor = el('div', 'armor')
  private sidebar = el('div', 'sidebar panel')
  private feed = el('div', 'feed')
  private chatLog = el('div', 'chat-log')
  private chatInput = el('input', 'chat-input')
  private title = el('div', 'title')
  private center = el('div', 'center-note')
  private lobby = el('div', 'lobby panel')
  private scoreboard = el('div', 'scoreboard panel')
  private debug = el('pre', 'debug')
  private modal = el('div', 'modal')
  private help = el('div', 'help')
  private toasts = el('div', 'toasts')
  private vignette = el('div', 'vignette')
  private error = el('div', 'error-screen')
  private summary = el('div', 'summary panel')
  private loading = el('div', 'loading show')
  private backdrop = el('div', 'backdrop')
  private slots: HTMLDivElement[] = []
  private titleUntil = 0
  private debugOn = false
  private modalKind: 'shop' | 'upgrades' | 'inventory' | null = null
  private shopTab: OfferCategory = 'blocks'
  private pickedSlot: number | null = null
  private lastRender = 0
  private lastFps = 0
  chatOpen = false

  constructor(
    container: HTMLElement,
    private readonly game: Game,
  ) {
    for (let i = 0; i < HOTBAR; i++) {
      const s = el('div', 'slot')
      this.slots.push(s)
      this.hotbar.append(s)
    }
    const bottom = el('div', 'bottom')
    const stats = el('div', 'stats')
    stats.append(this.hearts, this.armor)
    bottom.append(stats, this.hotbar)
    this.chatInput.maxLength = 200
    this.chatInput.placeholder = 'Team chat; start with ! for everyone, / for commands'
    const chat = el('div', 'chat')
    chat.append(this.chatLog, this.chatInput)
    this.renderPause()
    this.root.append(this.vignette, this.direction, this.crosshair, this.marker, this.charge, this.fps, this.sidebar, this.feed, chat, this.title, this.center, this.backdrop, this.lobby, this.scoreboard, this.debug, bottom, this.toasts, this.summary, this.modal, this.help, this.loading, this.error)
    this.backdrop.addEventListener('click', () => this.game.lock())
    container.append(this.root)

    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim()
        if (text) this.game.send({ t: 'chat', text })
        this.closeChat()
      } else if (e.key === 'Escape') this.closeChat()
    })
    this.modal.addEventListener('mousedown', (e) => {
      if (e.target === this.modal) this.closeModal()
    })
    // Clicking the dimmed backdrop also resumes; the card's own controls do not.
    this.help.addEventListener('click', (e) => {
      if (e.target === this.help) this.game.lock()
    })
    this.summary.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.close !== undefined) this.summary.classList.remove('show')
    })
  }

  get modalOpen(): boolean {
    return this.modalKind !== null || this.chatOpen || this.settingsOpen
  }

  settingsOpen = false

  /** The pause card: resume, settings, leave, and the keys as they are bound now. */
  private renderPause() {
    const k = (a: Action) => (this.game.settings.keys[a] ?? []).map(keyLabel).join(' or ') || 'unbound'
    const sprint = this.game.settings.sprintMode === 'always' ? 'always on' : `${k('sprint')}${this.game.settings.doubleTapSprint ? ', or double-tap forward' : ''}`
    this.help.innerHTML = `<div class="help-card"><h1>${BRAND}</h1>
      <div class="pause-row"><button class="btn primary" data-pause="resume">Back to game</button><button class="btn" data-pause="wardrobe">Wardrobe</button><button class="btn" data-pause="settings">Settings</button><button class="btn" data-pause="leave">Leave</button></div>
      <div class="keys">
        <span><kbd>${k('forward')}</kbd> <kbd>${k('left')}</kbd> <kbd>${k('back')}</kbd> <kbd>${k('right')}</kbd> move</span>
        <span><kbd>${k('jump')}</kbd> jump</span><span><kbd>${k('sneak')}</kbd> sneak</span><span><kbd>${sprint}</kbd> sprint</span>
        <span><kbd>Left click</kbd> hit, break</span><span><kbd>Right click</kbd> place, use, shop</span><span><kbd>1-9</kbd> hotbar</span>
        <span><kbd>${k('drop')}</kbd> drop</span><span><kbd>${k('inventory')}</kbd> inventory</span><span><kbd>${k('shop')}</kbd> shop</span><span><kbd>${k('players')}</kbd> players</span>
        <span><kbd>${k('chat')}</kbd> chat</span><span><kbd>${k('debug')}</kbd> debug</span>
      </div><p class="muted small">Every control is explained, and can be changed, in Settings, Controls.</p></div>`
    this.help.querySelector('[data-pause="resume"]')!.addEventListener('click', () => this.game.lock())
    this.help.querySelector('[data-pause="settings"]')!.addEventListener('click', () => this.openSettingsWindow())
    this.help.querySelector('[data-pause="wardrobe"]')!.addEventListener('click', () => {
      if (this.settingsOpen) return
      this.settingsOpen = true
      this.syncMenus()
      openWardrobe(
        this.root,
        this.game.self?.team ?? null,
        (look) => this.game.setLook(look),
        () => {
          this.settingsOpen = false
          this.syncMenus()
        },
      )
    })
    this.help.querySelector('[data-pause="leave"]')!.addEventListener('click', () => {
      this.game.destroy()
      location.href = location.pathname
    })
  }

  openSettingsWindow() {
    if (this.settingsOpen) return
    this.settingsOpen = true
    document.exitPointerLock?.()
    this.syncMenus()
    openSettings(
      this.root,
      this.game.settings,
      (s) => this.game.applySettings(s),
      () => {
        this.settingsOpen = false
        this.renderPause()
        this.syncMenus()
      },
    )
  }

  destroy() {
    this.root.remove()
  }

  setLocked(_locked: boolean) {
    this.syncMenus()
  }

  /** In the lobby, Esc opens the lobby screen; otherwise it opens the pause menu. */
  private inLobby(): boolean {
    const v = this.game.gameView
    return !!v && v.mode === 'arena' && (v.phase === 'waiting' || v.phase === 'countdown')
  }

  private syncMenus() {
    // Scripted play (game.automation) never captures the mouse; treat it as playing.
    const free = !this.game.locked && !this.game.automation && !this.modalOpen
    this.help.classList.toggle('hidden', !free || this.inLobby())
    this.backdrop.classList.toggle('show', free && this.inLobby())
    this.lobby.classList.toggle('open', free && this.inLobby())
  }

  showError(reason: string) {
    document.exitPointerLock?.()
    this.loading.classList.remove('show')
    this.error.innerHTML = `<div class="box"><h2>${escapeHtml(reason)}</h2><p class="muted">Your connection to the game ended. Trying again rejoins the same room.</p><div class="row"><button class="btn primary" data-retry>Try again</button><button class="btn" data-menu>Back to menu</button></div></div>`
    this.error.classList.add('show')
    this.error.querySelector('[data-retry]')!.addEventListener('click', () => location.reload())
    this.error.querySelector('[data-menu]')!.addEventListener('click', () => (location.href = location.pathname))
  }

  /** Hidden once we have a world and our own state. */
  setLoading(text: string | null) {
    this.loading.classList.toggle('show', text !== null)
    if (text) this.loading.innerHTML = `<div class="box"><h2>${text}</h2><div class="bar"><i></i></div></div>`
  }

  /** The end-of-round table; it stays up until the round resets or it is closed. */
  showSummary(m: Extract<ServerMessage, { t: 'summary' }>) {
    const rows = m.players
      .map((p) => `<tr${p.id === this.game.myId ? ' class="me"' : ''}><td><i style="background:${TEAM_COLORS[p.team]}"></i>${escapeHtml(p.name)}</td><td>${p.finals}</td><td>${p.kills}</td><td>${p.beds}</td><td>${p.deaths}</td></tr>`)
      .join('')
    const title = m.winner === 'draw' ? 'Draw' : `${TEAM_NAMES[m.winner]} wins`
    this.summary.innerHTML = `<div class="window-head"><h2>${title}</h2><button class="btn ghost" data-close>Close</button></div>
      <table><thead><tr><th>Player</th><th>Finals</th><th>Kills</th><th>Beds</th><th>Deaths</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted small">Back to the lobby in ${Math.round(m.lobbyIn / TPS)} seconds.</p>`
    this.summary.classList.add('show')
  }

  hurtFlash() {
    this.restart(this.vignette, 'hit')
    this.restart(this.hearts, 'shake')
  }

  /** The X around the crosshair when your hit lands; yellow for a critical hit. */
  hitMarker(crit: boolean) {
    this.marker.classList.toggle('crit', crit)
    this.restart(this.marker, 'show')
  }

  /** A red arc around the crosshair pointing toward where a hit came from (0 = straight ahead). */
  damageFrom(angle: number) {
    this.direction.style.setProperty('--angle', `${angle}rad`)
    this.restart(this.direction, 'show')
  }

  private restart(e: HTMLElement, cls: string) {
    e.classList.remove(cls)
    void e.offsetWidth
    e.classList.add(cls)
  }

  toast(text: string) {
    const t = el('div', 'toast', text)
    this.toasts.append(t)
    setTimeout(() => t.remove(), 2600)
  }

  event(m: Extract<ServerMessage, { t: 'event' }>) {
    switch (m.kind) {
      case 'title':
        this.title.innerHTML = `<div class="big">${escapeHtml(m.text)}</div>${m.sub ? `<div class="sub">${escapeHtml(m.sub)}</div>` : ''}`
        this.titleUntil = performance.now() + 3200
        break
      case 'kill':
      case 'bed': {
        const line = el('div', `feed-line ${m.kind}`, m.text)
        if (m.team) line.style.setProperty('--team', TEAM_COLORS[m.team])
        this.feed.prepend(line)
        while (this.feed.children.length > 6) this.feed.lastChild!.remove()
        setTimeout(() => line.classList.add('fade'), 7000)
        this.chatLine(m.text, m.kind)
        break
      }
      case 'error':
        this.toast(m.text)
        break
      default:
        this.chatLine(m.text, m.kind, m.team)
    }
  }

  private chatLine(text: string, kind: string, team?: TeamId) {
    const line = el('div', `chat-line ${kind}`)
    if (kind === 'chat' && team) {
      const [name, ...rest] = text.split(': ')
      const n = el('span', 'name', name)
      n.style.color = TEAM_COLORS[team]
      line.append(n, document.createTextNode(`: ${rest.join(': ')}`))
    } else line.textContent = text
    this.chatLog.append(line)
    while (this.chatLog.children.length > 60) this.chatLog.firstChild!.remove()
    this.chatLog.scrollTop = this.chatLog.scrollHeight
    setTimeout(() => line.classList.add('old'), 10_000)
  }

  openChat(prefix: string) {
    this.chatOpen = true
    document.exitPointerLock?.()
    this.root.classList.add('chatting')
    this.chatInput.value = prefix
    setTimeout(() => this.chatInput.focus(), 0)
  }

  private closeChat() {
    this.chatOpen = false
    this.root.classList.remove('chatting')
    this.chatInput.blur()
    this.game.lock()
  }

  toggleDebug() {
    this.debugOn = !this.debugOn
  }

  setScoreboard(show: boolean) {
    this.scoreboard.classList.toggle('show', show)
    if (show) this.renderScoreboard()
  }

  closeModal() {
    this.modalKind = null
    this.pickedSlot = null
    this.modal.classList.remove('show')
    this.modal.innerHTML = ''
    this.game.lock()
  }

  private openModal(kind: 'shop' | 'upgrades' | 'inventory') {
    this.modalKind = kind
    document.exitPointerLock?.()
    this.modal.classList.add('show')
    this.renderModal()
  }

  openShop(kind: 'shop' | 'upgrades') {
    this.openModal(kind)
  }

  openInventory() {
    this.openModal('inventory')
  }

  // Per-frame ---------------------------------------------------------------

  frame(now: number) {
    const g = this.game
    const self = g.self
    if (now > this.titleUntil) this.title.classList.remove('show')
    else this.title.classList.add('show')
    if (this.debugOn) {
      const d = g.debugInfo()
      const f = (v: number) => v.toFixed(3)
      this.debug.textContent = [
        `${BRAND}  ${d.fps} fps  tick ${d.tick}`,
        `xyz ${d.pos.map(f).join(' ')}`,
        `vel ${d.vel.map(f).join(' ')}`,
        `onGround ${d.onGround}  sneaking ${d.sneaking}  sprinting ${d.sprinting}`,
        `fall ${d.fall.toFixed(2)}  sunlight ${d.light}`,
        `yaw ${d.yaw.toFixed(2)}  pitch ${d.pitch.toFixed(2)}`,
        `target ${d.target}`,
        `dig ${(d.dig * 100).toFixed(0)}%`,
      ].join('\n')
    }
    this.debug.classList.toggle('show', this.debugOn)
    this.syncMenus()
    this.fps.classList.toggle('show', g.settings.showFps && !this.debugOn)
    if (g.settings.showFps && now - this.lastFps > 500) {
      this.lastFps = now
      this.fps.textContent = `${g.debugInfo().fps} fps`
    }
    const draw = g.drawCharge()
    this.charge.style.setProperty('--draw', String(draw))
    this.charge.classList.toggle('show', draw > 0)
    // DOM work a few times a second is plenty for everything else.
    if (now - this.lastRender < 100) return
    this.lastRender = now
    if (!self) return
    this.renderHotbar()
    this.renderStats()
    this.renderSidebar()
    this.renderLobby()
    this.renderCenter()
    if (this.scoreboard.classList.contains('show')) this.renderScoreboard()
    if (this.modalKind) this.renderModal()
    this.crosshair.classList.toggle('hidden', !self.alive)
  }

  private renderHotbar() {
    const self = this.game.self!
    const team = self.team ?? 'red'
    for (let i = 0; i < HOTBAR; i++) {
      const s = self.inventory[i]
      const key = `${s?.id ?? ''}:${s?.count ?? 0}:${i === self.selected}:${team}`
      const slot = this.slots[i]
      if (slot.dataset.key === key) continue
      slot.dataset.key = key
      slot.classList.toggle('selected', i === self.selected)
      slot.innerHTML = s ? `<img src="${this.game.icons.url(s.id, team)}" alt=""><span class="count">${s.count > 1 ? s.count : ''}</span>` : ''
      slot.title = s ? (item(s.id)?.name ?? s.id) : ''
    }
    this.hotbar.classList.toggle('hidden', !self.alive)
  }

  private renderStats() {
    const self = this.game.self!
    const hp = Math.max(0, self.health)
    const left = (e: 'speed' | 'jump' | 'invisible') => Math.max(0, Math.ceil(((self.effects?.[e] ?? 0) - this.game.tickNow()) / TPS))
    const effects = [['speed', 'Speed'], ['jump', 'Jump'], ['invisible', 'Invisible']]
      .map(([e, label]) => [label, left(e as 'speed')] as const)
      .filter(([, s]) => s > 0)
      .map(([label, s]) => `${label} ${s}s`)
      .join(', ')
    const key = `${hp}:${self.armor}:${self.alive}:${self.protectedTicks > 0}:${effects}`
    if (this.hearts.dataset.key === key) return
    this.hearts.dataset.key = key
    let html = ''
    for (let i = 0; i < MAX_HEALTH / 2; i++) html += HEART(hp >= (i + 1) * 2 ? 'full' : hp === i * 2 + 1 ? 'half' : 'empty')
    this.hearts.innerHTML = html
    this.hearts.classList.toggle('hidden', !self.alive)
    this.armor.textContent = self.alive ? `${self.armor[0].toUpperCase()}${self.armor.slice(1)} armour${self.protectedTicks > 0 ? ', spawn shield' : ''}${effects ? `, ${effects}` : ''}` : ''
  }

  private renderSidebar() {
    const g = this.game
    const view = g.gameView
    const self = g.self!
    if (!view) return
    const rows: string[] = [`<div class="brand">${BRAND}</div>`]
    if (view.mode === 'sandbox') rows.push('<div class="line muted">Sandbox: try every mechanic. /help for commands.</div>')
    else if (view.phase === 'waiting') rows.push('<div class="line muted">Waiting for players</div>')
    else if (view.phase === 'countdown') rows.push(`<div class="line">Starting in <b>${Math.ceil(g.clock() / TPS)}</b></div>`)
    else if (view.phase === 'playing') {
      rows.push(`<div class="line muted">Time <b>${clock(g.clock())}</b></div>`)
      if (view.next) rows.push(`<div class="line">${view.next.label} in <b>${clock(view.next.in - (g.clock() - view.clock))}</b></div>`)
    } else rows.push(`<div class="line">${view.winner === 'draw' ? 'Draw' : view.winner ? `${TEAM_NAMES[view.winner]} wins` : 'Round over'}</div>`)
    if (view.mode === 'arena' && view.phase !== 'waiting' && view.phase !== 'countdown') {
      rows.push('<div class="teams">')
      for (const t of view.teams) {
        const state = t.eliminated ? '<span class="x">out</span>' : t.bed ? '<span class="ok">bed</span>' : `<span class="warn">${t.alive}</span>`
        rows.push(`<div class="team-row${t.team === self.team ? ' mine' : ''}"><i style="background:${TEAM_COLORS[t.team]}"></i>${TEAM_NAMES[t.team]}${t.team === self.team ? ' (you)' : ''}<span class="right">${state}</span></div>`)
      }
      rows.push('</div>')
    }
    const res = ['iron', 'gold', 'diamond', 'emerald'].map((r) => `<span class="res"><i style="background:${RESOURCE_COLORS[r]}"></i>${countItem(self.inventory, r)}</span>`).join('')
    rows.push(`<div class="resources">${res}</div>`)
    if (view.mode === 'arena') rows.push(`<div class="line muted small">Kills ${self.stats.kills}, finals ${self.stats.finals}, beds ${self.stats.beds}</div>`)
    const html = rows.join('')
    if (this.sidebar.dataset.html !== html) {
      this.sidebar.dataset.html = html
      this.sidebar.innerHTML = html
    }
  }

  /** The invite link was just copied (the button says so for a moment). */
  private copied = false

  private renderLobby() {
    const g = this.game
    if (g.gameView?.phase === 'waiting') this.summary.classList.remove('show')
    const view = g.gameView
    const self = g.self!
    const show = !!view && view.mode === 'arena' && (view.phase === 'waiting' || view.phase === 'countdown')
    this.lobby.classList.toggle('show', show)
    if (!show || !view) return
    const isHost = view.host === g.myId
    const people = g.views.filter((p) => !p.bot)
    const key = JSON.stringify([view.teams, view.phase, Math.ceil(g.clock() / TPS), self.team, isHost, view.bots, g.botLevel, people.map((p) => [p.id, p.name, p.team]), g.votes, g.myVote, g.locked, this.copied])
    if (this.lobby.dataset.key === key) return
    this.lobby.dataset.key = key
    const teamButtons = TEAMS.map((t) => {
      const n = g.views.filter((p) => p.team === t).length
      return `<button class="btn team${self.team === t ? ' chosen' : ''}" data-team="${t}" style="--team:${TEAM_COLORS[t]}"><i></i>${TEAM_NAMES[t]}<span>${n}</span></button>`
    }).join('')
    const humans = people.length
    if (g.locked) {
      // Playing on the lobby deck: a one-line banner; Esc opens the full lobby screen.
      this.lobby.innerHTML = `<div class="banner">${view.phase === 'countdown' ? `Starting in ${Math.ceil(g.clock() / TPS)}` : 'Waiting for players'}. Press Esc to pick a team${isHost ? ' or start' : ''}.</div>`
      return
    }
    const q = new URLSearchParams(location.search)
    const roomName = q.get('room') ?? 'main'
    const invite = g.mode.offline ? null : inviteLink(roomName, { private: q.get('private') === '1', fast: q.get('fast') === '1' })
    const status =
      view.phase === 'countdown'
        ? `The round starts in ${Math.ceil(g.clock() / TPS)} seconds.`
        : humans < 2
          ? `Waiting for someone else to join.${isHost ? ' You can also start now and play the bots.' : ''}`
          : isHost
            ? 'Everyone here can start. Press Start now when you are ready.'
            : 'Waiting for the host to start.'
    const roster = people
      .map((p) => `<li><i style="background:${p.team ? TEAM_COLORS[p.team] : '#8b8b8b'}"></i>${escapeHtml(p.name)}${p.id === g.myId ? ' <span class="muted">(you)</span>' : ''}${p.id === view.host ? ' <span class="tag">host</span>' : ''}<span class="muted right">${p.team ? TEAM_NAMES[p.team] : 'no team yet'}</span></li>`)
      .join('')
    this.lobby.innerHTML = `
      <div class="lobby-head"><h2>${view.phase === 'countdown' ? `Starting in ${Math.ceil(g.clock() / TPS)}` : 'Waiting for players'}</h2>${g.mode.offline ? '<span class="tag">Solo</span>' : `<span class="tag">Room ${escapeHtml(roomName)}${q.get('private') === '1' ? ' · invite only' : ''}</span>`}</div>
      <p class="status-line">${status}</p>
      ${invite ? `<div class="invite-row"><input readonly value="${escapeHtml(invite)}" aria-label="Invite link"><button class="btn" data-act="copy">${this.copied ? 'Copied' : 'Copy invite link'}</button></div>` : ''}
      <p class="label">In this room (${humans})</p>
      <ul class="roster">${roster}</ul>
      ${view.bots ? `<p class="muted small">${levelName(g.botLevel)} bots fill empty teams when the round starts; anyone who joins mid-round takes a bot's place.</p>` : ''}
      <p class="label">Team</p>
      <div class="team-grid">${teamButtons}</div>
      ${g.votes ? `<p class="label">Arena</p><div class="map-grid">${g.votes.maps.map((m) => `<button class="btn map${g.myVote === m.id ? ' chosen' : ''}" data-map="${m.id}">${m.name}<span>${m.votes}</span></button>`).join('')}</div>` : ''}
      ${isHost && view.bots ? `<p class="label">Bot level</p><div class="team-grid">${BOT_LEVELS.map((l) => `<button class="btn${g.botLevel === l ? ' chosen' : ''}" data-level="${l}">${levelName(l)}</button>`).join('')}</div>` : ''}
      ${isHost ? `<div class="row"><button class="btn primary" data-act="start"${view.phase === 'countdown' ? ' disabled' : ''}>Start now</button><button class="btn" data-act="bots">${view.bots ? 'Bots: on' : 'Bots: off'}</button><button class="btn" data-act="resume">Back to game</button></div>` : '<div class="row"><button class="btn" data-act="resume">Back to game</button></div>'}`
    this.lobby.querySelector('[data-act="resume"]')?.addEventListener('click', () => g.lock())
    this.lobby.querySelector('[data-act="copy"]')?.addEventListener('click', () => {
      const field = this.lobby.querySelector<HTMLInputElement>('.invite-row input')!
      field.select()
      const done = () => {
        this.copied = true
        setTimeout(() => (this.copied = false), 2000)
      }
      if (navigator.clipboard) navigator.clipboard.writeText(field.value).then(done, () => document.execCommand('copy') && done())
      else if (document.execCommand('copy')) done()
    })
    this.lobby.querySelectorAll<HTMLButtonElement>('[data-team]').forEach((b) => b.addEventListener('click', () => g.send({ t: 'team', team: b.dataset.team as TeamId })))
    this.lobby.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) =>
      b.addEventListener('click', () => {
        g.myVote = b.dataset.map!
        g.send({ t: 'vote', map: b.dataset.map! })
      }),
    )
    this.lobby.querySelector('[data-act="start"]')?.addEventListener('click', () => g.send({ t: 'start' }))
    this.lobby.querySelector('[data-act="bots"]')?.addEventListener('click', () => g.send({ t: 'settings', bots: !view.bots }))
    this.lobby.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => b.addEventListener('click', () => g.send({ t: 'settings', bots: view.bots, botLevel: b.dataset.level as BotLevel })))
  }

  private renderCenter() {
    const self = this.game.self!
    let text = ''
    if (self.respawnIn !== null) text = `<div class="big">You died</div><div class="sub">Respawning in ${Math.ceil(self.respawnIn / TPS)}</div>`
    else if (self.eliminated && this.game.gameView?.phase === 'playing') text = '<div class="sub">Spectating. Fly with WASD, Space and Shift.</div>'
    if (this.center.dataset.html !== text) {
      this.center.dataset.html = text
      this.center.innerHTML = text
    }
  }

  private renderScoreboard() {
    const g = this.game
    const rows = [...g.views]
      .sort((a, b) => (a.team ?? 'z').localeCompare(b.team ?? 'z'))
      .map((p) => `<div class="score-row"><i style="background:${p.team ? TEAM_COLORS[p.team] : '#888'}"></i><span class="name">${escapeHtml(p.name)}${p.id === g.myId ? ' (you)' : ''}</span><span class="right">${p.alive ? `${p.health} hp` : 'dead'}</span></div>`)
      .join('')
    this.scoreboard.innerHTML = `<h3>Players</h3>${rows}`
  }

  // Modals -------------------------------------------------------------------

  private renderModal() {
    const self = this.game.self
    if (!self || !this.modalKind) return
    const key = JSON.stringify([this.modalKind, this.shopTab, self.inventory, self.armor, self.upgrades, self.pickaxeTier, self.axeTier, this.pickedSlot])
    if (this.modal.dataset.key === key) return
    this.modal.dataset.key = key
    if (this.modalKind === 'shop') this.renderShop()
    else if (this.modalKind === 'upgrades') this.renderUpgrades()
    else this.renderInventory()
  }

  private renderShop() {
    const self = this.game.self!
    const team = self.team ?? 'red'
    const tabs: [OfferCategory, string][] = [['blocks', 'Blocks'], ['melee', 'Melee'], ['armor', 'Armour'], ['tools', 'Tools'], ['ranged', 'Ranged'], ['utility', 'Utility'], ['potions', 'Potions']]
    const offers = OFFERS.filter((o) => o.category === this.shopTab)
    const cards = offers.map((o) => this.offerCard(o)).join('')
    this.modal.innerHTML = `<div class="window panel">
      <div class="window-head"><h2>Item shop</h2><button class="btn ghost" data-close>Close</button></div>
      <div class="tabs">${tabs.map(([id, label]) => `<button class="tab${id === this.shopTab ? ' on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
      <div class="offers">${cards}</div>
      <div class="wallet">${['iron', 'gold', 'diamond', 'emerald'].map((r) => `<span class="res"><i style="background:${RESOURCE_COLORS[r]}"></i>${countItem(self.inventory, r)} ${r}</span>`).join('')}</div>
    </div>`
    void team
    this.modal.querySelector('[data-close]')!.addEventListener('click', () => this.closeModal())
    this.modal.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.shopTab = b.dataset.tab as OfferCategory
        this.renderModal()
      }),
    )
    this.modal.querySelectorAll<HTMLButtonElement>('[data-offer]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!b.classList.contains('dim')) this.game.sound.play('buy')
        this.game.send({ t: 'buy', offer: b.dataset.offer! })
      }),
    )
  }

  private offerCard(o: Offer): string {
    const self = this.game.self!
    let icon = o.icon
    let cost = o.cost
    let owned = false
    let name = o.name
    if (o.give.kind === 'pickaxe' || o.give.kind === 'axe') {
      const tier = o.give.kind === 'pickaxe' ? self.pickaxeTier : self.axeTier
      const list = o.give.kind === 'pickaxe' ? PICKAXES : AXES
      owned = tier >= 3
      icon = list[Math.min(3, tier + 1)]
      name = item(icon)?.name ?? name
      cost = TOOL_TIER_COST[Math.min(3, tier + 1)]
    }
    if (o.give.kind === 'armor') owned = ARMOR_ORDER.indexOf(o.give.tier) <= ARMOR_ORDER.indexOf(self.armor)
    if (o.give.kind === 'shears') owned = countItem(self.inventory, 'shears') > 0
    const affordable = cost.every((c) => countItem(self.inventory, c.resource) >= c.amount)
    const price = cost.map((c) => `<span style="color:${RESOURCE_COLORS[c.resource]}">${c.amount} ${c.resource}</span>`).join(' ')
    return `<button class="offer${affordable && !owned ? '' : ' dim'}" data-offer="${o.id}"${owned ? ' disabled' : ''}>
      <img src="${this.game.icons.url(icon, self.team ?? 'red')}" alt=""><span class="offer-name">${name}</span><span class="price">${owned ? 'Owned' : price}</span></button>`
  }

  private renderUpgrades() {
    const self = this.game.self!
    const diamonds = countItem(self.inventory, 'diamond')
    const cards = UPGRADES.map((u) => {
      const level = self.upgrades[u.id]
      const maxed = level >= u.levels.length
      const cost = maxed ? 0 : u.levels[level]
      const pips = u.levels.map((_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')
      return `<button class="offer wide${maxed || diamonds < cost ? ' dim' : ''}" data-upgrade="${u.id}"${maxed ? ' disabled' : ''}>
        <span class="offer-name">${u.name}</span><span class="desc">${u.description}</span><span class="pips">${pips}</span>
        <span class="price">${maxed ? 'Maxed' : `<span style="color:${RESOURCE_COLORS.diamond}">${cost} diamond${cost === 1 ? '' : 's'}</span>`}</span></button>`
    }).join('')
    this.modal.innerHTML = `<div class="window panel">
      <div class="window-head"><h2>Team upgrades</h2><button class="btn ghost" data-close>Close</button></div>
      <div class="offers single">${cards}</div>
      <div class="wallet"><span class="res"><i style="background:${RESOURCE_COLORS.diamond}"></i>${diamonds} diamonds</span></div></div>`
    this.modal.querySelector('[data-close]')!.addEventListener('click', () => this.closeModal())
    this.modal.querySelectorAll<HTMLButtonElement>('[data-upgrade]').forEach((b) => b.addEventListener('click', () => this.game.send({ t: 'upgrade', id: b.dataset.upgrade as never })))
  }

  private renderInventory() {
    const self = this.game.self!
    const team = self.team ?? 'red'
    const cell = (i: number) => {
      const s = self.inventory[i]
      return `<button class="slot inv${this.pickedSlot === i ? ' picked' : ''}${i < HOTBAR ? ' hot' : ''}" data-slot="${i}">${s ? `<img src="${this.game.icons.url(s.id, team)}" alt=""><span class="count">${s.count > 1 ? s.count : ''}</span>` : ''}</button>`
    }
    const storage = Array.from({ length: INVENTORY_SIZE - HOTBAR }, (_, k) => cell(k + HOTBAR)).join('')
    const hot = Array.from({ length: HOTBAR }, (_, k) => cell(k)).join('')
    this.modal.innerHTML = `<div class="window panel narrow">
      <div class="window-head"><h2>Inventory</h2><button class="btn ghost" data-close>Close</button></div>
      <p class="muted small">Click two slots to swap them.</p>
      <div class="inv-grid">${storage}</div><div class="inv-grid hotrow">${hot}</div></div>`
    this.modal.querySelector('[data-close]')!.addEventListener('click', () => this.closeModal())
    this.modal.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.slot)
        if (this.pickedSlot === null) this.pickedSlot = i
        else {
          const a = this.pickedSlot
          this.pickedSlot = null
          if (a !== i) {
            ;[self.inventory[a], self.inventory[i]] = [self.inventory[i], self.inventory[a]]
            this.game.send({ t: 'swap', a, b: i })
          }
        }
        this.renderModal()
      }),
    )
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function levelName(level: BotLevel): string {
  return level[0].toUpperCase() + level.slice(1)
}
