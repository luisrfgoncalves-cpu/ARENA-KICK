// ============================================================
//  game.ts ââ‚¬" Motor Principal com Matter.js + Online P2P + àƒÂudio
// ============================================================
import Matter from 'matter-js'
import confetti from 'canvas-confetti'
import {
  createWorld,
  createBall,
  createPlayer,
  createGoalSensors,
  buildArenaWalls,
  clampBodySpeed,
  isInsideSensor,
  ArenaDimensions,
  LABEL,
  Vec2,
  vlen,
  vnorm,
  vsub
} from './physics'
import { InputManager, PlayerInput, getLastValidDirection, setLastValidDirection } from './input'
import { BotAI } from './bot'
import { Renderer } from './renderer'
import { AudioManager, initAudio } from './audio'
import { ParticleSystem } from './particles'
import type { NetworkManager, NetSyncPayload } from './network'
import { dbService } from './supabase'
import { FieldTheme, TeamKey } from './assets'

export interface GameConfig {
  canvas: HTMLCanvasElement
  mode: 'bot' | '2p' | 'online' | 'practice'
  format?: '1v1' | '2v2'
  difficulty: 'easy' | 'medium' | 'hard'
  theme?: FieldTheme
  teamP1?: TeamKey
  teamP2?: TeamKey
  network?: NetworkManager
  playerName?: string
  onScoreUpdate: (p1: number, p2: number) => void
  onTimerUpdate: (seconds: number) => void
  onGoal: (scorer: 'p1' | 'p2') => void
  onPowerChange: (pct: number) => void
  onGameEnd: (winner: 'p1' | 'p2' | 'draw', scoreP1: number, scoreP2: number) => void
}

const FIXED_DT = 1 / 60
const GAME_DURATION = 180
const PLAYER_SPEED = 6.5
const PLAYER_RADIUS = 24
const BALL_RADIUS = 15
const BALL_MAX_SPEED = 24
const DASH_FORCE = 16
const DASH_COOLDOWN = 1.3
const POWER_CHARGE_T = 1.0

interface PlayerCtrl {
  body: Matter.Body
  dashCooldown: number
  dashActive: boolean
  dashDur: number
  dashDir: Vec2
  powerCharging: boolean
  powerTime: number
  carrying: boolean
}

export class Game {
  private cfg: GameConfig
  private renderer: Renderer
  private input: InputManager
  private audio: AudioManager
  private particles: ParticleSystem
  private bot: BotAI | null = null

  private engine!: Matter.Engine
  private arena!: ArenaDimensions
  private goalSensors!: { leftSensor: Matter.Body; rightSensor: Matter.Body }
  private obstacles: Matter.Body[] = []

  private p1!: PlayerCtrl
  private p2!: PlayerCtrl
  private p3: PlayerCtrl | null = null
  private p4: PlayerCtrl | null = null
  private is2v2 = false
  private ball!: Matter.Body
  private lastToucher: 'p1' | 'p2' | null = null

  private scoreP1 = 0
  private scoreP2 = 0
  private timeLeft = GAME_DURATION
  private phase: 'COUNTDOWN' | 'PLAYING' | 'GOAL' | 'ENDED' = 'COUNTDOWN'
  private countdown = 3
  private countdownTimer = 0
  private goalResetTimer = 0
  private ballStuckTimer = 0
  private lastBallPos = { x: 0, y: 0 }

  private paused = false
  private raf = 0
  private lastTime = 0
  private netSyncTimer = 0
  private physicsAccumulator = 0

