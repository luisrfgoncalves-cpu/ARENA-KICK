// ============================================================
//  audio.ts — Áudio real (motor, torcida, trilha e SFX)
//  Samples CC0/CC-BY em /public/audio
// ============================================================
import { Howl, Howler } from 'howler'

export type SoundKey =
  | 'hit'
  | 'powerHit'
  | 'dash'
  | 'wallBounce'
  | 'postHit'
  | 'goal'
  | 'goalFanfare'
  | 'whistle'
  | 'countdown'
  | 'countdownGo'
  | 'kickoffArp'
  | 'victory'
  | 'boost'
  | 'crowd'
  | 'cheer'

const SFX = '/audio/sfx'
const CROWD = '/audio/crowd'
const ENGINE = '/audio/engine'
const MUSIC = '/audio/music'

let sounds: Record<SoundKey, Howl> | null = null
let bgm: Howl | null = null
let bgmShouldPlay = false

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function initAudio() {
  if (sounds) return
  sounds = {
    hit: new Howl({ src: [`${SFX}/hit.ogg`], volume: 0.7 }),
    powerHit: new Howl({ src: [`${SFX}/kick.ogg`], volume: 0.9 }),
    dash: new Howl({ src: [`${SFX}/swish.wav`], volume: 0.5 }),
    wallBounce: new Howl({ src: [`${SFX}/hit.ogg`], volume: 0.45, rate: 1.2 }),
    postHit: new Howl({ src: [`${SFX}/post.ogg`], volume: 0.85 }),
    goal: new Howl({ src: [`${CROWD}/cheer_strong.mp3`], volume: 0.95 }),
    goalFanfare: new Howl({ src: [`${CROWD}/cheer_soft.mp3`], volume: 0.5 }),
    whistle: new Howl({ src: [`${SFX}/whistle.wav`], volume: 0.45, rate: 1.35 }),
    countdown: new Howl({ src: [`${SFX}/select.ogg`], volume: 0.75, rate: 1.15 }),
    countdownGo: new Howl({ src: [`${SFX}/select.ogg`], volume: 0.85 }),
    kickoffArp: new Howl({ src: [`${SFX}/select.ogg`], volume: 0.5, rate: 1.25 }),
    victory: new Howl({ src: [`${CROWD}/cheer_strong.mp3`], volume: 0.85, rate: 1.02 }),
    boost: new Howl({ src: [`${SFX}/boost.ogg`], volume: 0.7 }),
    crowd: new Howl({ src: [`${CROWD}/crowd_bed.mp3`], volume: 0, loop: true }),
    cheer: new Howl({ src: [`${CROWD}/cheer_soft.mp3`], volume: 0.6 }),
  }
  bgm = new Howl({ src: [`${MUSIC}/synthwave.ogg`], volume: 0, loop: true })
}

// ── MOTOR REAL: loop acelerado por playback rate + volume ────
class EngineSound {
  private howl: Howl | null = null
  private id: number | null = null
  private vol = 0

  start() {
    if (this.howl) return
    try {
      this.howl = new Howl({ src: [`${ENGINE}/engine_mid.wav`], loop: true, volume: 0 })
      this.id = this.howl.play()
      if (typeof this.id === 'number') this.howl.volume(0, this.id)
    } catch (e) {
      console.warn('Engine audio failed:', e)
    }
  }

  setSpeed(ratio: number, boosting: boolean, muted: boolean) {
    if (!this.howl || this.id === null) return
    const r = clamp(ratio, 0, 1.5)
    const target = muted ? 0 : 0.1 + Math.min(r, 1) * 0.26 + (boosting ? 0.1 : 0)
    this.vol += (target - this.vol) * 0.15
    const rate = 0.65 + Math.min(r, 1.5) * 0.85 + (boosting ? 0.25 : 0)
    this.howl.rate(rate, this.id)
    this.howl.volume(this.vol, this.id)
  }

  stop() {
    if (!this.howl) return
    try {
      this.howl.stop()
      this.howl.unload()
    } catch {}
    this.howl = null
    this.id = null
    this.vol = 0
  }
}

// ── MOTOR ESPACIAL 3D: Som de motor posicional para adversários com atenuação ──
class SpatialEngineSound {
  private howl: Howl | null = null
  private id: number | null = null
  private vol = 0

  start() {
    if (this.howl) return
    try {
      this.howl = new Howl({ src: [`${ENGINE}/engine_mid.wav`], loop: true, volume: 0 })
      this.id = this.howl.play()
      if (typeof this.id === 'number') this.howl.volume(0, this.id)
    } catch {}
  }

  update(x: number, y: number, z: number, ratio: number, boosting: boolean, muted: boolean) {
    if (!this.howl || this.id === null) return
    const r = clamp(ratio, 0, 1.5)
    const target = muted ? 0 : 0.08 + Math.min(r, 1) * 0.22 + (boosting ? 0.08 : 0)
    this.vol += (target - this.vol) * 0.15
    const rate = 0.65 + Math.min(r, 1.5) * 0.85 + (boosting ? 0.25 : 0)
    this.howl.rate(rate, this.id)
    this.howl.volume(this.vol, this.id)
    this.howl.pos(x, y, z, this.id)
  }

  stop() {
    if (!this.howl) return
    try {
      this.howl.stop()
      this.howl.unload()
    } catch {}
    this.howl = null
    this.id = null
    this.vol = 0
  }
}

