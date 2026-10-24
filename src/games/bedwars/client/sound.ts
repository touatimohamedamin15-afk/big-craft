/**
 * Sound effects synthesised with Web Audio: no audio files. The context starts
 * on the first click (browsers require a gesture); before that, sounds are
 * silently skipped.
 */
export type SoundName = 'hit' | 'hurt' | 'break' | 'place' | 'pickup' | 'kill' | 'bed' | 'tick' | 'start' | 'buy' | 'deny' | 'explode' | 'bow' | 'throw'

export class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  volume = 0.5

  setVolume(v: number) {
    this.volume = v
    if (this.master) this.master.gain.value = v
  }

  /** Call from a user gesture (the click that locks the pointer). */
  unlock() {
    if (this.ctx) return void this.ctx.resume()
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.volume
    this.master.connect(this.ctx.destination)
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.noise = buf
  }

  /** `gain` 0..1 scales a sound, e.g. by distance. `pitch` shifts it. */
  play(name: SoundName, gain = 1, pitch = 1) {
    const ctx = this.ctx
    if (!ctx || !this.master || gain <= 0.01) return
    const t = ctx.currentTime
    const out = ctx.createGain()
    out.gain.value = gain
    out.connect(this.master)
    const tone = (freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.2, slide = 1) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = type
      o.frequency.setValueAtTime(freq * pitch, t + start)
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * pitch * slide), t + start + dur)
      g.gain.setValueAtTime(vol, t + start)
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur)
      o.connect(g).connect(out)
      o.start(t + start)
      o.stop(t + start + dur + 0.02)
    }
    const burst = (dur: number, freq: number, vol = 0.4, q = 1) => {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = freq * pitch
      f.Q.value = q
      const g = ctx.createGain()
      g.gain.setValueAtTime(vol, t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      src.connect(f).connect(g).connect(out)
      src.start(t)
      src.stop(t + dur + 0.02)
    }
    switch (name) {
      case 'hit':
        burst(0.12, 900, 0.5, 0.8)
        tone(180, 0, 0.1, 'triangle', 0.3, 0.5)
        break
      case 'hurt':
        tone(220, 0, 0.18, 'sawtooth', 0.18, 0.6)
        burst(0.1, 500, 0.3)
        break
      case 'break':
        burst(0.18, 700, 0.6, 0.7)
        burst(0.1, 2200, 0.25, 1.5)
        break
      case 'place':
        burst(0.07, 1200, 0.35, 1.2)
        tone(140, 0, 0.06, 'triangle', 0.2, 0.8)
        break
      case 'pickup':
        tone(880, 0, 0.06, 'square', 0.08, 1.5)
        tone(1320, 0.05, 0.06, 'square', 0.06, 1.2)
        break
      case 'kill':
        tone(660, 0, 0.12, 'triangle', 0.25)
        tone(990, 0.1, 0.2, 'triangle', 0.25)
        break
      case 'bed':
        tone(520, 0, 0.6, 'sawtooth', 0.18, 0.3)
        tone(390, 0.15, 0.6, 'sawtooth', 0.14, 0.3)
        break
      case 'tick':
        tone(1000, 0, 0.05, 'square', 0.12)
        break
      case 'start':
        tone(523, 0, 0.25, 'triangle', 0.2)
        tone(659, 0.08, 0.25, 'triangle', 0.2)
        tone(784, 0.16, 0.4, 'triangle', 0.2)
        break
      case 'buy':
        tone(740, 0, 0.07, 'square', 0.1)
        tone(1110, 0.06, 0.1, 'square', 0.1)
        break
      case 'explode':
        burst(0.9, 120, 1.2, 0.4)
        burst(0.5, 400, 0.6, 0.6)
        tone(60, 0, 0.6, 'sine', 0.5, 0.4)
        break
      case 'bow':
        tone(300, 0, 0.12, 'triangle', 0.18, 2)
        burst(0.08, 3000, 0.2, 2)
        break
      case 'throw':
        burst(0.15, 1500, 0.3, 0.8)
        break
      case 'deny':
        tone(200, 0, 0.15, 'square', 0.12, 0.8)
        break
    }
  }
}

/** Loudness for a sound at `distance` blocks. */
export function falloff(distance: number, range = 24): number {
  return Math.max(0, 1 - distance / range) ** 1.5
}