  constructor(cfg: GameConfig) {
    this.cfg = cfg
    initAudio()
    this.audio = new AudioManager()
    this.renderer = new Renderer(cfg.canvas)
    if (cfg.theme || cfg.teamP1 || cfg.teamP2) {
      this.renderer.setCustomization(
        cfg.theme || 'classic',
        cfg.teamP1 || 'brazil',
        cfg.teamP2 || 'usa'
      )
    }
    this.input = new InputManager(cfg.mode)
    this.particles = new ParticleSystem()

    this.setupArena()
    this.initPhysicsWorld()

    if (cfg.mode === 'bot') {
      this.bot = new BotAI({
        difficulty: cfg.difficulty,
        speed: PLAYER_SPEED * 60,
        arena: this.arena
      })
    }

    if (cfg.mode === 'online' && cfg.network) {
      cfg.network.onDataReceived = (payload) => this.handleNetworkData(payload)
    }

    window.addEventListener('resize', this.onResize)
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  private setupArena() {
    const W = this.renderer.W
    const H = this.renderer.H
    const margin = 28
    const goalHalfH = H * 0.22
    const goalDepth = 35

    this.arena = {
      x: margin,
      y: margin,
      w: W - margin * 2,
      h: H - margin * 2,
      goalTop: H / 2 - goalHalfH,
      goalBot: H / 2 + goalHalfH,
      goalDepth
    }
  }

  private initPhysicsWorld() {
    this.engine = createWorld(this.arena)
    const { x, y, w, h } = this.arena
    this.is2v2 = this.cfg.format === '2v2'

    // Criar Corpos
    this.ball = createBall(x + w * 0.5, y + h * 0.5, BALL_RADIUS)
    const p1X = this.is2v2 ? x + w * 0.32 : x + w * 0.22
    const p1Y = this.is2v2 ? y + h * 0.40 : y + h * 0.5
    const p2X = this.is2v2 ? x + w * 0.68 : x + w * 0.22
    const p2Y = this.is2v2 ? y + h * 0.40 : y + h * 0.5

    const p1Body = createPlayer(p1X, p1Y, PLAYER_RADIUS, LABEL.PLAYER1)
    const p2Body = createPlayer(this.is2v2 ? x + w * 0.68 : x + w * 0.78, p2Y, PLAYER_RADIUS, LABEL.PLAYER2)

    this.goalSensors = createGoalSensors(this.arena)

    this.p1 = {
      body: p1Body,
      dashCooldown: 0,
      dashActive: false,
      dashDur: 0,
      dashDir: { x: 1, y: 0 },
      powerCharging: false,
      powerTime: 0,
      carrying: false
    }

    this.p2 = {
      body: p2Body,
      dashCooldown: 0,
      dashActive: false,
      dashDur: 0,
      dashDir: { x: -1, y: 0 },
      powerCharging: false,
      powerTime: 0,
      carrying: false
    }

    const bodiesToAdd: Matter.Body[] = [
      this.ball,
      p1Body,
      p2Body,
      this.goalSensors.leftSensor,
      this.goalSensors.rightSensor
    ]

    if (this.is2v2) {
      const p3Body = createPlayer(x + w * 0.16, y + h * 0.50, PLAYER_RADIUS, LABEL.PLAYER3)
      const p4Body = createPlayer(x + w * 0.84, y + h * 0.50, PLAYER_RADIUS, LABEL.PLAYER4)
      this.p3 = {
        body: p3Body,
        dashCooldown: 0,
        dashActive: false,
        dashDur: 0,
        dashDir: { x: 1, y: 0 },
        powerCharging: false,
        powerTime: 0,
        carrying: false
      }
      this.p4 = {
        body: p4Body,
        dashCooldown: 0,
        dashActive: false,
        dashDur: 0,
        dashDir: { x: -1, y: 0 },
        powerCharging: false,
        powerTime: 0,
        carrying: false
      }
      bodiesToAdd.push(p3Body, p4Body)
    }

    Matter.Composite.add(this.engine.world, bodiesToAdd)

    // Eventos de Colisão
    Matter.Events.on(this.engine, 'collisionStart', (evt) => {
      for (const pair of evt.pairs) {
        const labels = [pair.bodyA.label, pair.bodyB.label]
        if (labels.includes(LABEL.BALL) && (
          labels.includes(LABEL.PLAYER1) ||
          labels.includes(LABEL.PLAYER2) ||
          labels.includes(LABEL.PLAYER3) ||
          labels.includes(LABEL.PLAYER4)
        )) {
          if (labels.includes(LABEL.PLAYER1) || labels.includes(LABEL.PLAYER3)) this.lastToucher = 'p1'
          if (labels.includes(LABEL.PLAYER2) || labels.includes(LABEL.PLAYER4)) this.lastToucher = 'p2'
          this.audio.playHit()
          this.input.vibrate(100)
          this.particles.emitHit(this.ball.position.x, this.ball.position.y, this.ball.velocity.x, this.ball.velocity.y)
          this.renderer.triggerShake(4, 0.12)
        } else if (labels.includes(LABEL.BALL) && labels.includes(LABEL.POST)) {
          this.audio.playPostHit()
          this.input.vibrate(180)
          this.particles.emitHit(this.ball.position.x, this.ball.position.y, 0, 0)
          this.renderer.triggerShake(6, 0.18)
        } else if (labels.includes(LABEL.BALL) && labels.includes(LABEL.WALL)) {
          this.audio.playWallBounce()
        }
      }
    })
  }

  private resetPositions() {
    this.lastToucher = null
    this.p1.carrying = false
    this.p2.carrying = false
    this.p1.body.collisionFilter.mask = 0xFFFF
    this.p2.body.collisionFilter.mask = 0xFFFF
    if (this.p3) {
      this.p3.carrying = false
      this.p3.body.collisionFilter.mask = 0xFFFF
    }
    if (this.p4) {
      this.p4.carrying = false
      this.p4.body.collisionFilter.mask = 0xFFFF
    }

    const { x, y, w, h } = this.arena
    if (this.is2v2 && this.p3 && this.p4) {
      Matter.Body.setPosition(this.p1.body, { x: x + w * 0.32, y: y + h * 0.38 })
      Matter.Body.setVelocity(this.p1.body, { x: 0, y: 0 })
      Matter.Body.setPosition(this.p3.body, { x: x + w * 0.16, y: y + h * 0.50 })
      Matter.Body.setVelocity(this.p3.body, { x: 0, y: 0 })

      Matter.Body.setPosition(this.p2.body, { x: x + w * 0.68, y: y + h * 0.38 })
      Matter.Body.setVelocity(this.p2.body, { x: 0, y: 0 })
      Matter.Body.setPosition(this.p4.body, { x: x + w * 0.84, y: y + h * 0.50 })
      Matter.Body.setVelocity(this.p4.body, { x: 0, y: 0 })
    } else {
      Matter.Body.setPosition(this.p1.body, { x: x + w * 0.22, y: y + h * 0.5 })
      Matter.Body.setVelocity(this.p1.body, { x: 0, y: 0 })
      Matter.Body.setPosition(this.p2.body, { x: x + w * 0.78, y: y + h * 0.5 })
      Matter.Body.setVelocity(this.p2.body, { x: 0, y: 0 })
    }

    Matter.Body.setPosition(this.ball, { x: x + w * 0.5, y: y + h * 0.5 })
    Matter.Body.setVelocity(this.ball, {
      x: (Math.random() - 0.5) * 3,
      y: (Math.random() - 0.5) * 3
    })
  }

  /**
   * Função central de recuperação da bola 2D (Item 10)
   * Restaura a bola de estados inválidos (fora do campo, NaN, travada no canto)
   * sem criar uma segunda bola, mantendo exatamente 1 bola válida e visível.
   */
  public recoverBall(reason: string): void {
    if (!this.ball) return
    const { x, y, w, h } = this.arena

    // Diagnóstico controlado
    console.warn(`[BeatBall2D] recoverBall disparado: motivo=${reason}`)

    // Se estiver em estado de comemoração de gol, não interfere no fluxo de comemoração
    if (this.phase === 'GOAL') return

    // Posição segura no centro do campo
    const safeX = x + w * 0.5
    const safeY = y + h * 0.5

    Matter.Body.setPosition(this.ball, { x: safeX, y: safeY })
    Matter.Body.setVelocity(this.ball, {
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2
    })
    Matter.Body.setAngularVelocity(this.ball, 0)
    Matter.Body.setAngle(this.ball, 0)

    this.ballStuckTimer = 0
    this.lastBallPos = { x: safeX, y: safeY }
  }

  private loop = (now: number) => {
    if (this.paused || this.phase === 'ENDED') return

    const dt = Math.min((now - this.lastTime) / 1000, 0.05)
    this.lastTime = now
    this.raf = requestAnimationFrame(this.loop)

    this.update(dt)
    this.render(dt)
  }

  private update(dt: number) {
    switch (this.phase) {
      case 'COUNTDOWN':
        this.countdownTimer += dt
        if (this.countdownTimer >= 1.0) {
          this.countdownTimer = 0
          this.countdown--
          if (this.countdown > 0) {
            this.audio.playCountdown()
          } else {
            this.phase = 'PLAYING'
            this.audio.playCountdownGo()
            this.audio.startBGM()
          }
        }
        break

      case 'PLAYING':
        this.updatePlaying(dt)
        break

      case 'GOAL':
        this.goalResetTimer -= dt
        if (this.goalResetTimer <= 0) {
          this.countdown = 2
          this.countdownTimer = 0
          this.phase = 'COUNTDOWN'
          this.resetPositions()
          if (this.cfg.mode === 'online' && this.cfg.network?.isHost()) {
            this.cfg.network.send({
              t: performance.now(),
              event: 'countdown',
              countdown: 2,
              ball: {
                x: this.ball.position.x,
                y: this.ball.position.y,
                vx: this.ball.velocity.x,
                vy: this.ball.velocity.y
              }
            })
          }
        }
        break
    }
    this.syncNetwork(dt)
  }

  private updatePlaying(dt: number) {
    this.timeLeft -= dt
    this.cfg.onTimerUpdate(Math.max(0, Math.ceil(this.timeLeft)))

    if (this.timeLeft <= 0) {
      this.endGame()
      return
    }

    // Input P1
    this.processPlayerMovement(this.p1, this.input.p1, dt)

    // Input P2 / Bot / Online
    if (this.cfg.mode === '2p') {
      this.processPlayerMovement(this.p2, this.input.p2, dt)
    } else if (this.cfg.mode === 'bot' && this.bot) {
      const decision = this.bot.update(dt, this.p2.body, this.ball, this.p1.body)
      const botInput: PlayerInput = {
        up: decision.move.y < -0.25,
        down: decision.move.y > 0.25,
        left: decision.move.x < -0.25,
        right: decision.move.x > 0.25,
        dash: decision.dash,
        power: decision.powerShot,
        shoot: decision.powerShot
      }
      this.processPlayerMovement(this.p2, botInput, dt)
    }

    // 2v2: IA Defensores P3 (Time 1) e P4 (Time 2)
    if (this.is2v2 && this.p3) {
      const ballPos = this.ball.position
      const { x, w, goalTop, goalBot } = this.arena
      const targetX = ballPos.x < x + w * 0.5 ? Math.max(x + w * 0.12, ballPos.x - 28) : x + w * 0.20
      const targetY = ballPos.x < x + w * 0.5 ? ballPos.y : Math.max(goalTop + 12, Math.min(goalBot - 12, ballPos.y))
      const dx = targetX - this.p3.body.position.x
      const dy = targetY - this.p3.body.position.y
      const dLen = Math.hypot(dx, dy)
      const distBall = Math.hypot(ballPos.x - this.p3.body.position.x, ballPos.y - this.p3.body.position.y)

      const bot3Input: PlayerInput = {
        up: dy < -8,
        down: dy > 8,
        left: dx < -8,
        right: dx > 8,
        dash: dLen > 90 && Math.random() < 0.04,
        power: false,
        shoot: distBall < PLAYER_RADIUS + BALL_RADIUS + 25
      }
      this.processPlayerMovement(this.p3, bot3Input, dt)
    }

    if (this.is2v2 && this.p4) {
      const ballPos = this.ball.position
      const { x, w, goalTop, goalBot } = this.arena
      const targetX = ballPos.x > x + w * 0.5 ? Math.min(x + w * 0.88, ballPos.x + 28) : x + w * 0.80
      const targetY = ballPos.x > x + w * 0.5 ? ballPos.y : Math.max(goalTop + 12, Math.min(goalBot - 12, ballPos.y))
      const dx = targetX - this.p4.body.position.x
      const dy = targetY - this.p4.body.position.y
      const dLen = Math.hypot(dx, dy)
      const distBall = Math.hypot(ballPos.x - this.p4.body.position.x, ballPos.y - this.p4.body.position.y)

      const bot4Input: PlayerInput = {
        up: dy < -8,
        down: dy > 8,
        left: dx < -8,
        right: dx > 8,
        dash: dLen > 90 && Math.random() < 0.04,
        power: false,
        shoot: distBall < PLAYER_RADIUS + BALL_RADIUS + 25
      }
      this.processPlayerMovement(this.p4, bot4Input, dt)
    }

    // Step da Física Matter.js com PASSO FIXO (independente do FPS)
    this.physicsAccumulator += dt
    let steps = 0
    while (this.physicsAccumulator >= FIXED_DT && steps < 5) {
      Matter.Engine.update(this.engine, FIXED_DT * 1000)
      this.physicsAccumulator -= FIXED_DT
      steps++
    }
    // Evita "spiral of death" em quedas longas de FPS
    if (steps === 5) this.physicsAccumulator = 0
    clampBodySpeed(this.ball, BALL_MAX_SPEED)
    clampBodySpeed(this.p1.body, PLAYER_SPEED * 1.5)
    clampBodySpeed(this.p2.body, PLAYER_SPEED * 1.5)
    if (this.is2v2 && this.p3 && this.p4) {
      clampBodySpeed(this.p3.body, PLAYER_SPEED * 1.5)
      clampBodySpeed(this.p4.body, PLAYER_SPEED * 1.5)
    }

    // Condução Orgânica de Bola (Estilo BeatBall original do Roblox - sem ímã/cola)
    const activePlayers = [this.p1, this.p2]
    if (this.is2v2 && this.p3 && this.p4) {
      activePlayers.push(this.p3, this.p4)
    }
    for (const p of activePlayers) {
      p.carrying = false
      p.body.collisionFilter.mask = 0xFFFF
      const diff = vsub(this.ball.position, p.body.position)
      const distToBall = vlen(diff)
      const contactDist = PLAYER_RADIUS + BALL_RADIUS + 8

      if (distToBall < contactDist && !p.powerCharging) {
        const pv = p.body.velocity
        const pvSpeed = Math.hypot(pv.x, pv.y)
        if (pvSpeed > 0.4) {
          const dirX = diff.x / (distToBall || 1)
          const dirY = diff.y / (distToBall || 1)
          const dot = (pv.x * dirX + pv.y * dirY) / pvSpeed
          if (dot > 0.15) {
            // Empurra a bola organicamente na direção da corrida sem colar no corpo
            Matter.Body.setVelocity(this.ball, {
              x: pv.x * 0.95 + dirX * pvSpeed * 0.25,
              y: pv.y * 0.95 + dirY * pvSpeed * 0.25
            })
          }
        }
      }
    }

    // Atrito natural do gramado na bola (desacelera e para suavemente)
    const bv = this.ball.velocity
    const bspd = Math.hypot(bv.x, bv.y)
    if (bspd > 0.05) {
      Matter.Body.setVelocity(this.ball, {
        x: bv.x * 0.988,
        y: bv.y * 0.988
      })
    }

    // Efeito Magnus / Spin Curvo no BeatBall (estilo Haxball profissional)
    if (Math.abs(this.ball.angularVelocity) > 0.02 && bspd > 1.5) {
      const perpX = -bv.y / bspd
      const perpY = bv.x / bspd
      const curveMag = this.ball.angularVelocity * 0.38
      Matter.Body.setVelocity(this.ball, {
        x: this.ball.velocity.x + perpX * curveMag,
        y: this.ball.velocity.y + perpY * curveMag
      })
      Matter.Body.setAngularVelocity(this.ball, this.ball.angularVelocity * 0.978)
    }

    // Efeitos visuais e trilhas
    this.renderer.updateBallTrail(this.ball, dt)
    const ballSpd = vlen(this.ball.velocity as Vec2)
    if (ballSpd > 4) {
      this.particles.emitCometFlame(
        this.ball.position.x,
        this.ball.position.y,
        this.ball.velocity.x,
        this.ball.velocity.y
      )
    }
    this.particles.update(dt)
    this.cfg.onPowerChange(this.p1.powerCharging ? this.p1.powerTime / POWER_CHARGE_T : 0)

    const authoritative = this.cfg.mode !== 'online' || this.cfg.network?.isHost()
    if (authoritative) {
      if (isInsideSensor(this.ball, this.goalSensors.leftSensor)) {
        if (this.lastToucher === 'p1') {
          // Anti-gol contra: rebate a bola para fora da meta defensiva
          Matter.Body.setVelocity(this.ball, { x: 9.5, y: (Math.random() - 0.5) * 5 })
          this.audio.playWallBounce()
          this.particles.emitHit(this.ball.position.x, this.ball.position.y, 9.5, 0)
        } else {
          this.handleGoal('p2')
        }
      } else if (isInsideSensor(this.ball, this.goalSensors.rightSensor)) {
        if (this.lastToucher === 'p2') {
          // Anti-gol contra: rebate a bola para fora da meta defensiva
          Matter.Body.setVelocity(this.ball, { x: -9.5, y: (Math.random() - 0.5) * 5 })
          this.audio.playWallBounce()
          this.particles.emitHit(this.ball.position.x, this.ball.position.y, -9.5, 0)
        } else {
          this.handleGoal('p1')
        }
      }
    }

    // ── VALIDAÇÃO DE INTEGRIDADE DA BOLA (Item 10) ──
    const bp = this.ball.position
    const bvNow = this.ball.velocity

    // 1. Verificação de NaN ou Infinity
    if (!Number.isFinite(bp.x) || !Number.isFinite(bp.y) ||
        !Number.isFinite(bvNow.x) || !Number.isFinite(bvNow.y) ||
        !Number.isFinite(this.ball.angle)) {
      this.recoverBall('invalid_nan_or_infinity')
      return
    }

    // 2. Verificação de limites da arena (fora da área sem ser gol)
    const { x: ax, y: ay, w: aw, h: ah, goalDepth: agd } = this.arena
    const outMargin = 35
    const minX = ax - agd - outMargin
    const maxX = ax + aw + agd + outMargin
    const minY = ay - outMargin
    const maxY = ay + ah + outMargin

    if (bp.x < minX || bp.x > maxX || bp.y < minY || bp.y > maxY) {
      if (this.phase !== 'GOAL') {
        this.recoverBall('out_of_bounds')
      }
    }

    // 3. Verificação de bola presa no canto/trave por mais de 1 segundo
    const isNearGoalY = bp.y < this.arena.goalTop + 18 || bp.y > this.arena.goalBot - 18
    const isNearPostX = Math.abs(bp.x - ax) < 32 || Math.abs(bp.x - (ax + aw)) < 32
    if (isNearGoalY && isNearPostX) {
      const moved = Math.hypot(bp.x - this.lastBallPos.x, bp.y - this.lastBallPos.y)
      const speed = Math.hypot(bvNow.x, bvNow.y)
      if (moved < 3 && speed < 0.25) {
        this.ballStuckTimer += dt
        if (this.ballStuckTimer > 1.0) {
          // Descola a bola em direção ao campo aberto com impulso seguro
          const nudgeDirX = bp.x < ax + aw * 0.5 ? 1 : -1
          Matter.Body.setVelocity(this.ball, { x: nudgeDirX * 5.0, y: (Math.random() - 0.5) * 3 })
          this.ballStuckTimer = 0
          console.warn('[BeatBall2D] recoverBall: bola descolada do canto da trave')
        }
      } else {
        this.ballStuckTimer = 0
        this.lastBallPos = { x: bp.x, y: bp.y }
      }
    } else {
      this.ballStuckTimer = 0
      this.lastBallPos = { x: bp.x, y: bp.y }
    }
  }

  private syncNetwork(dt: number) {
    // Sincronização Online P2P (30Hz broadcast constante em todas as fases)
    if (this.cfg.mode === 'online' && this.cfg.network?.isConnected()) {
      this.netSyncTimer += dt
      if (this.netSyncTimer > 1 / 30) {
        this.netSyncTimer = 0
        const isHost = this.cfg.network.isHost()
        const payload: NetSyncPayload = {
          t: performance.now(),
          p1: {
            x: this.p1.body.position.x,
            y: this.p1.body.position.y,
            vx: this.p1.body.velocity.x,
            vy: this.p1.body.velocity.y,
            dash: this.p1.dashActive
          }
        }
        if (isHost) {
          payload.ball = {
            x: this.ball.position.x,
            y: this.ball.position.y,
            vx: this.ball.velocity.x,
            vy: this.ball.velocity.y
          }
          payload.scores = { p1: this.scoreP1, p2: this.scoreP2 }
        }
        this.cfg.network.send(payload)
      }
    }
  }

  private processPlayerMovement(p: PlayerCtrl, input: PlayerInput, dt: number) {
    p.dashCooldown = Math.max(0, p.dashCooldown - dt)

    let moveX = 0
    let moveY = 0
    if (input.up) moveY -= 1
    if (input.down) moveY += 1
    if (input.left) moveX -= 1
    if (input.right) moveX += 1

    const len = Math.hypot(moveX, moveY)
    if (len > 0) {
      moveX /= len
      moveY /= len
      p.dashDir = { x: moveX, y: moveY }
      if (p === this.p1) setLastValidDirection(p.dashDir)
    } else if (p === this.p1) {
      const lastDir = getLastValidDirection()
      if (Math.hypot(lastDir.x, lastDir.y) > 0.1) {
        p.dashDir = lastDir
      }
    }

    // Dash
    if (input.dash && p.dashCooldown <= 0 && !p.dashActive) {
      p.dashActive = true
      p.dashDur = 0.16
      p.dashCooldown = DASH_COOLDOWN
      this.audio.playDash()
      this.particles.emitDash(p.body.position.x, p.body.position.y, p.dashDir.x * DASH_FORCE, p.dashDir.y * DASH_FORCE)
      Matter.Body.setVelocity(p.body, {
        x: p.dashDir.x * DASH_FORCE,
        y: p.dashDir.y * DASH_FORCE
      })
    }

    if (p.dashActive) {
      p.dashDur -= dt
      if (p.dashDur <= 0) p.dashActive = false
    } else {
      Matter.Body.setVelocity(p.body, {
        x: moveX * PLAYER_SPEED,
        y: moveY * PLAYER_SPEED
      })
    }

    // Chute Instantâneo Direto para o Gol (Botão B ou X no Xbox, C ou Espaço no Teclado)
    if (input.shoot) {
      const diff = vsub(this.ball.position, p.body.position)
      const dist = vlen(diff)
      const shootRange = PLAYER_RADIUS + BALL_RADIUS + 22
      if (dist < shootRange) {
        this.executeInstantShot(p)
      }
    }

    // Power Shot / Chute Dedicado (BeatBall original)
    if (input.power) {
      p.powerCharging = true
      p.powerTime = Math.min(p.powerTime + dt, POWER_CHARGE_T)
    } else if (p.powerCharging) {
      p.powerCharging = false
      const charge = Math.max(0.12, p.powerTime / POWER_CHARGE_T)
      p.powerTime = 0
      this.executePowerShot(p, charge)
    }
  }

  private executeInstantShot(p: PlayerCtrl) {
    p.carrying = false
    this.lastToucher = p === this.p1 ? 'p1' : 'p2'

    // Direção: mira no gol adversário mesclado com a direção de corrida
    const isP1 = p === this.p1
    let dir = { ...p.dashDir }
    if (Math.hypot(dir.x, dir.y) < 0.1) {
      dir = { x: isP1 ? 1 : -1, y: 0 }
    } else {
      const goalX = isP1 ? this.arena.x + this.arena.w : this.arena.x
      const goalY = (this.arena.goalTop + this.arena.goalBot) / 2
      const toGoalX = goalX - this.ball.position.x
      const toGoalY = goalY - this.ball.position.y
      const toGoalDist = Math.hypot(toGoalX, toGoalY) || 1
      // 65% direção da corrida, 35% mira na direção do gol
      dir = {
        x: dir.x * 0.65 + (toGoalX / toGoalDist) * 0.35,
        y: dir.y * 0.65 + (toGoalY / toGoalDist) * 0.35
      }
      const len = Math.hypot(dir.x, dir.y) || 1
      dir.x /= len
      dir.y /= len
    }

    const force = 18.0 // Chute direto limpo, firme e rápido
    Matter.Body.setVelocity(this.ball, {
      x: dir.x * force,
      y: dir.y * force
    })
    // Efeito curvo com base na inclinação vertical do movimento do jogador
    const spin = (p.dashDir.y || 0) * 0.42 * (isP1 ? 1 : -1)
    Matter.Body.setAngularVelocity(this.ball, spin)

    this.audio.playPowerHit()
    this.particles.emitHit(this.ball.position.x, this.ball.position.y, dir.x * force, dir.y * force)
    this.renderer.triggerShake(6, 0.16)
  }

  private executePowerShot(p: PlayerCtrl, powerRatio: number) {
    p.carrying = false
    this.lastToucher = p === this.p1 ? 'p1' : 'p2'
    p.body.collisionFilter.mask = 0xFFFF
    const dir = p.dashDir
    const force = 11 + powerRatio * 17
    Matter.Body.setVelocity(this.ball, {
      x: dir.x * force,
      y: dir.y * force
    })
    const spin = (p.dashDir.y || 0) * 0.65 * powerRatio * (p === this.p1 ? 1 : -1)
    Matter.Body.setAngularVelocity(this.ball, spin)

    this.audio.playPowerHit()
    this.particles.emitPowerShot(this.ball.position.x, this.ball.position.y, dir.x * force, dir.y * force)
    this.renderer.triggerShake(powerRatio * 11, 0.22)
  }

  private handleGoal(scorer: 'p1' | 'p2') {
    this.p1.carrying = false
    this.p2.carrying = false
    this.p1.body.collisionFilter.mask = 0xFFFF
    this.p2.body.collisionFilter.mask = 0xFFFF
    if (this.p3) {
      this.p3.carrying = false
      this.p3.body.collisionFilter.mask = 0xFFFF
    }
    if (this.p4) {
      this.p4.carrying = false
      this.p4.body.collisionFilter.mask = 0xFFFF
    }
    if (scorer === 'p1') this.scoreP1++
    else this.scoreP2++

    this.cfg.onScoreUpdate(this.scoreP1, this.scoreP2)
    this.cfg.onGoal(scorer)
    this.audio.playGoal()
    this.input.vibrate(400)
    this.particles.emitGoal(this.ball.position.x, this.ball.position.y)
    this.renderer.triggerShake(18, 0.45)
    this.renderer.triggerFlash(scorer === 'p1' ? '#00ff88' : '#ff2d78', 0.5)

    // ExplosàƒÂ£o àƒ©pica de confete em tela cheia
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 }
    })

    this.phase = 'GOAL'
    this.goalResetTimer = 2.0

    // Host autoritativo notifica o cliente imediatamente
    if (this.cfg.mode === 'online' && this.cfg.network?.isHost()) {
      this.cfg.network.send({
        t: performance.now(),
        event: 'goal',
        whoScored: scorer,
        scores: { p1: this.scoreP1, p2: this.scoreP2 },
        ball: {
          x: this.ball.position.x,
          y: this.ball.position.y,
          vx: this.ball.velocity.x,
          vy: this.ball.velocity.y
        }
      })
    }
  }

  private triggerClientGoal(whoScored: 'p1' | 'p2', scores: { p1: number; p2: number }) {
    if (this.phase === 'GOAL') return

    this.p1.carrying = false
    this.p2.carrying = false
    this.p1.body.collisionFilter.mask = 0xFFFF
    this.p2.body.collisionFilter.mask = 0xFFFF
    if (this.p3) {
      this.p3.carrying = false
      this.p3.body.collisionFilter.mask = 0xFFFF
    }
    if (this.p4) {
      this.p4.carrying = false
      this.p4.body.collisionFilter.mask = 0xFFFF
    }

    // No Host, scores.p1 é o host e scores.p2 é o cliente.
    // No cliente local, scoreP1 é o cliente e scoreP2 é o host.
    this.scoreP1 = scores.p2
    this.scoreP2 = scores.p1
    this.cfg.onScoreUpdate(this.scoreP1, this.scoreP2)

    // Se no host quem marcou foi p1 (host), para o cliente quem marcou foi o adversário ('p2').
    // Se no host quem marcou foi p2 (cliente), para o cliente quem marcou foi ele mesmo ('p1').
    const localScorer: 'p1' | 'p2' = whoScored === 'p1' ? 'p2' : 'p1'
    this.cfg.onGoal(localScorer)

    this.audio.playGoal()
    this.input.vibrate(400)
    this.particles.emitGoal(this.ball.position.x, this.ball.position.y)
    this.renderer.triggerShake(18, 0.45)
    this.renderer.triggerFlash(localScorer === 'p1' ? '#00ff88' : '#ff2d78', 0.5)

    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 }
    })

    // Entra na fase de comemoração sincronizada (trava o jogo por 2.0s igual ao Host)
    this.phase = 'GOAL'
    this.goalResetTimer = 2.0
  }

  private mirrorX(x: number) { return 2 * this.arena.x + this.arena.w - x }
  private mirrorY(y: number) { return 2 * this.arena.y + this.arena.h - y }

  private handleNetworkData(payload: NetSyncPayload) {
    const isHost = this.cfg.network?.isHost()

    if (payload.p1) {
      Matter.Body.setPosition(this.p2.body, {
        x: this.mirrorX(payload.p1.x),
        y: this.mirrorY(payload.p1.y)
      })
      Matter.Body.setVelocity(this.p2.body, {
        x: -payload.p1.vx,
        y: -payload.p1.vy
      })
    }

    if (!isHost) {
      // 1. Evento explícito de gol enviado pelo Host
      if (payload.event === 'goal' && payload.whoScored && payload.scores) {
        this.triggerClientGoal(payload.whoScored, payload.scores)
      }

      // 2. Transição sincronizada para countdown após reset do gol
      if (payload.event === 'countdown') {
        this.phase = 'COUNTDOWN'
        this.countdown = payload.countdown ?? 2
        this.countdownTimer = 0
        this.goalResetTimer = 0
        this.resetPositions()
      }

      // 3. Cliente reconcilia bola enviada pela autoridade (host)
      if (payload.ball) {
        Matter.Body.setPosition(this.ball, {
          x: this.mirrorX(payload.ball.x),
          y: this.mirrorY(payload.ball.y)
        })
        Matter.Body.setVelocity(this.ball, {
          x: -payload.ball.vx,
          y: -payload.ball.vy
        })
      }

      // 4. Fallback de segurança para sincronização de placar caso o evento UDP atrase
      if (payload.scores) {
        const newP1 = payload.scores.p2 // no host, p2 é o cliente
        const newP2 = payload.scores.p1
        if (newP1 > this.scoreP1 || newP2 > this.scoreP2) {
          const who: 'p1' | 'p2' = newP1 > this.scoreP1 ? 'p2' : 'p1'
          this.triggerClientGoal(who, payload.scores)
        }
      }
    }
  }

  private endGame() {
    this.phase = 'ENDED'
    let winner: 'p1' | 'p2' | 'draw'
    if (this.scoreP1 > this.scoreP2) winner = 'p1'
    else if (this.scoreP2 > this.scoreP1) winner = 'p2'
    else winner = 'draw'

    this.audio.playVictory()
    this.cfg.onGameEnd(winner, this.scoreP1, this.scoreP2)

    // Gravar no Supabase / Leaderboard Local
    const playerName = this.cfg.playerName || 'Jogador'
    dbService.recordMatchResult(playerName, winner === 'p1', this.scoreP1)
  }

  private render(dt: number) {
    this.renderer.beginFrame(dt)
    this.renderer.drawArena(this.arena)
    this.renderer.drawObstacles(this.obstacles)
    this.renderer.drawParticles(this.particles)
    this.renderer.drawBall(this.ball, BALL_RADIUS)

    this.renderer.drawPlayer(
      this.p1.body,
      PLAYER_RADIUS,
      '#00ff88',
      1,
      this.p1.dashCooldown <= 0,
      this.p1.powerCharging ? this.p1.powerTime / POWER_CHARGE_T : 0,
      this.p1.carrying
    )

    this.renderer.drawPlayer(
      this.p2.body,
      PLAYER_RADIUS,
      this.cfg.mode === 'bot' ? '#ff2d78' : '#00cfff',
      2,
      this.p2.dashCooldown <= 0,
      this.p2.powerCharging ? this.p2.powerTime / POWER_CHARGE_T : 0,
      this.p2.carrying
    )

    if (this.is2v2 && this.p3 && this.p4) {
      this.renderer.drawPlayer(
        this.p3.body,
        PLAYER_RADIUS,
        '#00cfff',
        3,
        this.p3.dashCooldown <= 0,
        0,
        this.p3.carrying
      )
      this.renderer.drawPlayer(
        this.p4.body,
        PLAYER_RADIUS,
        '#ffd23f',
        4,
        this.p4.dashCooldown <= 0,
        0,
        this.p4.carrying
      )
    }

    if (this.phase === 'COUNTDOWN' && this.countdown > 0) {
      this.renderer.drawCountdown(String(this.countdown))
    }

    this.renderer.endFrame(dt)
  }

  private rebuildArenaPhysics() {
    const world = this.engine.world
    const statics = Matter.Composite.allBodies(world).filter((b) => b.isStatic)
    if (statics.length) Matter.Composite.remove(world, statics)

    this.setupArena()
    const walls = buildArenaWalls(this.arena)
    this.goalSensors = createGoalSensors(this.arena)
    Matter.Composite.add(world, [
      ...walls,
      this.goalSensors.leftSensor,
      this.goalSensors.rightSensor
    ])
  }

  private onResize = () => {
    this.renderer.resize()
    this.rebuildArenaPhysics()
    this.resetPositions()
  }

  pause() { this.paused = true }
  resume() {
    this.paused = false
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }
  isPaused() { return this.paused }

  setTrainingMode(enabled: boolean) {
    if (enabled) {
      this.timeLeft = 999999
      this.bot = null
      this.phase = 'PLAYING'
      this.audio.startBGM()
    }
  }

  destroy() {
    this.paused = true
    this.phase = 'ENDED'
    this.bot = null
    this.physicsAccumulator = 0
    cancelAnimationFrame(this.raf)
    if (this.engine) {
      Matter.Events.off(this.engine, 'collisionStart', undefined as any)
      Matter.World.clear(this.engine.world, false)
      Matter.Engine.clear(this.engine)
    }
    this.renderer.destroy()
    this.input.destroy()
    this.audio.stopAll()
    this.audio.destroy()
    window.removeEventListener('resize', this.onResize)
  }
}