export class AudioManager {
  // Estado de mute GLOBAL e compartilhado por todas as instâncias (2D e 3D)
  private static mutedGlobal = false
  private engine = new EngineSound()
  private opponentEngine = new SpatialEngineSound()
  private crowdPlaying = false
  private crowdId: number | null = null

  private get muted() { return AudioManager.mutedGlobal }

  static setMutedGlobal(v: boolean) {
    AudioManager.mutedGlobal = v
    Howler.mute(v)
    if (v) {
      bgm?.pause()
    } else if (bgmShouldPlay) {
      if (!bgm) initAudio()
      if (bgm && !bgm.playing()) this.resumeBgm()
    }
  }

  private static resumeBgm() {
    if (!bgm) return
    const id = bgm.play()
    bgm.volume(0, id)
    bgm.fade(0, 0.18, 1200, id)
  }

  static isMutedGlobal() { return AudioManager.mutedGlobal }

  // ── ÁUDIO ESPACIAL 3D HOWLER ──
  updateListener(x: number, y: number, z: number, forwardX = 0, forwardY = 0, forwardZ = -1) {
    if (this.muted) return
    try {
      Howler.pos(x, y, z)
      Howler.orientation(forwardX, forwardY, forwardZ, 0, 1, 0)
    } catch {}
  }

  playSpatial(sound: SoundKey, x: number, y: number, z: number) {
    if (this.muted || !sounds) return
    try {
      const h = sounds[sound]
      if (!h) return
      const id = h.play()
      if (typeof id === 'number') {
        h.pos(x, y, z, id)
      }
    } catch {}
  }

  playCollisionTiered(force: number, x?: number, y?: number, z?: number) {
    if (this.muted || !sounds) return
    try {
      if (force > 38) {
        if (x !== undefined && y !== undefined && z !== undefined) {
          this.playSpatial('postHit', x, y, z)
          this.playSpatial('powerHit', x, y, z)
        } else {
          this.playPostHit()
        }
      } else if (force > 18) {
        if (x !== undefined && y !== undefined && z !== undefined) {
          this.playSpatial('powerHit', x, y, z)
        } else {
          this.playPowerHit()
        }
      } else {
        if (x !== undefined && y !== undefined && z !== undefined) {
          this.playSpatial('hit', x, y, z)
        } else {
          this.playHit()
        }
      }
    } catch {}
  }

  play(sound: SoundKey) {
    if (this.muted || !sounds) return
    try { sounds[sound]?.play() } catch {}
  }

  playHit()        { this.play('hit') }
  playPowerHit()   { this.play('powerHit') }
  playDash()       { this.play('dash') }
  playWallBounce() { this.play('wallBounce') }
  playPostHit() {
    this.play('postHit')
    this.play('wallBounce')
  }

  playGoal() {
    this.play('goal')
    this.play('goalFanfare')
  }

  playGoalFanfare() {
    this.play('goalFanfare')
  }

  playWhistle()    { this.play('whistle') }
  playCountdown()  { this.play('countdown') }

  playCountdownGo() {
    this.play('countdownGo')
    this.play('kickoffArp')
  }
  playVictory()    { this.play('victory') }
  playBoost()      { this.play('boost') }

  startCrowd() {
    if (this.muted || !sounds || this.crowdPlaying) return
    try {
      const id = sounds.crowd.play()
      sounds.crowd.volume(0, id)
      sounds.crowd.fade(0, 0.52, 900, id)
      this.crowdId = id
      this.crowdPlaying = true
    } catch {}
  }

  stopCrowd() {
    if (!sounds) return
    const id = this.crowdId
    this.crowdPlaying = false
    this.crowdId = null
    if (id === null) return
    try {
      sounds.crowd.fade(sounds.crowd.volume(id) as number, 0, 600, id)
      window.setTimeout(() => { try { sounds?.crowd.stop(id) } catch {} }, 650)
    } catch {
      try { sounds.crowd.stop() } catch {}
    }
  }

  playCheer() { this.play('cheer') }

  startBGM() {
    bgmShouldPlay = true
    if (this.muted) return
    if (!bgm) initAudio()
    if (bgm && !bgm.playing()) AudioManager.resumeBgm()
  }

  stopBGM() {
    bgmShouldPlay = false
    try { bgm?.stop() } catch {}
  }

  startEngine() {
    this.engine.start()
  }

  updateEngine(speedRatio: number, boosting: boolean) {
    this.engine.setSpeed(speedRatio, boosting, this.muted)
  }

  stopEngine() {
    this.engine.stop()
  }

  startOpponentEngine() {
    this.opponentEngine.start()
  }

  updateOpponentEngine(x: number, y: number, z: number, speedRatio: number, boosting: boolean) {
    this.opponentEngine.update(x, y, z, speedRatio, boosting, this.muted)
  }

  stopOpponentEngine() {
    this.opponentEngine.stop()
  }

  setMuted(v: boolean) {
    AudioManager.setMutedGlobal(v)
  }

  getMuted() { return AudioManager.mutedGlobal }

  stopAll() {
    this.stopBGM()
    this.engine.stop()
    this.opponentEngine.stop()
    this.crowdPlaying = false
    this.crowdId = null
    try { sounds?.crowd.stop() } catch {}
    if (sounds) {
      for (const key of Object.keys(sounds)) {
        try { (sounds as any)[key]?.stop() } catch {}
      }
    }
  }

  destroy() {
    this.stopAll()
  }
}

// Helpers globais (podem ser usados por qualquer tela, inclusive o 3D)
export function setAudioMuted(v: boolean) { AudioManager.setMutedGlobal(v) }
export function isAudioMuted() { return AudioManager.isMutedGlobal() }
