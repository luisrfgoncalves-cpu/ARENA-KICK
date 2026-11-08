// ============================================================
//  100% CARTOON: Cel-Shading com OutlineEffect & MeshToonMaterial,
//  Countdown 3.. 2.. 1.. VAI! com Sons Procedurais e Bot Justo e Divertido
// ============================================================
import * as THREE from 'three'
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import Stats from 'three/examples/jsm/libs/stats.module.js'
import { EffectComposer, RenderPass, BloomEffect, EffectPass, VignetteEffect } from 'postprocessing'
import confetti from 'canvas-confetti'
import GUI from 'lil-gui'
import { GamepadManager } from './gamepad'
import { initAudio, AudioManager, setAudioMuted, isAudioMuted } from './audio'
import { CAR_MODELS } from './carModels'
import { buildGuinchoTodyVehicle, buildVanGostVehicle } from './customVehicles'
import { loadArenaKongEnvironment, ArenaKongEnvironmentResult, createArenaKongInstantBackdrop } from './arenaKongEnvironment'
import { KongGorak } from './arenaKongController'
import { dbService } from './supabase'
import { TurboNetworkController } from './turbonetwork'
import type { NetworkManager } from './network'


const FIELD_W  = 220      // Arena 4v4 épica (era 160)
const FIELD_L  = 360      // Arena 4v4 épica (era 260)
const CEIL_H   = 58       // Teto elevado para jogadas aéreas livres e arcos perfeitos (era 46)
const BALL_R   = 2.2      // Raio da bola cartoon
const GRAVITY  = 30       // Gravidade arcade

const GOAL_W   = 48.0     // Trave ampliada proporcional à arena 220m
const GOAL_H   = 17.0     // Altura da trave cartoon ampliada
const GOAL_D   = 18.0     // Profundidade da cabine da rede


function createToonGradient(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 1
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, 1, 1) // Sombra profunda rica
  ctx.fillStyle = '#64748b'; ctx.fillRect(1, 0, 1, 1) // Meio-tom
  ctx.fillStyle = '#cbd5e1'; ctx.fillRect(2, 0, 1, 1) // Luz cartoon saturada
  ctx.fillStyle = '#ffffff'; ctx.fillRect(3, 0, 1, 1) // Brilho especular
  const tex = new THREE.CanvasTexture(c)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  return tex
}

const TOON_GRADIENT = createToonGradient()

interface BallObject {
  mesh:         THREE.Mesh
  shadow:       THREE.Mesh
  pos:          THREE.Vector3
  vel:          THREE.Vector3
  rotAxis:      THREE.Vector3
  squash:       THREE.Vector3
  targetSquash: THREE.Vector3
}

interface CartoonStar {
  mesh:      THREE.Mesh
  vel:       THREE.Vector3
  rotVel:    THREE.Vector3
  life:      number
  maxLife:   number
  baseScale: number
}

interface TrailSegment {
  mesh:    THREE.Mesh
  life:    number
  maxLife: number
}


interface SmokePuff {
  mesh: THREE.Mesh
  vel:  THREE.Vector3
  life: number
  maxLife: number
}

// ── SISTEMA DE RANK / ELO ──────────────────────────────────────
export type RankTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'champion'
function getRankFromMMR(mmr: number): { tier: RankTier; label: string; emoji: string; color: string } {
  if (mmr >= 1600) return { tier: 'champion', label: 'CAMPEÃO', emoji: '🏆', color: '#a855f7' }
  if (mmr >= 1400) return { tier: 'platinum', label: 'PLATINA',  emoji: '💎', color: '#38bdf8' }
  if (mmr >= 1250) return { tier: 'gold',     label: 'OURO',     emoji: '🥇', color: '#ffd23f' }
  if (mmr >= 1100) return { tier: 'silver',   label: 'PRATA',    emoji: '🥈', color: '#94a3b8' }
  return { tier: 'bronze', label: 'BRONZE', emoji: '🥉', color: '#cd7f32' }
}

export type TurboTheme = 'classic' | 'cyber' | 'futsal' | 'snowday' | 'kong'

export type TurboBotLevel = 'easy' | 'medium' | 'hard' | 'expert'
export type TurboMatchFormat = '1v1' | '2v2' | '3v3' | '4v4'
export type GoalExplosionType = 'toon' | 'supernova' | 'lightning' | 'confetti'
export type TurboGameMode = 'standard' | 'rumble' | 'snowday'
export type RumblePowerup = 'magnet' | 'shockwave' | 'punch' | 'overdrive' | 'missile' | 'freeze' | 'oil'

export interface TurboTuning {
  playerSpeedMult?: number
  turnRate?: number
  jumpForce?: number
  ballBounce?: number
  theme?: TurboTheme
  botLevel?: TurboBotLevel
  matchFormat?: TurboMatchFormat
  goalExplosion?: GoalExplosionType
  gameMode?: TurboGameMode
  spectatorMode?: boolean
  isTraining?: boolean
}

// ============================================================
//  CLASSE PRINCIPAL DO JOGO TURBO SOCCER 3D
// ============================================================
export class TurboSoccerGame {
  private container:     HTMLElement
  private scene:         THREE.Scene
  private camera:        THREE.PerspectiveCamera
  private renderer:      THREE.WebGLRenderer
  private outlineEffect: OutlineEffect
  private composer:      EffectComposer | null = null
  private stats:         any = null
  private clock          = new THREE.Clock()
  private animId         = 0
  private isRunning      = true
  private destroyed      = false
  private paused         = false
  private pauseOverlay: HTMLElement | null = null

  private isTouchDevice  = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  private isMobile       = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  private touch          = { throttle: 0, steer: 0, jump: false, boost: false, drift: false, roll: false }

  private gamepad        = new GamepadManager()
  private audio:         AudioManager

  private playerCar!:    CarObject
  private botCar!:       CarObject
  // ── MULTI-CAR (2v2 / 3v3 / 4v4) ──────────────────────────
  private matchFormat:   TurboMatchFormat = '1v1'
  private orangeCars:    CarObject[] = []  // time laranja (inclui playerCar)
  private blueCars:      CarObject[] = []  // time azul (inclui botCar)
  private allCars:       CarObject[] = []  // todos os carros para loops
  // ── ARENA KONG: GORILA NEUTRO KONG GORAK & CENÁRIO SELVAGEM ──
  private kongGorak:        KongGorak | null = null
  private kongEnvResult:    ArenaKongEnvironmentResult | null = null
  private kongBackdropMesh: THREE.Mesh | null = null
    // ── MOEDAS DE NITRO & OBSTÁCULOS DINÂMICOS ────────────────
  private boostCoins: {
    group: THREE.Group
    coinMesh: THREE.Mesh
    pos: THREE.Vector3
    active: boolean
    respawnTimer: number
    value: number
  }[] = []

  // ── CAIXAS DE ITENS MARIO KART & PROJÉTEIS RUMBLE ──
  private mysteryBoxes: {
    group: THREE.Group
    boxMesh: THREE.Mesh
    qMesh: THREE.Mesh
    pos: THREE.Vector3
    active: boolean
    respawnTimer: number
  }[] = []

  private activeMissiles: {
    group: THREE.Group
    pos: THREE.Vector3
    vel: THREE.Vector3
    owner: CarObject
    target: CarObject | null
    lifetime: number
  }[] = []

  private activeIceProjectiles: {
    group: THREE.Group
    pos: THREE.Vector3
    vel: THREE.Vector3
    owner: CarObject
    lifetime: number
  }[] = []

  private activeOilSlicks: {
    mesh: THREE.Mesh
    pos: THREE.Vector3
    owner: CarObject
    lifetime: number
    armTimer: number
  }[] = []

  private activePunches: {
    group: THREE.Group
    gloveMesh: THREE.Mesh
    springCoils: THREE.Mesh[]
    owner: CarObject
    origin: THREE.Vector3
    dir: THREE.Vector3
    target: CarObject | 'ball' | null
    distTraveled: number
    maxDist: number
    speed: number
    lifetime: number
  }[] = []

  private dynamicObstacles: {
    group: THREE.Group
    pos: THREE.Vector3
    vel: THREE.Vector3
    rot: THREE.Euler
    rotVel: THREE.Vector3
    radius: number
    height: number
    type: 'barrel' | 'cone'
    selfRightTimer: number
  }[] = []
  private ball!:         BallObject
  private lastToucher:   'player' | 'bot' | null = null

  // Placar e Estados
  private scorePlayer       = 0
  private scoreBot          = 0
  private matchTimer        = 300
  private goalCooldown      = 0
  private kickoffCountdown  = 3.5 // 3.. 2.. 1.. VAI!
  private isKickoffActive   = true
  private matchEnded        = false
  private isTraining        = false
  private jumpHeld          = false
  private flipActionHeld    = false
  private aerialBoostHeld   = false
  private demoRespawnTimer  = 0          // timer pós-demo do player
  private botDemoRespawnTimer = 0        // timer pós-demo do bot
  private playerDemoed      = false      // player explodiu por demo
  private botDemoed         = false      // bot explodiu por demo
  private playerBoosting    = false
  private boostSfxHeld      = false
  private handbrakeHeld     = false
  private barrelRollHeld    = false


  private isBallCam         = false // Seguir o carro por padrão para NUNCA perder o carro de vista!
  private camOrbitH         = 0
  private camOrbitV         = 0
  private camCurrentPos     = new THREE.Vector3(0, 8, 52)
  private camCurrentLook    = new THREE.Vector3(0, 2, 30)
  private camShakeIntensity = 0
  private camShakeDecay     = 8.5
  private quickChatTimer    = 0
  private prevDpadUp        = false
  private prevDpadDown      = false
  private prevDpadLeft      = false
  private prevDpadRight     = false
  private prevRb            = false

  private keys: Record<string, boolean> = {}


  private sunLight!: THREE.DirectionalLight
  private gui: GUI | null = null
  private studioParams = {
    outlineThickness: 0.007,
    sunIntensity: 1.15,
    exposure: 1.05,
    playerSpeedMult: 1.0,
    turnRate: 2.8,
    jumpForce: 13.5,
    gravity: 26.0,
    ballBounce: 0.62,
    camDist: 14.8,
    camH: 6.2,
  }


  private smokePuffs: SmokePuff[] = []
  private smokeGeo = new THREE.SphereGeometry(0.35, 8, 8)
  private tireSmokeCooldown = 0
  private sharedSmokeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.65
  })
  private cartoonStars: CartoonStar[] = []
  private starGeo: THREE.ShapeGeometry
  private ballTrailSegments: TrailSegment[] = []
  private skidMarks: TrailSegment[] = []
  private lastBallTrailPos = new THREE.Vector3()
  private skidMarkTimer = 0
  private impactFlashMesh: THREE.Mesh | null = null
  private impactFlashTimer = 0
  private carHitCooldown = 0
  private crowdInstances: { mesh: THREE.InstancedMesh; data: { x: number; feetY: number; z: number; phase: number; yaw: number }[] }[] = []
  private crowdDummy = new THREE.Object3D()
  private crowdTextures: THREE.CanvasTexture[] = []
  private crowdFanW = 1.62
  private crowdFanH = 2.42
  private crowdUpdateTimer = 0
  private scoreboardCanvas?: HTMLCanvasElement
  private scoreboardCtx?: CanvasRenderingContext2D
  private scoreboardTex?: THREE.CanvasTexture
  private lastBoardSec = -1

  // Elementos do HUD
  private hudScoreP!:     HTMLElement
  private hudScoreB!:     HTMLElement
  private hudTimer!:      HTMLElement
  private hudSpeed!:      HTMLElement
  private hudBoost!:      HTMLElement
  private hudGoalBanner!: HTMLElement
  private hudGoalTitle!:  HTMLElement
  private hudCtrlMode!:   HTMLElement
  private hudCountdown!:  HTMLElement
  private hudCamStatus!:  HTMLElement

  private lastCountdownSec = -1

  public onExit?: () => void

  private selectedCarModelId = 'octane-cartoon'
  // Atributos do veículo selecionado (bonus especiais dos carros Power-Kick)
  private carAttrs: { nitroBonus: number; pushBonus: number; shieldBonus: number; jumpBonus: number } = {
    nitroBonus: 1.0, pushBonus: 1.0, shieldBonus: 0, jumpBonus: 0
  }
  private theme: TurboTheme = 'classic'
  private botLevel: TurboBotLevel = 'medium'
  private goalExplosion: GoalExplosionType = 'toon'
  private gameMode: TurboGameMode = 'standard'
  private spectatorMode = false

  // ── ONLINE 1v1 (Turbo Network Controller) ──────────────────
  private turboNet: TurboNetworkController | null = null
  private isOnline1v1 = false
  private snapshotTimer = 0
  private readonly SNAPSHOT_INTERVAL = 1 / 25   // 25 Hz snapshot broadcast
  private hudPingEl: HTMLElement | null = null
  private onlineDisconnectShown = false

  // Rumble
  private rumblePowerup: RumblePowerup | null = null
  private rumbleTimer = 7.0
  private rumbleActive: { type: RumblePowerup; timeLeft: number } | null = null
  private botRumbleStates: Map<CarObject, { powerup: RumblePowerup | null; timer: number; active: { type: RumblePowerup; timeLeft: number } | null }> = new Map()

  // Instant Replay (Zero-Allocation Preallocated Ring Buffer para 60 FPS estavel sem GC pauses)
  private static readonly MAX_REPLAY_FRAMES = 480
  private replayRingBuffer: Array<{
    ballPos: THREE.Vector3
    ballRot: THREE.Euler
    cars: Array<{ pos: THREE.Vector3; yaw: number; pitch: number; roll: number }>
  }> = []
  private replayHead = 0
  private replayTotalStored = 0
  private isReplaying = false
  private replayPlaybackFrames: Array<{
    ballPos: THREE.Vector3
    ballRot: THREE.Euler
    cars: Array<{ pos: THREE.Vector3; yaw: number; pitch: number; roll: number }>
  }> = []
  private replayPlaybackIdx = 0
  private hudReplayBanner?: HTMLElement
  private hudRumbleCard?: HTMLElement
  private hudRumbleIcon?: HTMLElement
  private hudRumbleName?: HTMLElement
  private hudRumbleHint?: HTMLElement
  private hudNitroArc: SVGElement | null = null
  private hudGoalNav?: HTMLElement
  private hudGoalNavArrow?: HTMLElement
  private hudGoalNavText?: HTMLElement
  private hudGoalNavDist?: HTMLElement
  private missileWarningHUD?: HTMLDivElement
  private isRouletteSpinning = false
  private rouletteTimer = 0
  private rouletteTickTimer = 0
  private rouletteTarget: RumblePowerup = 'missile'
  private rouletteTargetLabel = ''
  private missileLockAlertTimer = 0
  private magnetArcLine?: THREE.Line
  private magnetArcGeometry?: THREE.BufferGeometry
  private launchPads: Array<{
    mesh: THREE.Group
    pos: THREE.Vector3
    cooldown: number
  }> = []

  // Scratch vectors reutilizaveis (Zero Allocation no game loop a 60 FPS)
  private readonly _camTargetPos = new THREE.Vector3()
  private readonly _camTargetLook = new THREE.Vector3()
  private readonly _camToBall = new THREE.Vector3()
  private readonly _camDir = new THREE.Vector3()
  private readonly _camOd = new THREE.Vector3()
  private readonly _camOffset = new THREE.Vector3(0, 18, 36)
  private readonly _camReplayTarget = new THREE.Vector3()

  constructor(container: HTMLElement, carModelId = 'octane-cartoon', tuning?: TurboTuning, network?: NetworkManager) {
    this.container = container
    this.selectedCarModelId = carModelId
    // Carrega atributos especiais do veículo selecionado (Power-Kick cars)
    const a = CAR_MODELS[carModelId]?.attrs
    if (a) {
      this.carAttrs = {
        nitroBonus: a.nitroBonus ?? 1.0,
        pushBonus:  a.pushBonus  ?? 1.0,
        shieldBonus: a.shieldBonus ?? 0,
        jumpBonus:  a.jumpBonus  ?? 0,
      }
    }
    this.theme = tuning?.theme ?? 'classic'
    this.botLevel = tuning?.botLevel ?? 'medium'
    this.matchFormat = tuning?.matchFormat ?? '1v1'
    this.goalExplosion = tuning?.goalExplosion ?? 'toon'
    this.gameMode = tuning?.gameMode ?? 'standard'
    this.spectatorMode = tuning?.spectatorMode ?? false
    if (this.gameMode === 'snowday') {
      this.theme = 'snowday'
    }

    // ── ONLINE 1v1 setup ──────────────────────────────────────
    if (network) {
      this.turboNet = new TurboNetworkController(network)
      this.isOnline1v1 = true
      this.matchFormat = '1v1'           // força 1v1 no modo online
      this.botLevel = 'medium'            // bot AI não será usado no modo online

      this.turboNet.onGoalEvent = (scorer, scores, _ballPos) => {
        // Cliente recebe gol do Host e atualiza o placar local
        // No Host: Host = Laranja, Cliente = Azul.
        // No Cliente: Cliente = Azul, Host = Laranja.
        if (this.destroyed) return
        const isPlayerGoal = !this.turboNet!.isHost
          ? scorer === 'blue'
          : scorer === 'orange'
        this.scorePlayer = !this.turboNet!.isHost ? scores.blue : scores.orange
        this.scoreBot    = !this.turboNet!.isHost ? scores.orange : scores.blue
        this.onGoalScored(isPlayerGoal ? 'player' : 'bot')
      }

      this.turboNet.onResetEvent = () => {
        if (this.destroyed) return
        this.resetKickoff()
      }

      this.turboNet.onCountdownEvent = (count) => {
        if (this.destroyed) return
        this.applyCountdownValue(count)
      }

      this.turboNet.onMatchEndEvent = (winner, scores) => {
        if (this.destroyed) return
        const isPlayerWin = !this.turboNet!.isHost
          ? (winner === 'blue' || winner === 'draw')
          : (winner === 'orange' || winner === 'draw')
        this.scorePlayer = !this.turboNet!.isHost ? scores.blue : scores.orange
        this.scoreBot    = !this.turboNet!.isHost ? scores.orange : scores.blue
        this.endMatch()
      }

      this.turboNet.onPeerDisconnected = () => {
        this.handleOnlineDisconnect()
      }

      this.turboNet.onCarHitEvent = (targetSlot, effect) => {
        if (this.destroyed) return
        const targetCar = this.allCars[targetSlot]
        if (targetCar) {
          if (effect === 'freeze') targetCar.applyFreeze(2.0)
          else if (effect === 'spin') targetCar.applySpinOut(1.4)
          else if (effect === 'shock') this.triggerShockwave(targetCar.pos)
        }
      }
    }

    if (tuning) {
      if (tuning.playerSpeedMult !== undefined) this.studioParams.playerSpeedMult = tuning.playerSpeedMult
      if (tuning.turnRate !== undefined) this.studioParams.turnRate = tuning.turnRate
      if (tuning.jumpForce !== undefined) this.studioParams.jumpForce = tuning.jumpForce
      if (tuning.ballBounce !== undefined) this.studioParams.ballBounce = tuning.ballBounce
    }

    initAudio()
    this.audio = new AudioManager()
    this.initReplayBuffer()

    // Geometria de estrela cartoon (4 pontas expressiva estilo anime/comic)
    const starShape = new THREE.Shape()
    const pts = 4
    const step = Math.PI / pts
    for (let i = 0; i < pts * 2; i++) {
      const r = i % 2 === 0 ? 0.95 : 0.28
      const a = i * step - Math.PI / 2
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      if (i === 0) starShape.moveTo(x, y)
      else starShape.lineTo(x, y)
    }
    starShape.closePath()
    this.starGeo = new THREE.ShapeGeometry(starShape)

    // 1. Cena Cartoon
    this.scene = new THREE.Scene()
    const themeBg = this.theme === 'cyber' ? 0x0b1020 : this.theme === 'futsal' ? 0x1e293b : this.theme === 'snowday' ? 0x93c5fd : this.theme === 'kong' ? 0x064e3b : 0x38bdf8
    this.scene.background = new THREE.Color(themeBg)


    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 1000)

    // 3. WebGLRenderer com Cores Vivas & Otimização Mobile
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isMobile,
      powerPreference: 'high-performance',
      precision: this.isMobile ? 'mediump' : 'highp',
    })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.25 : 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = this.isMobile ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.container.appendChild(this.renderer.domElement)

    // 4. Efeito de Contorno Cartoon Oficial Three.js (Comic Book Outline)
    this.outlineEffect = new OutlineEffect(this.renderer, {
      defaultThickness: this.studioParams.outlineThickness,
      defaultColor: [0.06, 0.06, 0.12], // Tracado preto/azul-escuro de quadrinhos
      defaultAlpha: 1.0,
      defaultKeepAlive: true,
    })

    // 5. Pós-Processamento GPU pmndrs/postprocessing (Bloom nos Neons & Vinheta de Estádio no PC)
    if (!this.isMobile) {
      try {
        this.composer = new EffectComposer(this.renderer, {
          frameBufferType: THREE.HalfFloatType
        })
        this.composer.addPass(new RenderPass(this.scene, this.camera))
        const bloom = new BloomEffect({
          intensity: 0.82,
          luminanceThreshold: 0.70,
          mipmapBlur: true
        })
        const vignette = new VignetteEffect({
          darkness: 0.35,
          offset: 0.35
        })
        this.composer.addPass(new EffectPass(this.camera, bloom, vignette))
      } catch (e) {
        console.warn('[PostProcessing] Fallback to standard OutlineEffect:', e)
        this.composer = null
      }
    }

    // 6. Monitor de Performance FPS stats.js (ativável via tecla F2)
    try {
      this.stats = new Stats()
      this.stats.showPanel(0)
      this.stats.dom.style.position = 'absolute'
      this.stats.dom.style.top = '14px'
      this.stats.dom.style.left = '14px'
      this.stats.dom.style.zIndex = '9999'
      this.stats.dom.style.display = 'none'
      this.container.appendChild(this.stats.dom)
    } catch {}

    if (tuning?.isTraining) {
      this.isTraining = true
    }

    this.initAsync()
  }

  private async initAsync() {
    try {
      this.setupLighting()
      this.buildSkyAndSun()
      this.buildCartoonArena()
      this.buildObstacles3D()
      this.buildBoostCoins()
      // ARENA POWER-KICK (ou modo Rumble): Caixas surpresa e Launch Pads na arena!
      if (this.theme === 'classic' || this.gameMode === 'rumble') {
        this.buildMysteryBoxes()
        this.buildLaunchPads()
      }
      this.buildMagnetArc()
      this.buildGoals()
      this.buildBall()
      this.loadSceneryClouds()
      this.loadCornerFlags()
      this.buildCartoonCrowd()
      this.buildImpactFlash()

      // ── SPAWN DE KICKOFF DIAGONAL / LATERAL ESTILO ROCKET LEAGUE ──────────
      // NUNCA nascem em linha reta pro gol! A saída acontece pelas laterais em 45°,
      // evitando gols instantâneos e permitindo disputa aérea e passes reais!
      const teamSizes: Record<TurboMatchFormat, number> = { '1v1': 1, '2v2': 2, '3v3': 3, '4v4': 4 }
      const teamSize = teamSizes[this.matchFormat]

      const { orangeSpawns, blueSpawns } = this.getKickoffSpawns()
      const isClient1v1 = this.isOnline1v1 && !this.turboNet?.isHost

      if (isClient1v1) {
        // ── CLIENTE ONLINE 1v1:
        // playerCar = Carro Azul do próprio jogador (Slot 1, nasce no blueSpawn, força azul)
        this.playerCar = new CarObject(this.scene, 0x0099ff, false, true)
        this.playerCar.setPosition(blueSpawns[0].x, 0, blueSpawns[0].z)
        this.playerCar.yaw = blueSpawns[0].yaw
        this.playerCar.applyTransform()
        this.blueCars.push(this.playerCar)

        // botCar = Carro Laranja que representa o Host remoto (Slot 0, nasce no orangeSpawn, força laranja)
        this.botCar = new CarObject(this.scene, 0xff4500, true, true)
        this.botCar.setPosition(orangeSpawns[0].x, 0, orangeSpawns[0].z)
        this.botCar.yaw = orangeSpawns[0].yaw
        this.botCar.applyTransform()
        this.orangeCars.push(this.botCar)

        // Lista mestre com índices de slot correspondentes:
        // Slot 0 = Host Laranja (botCar), Slot 1 = Cliente Azul (playerCar)
        this.allCars = [this.botCar, this.playerCar]

        // Posiciona câmera atrás do carro Azul olhando em direção ao gol Laranja (+Z)
        const sp = blueSpawns[0]
        this.camCurrentPos.set(sp.x - Math.sin(sp.yaw) * 16, 8.5, sp.z - Math.cos(sp.yaw) * 16)
        this.camCurrentLook.set(sp.x + Math.sin(sp.yaw) * 10, 2.0, sp.z + Math.cos(sp.yaw) * 10)
        this.camera.position.copy(this.camCurrentPos)
        this.camera.lookAt(this.camCurrentLook)
      } else {
        // ── HOST ONLINE OU MODO SOLO / OFFLINE (padrão preservado):
        // Carro do Jogador (Laranja — slot 0)
        const forceOrange = this.isOnline1v1
        this.playerCar = new CarObject(this.scene, 0xff4500, false, forceOrange)
        this.playerCar.setPosition(orangeSpawns[0].x, 0, orangeSpawns[0].z)
        this.playerCar.yaw = orangeSpawns[0].yaw
        this.playerCar.applyTransform()
        this.orangeCars.push(this.playerCar)

        // Aliados Bot Laranja (slots 1..teamSize-1)
        const orangeBotColors = [0xff8800, 0xffaa00, 0xffcc00]
        for (let i = 1; i < teamSize; i++) {
          const ally = new CarObject(this.scene, orangeBotColors[i - 1] ?? 0xff8800, true)
          const sp = orangeSpawns[i] ?? orangeSpawns[0]
          ally.setPosition(sp.x, 0, sp.z)
          ally.yaw = sp.yaw
          ally.applyTransform()
          ally.attachTeamBadge(`🤝 ALIADO ${i}`, '#22c55e', '#ffffff')
          this.orangeCars.push(ally)
        }

        // Carro do Bot Rival (Azul — slot 0 no solo, slot 1 online)
        const forceBlue = this.isOnline1v1
        this.botCar = new CarObject(this.scene, 0x0099ff, true, forceBlue)
        this.botCar.setPosition(blueSpawns[0].x, 0, blueSpawns[0].z)
        this.botCar.yaw = blueSpawns[0].yaw
        this.botCar.applyTransform()
        this.botCar.attachTeamBadge('⚔️ RIVAL', '#ef4444', '#ffffff')
        this.blueCars.push(this.botCar)

        // Rivais Bot Azul adicionais (slots 1..teamSize-1)
        const blueBotColors = [0x00cfff, 0x00eeff, 0x44aaff]
        for (let i = 1; i < teamSize; i++) {
          const rival = new CarObject(this.scene, blueBotColors[i - 1] ?? 0x00cfff, true)
          const sp = blueSpawns[i] ?? blueSpawns[0]
          rival.setPosition(sp.x, 0, sp.z)
          rival.yaw = sp.yaw
          rival.applyTransform()
          rival.attachTeamBadge(`⚔️ RIVAL ${i + 1}`, '#ef4444', '#ffffff')
          this.blueCars.push(rival)
        }

        // Lista mestre com todos os carros
        this.allCars = [...this.orangeCars, ...this.blueCars]

        // Posiciona câmera e inicializa HUD e loop imediatamente
        const sp = orangeSpawns[0]
        this.camCurrentPos.set(sp.x - Math.sin(sp.yaw) * 16, 8.5, sp.z - Math.cos(sp.yaw) * 16)
        this.camCurrentLook.set(sp.x + Math.sin(sp.yaw) * 10, 2.0, sp.z + Math.cos(sp.yaw) * 10)
        this.camera.position.copy(this.camCurrentPos)
        this.camera.lookAt(this.camCurrentLook)
      }

      if (this.isOnline1v1) {
        const role = this.turboNet?.isHost ? 'host' : 'client'
        const slot = this.turboNet?.isHost ? 0 : 1
        const team = this.turboNet?.isHost ? 'orange' : 'blue'
        const spawnZ = this.playerCar.pos.z
        const targetGoalZ = this.turboNet?.isHost ? -FIELD_L / 2 : FIELD_L / 2
        console.log('[TurboOnline]', {
          role,
          slot,
          team,
          spawnZ,
          targetGoalZ
        })
      }

      this.buildHUD()

      this.gamepad.onBallCamToggle = () => this.toggleBallCam()
      window.addEventListener('resize', this.onResize)
      window.addEventListener('keydown', this.onKeyDown)
      window.addEventListener('keyup', this.onKeyUp)

      // ── ARENA KONG: AMBIENTE SELVAGEM & GORILA GIGANTE KONG GORAK ──
      if (this.theme === 'kong') {
        loadArenaKongEnvironment(this.scene, { mode: 'day' }).then((env) => {
          if (this.destroyed) {
            env.dispose()
            return
          }
          this.kongEnvResult = env
        }).catch((err) => console.warn('[ArenaKong] Falha ao carregar kits de ambiente:', err))

        const kongPhysics = {
          applyImpulse: (target: any, impulse: THREE.Vector3) => {
            if (target === this.ball || target === this.ball?.mesh) {
              this.ball.vel.add(impulse)
            } else if (target && typeof target.velX !== 'undefined') {
              target.velX += impulse.x
              target.velZ += impulse.z
              target.velY = Math.max(target.velY, Math.abs(impulse.y))
              if (typeof target.applySpinOut === 'function') target.applySpinOut(1.8)
            }
          },
          applyAngularImpulse: (target: any, _ang: THREE.Vector3) => {
            if (target && typeof target.applySpinOut === 'function') {
              target.applySpinOut(2.2)
            }
          },
          setKinematic: (target: any, isKinematic: boolean) => {
            if (target === this.ball || target === this.ball?.mesh) {
              this.ball.userData = this.ball.userData || {}
              this.ball.userData.kongHeld = isKinematic
            }
          },
          setSensor: (_target: any, _isSensor: boolean) => {}
        }

        const kongCamera = {
          shake: (_duration: number, intensity: number) => this.triggerCameraShake(intensity)
        }

        const kongEffects = {
          kick: (pos?: THREE.Vector3) => {
            this.audio.playPowerHit()
            this.audio.synthesizeBoom(90, 0.4, 0.8)
            if (pos) this.emitCartoonStarBurst(pos, 35, 0xfacc15)
          },
          punch: (pos?: THREE.Vector3) => {
            this.audio.playPunchImpact()
            this.audio.playHit()
            this.triggerCameraShake(0.35)
            if (pos) this.emitCartoonStarBurst(pos, 40, 0xef4444)
          },
          grab: (pos?: THREE.Vector3) => {
            this.audio.playDash()
            if (pos) this.emitCartoonStarBurst(pos, 22, 0x00f0ff)
          },
          throw: (pos?: THREE.Vector3) => {
            this.audio.playPowerHit()
            this.audio.synthesizeBoom(70, 0.5, 1.0)
            this.triggerCameraShake(0.55)
            if (pos) this.emitCartoonStarBurst(pos, 44, 0x22c55e)
          },
          slam: (pos?: THREE.Vector3) => {
            this.audio.playPunchImpact()
            this.audio.synthesizeBoom(55, 0.85, 1.6)
            this.triggerCameraShake(0.95)
            if (pos) {
              this.emitCartoonStarBurst(pos, 60, 0x22c55e)
              this.emitCartoonStarBurst(pos, 35, 0xffffff)
            }
          },
          hitObstacle: (pos?: THREE.Vector3) => {
            this.audio.playWallBounce()
            this.audio.playCollisionTiered(25)
            if (pos) this.emitCartoonStarBurst(pos, 28, 0xd97706)
          },
          step: (_pos?: THREE.Vector3) => {
            this.audio.synthesizeBoom(40, 0.12, 0.18)
            this.triggerCameraShake(0.06)
          },
          rage: (_k: number) => {
            this.audio.synthesizeBoom(80, 0.9, 1.5)
            this.triggerCameraShake(0.5)
          }
        }

        this.kongGorak = new KongGorak({
          scene: this.scene,
          ball: this.ball,
          getCars: () => this.allCars,
          getObstacles: () => this.dynamicObstacles,
          physics: kongPhysics,
          camera: kongCamera,
          effects: kongEffects
        })

        this.scene.add(this.kongGorak.rootGroup)
        this.kongGorak.load().catch((err) => console.warn('[KongGorak] Falha ao carregar modelo:', err))
      }

      this.loop()
      if (this.isTraining) {
        this.setTrainingMode(true)
      }

      // Carrega modelos 3D reais (GLB) para todos os carros — variedade total sem caixas geométricas
      const botModelPool = ['buggy', 'ferrari', 'toycar', 'cartoon-yellow', 'cartoon-green', 'cartoon-purple', 'cartoon-moto', 'sportscar', 'volt-striker', 'titan-shift', 'nova-forge', 'guincho-tody', 'van-gost']
      const loadPromises: Promise<any>[] = []

      loadPromises.push(this.playerCar.loadModel(this.selectedCarModelId))
      for (let i = 1; i < this.orangeCars.length; i++) {
        const allyModel = botModelPool[(i - 1) % botModelPool.length]
        loadPromises.push(this.orangeCars[i].loadModel(allyModel))
      }
      const primaryBotModel = this.selectedCarModelId === 'buggy' ? 'ferrari' : 'buggy'
      loadPromises.push(this.botCar.loadModel(primaryBotModel))
      for (let i = 1; i < this.blueCars.length; i++) {
        const botModel = botModelPool[(i + 1) % botModelPool.length]
        loadPromises.push(this.blueCars[i].loadModel(botModel))
      }
      void Promise.allSettled(loadPromises)
    } catch (err) {
      console.error('[TurboSoccer] Falha crítica no initAsync:', err)
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true
    if (e.code === 'KeyR' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
      this.activatePlayerRumble()
    }
    if (e.code === 'Space' && this.isReplaying) {
      this.stopGoalReplay()
    }
    if (e.code === 'KeyC') {
      this.triggerBarrelRoll()
    }
    if (e.code === 'KeyH') {
      this.toggleStudioGUI()
    }
    if (e.code === 'F2' && this.stats) {
      this.stats.dom.style.display = this.stats.dom.style.display === 'none' ? 'block' : 'none'
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault()
      this.togglePause()
    }
    // Teclas de Quick Chat / Emote (1 a 8)
    if (e.code === 'Digit1') this.showQuickChat('⚽ Golaço! VAI!')
    if (e.code === 'Digit2') this.showQuickChat('🛡️ Grande defesa!')
    if (e.code === 'Digit3') this.showQuickChat('⚡ Passa a bola aqui!')
    if (e.code === 'Digit4') this.showQuickChat('🔥 Que manobra!')
    if (e.code === 'Digit5') this.showQuickChat('🚀 Na trave!')
    if (e.code === 'Digit6') this.showQuickChat('🏎️ Sai da frente!')
    if (e.code === 'Digit7') this.showQuickChat('🤝 Belo passe!')
    if (e.code === 'Digit8') this.showQuickChat('👏 Boa partida!')
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false
  }

  public setTrainingMode(enabled: boolean) {
    this.isTraining = enabled
    if (enabled) {
      this.matchTimer = 999999
      this.kickoffCountdown = 0
      this.isKickoffActive = false
      const cdWrap = document.getElementById('turbo-countdown-overlay')
      if (cdWrap) cdWrap.style.display = 'none'
      if (this.hudTimer) this.hudTimer.textContent = 'TREINO'
      this.playerCar.boost = 100
      for (const car of this.allCars) {
        if (car !== this.playerCar) {
          car.freeze()
          car.group.visible = false
        }
      }
      this.showQuickChat('🎯 MODO TREINO LIVRE: Nitro infinito e arena livre!')
    }
  }

  public triggerBarrelRoll = () => {
    const pc = this.playerCar
    if (pc.isRolling) return
    pc.isRolling = true
    pc.rollAngle = 0
    pc.speed = Math.min(pc.speed + 0.55, 1.75 * this.studioParams.playerSpeedMult)
    this.audio.playDash()
    this.emitTireSmoke(pc)
  }

  public toggleBallCam = () => {
    this.isBallCam = !this.isBallCam
    if (this.hudCamStatus) {
      this.hudCamStatus.textContent = this.isBallCam ? 'BOLA' : 'LIVRE'
      this.hudCamStatus.style.color = this.isBallCam ? '#00ff88' : '#00cfff'
    }
  }

  public togglePause = () => {
    if (this.matchEnded || this.destroyed) return
    this.paused = !this.paused
    if (this.pauseOverlay) this.pauseOverlay.style.display = this.paused ? 'flex' : 'none'
  }

  public toggleStudioGUI = () => {
    if (this.gui) {
      if (this.gui._hidden) {
        this.gui.show()
      } else {
        this.gui.hide()
      }
      return
    }

    this.gui = new GUI({ title: 'Arena Studio 3D' })
    this.gui.domElement.style.position = 'absolute'
    this.gui.domElement.style.top = '70px'
    this.gui.domElement.style.right = '20px'
    this.gui.domElement.style.zIndex = '250'

    // Visual Toon
    const fVis = this.gui.addFolder('Estilo Cartoon')
    fVis.add(this.studioParams, 'outlineThickness', 0.001, 0.02, 0.001).name('Contorno Toon').onChange(() => {
      this.rebuildOutline()
    })
    fVis.add(this.studioParams, 'sunIntensity', 0.5, 3.0, 0.1).name('Luz do Sol').onChange((v: number) => {
      if (this.sunLight) this.sunLight.intensity = v
    })
    fVis.add(this.studioParams, 'exposure', 0.6, 2.0, 0.05).name('Exposicao').onChange((v: number) => {
      this.renderer.toneMappingExposure = v
    })


    const fPhys = this.gui.addFolder('Fisica e Mecanica')
    fPhys.add(this.studioParams, 'playerSpeedMult', 0.5, 2.5, 0.1).name('Velocidade')
    fPhys.add(this.studioParams, 'turnRate', 1.5, 5, 0.1).name('Giro')
    fPhys.add(this.studioParams, 'jumpForce', 8, 26, 1).name('Forca do Pulo')
    fPhys.add(this.studioParams, 'gravity', 10, 60, 2).name('Gravidade')
    fPhys.add(this.studioParams, 'ballBounce', 0.3, 0.95, 0.05).name('Quique Bola')


    const fCam = this.gui.addFolder('Camera 3D')
    fCam.add(this.studioParams, 'camDist', 8, 25, 0.5).name('Distancia')
    fCam.add(this.studioParams, 'camH', 3, 14, 0.5).name('Altura')
    fCam.add(this, 'toggleBallCam').name('Alternar Bola/Livre')
  }


  private rebuildOutline() {
    this.outlineEffect = new OutlineEffect(this.renderer, {
      defaultThickness: this.studioParams.outlineThickness,
      defaultColor: [0.06, 0.06, 0.12],
      defaultAlpha: 1.0,
      defaultKeepAlive: true,
    })
    this.outlineEffect.setSize(window.innerWidth, window.innerHeight)
  }




  private setupLighting() {
    const isNight = this.theme === 'cyber'


    const ambient = new THREE.AmbientLight(0xffffff, isNight ? 0.5 : 0.65)
    this.scene.add(ambient)

    // Sol direcional com sombras toon marcantes
    const sun = new THREE.DirectionalLight(0xfff6dd, isNight ? 0.55 : this.studioParams.sunIntensity)
    sun.position.set(45, 80, 50)
    sun.castShadow = true
    const shadowRes = this.isMobile ? 1024 : 2048
    sun.shadow.mapSize.set(shadowRes, shadowRes)
    sun.shadow.bias = -0.0003
    const d = 65
    sun.shadow.camera.left = -d
    sun.shadow.camera.right = d
    sun.shadow.camera.top = d
    sun.shadow.camera.bottom = -d
    this.scene.add(sun)
    this.sunLight = sun


    const hemi = new THREE.HemisphereLight(0x7dd3fc, 0x15803d, isNight ? 0.3 : 0.45)
    this.scene.add(hemi)
  }




  private buildSkyAndSun() {
    if (this.theme === 'kong') {
      // Backdrop 360° tropical instantâneo para a Arena Kong (garante cenário visível desde o frame 0)
      this.kongBackdropMesh = createArenaKongInstantBackdrop(this.scene, 'day')
      return
    }
    // ── CENÁRIO PANORÂMICO 360° (HORIZONTE EXTERNO DE PROFUNDIDADE) ──
    const isNight = this.theme === 'cyber'
    const backdropFile = isNight
      ? '/assets/environment/arena-kick-backdrop-night.webp'
      : '/assets/environment/arena-kick-backdrop-day.webp'

    try {
      const texLoader = new THREE.TextureLoader()
      const backdropTex = texLoader.load(backdropFile)
      backdropTex.colorSpace = THREE.SRGBColorSpace
      backdropTex.wrapS = THREE.RepeatWrapping
      backdropTex.repeat.set(3, 1) // Repetição panorâmica suave ao redor dos 360°

      const backdropMat = new THREE.MeshBasicMaterial({
        map: backdropTex,
        side: THREE.BackSide,
        depthWrite: false
      })

      // Cilindro gigante envolvendo toda a arena (FIELD_W=220, FIELD_L=360)
      const backdropMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(280, 280, 160, 64, 1, true),
        backdropMat
      )
      backdropMesh.position.set(0, 65, 0)
      backdropMesh.renderOrder = -10
      this.scene.add(backdropMesh)
    } catch (e) {
      console.warn('[TurboSoccer] Fallback de backdrop:', e)
    }

    // Sol 3D Estilizado Cartoon no Horizonte Alto
    const sunGroup = new THREE.Group()
    sunGroup.position.set(60, 70, -80)

    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff000 })
    const sunCore = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 24), sunMat)
    sunGroup.add(sunCore)

    // Raios do Sol Cartoon
    const rayMat = new THREE.MeshBasicMaterial({
      color: 0xffea00,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide
    })
    const rays = 12
    for (let i = 0; i < rays; i++) {
      const angle = (i / rays) * Math.PI * 2
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.5, 12, 4), rayMat)
      cone.position.set(Math.cos(angle) * 14, Math.sin(angle) * 14, 0)
      cone.rotation.z = angle - Math.PI / 2
      sunGroup.add(cone)
    }

    sunGroup.visible = this.theme !== 'cyber'
    this.scene.add(sunGroup)
  }

  private loadSceneryClouds() {
    const cloudMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      gradientMap: TOON_GRADIENT
    })

    const buildFluffyCloud = () => {
      const cg = new THREE.Group()
      // Nuvem fofa estilizada cartoon composta por esferas e elipsóides brancos arredondados
      const parts = [
        { r: 2.2, x: 0, y: 0, z: 0 },
        { r: 1.8, x: -1.8, y: -0.3, z: 0.2 },
        { r: 1.7, x: 1.8, y: -0.2, z: -0.1 },
        { r: 1.4, x: -0.9, y: 1.1, z: 0 },
        { r: 1.5, x: 0.9, y: 1.0, z: 0.1 },
        { r: 1.2, x: 0, y: 0.2, z: 1.2 },
        { r: 1.2, x: 0, y: 0.1, z: -1.2 }
      ]
      parts.forEach(p => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(p.r, 16, 16), cloudMat)
        m.position.set(p.x, p.y, p.z)
        cg.add(m)
      })
      return cg
    }

    const positions: [number, number, number, number][] = [
      [-65, 38, -85, 3.8],
      [75, 42, -95, 4.2],
      [-78, 40, 55, 3.5],
      [70, 36, 65, 4.0],
      [0, 52, -110, 5.0],
      [-40, 44, 20, 3.2],
      [45, 42, -30, 3.6]
    ]

    positions.forEach(([cx, cy, cz, sc]) => {
      const cloud = buildFluffyCloud()
      cloud.scale.set(sc, sc * 0.75, sc)
      cloud.position.set(cx, cy, cz)
      this.scene.add(cloud)
    })
  }


  //  BANDEIRAS DE ESCANTEIO OFICIAIS KENNEY CC0

  private loadCornerFlags() {
    const loader = new GLTFLoader()
    loader.load('/models/flag.glb', (gltf) => {
      const fx = FIELD_W / 2 - 1.2
      const fz = FIELD_L / 2 - 1.2
      const corners: [number, number, number][] = [
        [-fx, fz, Math.PI / 4],
        [fx, fz, -Math.PI / 4],
        [-fx, -fz, (3 * Math.PI) / 4],
        [fx, -fz, (-3 * Math.PI) / 4],
      ]
      corners.forEach(([cx, cz, rot]) => {
        const flag = gltf.scene.clone()
        flag.scale.setScalar(2.2)
        flag.position.set(cx, 0.1, cz)
        flag.rotation.y = rot
        flag.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            c.castShadow = true
          }
        })
        this.scene.add(flag)
      })
    }, undefined, () => {})
  }


  //  TORCIDA CARTOON (BILLBOARDS DESENHADOS EM CANVAS)

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

      // ── TORCIDA CARTOON PROFISSIONAL (PERSONAGENS EXPRESSIVOS) ─────
  private generateCartoonFanTextures(): THREE.CanvasTexture[] {
    const textures: THREE.CanvasTexture[] = []

    const skinTones = ['#ffd1b3', '#fcd34d', '#fbb78c', '#e0a97c', '#ffdfba', '#d49b6a']
    const shirtColors = ['#ff5500', '#00cfff', '#22c55e', '#ff2d78', '#facc15', '#a855f7', '#ef4444', '#3b82f6']
    const hairColors = ['#1e1b4b', '#7c2d12', '#451a03', '#ca8a04', '#18181b', '#0284c7']

    for (let i = 0; i < 8; i++) {
      const c = document.createElement('canvas')
      c.width = 256
      c.height = 384
      const ctx = c.getContext('2d')!

      const skin = skinTones[i % skinTones.length]
      const shirt = shirtColors[i % shirtColors.length]
      const hair = hairColors[i % hairColors.length]
      const hasCap = i % 2 === 1

      ctx.clearRect(0, 0, 256, 384)
      ctx.lineWidth = 4
      ctx.strokeStyle = '#0f172a'
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      // 1. BRAÇOS LEVANTADOS TORCENDO (COMEMORAÇÃO)
      ctx.fillStyle = skin
      // Braço esquerdo
      ctx.beginPath()
      ctx.moveTo(70, 190)
      ctx.quadraticCurveTo(30, 130, 40, 70)
      ctx.lineTo(60, 65)
      ctx.quadraticCurveTo(55, 120, 85, 180)
      ctx.closePath()
      ctx.fill(); ctx.stroke()

      // Braço direito
      ctx.beginPath()
      ctx.moveTo(186, 190)
      ctx.quadraticCurveTo(226, 130, 216, 70)
      ctx.lineTo(196, 65)
      ctx.quadraticCurveTo(201, 120, 171, 180)
      ctx.closePath()
      ctx.fill(); ctx.stroke()

      // Mãozinhas Cartoon comemorando ou Bandeirinha
      ctx.fillStyle = '#facc15'
      ctx.beginPath(); ctx.arc(48, 65, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.beginPath(); ctx.arc(208, 65, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke()

      // 2. CORPO / CAMISA DE FUTEBOL CARTOON
      ctx.fillStyle = shirt
      ctx.beginPath()
      ctx.moveTo(75, 180)
      ctx.lineTo(181, 180)
      ctx.lineTo(195, 340)
      ctx.lineTo(61, 340)
      ctx.closePath()
      ctx.fill(); ctx.stroke()

      // Listras ou número esportivo na camisa
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(100, 185, 16, 150)
      ctx.fillRect(140, 185, 16, 150)

      // Gola da camisa
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.moveTo(105, 180)
      ctx.lineTo(128, 205)
      ctx.lineTo(151, 180)
      ctx.closePath()
      ctx.fill(); ctx.stroke()

      // 3. CABEÇA / ROSTO CARTOON EXPRESSIVO
      ctx.fillStyle = skin
      ctx.beginPath()
      ctx.arc(128, 120, 48, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke()

      // Orelhas
      ctx.beginPath(); ctx.arc(78, 120, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.beginPath(); ctx.arc(178, 120, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke()

      // Cabelo ou Boné Cartoon
      if (hasCap) {
        // Boné de torcedor
        ctx.fillStyle = shirt
        ctx.beginPath()
        ctx.arc(128, 105, 50, Math.PI, Math.PI * 2)
        ctx.closePath()
        ctx.fill(); ctx.stroke()
        // Aba do boné
        ctx.fillStyle = '#facc15'
        ctx.beginPath()
        ctx.ellipse(128, 105, 54, 14, 0, 0, Math.PI * 2)
        ctx.fill(); ctx.stroke()
      } else {
        // Cabelo estiloso cartoon
        ctx.fillStyle = hair
        ctx.beginPath()
        ctx.moveTo(76, 110)
        ctx.quadraticCurveTo(80, 60, 128, 60)
        ctx.quadraticCurveTo(176, 60, 180, 110)
        ctx.quadraticCurveTo(160, 85, 128, 90)
        ctx.quadraticCurveTo(95, 85, 76, 110)
        ctx.closePath()
        ctx.fill(); ctx.stroke()
      }

      // 4. OLHOS CARTOON GRANDES E VIBRANTES
      // Olho Esquerdo
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.ellipse(110, 118, 12, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      // Olho Direito
      ctx.beginPath(); ctx.ellipse(146, 118, 12, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()

      // Pupilas
      ctx.fillStyle = '#0f172a'
      ctx.beginPath(); ctx.arc(112, 118, 7, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(144, 118, 7, 0, Math.PI * 2); ctx.fill()

      // Brilho dos olhos (especular cartoon)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(114, 115, 3, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(146, 115, 3, 0, Math.PI * 2); ctx.fill()

      // Sobrancelhas animadas
      ctx.strokeStyle = hair
      ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(98, 98); ctx.lineTo(122, 102); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(158, 98); ctx.lineTo(134, 102); ctx.stroke()

      // 5. BOCA ABERTA GRITANDO "GOL!" OU SORRISO CARTOON
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 3
      if (i % 2 === 0) {
        // Boca aberta gritando
        ctx.fillStyle = '#991b1b'
        ctx.beginPath()
        ctx.ellipse(128, 145, 14, 18, 0, 0, Math.PI * 2)
        ctx.fill(); ctx.stroke()
        // Dentes
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(120, 131, 16, 6)
      } else {
        // Sorriso cartoon largo
        ctx.fillStyle = '#991b1b'
        ctx.beginPath()
        ctx.arc(128, 138, 18, 0.1 * Math.PI, 0.9 * Math.PI)
        ctx.closePath()
        ctx.fill(); ctx.stroke()
      }

      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearFilter
      textures.push(tex)
    }

    return textures
  }

  private buildCartoonCrowd() {
    const textures = this.generateCartoonFanTextures()
    this.crowdTextures = textures

    const rowD = 3.6
    const rowH = 2.0
    const seatTopY = (r: number) => r * rowH * 0.72 + 1.2 + rowH * 0.28 + 0.2
    const byTex = new Map<number, { x: number; feetY: number; z: number; phase: number; yaw: number }[]>()

    const addFan = (x: number, feetY: number, z: number, phase: number, yaw: number) => {
      const ti = Math.floor(Math.random() * textures.length)
      let arr = byTex.get(ti)
      if (!arr) { arr = []; byTex.set(ti, arr) }
      arr.push({ x, feetY, z, phase, yaw })
    }

    const sides: number[] = [-1, 1]
    // Arquibancadas laterais preenchidas
    for (const s of sides) {
      for (let r = 0; r < 8; r++) {
        const posX = s * (FIELD_W / 2 + 3.2 + r * rowD)
        const feetY = seatTopY(r)
        for (let c = -7; c <= 7; c++) {
          const posZ = c * 9 + (r % 2) * 1.5
          addFan(posX, feetY, posZ, r * 0.7 + c * 0.45, s * Math.PI * 0.5)
        }
      }
    }
    // Arquibancadas atrás dos gols preenchidas
    for (const s of sides) {
      for (let r = 0; r < 8; r++) {
        const posZ = s * (FIELD_L / 2 + 6.5 + r * rowD)
        const feetY = seatTopY(r)
        for (let c = -5; c <= 5; c++) {
          const posX = c * 9 + (r % 2) * 1.5
          addFan(posX, feetY, posZ, r * 0.75 + c * 0.5, s > 0 ? Math.PI : 0)
        }
      }
    }

    for (const entry of Array.from(byTex.entries())) {
      const ti = entry[0]
      const arr = entry[1]
      const mat = new THREE.MeshBasicMaterial({ map: textures[ti], transparent: true, alphaTest: 0.25, depthWrite: true, side: THREE.FrontSide })
      mat.userData.outlineParameters = { visible: false }
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(this.crowdFanW, this.crowdFanH), mat, arr.length)
      mesh.castShadow = false
      mesh.receiveShadow = false
      this.crowdInstances.push({ mesh, data: arr })
      this.scene.add(mesh)
    }
  }

  private buildCartoonArena() {
    // 1. Textura do Gramado Cartoon Ultra-Saturado
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 1024
    const ctx = c.getContext('2d')!

    const isSnow = this.theme === 'snowday'
    const grassA = isSnow ? '#f0f9ff' : this.theme === 'cyber' ? '#0b1220' : this.theme === 'futsal' ? '#b45309' : this.theme === 'kong' ? '#15803d' : '#22c55e'
    const grassB = isSnow ? '#e0f2fe' : this.theme === 'cyber' ? '#1e1b4b' : this.theme === 'futsal' ? '#92400e' : this.theme === 'kong' ? '#166534' : '#16a34a'
    const lineCol = isSnow ? '#0284c7' : this.theme === 'cyber' ? '#00cfff' : this.theme === 'kong' ? '#bbf7d0' : '#ffffff'


    ctx.fillStyle = grassA
    ctx.fillRect(0, 0, 1024, 1024)

    // Faixas de corte alternadas
    const stripes = 16
    for (let i = 0; i < stripes; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = grassB
        ctx.fillRect(0, (1024 / stripes) * i, 1024, 1024 / stripes)
      }
    }

    // Linhas de campo espessas
    ctx.strokeStyle = lineCol
    ctx.lineWidth = 18

    // Linhas Laterais
    ctx.strokeRect(40, 40, 944, 944)

    // Linha do Meio Campo
    ctx.beginPath()
    ctx.moveTo(40, 512); ctx.lineTo(984, 512); ctx.stroke()


    ctx.beginPath()
    ctx.arc(512, 512, 170, 0, Math.PI * 2); ctx.stroke()

    // Ponto Central
    ctx.beginPath()
    ctx.arc(512, 512, 18, 0, Math.PI * 2)
    ctx.fillStyle = lineCol; ctx.fill()



    ctx.strokeRect(280, 820, 464, 164)
    ctx.strokeRect(390, 910, 244, 74)

    ctx.strokeRect(280, 40, 464, 164)
    ctx.strokeRect(390, 40, 244, 74)

    // Arcos de Escanteio
    const cr = 48
    ctx.beginPath(); ctx.arc(40, 40, cr, 0, Math.PI / 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(984, 40, cr, Math.PI / 2, Math.PI); ctx.stroke()
    ctx.beginPath(); ctx.arc(40, 984, cr, -Math.PI / 2, 0); ctx.stroke()
    ctx.beginPath(); ctx.arc(984, 984, cr, Math.PI, -Math.PI / 2); ctx.stroke()

    const turfTex = new THREE.CanvasTexture(c)
    turfTex.wrapS = turfTex.wrapT = THREE.ClampToEdgeWrapping

    const turfMat = new THREE.MeshToonMaterial({
      map: turfTex,
      gradientMap: TOON_GRADIENT
    })

    const turfGeo = new THREE.PlaneGeometry(FIELD_W, FIELD_L)
    const turf = new THREE.Mesh(turfGeo, turfMat)
    turf.rotation.x = -Math.PI / 2
    turf.receiveShadow = true
    this.scene.add(turf)

    // Moldura de Concreto Cartoon ao Redor do Campo
    const curbMat = new THREE.MeshToonMaterial({
      color: 0x0f172a,
      gradientMap: TOON_GRADIENT
    })
    const curbThick = 2.0
    // Curbs laterais
    for (const sx of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(curbThick, 0.4, FIELD_L + curbThick * 2), curbMat)
      curb.position.set(sx * (FIELD_W / 2 + curbThick / 2), 0.15, 0)
      curb.receiveShadow = true
      this.scene.add(curb)
    }
    for (const sz of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(FIELD_W, 0.4, curbThick), curbMat)
      curb.position.set(0, 0.15, sz * (FIELD_L / 2 + curbThick / 2))
      curb.receiveShadow = true
      this.scene.add(curb)
    }


    this.buildLEDBoards()

    // Arquibancadas com Torcida Cartoon
    this.buildStadiumStands()


    this.buildGlassWalls()


    this.buildStadiumRoof()
    this.buildFloodlights()
    this.buildDugouts()
    this.buildScoreboard()
  }

  private buildGlassWalls() {
    const wallGlassMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide
    })

    // Paredes de fundo dos gols: 100% transparentes para NUNCA ofuscar ou embaçar os placares
    const endGlassMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide
    })

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, CEIL_H, FIELD_L), wallGlassMat)
      wall.position.set(side * FIELD_W / 2, CEIL_H / 2, 0)
      this.scene.add(wall)
    }

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(FIELD_W, CEIL_H, 0.4), endGlassMat)
      wall.position.set(0, CEIL_H / 2, side * (FIELD_L / 2 + GOAL_D))
      this.scene.add(wall)
    }

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, FIELD_L), wallGlassMat)
    ceil.position.y = CEIL_H
    ceil.rotation.x = Math.PI / 2
    this.scene.add(ceil)
  }

  private buildLEDBoards() {
    const lc = document.createElement('canvas')
    lc.width = 1024
    lc.height = 128
    const lctx = lc.getContext('2d')!

    lctx.fillStyle = '#0f172a'
    lctx.fillRect(0, 0, 1024, 128)

    // Bordas brilhantes
    lctx.fillStyle = '#ff5500'
    lctx.fillRect(0, 0, 1024, 8)
    lctx.fillRect(0, 120, 1024, 8)

    lctx.font = '900 52px Impact, sans-serif'
    lctx.fillStyle = '#facc15'
    lctx.fillText('⚡ ARENA KICK ⚽  FUT CAR  ⚡ ARENA KICK ⚽  FUT CAR  ⚡', 20, 84)

    const boardTex = new THREE.CanvasTexture(lc)
    boardTex.wrapS = THREE.RepeatWrapping
    boardTex.repeat.set(3, 1)

    const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, side: THREE.DoubleSide })
    const boardH = 3.4

    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_L, boardH), boardMat)
      mesh.position.set(side * (FIELD_W / 2 - 0.2), boardH / 2 + 0.1, 0)
      mesh.rotation.y = -side * Math.PI / 2
      this.scene.add(mesh)
    }
  }

  private buildStadiumStands() {
    const standMat = new THREE.MeshToonMaterial({
      color: 0x1e293b,
      gradientMap: TOON_GRADIENT
    })
    const seatColors = [0x0284c7, 0xf97316, 0x10b981, 0xfacc15, 0xec4899]
    const rowD = 3.5
    const rowH = 1.9
    const spanZ = FIELD_L * 1.08
    const spanX = FIELD_W * 1.08

    // Arquibancadas laterais (X)
    for (const side of [-1, 1]) {
      for (let r = 0; r < 8; r++) {
        const posX = side * (FIELD_W / 2 + 3.2 + r * rowD)
        const posY = r * rowH * 0.7 + 1.0

        const base = new THREE.Mesh(new THREE.BoxGeometry(rowD, rowH * 0.45, spanZ), standMat)
        base.position.set(posX, posY, 0)
        base.castShadow = true
        base.receiveShadow = true
        this.scene.add(base)

        const seatMat = new THREE.MeshToonMaterial({
          color: seatColors[r % seatColors.length],
          gradientMap: TOON_GRADIENT
        })
        const seats = new THREE.Mesh(new THREE.BoxGeometry(rowD * 0.85, 0.4, spanZ * 0.97), seatMat)
        seats.position.set(posX, posY + rowH * 0.28, 0)
        seats.castShadow = true
        this.scene.add(seats)
      }
    }


    // Arquibancadas de fundo (Z) - recuadas atrás da cabine do gol para NUNCA invadir a rede!
    for (const side of [-1, 1]) {
      for (let r = 0; r < 8; r++) {
        const posZ = side * (FIELD_L / 2 + GOAL_D + 4.5 + r * rowD)
        const posY = r * rowH * 0.7 + 1.2

        const base = new THREE.Mesh(new THREE.BoxGeometry(spanX, rowH * 0.45, rowD), standMat)
        base.position.set(0, posY, posZ)
        base.castShadow = true
        base.receiveShadow = true
        this.scene.add(base)

        const seatMat = new THREE.MeshToonMaterial({
          color: seatColors[(r + 2) % seatColors.length],
          gradientMap: TOON_GRADIENT
        })
        const seats = new THREE.Mesh(new THREE.BoxGeometry(spanX * 0.97, 0.4, rowD * 0.85), seatMat)
        seats.position.set(0, posY + rowH * 0.28, posZ)
        seats.castShadow = true
        this.scene.add(seats)
      }
    }
  }




  private buildStadiumRoof() {
    const roofMat = new THREE.MeshToonMaterial({ color: 0x1e293b, gradientMap: TOON_GRADIENT })
    const trimMat = new THREE.MeshToonMaterial({ color: 0x38bdf8, gradientMap: TOON_GRADIENT })
    const pillarMat = new THREE.MeshToonMaterial({ color: 0x334155, gradientMap: TOON_GRADIENT })

    const roofY = 13.5
    const spanZ = FIELD_L * 1.08
    const spanX = FIELD_W * 1.08
    const depth = 24

    for (const side of [-1, 1]) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(depth, 0.7, spanZ + depth), roofMat)
      roof.position.set(side * (FIELD_W / 2 + 3.2 + 7.5), roofY, 0)
      roof.receiveShadow = true
      this.scene.add(roof)

      const trim = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, spanZ + depth), trimMat)
      trim.position.set(side * (FIELD_W / 2 + 1.0), roofY - 0.4, 0)
      this.scene.add(trim)
    }

    for (const side of [-1, 1]) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(spanX + depth, 0.7, depth), roofMat)
      roof.position.set(0, roofY + 0.1, side * (FIELD_L / 2 + 3.2 + 7.5))
      roof.receiveShadow = true
      this.scene.add(roof)

      const trim = new THREE.Mesh(new THREE.BoxGeometry(spanX + depth, 0.9, 1.0), trimMat)
      trim.position.set(0, roofY - 0.3, side * (FIELD_L / 2 + 1.0))
      this.scene.add(trim)
    }

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, roofY, 1.2), pillarMat)
        pillar.position.set(sx * (FIELD_W / 2 + 18), roofY / 2, sz * (FIELD_L / 2 + 18))
        pillar.castShadow = true
        this.scene.add(pillar)
      }
    }
  }




  private buildFloodlights() {
    const poleMat = new THREE.MeshToonMaterial({ color: 0x475569, gradientMap: TOON_GRADIENT })
    const frameMat = new THREE.MeshToonMaterial({ color: 0x0f172a, gradientMap: TOON_GRADIENT })
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff7cc })

    const px = FIELD_W / 2 + 30
    const pz = FIELD_L / 2 + 28
    const poleH = 30

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * px
        const z = sz * pz
        const faceYaw = Math.atan2(-x, -z)

        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, poleH, 12), poleMat)
        pole.position.set(x, poleH / 2, z)
        pole.castShadow = true
        this.scene.add(pole)

        const bank = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 1.4), frameMat)
        bank.position.set(x, poleH + 1.5, z)
        bank.rotation.y = faceYaw
        this.scene.add(bank)

        const lamps = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.2), lampMat)
        lamps.position.set(
          x + Math.sin(faceYaw) * 0.8,
          poleH + 1.5,
          z + Math.cos(faceYaw) * 0.8
        )
        lamps.rotation.y = faceYaw
        this.scene.add(lamps)

        const light = new THREE.PointLight(0xfff2c0, this.theme === 'cyber' ? 2.8 : 1.4, 110, 1.6)
        light.position.set(x, poleH, z)
        this.scene.add(light)
      }
    }
  }




  private buildScoreboard() {
    const canvas = document.createElement('canvas')
    canvas.width = 2048
    canvas.height = 768
    this.scoreboardCanvas = canvas
    this.scoreboardCtx = canvas.getContext('2d')!

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.anisotropy = 16
    this.scoreboardTex = tex

    // ── PLACARES ELEVADOS DUPLOS GIGANTES (56m x 21m — ALTA DEFINIÇÃO & VISIBILIDADE TOTAL) ──
    const boardW = 56
    const boardH = 21
    const boardY = 28.5 // Elevado bem acima do travessão da trave de 17m
    // Posicionado no teto da cabine do gol, À FRENTE de qualquer parede de vidro externa
    const distFromCenter = FIELD_L / 2 + GOAL_D * 0.45

    const boardMat = new THREE.MeshBasicMaterial({ map: tex })
    const backMat = new THREE.MeshToonMaterial({ color: 0x050811, gradientMap: TOON_GRADIENT })
    const trussMat = new THREE.MeshToonMaterial({ color: 0x1e293b, gradientMap: TOON_GRADIENT })

    // [Z-position, Y-rotation, neonColor]
    const boardsConfig: Array<[number, number, number]> = [
      [-distFromCenter, 0, 0x00cfff],        // Placar Norte (acima do gol Azul, voltado para o campo)
      [distFromCenter, Math.PI, 0xff6600],  // Placar Sul (acima do gol Laranja, voltado para o campo)
    ]

    for (const [zPos, rotY, neonHex] of boardsConfig) {
      const group = new THREE.Group()
      group.position.set(0, boardY, zPos)
      group.rotation.y = rotY

      // Tela do placar
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(boardW, boardH), boardMat)
      group.add(screen)

      // Chassi traseiro reforçado
      const back = new THREE.Mesh(new THREE.BoxGeometry(boardW + 1.6, boardH + 1.6, 1.4), backMat)
      back.position.set(0, 0, -0.75)
      back.castShadow = true
      group.add(back)

      // Borda Neon luminosa
      const neonBorder = new THREE.Mesh(
        new THREE.BoxGeometry(boardW + 2.6, boardH + 2.6, 0.4),
        new THREE.MeshBasicMaterial({ color: neonHex })
      )
      neonBorder.position.set(0, 0, -0.8)
      group.add(neonBorder)

      // Torres de sustentação de treliça metálica até a arquibancada
      for (const sx of [-boardW / 2 + 2, boardW / 2 - 2]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.3, boardY, 12), trussMat)
        pillar.position.set(sx, -boardY / 2, -1.2)
        pillar.castShadow = true
        group.add(pillar)
      }

      this.scene.add(group)
    }

    this.drawScoreboard()
  }

  private drawScoreboard() {
    if (!this.scoreboardCtx || !this.scoreboardTex) return
    const ctx = this.scoreboardCtx
    const w = 2048
    const h = 768

    // Fundo preto stadium LED profundo
    ctx.fillStyle = '#050811'
    ctx.fillRect(0, 0, w, h)

    // Borda superior e inferior neon ciano
    ctx.fillStyle = '#0284c7'
    ctx.fillRect(0, 0, w, 22)
    ctx.fillRect(0, h - 22, w, 22)

    // Painel Laranja (Time 1 / Jogador)
    ctx.fillStyle = '#ff5500'
    ctx.beginPath()
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(60, 80, 560, 520, 24)
    } else {
      ctx.rect(60, 80, 560, 520)
    }
    ctx.fill()

    // Painel Azul (Time 2 / Rival)
    ctx.fillStyle = '#0088ff'
    ctx.beginPath()
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(w - 620, 80, 560, 520, 24)
    } else {
      ctx.rect(w - 620, 80, 560, 520)
    }
    ctx.fill()

    // Rótulos dos Times
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 52px "Luckiest Guy", Impact, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('TIME LARANJA', 340, 140)
    ctx.fillText('TIME AZUL', w - 340, 140)

    // Números do Placar Gigantes
    ctx.font = '900 320px "Luckiest Guy", Impact, sans-serif'
    const orangeScore = this.isOnline1v1 && !this.turboNet?.isHost ? this.scoreBot : this.scorePlayer
    const blueScore   = this.isOnline1v1 && !this.turboNet?.isHost ? this.scorePlayer : this.scoreBot
    ctx.fillText(String(orangeScore), 340, 390)
    ctx.fillText(String(blueScore), w - 340, 390)

    // Caixa Digital do Tempo Central
    ctx.fillStyle = '#0b1220'
    ctx.beginPath()
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(w / 2 - 280, 90, 560, 310, 24)
    } else {
      ctx.rect(w / 2 - 280, 90, 560, 310)
    }
    ctx.fill()
    ctx.lineWidth = 8
    ctx.strokeStyle = '#ffd23f'
    ctx.stroke()

    ctx.fillStyle = '#94a3b8'
    ctx.font = 'bold 44px "Luckiest Guy", Impact, sans-serif'
    ctx.fillText('TEMPO RESTANTE', w / 2, 148)

    const m = Math.floor(this.matchTimer / 60)
    const s = Math.floor(this.matchTimer % 60)
    ctx.fillStyle = '#ffe600'
    ctx.font = '900 160px "Orbitron", Arial Black, sans-serif'
    ctx.fillText(`${m}:${s < 10 ? '0' : ''}${s}`, w / 2, 275)

    // Letreiro do Estádio
    ctx.font = '900 72px "Luckiest Guy", Impact, sans-serif'
    if (this.theme === 'classic' || this.gameMode === 'rumble') {
      ctx.fillStyle = '#facc15'
      ctx.shadowColor = '#facc15'
      ctx.shadowBlur = 18
      ctx.fillText('⚡ ARENA POWER-KICK ⚡', w / 2, 650)
      ctx.shadowBlur = 0
    } else if (this.theme === 'kong') {
      ctx.fillStyle = '#22c55e'
      ctx.shadowColor = '#22c55e'
      ctx.shadowBlur = 18
      ctx.fillText('🦍 ARENA KONG 🦍', w / 2, 650)
      ctx.shadowBlur = 0
    } else {
      ctx.fillStyle = '#e2e8f0'
      ctx.fillText('🏟️ ARENA KICK 🏟️', w / 2, 650)
    }

    this.scoreboardTex.needsUpdate = true
  }

  private updateScoreboardDisplay() {
    if (!this.hudScoreP || !this.hudScoreB) return
    this.hudScoreP.textContent = String(this.scorePlayer)
    this.hudScoreB.textContent = String(this.scoreBot)
  }


  //  BANCOS DE RESERVAS (DUGOUTS) NAS LATERAIS

  private buildDugouts() {
    const shellMat = new THREE.MeshToonMaterial({ color: 0x1e293b, gradientMap: TOON_GRADIENT })
    const benchMat = new THREE.MeshToonMaterial({ color: 0xfacc15, gradientMap: TOON_GRADIENT })
    const roofMat = new THREE.MeshToonMaterial({ color: 0x38bdf8, gradientMap: TOON_GRADIENT })

    for (const side of [-1, 1]) {
      const x = side * (FIELD_W / 2 + 2.6)
      const z = side * 20

      const shell = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.6, 16), shellMat)
      shell.position.set(x, 1.3, z)
      shell.castShadow = true
      shell.receiveShadow = true
      this.scene.add(shell)

      const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 16.6), roofMat)
      canopy.position.set(x, 2.75, z)
      canopy.castShadow = true
      this.scene.add(canopy)

      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 13), benchMat)
      bench.position.set(x, 0.9, z)
      this.scene.add(bench)
    }
  }


  //  TRAVES CARTOON CURVADAS COM REDE ILUMINADA

  private buildGoals() {
    this.buildSingleGoal(FIELD_L / 2,  0xff6600, false) // Trave do Jogador (Laranja)
    this.buildSingleGoal(-FIELD_L / 2, 0x0088ff, true)  // Trave do Bot (Azul)
  }

  private buildSingleGoal(centerZ: number, teamColor: number, flipZ: boolean) {
    const group = new THREE.Group()

    const postMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      gradientMap: TOON_GRADIENT
    })
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x070b16, side: THREE.BackSide })
    const rimMat = new THREE.MeshToonMaterial({
      color: teamColor,
      gradientMap: TOON_GRADIENT
    })

    const pR = 0.55 // Postes tubulares cartoon encorpados
    const dir = flipZ ? -1 : 1

    // Postes Verticais Laterais
    for (const x of [-GOAL_W / 2, GOAL_W / 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(pR, pR, GOAL_H, 20), postMat)
      post.position.set(x, GOAL_H / 2, 0)
      post.castShadow = true

      // Contorno cartoon cel-shading
      const postOut = new THREE.Mesh(new THREE.CylinderGeometry(pR * 1.14, pR * 1.14, GOAL_H + 0.2, 20), outlineMat)
      post.add(postOut)
      group.add(post)

      // Faixas coloridas de equipe nos postes
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(pR + 0.05, pR + 0.05, 1.2, 20), rimMat)
      rim.position.set(x, GOAL_H * 0.52, 0)
      group.add(rim)
    }

    // Travessão Superior Horizontal
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(pR, pR, GOAL_W + pR * 2, 20), postMat)
    crossbar.rotation.z = Math.PI / 2
    crossbar.position.set(0, GOAL_H, 0)
    crossbar.castShadow = true
    const crossOut = new THREE.Mesh(new THREE.CylinderGeometry(pR * 1.14, pR * 1.14, GOAL_W + pR * 2 + 0.2, 20), outlineMat)
    crossbar.add(crossOut)
    group.add(crossbar)

    // Barras Superiores Horizontais Traseiras (sustentam a rede no topo como trave de futebol real)
    for (const x of [-GOAL_W / 2, GOAL_W / 2]) {
      const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, GOAL_D, 16), postMat)
      topBar.rotation.x = Math.PI / 2
      topBar.position.set(x, GOAL_H, dir * GOAL_D / 2)
      group.add(topBar)
    }

    // Suportes Diagonais Traseiros de Aço
    const supLen = Math.hypot(GOAL_H, GOAL_D)
    const supAngle = Math.atan2(GOAL_D, GOAL_H)
    for (const x of [-GOAL_W / 2, GOAL_W / 2]) {
      const sup = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, supLen, 12), postMat)
      sup.position.set(x, GOAL_H / 2, dir * GOAL_D / 2)
      sup.rotation.x = dir * supAngle
      group.add(sup)
    }

    // Barra Traseira de Fundo no Chão
    const groundBack = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, GOAL_W, 16), postMat)
    groundBack.rotation.z = Math.PI / 2
    groundBack.position.set(0, 0.2, dir * GOAL_D)
    group.add(groundBack)

    // Rede Hexagonal Estilizada de Futebol Real Cartoon
    const netCanvas = document.createElement('canvas')
    netCanvas.width = 256
    netCanvas.height = 256
    const nctx = netCanvas.getContext('2d')!
    nctx.strokeStyle = '#ffffff'
    nctx.lineWidth = 3.5
    // Malha hexagonal / losangular
    for (let i = -128; i <= 384; i += 24) {
      nctx.beginPath(); nctx.moveTo(i, 0); nctx.lineTo(i + 256, 256); nctx.stroke()
      nctx.beginPath(); nctx.moveTo(i + 256, 0); nctx.lineTo(i, 256); nctx.stroke()
    }
    const netTex = new THREE.CanvasTexture(netCanvas)
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping
    netTex.repeat.set(10, 5)

    const netMat = new THREE.MeshBasicMaterial({
      map: netTex,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide
    })

    // Painel da Rede de Fundo
    const netBack = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_H), netMat)
    netBack.position.set(0, GOAL_H / 2, dir * GOAL_D)
    group.add(netBack)

    // Painel da Rede do Teto
    const netTop = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_D), netMat)
    netTop.rotation.x = Math.PI / 2
    netTop.position.set(0, GOAL_H, dir * GOAL_D / 2)
    group.add(netTop)

    // Painéis Laterais da Rede
    for (const x of [-GOAL_W / 2, GOAL_W / 2]) {
      const ns = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_D, GOAL_H), netMat)
      ns.rotation.y = Math.PI / 2
      ns.position.set(x, GOAL_H / 2, dir * GOAL_D / 2)
      group.add(ns)
    }

    // Cabine Traseira Fechada (Goal Box Enclosure): Fundo sólido escuro para NUNCA ver arquibancada
    const backWallGeo = new THREE.BoxGeometry(GOAL_W + 1.6, GOAL_H + 1.0, 0.6)
    const backWallMat = new THREE.MeshToonMaterial({ color: 0x070b16, gradientMap: TOON_GRADIENT })
    const backWall = new THREE.Mesh(backWallGeo, backWallMat)
    backWall.position.set(0, GOAL_H / 2, dir * (GOAL_D + 0.35))
    group.add(backWall)

    // Moldura Neon do Gol nas costas
    const neonMat = new THREE.MeshBasicMaterial({ color: teamColor })
    const neonBorder = new THREE.Mesh(new THREE.BoxGeometry(GOAL_W + 2.2, 0.4, 0.4), neonMat)
    neonBorder.position.set(0, GOAL_H, dir * (GOAL_D + 0.1))
    group.add(neonBorder)

    // Luz interna suave da trave (ilumina a rede por dentro com a cor da equipe)
    const goalLight = new THREE.PointLight(teamColor, 2.2, 28)
    goalLight.position.set(0, GOAL_H * 0.75, dir * (GOAL_D * 0.5))
    group.add(goalLight)

    // ── LETREIRO NEON LUMINOSO DE ORIENTAÇÃO (ATAQUE vs DEFESA) ──
    const signCanvas = document.createElement('canvas')
    signCanvas.width = 1024
    signCanvas.height = 160
    const sctx = signCanvas.getContext('2d')!

    const isAttackGoal = flipZ // meta do Bot (-Z) é onde o jogador DEVE MARCAR (Ataque)
    const signBg = '#070b16'
    const signBorder = isAttackGoal ? '#00ff88' : '#ff6600'
    const signText = isAttackGoal ? '🎯 GOL ADVERSÁRIO (ATAQUE)' : '🛡️ SEU GOL (DEFESA)'
    const signTextColor = isAttackGoal ? '#00ff88' : '#ffd23f'

    sctx.fillStyle = signBg
    sctx.fillRect(0, 0, 1024, 160)
    sctx.lineWidth = 10
    sctx.strokeStyle = signBorder
    sctx.strokeRect(8, 8, 1008, 144)

    sctx.font = 'bold 64px "Luckiest Guy", Impact, sans-serif'
    sctx.textAlign = 'center'
    sctx.textBaseline = 'middle'
    sctx.shadowColor = signBorder
    sctx.shadowBlur = 24
    sctx.fillStyle = signTextColor
    sctx.fillText(signText, 512, 80)

    const signTex = new THREE.CanvasTexture(signCanvas)
    signTex.colorSpace = THREE.SRGBColorSpace

    const signW = 34
    const signH = 4.8
    const signMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(signW, signH),
      new THREE.MeshBasicMaterial({ map: signTex, transparent: true })
    )
    signMesh.position.set(0, GOAL_H + signH / 2 + 0.3, 0)
    if (!isAttackGoal) signMesh.rotation.y = Math.PI // virado para dentro do campo
    group.add(signMesh)

    // Suporte traseiro escuro da placa
    const signBack = new THREE.Mesh(
      new THREE.BoxGeometry(signW + 0.6, signH + 0.6, 0.4),
      new THREE.MeshToonMaterial({ color: 0x070b16, gradientMap: TOON_GRADIENT })
    )
    signBack.position.set(0, GOAL_H + signH / 2 + 0.3, isAttackGoal ? -0.25 : 0.25)
    group.add(signBack)

    group.position.z = centerZ
    this.scene.add(group)
  }




  private buildBall() {
    const geo = new THREE.SphereGeometry(BALL_R, 48, 48)

    // Textura da Bola Oficial de Futebol Cartoon (Truncated Icosahedron — 12 pentágonos pretos e 20 hexágonos brancos)
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 512
    const ctx = c.getContext('2d')!

    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, 0, 1024, 512)

    // Vértices normalizados de icosaedro regular (centros dos 12 pentágonos)
    const tau = (1 + Math.sqrt(5)) / 2
    const verts: [number, number, number][] = [
      [-1, tau, 0], [1, tau, 0], [-1, -tau, 0], [1, -tau, 0],
      [0, -1, tau], [0, 1, tau], [0, -1, -tau], [0, 1, -tau],
      [tau, 0, -1], [tau, 0, 1], [-tau, 0, -1], [-tau, 0, 1]
    ].map(v => {
      const len = Math.hypot(...v)
      return [v[0] / len, v[1] / len, v[2] / len]
    })

    const imgData = ctx.getImageData(0, 0, 1024, 512)
    const data = imgData.data

    for (let py = 0; py < 512; py++) {
      const phi = (py / 512 - 0.5) * Math.PI
      const cosP = Math.cos(phi)
      const sinP = Math.sin(phi)

      for (let px = 0; px < 1024; px++) {
        const lam = (px / 1024) * Math.PI * 2 - Math.PI
        const nx = cosP * Math.cos(lam)
        const ny = sinP
        const nz = cosP * Math.sin(lam)

        let maxDot = -1
        for (let i = 0; i < 12; i++) {
          const dot = nx * verts[i][0] + ny * verts[i][1] + nz * verts[i][2]
          if (dot > maxDot) maxDot = dot
        }

        const idx = (py * 1024 + px) * 4
        if (maxDot > 0.89) {
          // Pentágono preto cartoon
          data[idx] = 15
          data[idx + 1] = 23
          data[idx + 2] = 42
          data[idx + 3] = 255
        } else if (maxDot > 0.865) {
          // Costura da bola
          data[idx] = 30
          data[idx + 1] = 41
          data[idx + 2] = 59
          data[idx + 3] = 255
        } else {
          // Gomo branco com leve gradiente
          const shade = 244 + Math.floor(Math.sin(maxDot * 16) * 11)
          data[idx] = shade
          data[idx + 1] = shade
          data[idx + 2] = shade
          data[idx + 3] = 255
        }
      }
    }
    ctx.putImageData(imgData, 0, 0)

    const ballTex = new THREE.CanvasTexture(c)
    ballTex.colorSpace = THREE.SRGBColorSpace

    const ballMat = new THREE.MeshToonMaterial({
      map: ballTex,
      gradientMap: TOON_GRADIENT
    })

    const mesh = new THREE.Mesh(geo, ballMat)
    mesh.castShadow = true
    this.scene.add(mesh)

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_R * 1.15, 28),
      new THREE.MeshBasicMaterial({ color: 0x0a1020, transparent: true, opacity: 0.45 })
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.04
    this.scene.add(shadow)

    this.ball = {
      mesh,
      shadow,
      pos: new THREE.Vector3(0, BALL_R + 0.1, 0),
      vel: new THREE.Vector3(),
      rotAxis: new THREE.Vector3(1, 0, 0),
      squash: new THREE.Vector3(1, 1, 1),
      targetSquash: new THREE.Vector3(1, 1, 1)
    }
    this.lastBallTrailPos.copy(this.ball.pos)
    mesh.position.copy(this.ball.pos)
  }


  //  FLASH DE IMPACTO COMIC ("POW!")

  private buildImpactFlash() {
    const starGeo = new THREE.SphereGeometry(1.6, 8, 8)
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffea00, wireframe: true })
    this.impactFlashMesh = new THREE.Mesh(starGeo, starMat)
    this.impactFlashMesh.visible = false
    this.scene.add(this.impactFlashMesh)
  }

  private triggerImpactFlash(pos: THREE.Vector3) {
    if (!this.impactFlashMesh) return
    this.impactFlashMesh.position.copy(pos)
    this.impactFlashMesh.visible = true
    this.impactFlashTimer = 0.12
  }




  // ── VFX: EXPLOSÃO DE ESTRELAS CARTOON (POWER SHOTS / GOLS / IMPACTOS) ──
  public emitCartoonStarBurst(pos: THREE.Vector3, count = 10, colorHex = 0xffd23f) {
    const starColors = [colorHex, 0xffffff, 0xff9900, 0x22b7ff]
    for (let i = 0; i < count; i++) {
      const col = starColors[i % starColors.length]
      const mat = new THREE.MeshBasicMaterial({
        color: col,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95
      })
      const star = new THREE.Mesh(this.starGeo, mat)
      star.position.copy(pos)
      const baseScale = 0.6 + Math.random() * 0.9
      star.scale.setScalar(baseScale)
      this.scene.add(star)

      const ang = Math.random() * Math.PI * 2
      const spd = 6.0 + Math.random() * 18.0
      const elev = (Math.random() - 0.2) * 14.0

      this.cartoonStars.push({
        mesh: star,
        vel: new THREE.Vector3(Math.cos(ang) * spd, Math.max(3.0, elev), Math.sin(ang) * spd),
        rotVel: new THREE.Vector3(0, 0, (Math.random() - 0.5) * 22),
        life: 0.42 + Math.random() * 0.25,
        maxLife: 0.55,
        baseScale
      })
    }
  }

  // ── MARCAS DE PNEU/DERAPAGEM CARTOON NO GRAMADO (DRIFT SKID MARKS) ──
  private emitSkidMarks(car: CarObject) {
    const ya = car.yaw
    const backDist = -2.1
    for (const offset of [-1.22, 1.22]) {
      const px = car.pos.x + Math.sin(ya) * backDist + Math.cos(ya) * offset
      const pz = car.pos.z + Math.cos(ya) * backDist - Math.sin(ya) * offset

      const markGeo = new THREE.PlaneGeometry(0.38, 0.95)
      const markMat = new THREE.MeshBasicMaterial({
        color: 0x141426,
        transparent: true,
        opacity: 0.48,
        depthWrite: false
      })
      const mark = new THREE.Mesh(markGeo, markMat)
      mark.rotation.x = -Math.PI / 2
      mark.rotation.z = -ya
      mark.position.set(px, 0.04, pz)
      this.scene.add(mark)

      this.skidMarks.push({ mesh: mark, life: 1.8, maxLife: 1.8 })
    }
  }

  // ── RASTRO DE FITA VIBRANTE CARTOON DA BOLA (RIBBON TRAIL 3D) ──
  private emitBallRibbonSegment(fromPos: THREE.Vector3, toPos: THREE.Vector3, speed: number) {
    if (this.ballTrailSegments.length >= 8) return
    const dir = new THREE.Vector3().subVectors(toPos, fromPos)
    const len = dir.length()
    if (len < 0.3) return

    const ribbonGeo = new THREE.CylinderGeometry(0.55, 1.25, len, 8, 1, true)
    const color = speed > 32 ? 0xffea00 : speed > 22 ? 0x00cfff : 0xff5500
    const ribbonMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat)

    const mid = new THREE.Vector3().addVectors(fromPos, toPos).multiplyScalar(0.5)
    ribbon.position.copy(mid)
    ribbon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
    this.scene.add(ribbon)

    this.ballTrailSegments.push({
      mesh: ribbon,
      life: 0.38,
      maxLife: 0.38
    })
  }

  private emitTireSmoke(car: CarObject, force = false) {
    if (!car.grounded) return
    if (!force && this.tireSmokeCooldown > 0) return
    if (Math.abs(car.speed) < 0.25 && !force) return
    if (this.smokePuffs.length > 20) return

    this.tireSmokeCooldown = 0.08
    for (const offset of [-1.2, 1.2]) {
      const puff = new THREE.Mesh(this.smokeGeo, this.sharedSmokeMat)
      const ya = car.yaw
      const backDist = -2.2
      const px = car.pos.x + Math.sin(ya) * backDist + Math.cos(ya) * offset
      const pz = car.pos.z + Math.cos(ya) * backDist - Math.sin(ya) * offset
      puff.position.set(px, 0.4, pz)
      this.scene.add(puff)

      this.smokePuffs.push({
        mesh: puff,
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 2.0 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5),
        life: 0.35,
        maxLife: 0.35
      })
    }
  }

  private updateSmoke(dt: number) {
    this.tireSmokeCooldown = Math.max(0, this.tireSmokeCooldown - dt)

    // 1. Fumaça de pneus
    for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
      const p = this.smokePuffs[i]
      p.life -= dt
      if (p.life <= 0) {
        this.scene.remove(p.mesh)
        this.smokePuffs.splice(i, 1)
        continue
      }
      p.mesh.position.addScaledVector(p.vel, dt)
      const scale = 1.0 + (1.0 - p.life / p.maxLife) * 2.2
      p.mesh.scale.set(scale, scale, scale)
    }

    // 2. Estrelas Cartoon ("Pop" & Impactos Estilizados)
    for (let i = this.cartoonStars.length - 1; i >= 0; i--) {
      const s = this.cartoonStars[i]
      s.life -= dt
      if (s.life <= 0) {
        this.scene.remove(s.mesh)
        ;(s.mesh.material as THREE.Material).dispose()
        this.cartoonStars.splice(i, 1)
        continue
      }
      s.vel.y -= 18 * dt // leve gravidade
      s.mesh.position.addScaledVector(s.vel, dt)
      s.mesh.rotation.z += s.rotVel.z * dt
      const lifeRatio = s.life / s.maxLife
      // Curva pop: escala sobe rápido e afunila no final
      const sc = s.baseScale * Math.sin(lifeRatio * Math.PI) * 1.3
      s.mesh.scale.set(sc, sc, sc)
      const mat = s.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.min(1.0, lifeRatio * 1.5)
    }

    // 3. Rastro de Fita 3D da Bola (Ribbon Trail)
    for (let i = this.ballTrailSegments.length - 1; i >= 0; i--) {
      const t = this.ballTrailSegments[i]
      t.life -= dt
      if (t.life <= 0) {
        this.scene.remove(t.mesh)
        t.mesh.geometry?.dispose()
        ;(t.mesh.material as THREE.Material).dispose()
        this.ballTrailSegments.splice(i, 1)
        continue
      }
      const ratio = t.life / t.maxLife
      const sc = ratio * 1.1
      t.mesh.scale.set(sc, 1, sc)
      const mat = t.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = ratio * 0.7
    }

    // 4. Marcas de pneu de Drift no gramado
    for (let i = this.skidMarks.length - 1; i >= 0; i--) {
      const m = this.skidMarks[i]
      m.life -= dt
      if (m.life <= 0) {
        this.scene.remove(m.mesh)
        ;(m.mesh.material as THREE.Material).dispose()
        this.skidMarks.splice(i, 1)
        continue
      }
      const mat = m.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = (m.life / m.maxLife) * 0.48
    }

    if (this.impactFlashTimer > 0) {
      this.impactFlashTimer -= dt
      if (this.impactFlashTimer <= 0 && this.impactFlashMesh) {
        this.impactFlashMesh.visible = false
      }
    }
  }

  private updateCrowd(dt: number) {
    if (!this.crowdInstances || !this.crowdInstances.length) return
    if (this.isMobile) return // Plateia estática no mobile para economizar draw calls e matrizes WebGL
    // Throttle crowd updates to ~12 FPS to eliminate micro-stutters and lag
    this.crowdUpdateTimer += dt
    if (this.crowdUpdateTimer < 0.08) return
    this.crowdUpdateTimer = 0

    const time = Date.now() * 0.005
    for (const inst of this.crowdInstances) {
      let idx = 0
      const list = (inst as any).data || (inst as any).items || []
      for (const d of list) {
        const bob = Math.max(0, Math.sin(time * 3 + d.phase)) * 0.35
        this.crowdDummy.position.set(d.x, d.feetY + this.crowdFanH / 2 + bob, d.z)
        this.crowdDummy.rotation.set(0, d.yaw, 0)
        this.crowdDummy.updateMatrix()
        inst.mesh.setMatrixAt(idx++, this.crowdDummy.matrix)
      }
      inst.mesh.instanceMatrix.needsUpdate = true
    }
  }

  // Pre-alocação do Ring Buffer de Instant Replay (Zero heap allocations no game loop)
  private initReplayBuffer() {
    this.replayRingBuffer = []
    for (let f = 0; f < TurboSoccerGame.MAX_REPLAY_FRAMES; f++) {
      const cars = []
      for (let c = 0; c < 8; c++) {
        cars.push({
          pos: new THREE.Vector3(),
          yaw: 0,
          pitch: 0,
          roll: 0
        })
      }
      this.replayRingBuffer.push({
        ballPos: new THREE.Vector3(),
        ballRot: new THREE.Euler(),
        cars
      })
    }
    this.replayHead = 0
    this.replayTotalStored = 0
  }

  //  HUD ARCADE CARTOON
  private buildHUD() {
    const existing = document.getElementById('turbo-hud-root')
    if (existing) existing.remove()

    const isClient1v1 = this.isOnline1v1 && !this.turboNet?.isHost

    const hud = document.createElement('div')
    hud.id = 'turbo-hud-root'
    hud.style.position = 'absolute'
    hud.style.inset = '0'
    hud.style.pointerEvents = 'none'
    hud.style.zIndex = '100'
    hud.style.fontFamily = "'Orbitron', sans-serif"

    hud.innerHTML = `
      <!-- PLACAR CENTRAL TOON -->
      <div style="position:absolute;top:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;
        background:#22345c;border:3px solid #141426;border-radius:20px;overflow:hidden;box-shadow:0 7px 0 #141426;">
        <div style="display:flex;align-items:center;gap:10px;padding:8px 20px;">
          <div style="width:14px;height:14px;border-radius:4px;background:${isClient1v1 ? '#0088ff' : '#ff5500'};box-shadow:0 0 10px ${isClient1v1 ? '#0088ff' : '#ff5500'};"></div>
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="font-size:10px;font-weight:900;letter-spacing:1px;color:${isClient1v1 ? '#0088ff' : '#ff5500'};">${this.isOnline1v1 ? (isClient1v1 ? 'AZUL' : 'LARANJA') : 'JOGADOR'}</div>
            <div style="color:${isClient1v1 ? '#0088ff' : '#ff5500'};font-weight:900;font-size:32px;min-width:32px;text-align:center;line-height:1;" id="turbo-score-p">0</div>
          </div>
        </div>
        <div style="background:#ffd23f;padding:8px 18px;font-size:18px;font-weight:900;color:#141426;letter-spacing:2px;" id="turbo-timer">
          5:00
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:8px 20px;">
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="font-size:10px;font-weight:900;letter-spacing:1px;color:${isClient1v1 ? '#ff5500' : '#0088ff'};">${this.isOnline1v1 ? (isClient1v1 ? 'LARANJA' : 'AZUL') : 'RIVAL'}</div>
            <div style="color:${isClient1v1 ? '#ff5500' : '#0088ff'};font-weight:900;font-size:32px;min-width:32px;text-align:center;line-height:1;" id="turbo-score-b">0</div>
          </div>
          <div style="width:14px;height:14px;border-radius:4px;background:${isClient1v1 ? '#ff5500' : '#0088ff'};box-shadow:0 0 10px ${isClient1v1 ? '#ff5500' : '#0088ff'};"></div>
        </div>
      </div>

      <!-- INDICADOR DIRECIONAL DE ORIENTAÇÃO (ATAQUE / DEFESA — SEMPRE SABE ONDE MARCAR GOL) -->
      <div id="turbo-goal-nav" style="position:absolute;top:78px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;
        background:rgba(7,11,22,0.92);border:2px solid #00ff88;border-radius:16px;padding:3px 16px;
        box-shadow:0 0 16px rgba(0,255,136,0.25),0 4px 0 #070b16;font-family:'Luckiest Guy',sans-serif;font-size:12px;
        letter-spacing:1px;color:#00ff88;white-space:nowrap;user-select:none;pointer-events:none;z-index:110;">
        <span id="turbo-goal-nav-arrow" style="font-size:15px;display:inline-block;">⬆️</span>
        <span id="turbo-goal-nav-text">🎯 ATAQUE: GOL ADVERSÁRIO</span>
        <span id="turbo-goal-nav-dist" style="color:#ffd23f;font-size:11px;font-family:'Orbitron',sans-serif;font-weight:800;background:rgba(0,0,0,0.5);padding:2px 7px;border-radius:6px;">180m</span>
      </div>

      <!-- BOTOES DE CONTROLE & CAM -->
      <div style="position:absolute;top:18px;right:22px;display:flex;gap:10px;pointer-events:all;align-items:center;">
        <div id="turbo-ctrl-mode" style="background:rgba(0,255,136,0.15);border:1.5px solid #00ff88;
          color:#00ff88;border-radius:20px;padding:6px 14px;font-size:11px;font-weight:800;">TECLADO</div>
        <button id="btn-toggle-studio" style="background:rgba(250,204,21,0.2);border:1.5px solid #facc15;
          color:#facc15;border-radius:20px;padding:6px 14px;font-weight:800;font-size:11px;cursor:pointer;">
          ⚙️ ESTUDIO</button>
        <button id="btn-toggle-cam" style="background:rgba(0,180,255,0.2);border:1.5px solid #00cfff;
          color:white;border-radius:20px;padding:6px 16px;font-weight:800;font-size:11px;cursor:pointer;">
          CAM: <span id="ballcam-status" style="color:#00cfff;">LIVRE</span></button>
        <button id="btn-turbo-pause" style="background:rgba(250,204,21,0.2);border:1.5px solid #facc15;
          color:#facc15;border-radius:20px;padding:6px 14px;font-weight:800;font-size:11px;cursor:pointer;">
          ⏸️ PAUSA</button>
        <button id="btn-turbo-mute" style="background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.4);
          color:white;border-radius:20px;padding:6px 14px;font-weight:800;font-size:11px;cursor:pointer;">
          🔊 SOM</button>
        <button id="btn-turbo-exit" style="background:rgba(255,45,100,0.25);border:1.5px solid #ff2d78;
          color:white;border-radius:20px;padding:6px 16px;font-weight:800;font-size:11px;cursor:pointer;">❌ SAIR</button>
      </div>

      <!-- VELOCIMETRO DIGITAL -->
      <div style="position:absolute;bottom:26px;left:32px;background:#22345c;
        border:3px solid #141426;border-radius:18px;padding:12px 20px;text-align:center;min-width:90px;box-shadow:0 6px 0 #141426;">
        <div style="font-size:38px;font-weight:900;color:#00ff88;line-height:1;" id="turbo-speed">0</div>
        <div style="font-size:9px;letter-spacing:3px;color:rgba(255,255,255,0.7);margin-top:2px;">KM/H</div>
      </div>

      <!-- NITRO CIRCULAR COM GLOW -->
      <div style="position:absolute;bottom:22px;right:28px;text-align:center;">
        <div style="position:relative;width:110px;height:110px;">
          <svg viewBox="0 0 110 110" width="110" height="110" style="position:absolute;top:0;left:0;">
            <circle cx="55" cy="55" r="48" fill="none" stroke="rgba(255,85,0,0.2)" stroke-width="8"/>
            <circle id="nitro-arc" cx="55" cy="55" r="48" fill="none" stroke="#ff6600"
              stroke-width="8" stroke-linecap="round" stroke-dasharray="301.6" stroke-dashoffset="0"
              transform="rotate(-90 55 55)" style="filter:drop-shadow(0 0 8px #ff6600);transition:stroke-dashoffset 0.1s;"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <div style="font-size:30px;font-weight:900;color:#ff6600;" id="turbo-boost-val">100</div>
            <div style="font-size:8px;letter-spacing:3px;color:rgba(255,255,255,0.7);">NITRO</div>
          </div>
        </div>
      </div>

      <!-- INSTRUCOES INFERIORES -->
      <div style="position:absolute;bottom:18px;left:50%;transform:translateX(-50%);
        background:#22345c;border:3px solid #141426;border-radius:18px;padding:8px 22px;
        font-size:12px;color:#ffffff;text-align:center;box-shadow:0 5px 0 #141426;">
RT Acelerar &nbsp; LT Ré &nbsp; LS Direção &nbsp; RS Câmera &nbsp; A Pulo/Flip &nbsp; B Nitro &nbsp; RB Poder &nbsp; X Barrel Roll &nbsp; LB Drift &nbsp; Y Cam &nbsp; ESC Pausa
      </div>

      <!-- OVERLAY DE COUNTDOWN: 3.. 2.. 1.. VAI! -->
      <div id="turbo-countdown-overlay" style="position:absolute;inset:0;display:flex;
        align-items:center;justify-content:center;pointer-events:none;z-index:150;">
        <div id="turbo-countdown-text" style="font-size:76px;font-weight:900;
          color:#ef4444;text-shadow:0 4px 0 #141426, 0 0 25px rgba(255,85,0,0.6);
          background:rgba(20,20,38,0.85);border:3px solid #ff5500;border-radius:24px;
          padding:12px 42px;box-shadow:0 8px 0 #141426;letter-spacing:2px;">3</div>
      </div>

      <!-- BANNER DE GOL -->
      <div id="turbo-goal-banner" style="position:absolute;inset:0;display:none;
        align-items:center;justify-content:center;flex-direction:column;
        background:rgba(0,0,0,0.7);pointer-events:none;z-index:200;">
        <div id="turbo-goal-title" style="font-size:96px;font-weight:900;
          color:#ffe600;text-shadow:0 0 60px #ff6600,0 6px 0 #993300;">⚽ GOLAZO!</div>
        <div id="turbo-goal-sub" style="font-size:26px;color:white;margin-top:10px;font-weight:800;letter-spacing:2px;"></div>
        <div id="turbo-end-actions" style="display:none;gap:16px;margin-top:28px;pointer-events:all;">
          <button id="btn-turbo-rematch" style="background:#00ff88;border:none;color:#052e16;border-radius:16px;
            padding:14px 40px;font-weight:900;font-size:16px;cursor:pointer;font-family:'Orbitron',sans-serif;">🔄 JOGAR DE NOVO</button>
          <button id="btn-turbo-endmenu" style="background:rgba(255,45,100,0.25);border:2px solid #ff2d78;color:white;
            border-radius:16px;padding:14px 34px;font-weight:800;font-size:15px;cursor:pointer;font-family:'Orbitron',sans-serif;">🏠 MENU</button>
        </div>
      </div>

      <!-- BANNER DE REPLAY DA JOGADA -->
      <div id="turbo-replay-banner" style="position:absolute;top:85px;left:50%;transform:translateX(-50%);
        display:none;align-items:center;gap:12px;background:rgba(20,20,38,0.92);
        border:2px solid #00cfff;border-radius:20px;padding:8px 22px;box-shadow:0 0 25px rgba(0,207,255,0.6);
        pointer-events:all;z-index:220;">
        <span style="font-size:16px;">⏪</span>
        <span style="color:#00cfff;font-weight:900;font-size:13px;letter-spacing:2px;">REPLAY DA JOGADA (TRANSMISSÃO DE TV)</span>
        <button id="btn-skip-replay" style="background:#ff5500;border:none;color:white;border-radius:12px;
          padding:6px 16px;font-size:10px;font-weight:900;cursor:pointer;font-family:'Orbitron',sans-serif;margin-left:6px;">PULAR [QUALQUER BOTÃO DO CONTROLE / ESPAÇO]</button>
      </div>

      <!-- CARD DE POWER-UP (funciona em todos os modos - mystery boxes) -->
      <div id="turbo-rumble-card" style="position:absolute;bottom:140px;right:28px;display:none;
        background:rgba(30,41,59,0.95);border:3px solid #facc15;border-radius:20px;padding:12px 16px;
        flex-direction:column;align-items:center;gap:8px;box-shadow:0 0 20px rgba(250,204,21,0.5),0 6px 0 #141426;
        pointer-events:all;cursor:pointer;user-select:none;z-index:110;min-width:140px;">
        <div style="display:flex;align-items:center;gap:10px;width:100%;">
          <div id="turbo-rumble-icon" style="font-size:34px;filter:drop-shadow(0 0 8px #facc15);">⏳</div>
          <div>
            <div id="turbo-rumble-name" style="font-size:11px;font-weight:900;color:#facc15;letter-spacing:1px;">AGUARDANDO...</div>
            <div id="turbo-rumble-hint" style="font-size:9px;color:rgba(255,255,255,0.6);margin-top:2px;">[R] OU [RB]</div>
          </div>
        </div>
        <button id="turbo-use-btn" style="
          width:100%;padding:7px 10px;border-radius:12px;border:2px solid #facc15;
          background:linear-gradient(135deg,#facc15,#f59e0b);color:#1a1200;
          font-family:'Luckiest Guy',cursive;font-size:13px;letter-spacing:2px;
          cursor:pointer;box-shadow:0 3px 0 #92400e;pointer-events:all;
          transition:transform .08s,box-shadow .08s;
        ">⚡ USAR [R] / [RB]</button>
      </div>

      <!-- OVERLAY DE PAUSA -->
      <div id="turbo-pause-overlay" style="position:absolute;inset:0;display:none;
        align-items:center;justify-content:center;flex-direction:column;gap:18px;
        background:rgba(0,0,0,0.78);pointer-events:all;z-index:300;">
        <div style="font-size:56px;font-weight:900;color:#facc15;text-shadow:0 4px 0 #7f5f00;">⏸ PAUSA</div>
        <button id="btn-turbo-resume" style="background:#00ff88;border:none;color:#052e16;border-radius:16px;
          padding:14px 44px;font-weight:900;font-size:16px;cursor:pointer;font-family:'Orbitron',sans-serif;">▶ CONTINUAR</button>
        <button id="btn-turbo-pausemenu" style="background:rgba(255,45,100,0.25);border:2px solid #ff2d78;color:white;
          border-radius:16px;padding:12px 34px;font-weight:800;font-size:14px;cursor:pointer;font-family:'Orbitron',sans-serif;">🏠 MENU PRINCIPAL</button>
      </div>
    `

        this.container.appendChild(hud)

    this.hudScoreP     = document.getElementById('turbo-score-p')!
    this.hudScoreB     = document.getElementById('turbo-score-b')!
    this.hudTimer      = document.getElementById('turbo-timer')!
    this.hudSpeed      = document.getElementById('turbo-speed')!
    this.hudBoost      = document.getElementById('turbo-boost-val')!
    this.hudGoalBanner = document.getElementById('turbo-goal-banner')!
    this.hudGoalTitle  = document.getElementById('turbo-goal-title')!
    this.hudCtrlMode   = document.getElementById('turbo-ctrl-mode')!
    this.hudCountdown  = document.getElementById('turbo-countdown-text')!
    this.hudCamStatus  = document.getElementById('ballcam-status')!
    this.hudNitroArc   = (document.getElementById('nitro-arc') as unknown as SVGElement) || null

    this.hudReplayBanner = document.getElementById('turbo-replay-banner') || undefined
    this.hudRumbleCard   = document.getElementById('turbo-rumble-card') || undefined
    this.hudRumbleIcon   = document.getElementById('turbo-rumble-icon') || undefined
    this.hudRumbleName   = document.getElementById('turbo-rumble-name') || undefined
    this.hudRumbleHint   = document.getElementById('turbo-rumble-hint') || undefined
    this.hudGoalNav      = document.getElementById('turbo-goal-nav') || undefined
    this.hudGoalNavArrow = document.getElementById('turbo-goal-nav-arrow') || undefined
    this.hudGoalNavText  = document.getElementById('turbo-goal-nav-text') || undefined
    this.hudGoalNavDist  = document.getElementById('turbo-goal-nav-dist') || undefined

    // ── RANK BADGE NO HUD (canto superior esquerdo) ──
    try {
      const lbRaw = localStorage.getItem('arena_kick_leaderboard')
      const lb: Array<{ player_name: string; rating: number }> = lbRaw ? JSON.parse(lbRaw) : []
      const myEntry = lb.find((e) => e.player_name === 'Jogador 1')
      const myMMR = myEntry?.rating ?? 1000
      const rank = getRankFromMMR(myMMR)

      const rankBadge = document.createElement('div')
      rankBadge.id = 'turbo-rank-badge'
      rankBadge.style.cssText = `
        position:absolute;top:18px;left:22px;display:flex;align-items:center;gap:8px;
        background:#22345c;border:3px solid ${rank.color};border-radius:20px;
        padding:6px 16px;box-shadow:0 5px 0 #141426;z-index:30;pointer-events:none;
      `
      rankBadge.innerHTML = `
        <span style="font-size:18px;line-height:1;">${rank.emoji}</span>
        <div style="display:flex;flex-direction:column;line-height:1.1;">
          <span style="font-family:'Luckiest Guy',cursive;font-size:11px;color:${rank.color};letter-spacing:1px;">${rank.label}</span>
          <span style="font-size:9px;color:rgba(255,255,255,0.6);letter-spacing:1px;">${myMMR} MMR</span>
        </div>
      `
      hud.appendChild(rankBadge)
    } catch {
      // Rank badge é opcional — ignora se localStorage indisponível
    }

    if (this.spectatorMode) {
      const specBadge = document.createElement('div')
      specBadge.id = 'turbo-spectator-badge'
      specBadge.style.cssText = `
        position:absolute;top:76px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;
        background:#a855f7;border:3px solid #141426;border-radius:20px;padding:6px 20px;
        color:white;font-family:'Luckiest Guy',cursive;font-size:13px;letter-spacing:2px;box-shadow:0 6px 0 #141426;
        z-index:110;pointer-events:none;
      `
      specBadge.innerHTML = '👁️ MODO ESPECTADOR · TRANSMISSÃO AO VIVO'
      hud.appendChild(specBadge)
    }

    // ── ONLINE 1v1: Ping HUD + badge de conexão ──────────────
    if (this.isOnline1v1) {
      const pingEl = document.createElement('div')
      pingEl.id = 'turbo-ping-display'
      pingEl.style.cssText = `
        position:absolute;top:68px;right:14px;font-size:11px;color:#00cfff;
        font-family:monospace;background:rgba(0,0,0,0.5);padding:3px 8px;
        border-radius:6px;z-index:40;pointer-events:none;letter-spacing:1px;
      `
      pingEl.textContent = 'PING: --ms'
      hud.appendChild(pingEl)
      this.hudPingEl = pingEl

      const roleBadge = document.createElement('div')
      roleBadge.style.cssText = `
        position:absolute;top:92px;right:14px;font-size:10px;
        color:rgba(255,255,255,0.7);font-family:monospace;background:rgba(0,0,0,0.5);
        padding:2px 7px;border-radius:6px;z-index:40;pointer-events:none;letter-spacing:1px;
      `
      roleBadge.textContent = this.turboNet?.isHost ? '🖥 HOST' : '🎮 CLIENT'
      hud.appendChild(roleBadge)
    }

    // ── ALERTA DE MÍSSIL TELEGUIADO (RADAR HUD) ──────────────
    const missileAlert = document.createElement('div')
    missileAlert.id = 'turbo-missile-alert'
    missileAlert.style.cssText = `
      position:absolute;top:14%;left:50%;transform:translateX(-50%);display:none;
      background:rgba(220,38,38,0.92);border:3px solid #ffffff;border-radius:14px;
      padding:8px 22px;color:#ffffff;font-family:'Luckiest Guy',cursive;font-size:17px;
      letter-spacing:1px;box-shadow:0 0 30px rgba(239,68,68,0.95),0 4px 0 #7f1d1d;
      z-index:90;pointer-events:none;text-align:center;
    `
    hud.appendChild(missileAlert)
    this.missileWarningHUD = missileAlert

    // Card de power-up: funciona em TODOS os modos (mystery boxes em qualquer modo)
    if (this.hudRumbleCard) {
      // Começa oculto; updateRumbleHUD() mostra quando o jogador tem um item
      this.hudRumbleCard.style.display = 'none'
      this.hudRumbleCard.addEventListener('click', () => this.activatePlayerRumble())
    }
    // Botão USE dentro do card — também dispara o power-up
    const useBtn = document.getElementById('turbo-use-btn')
    if (useBtn) {
      useBtn.addEventListener('click', (e) => {
        e.stopPropagation() // evita duplo disparo com o click do card
        this.activatePlayerRumble()
      })
      useBtn.addEventListener('pointerdown', () => {
        useBtn.style.transform = 'translateY(2px)'
        useBtn.style.boxShadow = '0 1px 0 #92400e'
      })
      useBtn.addEventListener('pointerup', () => {
        useBtn.style.transform = ''
        useBtn.style.boxShadow = '0 3px 0 #92400e'
      })
    }

    const btnSkipReplay = document.getElementById('btn-skip-replay')
    if (btnSkipReplay) {
      btnSkipReplay.addEventListener('click', () => this.stopGoalReplay())
    }

    document.getElementById('btn-toggle-cam')!.addEventListener('click', () => this.toggleBallCam())
    document.getElementById('btn-toggle-studio')!.addEventListener('click', () => this.toggleStudioGUI())
    document.getElementById('btn-turbo-exit')!.addEventListener('click', () => {
      this.destroy()
      this.onExit?.()
    })
    document.getElementById('btn-turbo-pause')!.addEventListener('click', () => this.togglePause())

    const muteBtn = document.getElementById('btn-turbo-mute')!
    const paintMute = () => { muteBtn.textContent = isAudioMuted() ? '🔇 MUDO' : '🔊 SOM' }
    paintMute()
    muteBtn.addEventListener('click', () => {
      setAudioMuted(!isAudioMuted())
      paintMute()
    })

    this.pauseOverlay = document.getElementById('turbo-pause-overlay')
    document.getElementById('btn-turbo-resume')!.addEventListener('click', () => this.togglePause())
    document.getElementById('btn-turbo-pausemenu')!.addEventListener('click', () => {
      this.destroy()
      this.onExit?.()
    })

    document.getElementById('btn-turbo-rematch')!.addEventListener('click', () => this.restartMatch())
    document.getElementById('btn-turbo-endmenu')!.addEventListener('click', () => {
      this.destroy()
      this.onExit?.()
    })

    this.buildTouchControls(hud)
  }

  private buildTouchControls(root: HTMLElement) {
    if (!this.isTouchDevice && !this.isMobile) return
    const wrap = document.createElement('div')
    wrap.id = 'turbo-touch-controls'
    wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:120;touch-action:none;'

    const mkBtn = (id: string, text: string, bg: string, color: string, size: number, fsize: number) => {
      const b = document.createElement('button')
      b.id = id
      b.innerHTML = text
      b.style.cssText = `
        width:${size}px;height:${size}px;border-radius:50%;
        background:${bg};color:${color};border:3px solid #070b16;
        box-shadow:0 5px 0 #070b16;font-family:'Luckiest Guy',cursive;
        font-size:${fsize}px;display:flex;flex-direction:column;align-items:center;justify-content:center;
        touch-action:none;user-select:none;-webkit-touch-callout:none;cursor:pointer;
        transition:transform .08s ease;text-shadow:1px 1px 0 rgba(0,0,0,0.4);
      `
      return b
    }

    // CLUSTER ESQUERDO: DIREÇÃO
    const leftCluster = document.createElement('div')
    leftCluster.style.cssText = 'position:absolute;bottom:20px;left:20px;display:flex;gap:12px;pointer-events:all;'
    const btnLeft = mkBtn('tt-left', '◄', 'rgba(30,41,69,0.92)', '#fff', 66, 26)
    const btnRight = mkBtn('tt-right', '►', 'rgba(30,41,69,0.92)', '#fff', 66, 26)
    leftCluster.appendChild(btnLeft)
    leftCluster.appendChild(btnRight)
    wrap.appendChild(leftCluster)

    // CLUSTER DIREITO: AÇÕES ERGONÔMICAS EM ARCO
    const rightCluster = document.createElement('div')
    rightCluster.style.cssText = 'position:absolute;bottom:14px;right:14px;width:240px;height:180px;pointer-events:none;'

    // ACELERAR
    const btnAccel = mkBtn('tt-accel', '▲<br><span style="font-size:10px;">GAS</span>', 'linear-gradient(135deg,#22c55e,#15803d)', '#022c11', 72, 22)
    btnAccel.style.position = 'absolute'
    btnAccel.style.right = '10px'
    btnAccel.style.bottom = '75px'
    btnAccel.style.pointerEvents = 'all'

    // PULO / FLIP
    const btnJump = mkBtn('tt-jump', 'PULO<br><span style="font-size:9px;">FLIP</span>', 'linear-gradient(135deg,#ffd23f,#eab308)', '#070b16', 66, 13)
    btnJump.style.position = 'absolute'
    btnJump.style.right = '95px'
    btnJump.style.bottom = '78px'
    btnJump.style.pointerEvents = 'all'

    // NITRO / N2O
    const btnBoost = mkBtn('tt-boost', '🚀<br><span style="font-size:9px;">N2O</span>', 'linear-gradient(135deg,#ff7a00,#ea580c)', '#fff', 60, 16)
    btnBoost.style.position = 'absolute'
    btnBoost.style.right = '58px'
    btnBoost.style.bottom = '158px'
    btnBoost.style.pointerEvents = 'all'

    // RÉ / FREIO
    const btnBrake = mkBtn('tt-brake', '▼<br><span style="font-size:9px;">RÉ</span>', 'linear-gradient(135deg,#ef4444,#b91c1c)', '#fff', 54, 18)
    btnBrake.style.position = 'absolute'
    btnBrake.style.right = '18px'
    btnBrake.style.bottom = '8px'
    btnBrake.style.pointerEvents = 'all'

    // DRIFT
    const btnDrift = mkBtn('tt-drift', 'DRIFT', 'rgba(30,41,69,0.92)', '#38bdf8', 52, 10)
    btnDrift.style.position = 'absolute'
    btnDrift.style.right = '85px'
    btnDrift.style.bottom = '10px'
    btnDrift.style.pointerEvents = 'all'

    // ROLL
    const btnRoll = mkBtn('tt-roll', 'ROLL', 'rgba(30,41,69,0.92)', '#c084fc', 50, 10)
    btnRoll.style.position = 'absolute'
    btnRoll.style.right = '148px'
    btnRoll.style.bottom = '12px'
    btnRoll.style.pointerEvents = 'all'

    rightCluster.appendChild(btnAccel)
    rightCluster.appendChild(btnJump)
    rightCluster.appendChild(btnBoost)
    rightCluster.appendChild(btnBrake)
    rightCluster.appendChild(btnDrift)
    rightCluster.appendChild(btnRoll)
    wrap.appendChild(rightCluster)

    root.appendChild(wrap)

    const bind = (el: HTMLElement, on: () => void, off: () => void) => {
      const start = (e: PointerEvent) => {
        e.preventDefault()
        try { el.setPointerCapture(e.pointerId) } catch {}
        el.style.transform = 'translateY(3px) scale(0.94)'
        on()
      }
      const end = (e: PointerEvent) => {
        e.preventDefault()
        try { el.releasePointerCapture(e.pointerId) } catch {}
        el.style.transform = 'none'
        off()
      }
      el.addEventListener('pointerdown', start as any)
      el.addEventListener('pointerup', end as any)
      el.addEventListener('pointercancel', end as any)
    }

    bind(btnLeft,  () => { this.touch.steer = -1 }, () => { if (this.touch.steer === -1) this.touch.steer = 0 })
    bind(btnRight, () => { this.touch.steer = 1 },  () => { if (this.touch.steer === 1) this.touch.steer = 0 })
    bind(btnAccel, () => { this.touch.throttle = 1 },  () => { if (this.touch.throttle === 1) this.touch.throttle = 0 })
    bind(btnBrake, () => { this.touch.throttle = -1 }, () => { if (this.touch.throttle === -1) this.touch.throttle = 0 })
    bind(btnBoost, () => { this.touch.boost = true },  () => { this.touch.boost = false })
    bind(btnJump,  () => { this.touch.jump = true },   () => { this.touch.jump = false })
    bind(btnDrift, () => { this.touch.drift = true },  () => { this.touch.drift = false })
    bind(btnRoll,  () => { this.touch.roll = true },    () => { this.touch.roll = false })

    // BOTÃO USE POWER-UP — toque para usar o item coletado (mobile)
    const btnUse = document.createElement('button')
    btnUse.id = 'tt-use-powerup'
    btnUse.innerHTML = '⚡<br><span style="font-size:9px;">USAR</span>'
    btnUse.style.cssText = `
      position:absolute;bottom:85px;right:235px;
      width:62px;height:62px;border-radius:50%;
      background:linear-gradient(135deg,#facc15,#f59e0b);
      color:#1a1200;border:3px solid #92400e;
      box-shadow:0 5px 0 #92400e;
      font-family:'Luckiest Guy',cursive;font-size:18px;
      display:none;flex-direction:column;align-items:center;justify-content:center;
      touch-action:none;user-select:none;cursor:pointer;
      pointer-events:all;transition:transform .08s,box-shadow .08s;
      z-index:130;
    `
    wrap.appendChild(btnUse)
    bind(
      btnUse,
      () => { this.activatePlayerRumble() },
      () => {}
    )

    // Atualiza visibilidade do botão USE conforme o jogador tem item
    ;(this as any)._updateTouchUseBtn = () => {
      btnUse.style.display = this.rumblePowerup ? 'flex' : 'none'
    }
  }


  //  LOOP PRINCIPAL DO JOGO

  private loop = () => {
    if (!this.isRunning) return
    this.animId = requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta(), 0.05)

    if (!this.paused) {
      if (this.isReplaying) {
        this.updateReplayPlayback(dt)
        if (this.isMobile) {
          this.renderer.render(this.scene, this.camera)
        } else {
          this.outlineEffect.render(this.scene, this.camera)
        }
        return
      }

      this.carHitCooldown = Math.max(0, this.carHitCooldown - dt)

      // 1. Contagem Regressiva de Kickoff (3.. 2.. 1.. VAI!)
      if (this.kickoffCountdown > 0) {
        this.kickoffCountdown -= dt
        // Apenas o Host (ou solo/offline) atualiza o display diretamente; o Cliente segue o Host
        if (!this.isOnline1v1 || this.turboNet?.isHost) {
          this.updateCountdownDisplay()
        }
        for (const car of this.allCars) car.freeze()
      } else if (this.goalCooldown > 0) {
        this.goalCooldown -= dt
        for (const car of this.allCars) car.freeze()
      } else if (!this.matchEnded) {
        // ── ONLINE 1v1: modo host ou cliente ─────────────────
        if (this.isOnline1v1 && this.turboNet) {
          this.updateOnlineFrame(dt)
        } else {
          // ── MODO SOLO/BOT (padrão) ─────────────────────────
          if (!this.spectatorMode) {
            this.updatePlayerInput(dt)
          }
          this.updateBotAI(dt)
        }
        // ── KONG GORAK: Atualiza gorila neutro na Arena Kong ──
        if (this.kongGorak && this.theme === 'kong') {
          this.kongGorak.update(dt)
        }
        this.resolveCarCarCollision()
        // Física da bola: somente Host (online) ou sempre (solo)
        if (!this.isOnline1v1 || this.turboNet?.isHost) {
          this.updateBall(dt)
        }
        this.updateDynamicObstacles(dt)
        this.updateBoostCoins(dt)
        this.updateMysteryBoxes(dt)
        this.updateLaunchPads(dt)
        this.updateProjectilesAndTraps(dt)
        this.updateDemoRespawn(dt)
        this.updateMagnetArc()
        this.updateMissileAlert(dt)
        this.updateRoulette(dt)

        // ── ONLINE 1v1: snapshot do Host → cliente ───────────
        if (this.isOnline1v1 && this.turboNet?.isHost) {
          this.snapshotTimer += dt
          if (this.snapshotTimer >= this.SNAPSHOT_INTERVAL) {
            this.snapshotTimer = 0
            this.broadcastOnlineSnapshot()
          }
        }

        if (this.gameMode === 'rumble') {
          this.updateRumble(dt)
        } else if (this.rumblePowerup || this.rumbleActive) {
          // Em qualquer modo: aplica efeitos de power-ups coletados em mystery boxes
          this.updateRumbleEffectsOnly(dt)
        }

        // Buffer do Instant Replay - Zero Allocation Ring Buffer (sem garbage collection pauses)
        const rFrame = this.replayRingBuffer[this.replayHead]
        if (rFrame) {
          rFrame.ballPos.copy(this.ball.pos)
          rFrame.ballRot.copy(this.ball.mesh.rotation)
          for (let i = 0; i < this.allCars.length; i++) {
            const c = this.allCars[i]
            let slot = rFrame.cars[i]
            if (!slot) {
              slot = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0 }
              rFrame.cars[i] = slot
            }
            slot.pos.copy(c.pos)
            slot.yaw = c.yaw
            slot.pitch = c.pitch
            slot.roll = c.rollAngle
          }
          this.replayHead = (this.replayHead + 1) % TurboSoccerGame.MAX_REPLAY_FRAMES
          if (this.replayTotalStored < TurboSoccerGame.MAX_REPLAY_FRAMES) {
            this.replayTotalStored++
          }
        }
      } else {
        for (const car of this.allCars) car.freeze()
      }

      this.updateSmoke(dt)
      this.updateCrowd(dt)
      this.updateCamera(dt)
      this.updateHUD(dt)
      for (const car of this.allCars) car.update(dt)
      this.audio.updateEngine(Math.min(1, Math.abs(this.playerCar.speed) / 1.3), this.playerBoosting)

      // Som de motor espacial 3D do adversário mais próximo com atenuação de distância
      let closestOpponent: CarObject | null = null
      let closestDistSq = Infinity
      for (const bot of this.blueCars) {
        if (!bot.isDemoed && bot.group.visible) {
          const dSq = this.playerCar.pos.distanceToSquared(bot.pos)
          if (dSq < closestDistSq) {
            closestDistSq = dSq
            closestOpponent = bot
          }
        }
      }
      if (closestOpponent && closestDistSq < 2500) { // dentro de 50 metros
        this.audio.startOpponentEngine()
        this.audio.updateOpponentEngine(
          closestOpponent.pos.x,
          closestOpponent.pos.y,
          closestOpponent.pos.z,
          Math.min(1, Math.abs(closestOpponent.speed) / 1.3),
          false
        )
      } else {
        this.audio.stopOpponentEngine()
      }

      // Atualiza o Listener do Áudio Espacial 3D (Howler) com a posição e orientação real da Câmera
      const camDir = new THREE.Vector3()
      this.camera.getWorldDirection(camDir)
      this.audio.updateListener(
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z,
        camDir.x,
        camDir.y,
        camDir.z
      )
    } else {
      this.audio.updateEngine(0, false)
      this.audio.stopOpponentEngine()
    }

    // Renderiza cena: no desktop usa Bloom+Vinheta pós-processados (pmndrs/postprocessing)
    // No mobile usa single-pass ultra veloz (60 FPS estável)
    // IMPORTANTE: OutlineEffect e EffectComposer NÃO podem rodar juntos (double-render).
    // No desktop com composer, o RenderPass interno já cuida da cena completa.
    // No desktop sem composer (fallback), usa OutlineEffect diretamente.
    if (this.stats) this.stats.begin()
    if (this.isMobile) {
      this.renderer.render(this.scene, this.camera)
    } else if (this.composer) {
      // Bloom + Vinheta via postprocessing (RenderPass interno = sem double-render)
      this.composer.render()
    } else {
      // Fallback cartoon outline clássico
      this.outlineEffect.render(this.scene, this.camera)
    }
    if (this.stats) this.stats.end()
  }

  private updateCountdownDisplay() {
    const cdWrap = document.getElementById('turbo-countdown-overlay')!
    if (this.kickoffCountdown <= 0) {
      cdWrap.style.display = 'none'
      this.isKickoffActive = false
      return
    }

    cdWrap.style.display = 'flex'
    let currentSec = 0

    if (this.kickoffCountdown > 2.5) {
      currentSec = 3
      this.hudCountdown.textContent = '3'
      this.hudCountdown.style.color = '#ef4444'
    } else if (this.kickoffCountdown > 1.5) {
      currentSec = 2
      this.hudCountdown.textContent = '2'
      this.hudCountdown.style.color = '#f59e0b'
    } else if (this.kickoffCountdown > 0.5) {
      currentSec = 1
      this.hudCountdown.textContent = '1'
      this.hudCountdown.style.color = '#10b981'
    } else {
      currentSec = 0
      this.hudCountdown.textContent = 'VAI! ⚽'
      this.hudCountdown.style.color = '#22c55e'
    }

    if (currentSec !== this.lastCountdownSec) {
      this.lastCountdownSec = currentSec

      // Correção 2: Host envia evento autoritativo de countdown pela rede sempre que o segundo mudar
      if (this.isOnline1v1 && this.turboNet?.isHost) {
        this.turboNet.sendCountdownEvent(currentSec)
      }

      if (currentSec > 0) {
        this.audio.playCountdown()
      } else {
        this.audio.playCountdownGo()
        this.audio.startBGM()
        this.audio.startEngine()
        this.audio.startCrowd()
      }
    }
  }




  private updatePlayerInput(dt: number) {
    const gp = this.gamepad.getState()
    const pc = this.playerCar

    if (pc.isDemoed) return  // aguarda respawn via demoRespawnTimer

    if (gp.connected) {
      this.hudCtrlMode.textContent = '🎮 XBOX'
      this.hudCtrlMode.style.borderColor = '#00ff88'
    }

    // ── THROTTLE: só o botão ACELERAR/RÉ move o carro no chão ──────────────
    // W/S/Arrow APENAS quando não há gamepad (teclado como substituto de RT/LT)
    // D-Pad cima/baixo no gamepad também servem como ACELERAR/RÉ
    let throttle = 0
    if (gp.connected) {
      // Gamepad: gatilhos RT (frente) e LT (ré) têm prioridade; D-Pad como fallback
      if (gp.rtThrottle > 0.1)       throttle = gp.rtThrottle
      else if (gp.ltBrake > 0.1)     throttle = -gp.ltBrake
      else if (gp.dpadUp)            throttle = 1
      else if (gp.dpadDown)          throttle = -1
      // stickY NÃO é throttle — é só câmera/direção, não movimentação
    } else {
      // Teclado (sem gamepad): W/ArrowUp = acelerar, S/ArrowDown = ré
      if (this.keys['KeyW'] || this.keys['ArrowUp'])   throttle += 1
      if (this.keys['KeyS'] || this.keys['ArrowDown']) throttle -= 1
      // Touch: botão GAS = acelerar, botão RÉ = ré (já mapeados em buildTouchControls)
      throttle += this.touch.throttle
    }
    throttle = Math.max(-1, Math.min(1, throttle))

    let steer = 0
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  steer -= 1
    if (this.keys['KeyD'] || this.keys['ArrowRight']) steer += 1
    steer += this.touch.steer

    if (gp.connected) {
      if (Math.abs(gp.steerX) > 0.15) steer = gp.steerX
      else if (gp.dpadLeft) steer = -1
      else if (gp.dpadRight) steer = 1
    }
    steer = Math.max(-1, Math.min(1, steer))

    if (steer !== 0) {
      const turnMult = pc.drifting ? 2.1 : pc.speed < -0.1 ? -1 : 1
      pc.yaw -= steer * this.studioParams.turnRate * turnMult * dt
      pc.steerFront(-steer * 0.45)
      this.emitTireSmoke(pc)
    } else {
      pc.steerFront(0)
    }


    const boostBtn = gp.connected && gp.boost
    const boostKey = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touch.boost
    const isBoosting = (boostBtn || boostKey) && pc.boost > 0

    this.playerBoosting = isBoosting
    if (isBoosting) {
      if (!this.boostSfxHeld) {
        this.boostSfxHeld = true
        this.audio.playBoost()
      }
      if (this.isTraining) pc.boost = 100
      else pc.boost = Math.max(0, pc.boost - 32 * dt)
      pc.showFlame(true)
      throttle = Math.max(throttle, 1.0) * 1.55 * this.carAttrs.nitroBonus
      this.emitTireSmoke(pc)
    } else {
      this.boostSfxHeld = false
      pc.showFlame(false)
      // Nitro não recarrega sozinho: colete moedas cartoon no campo!
    }


    if (throttle !== 0) {
      const nitroMaxMult = isBoosting ? 1.75 * this.carAttrs.nitroBonus : 1.25
      const maxSpd = nitroMaxMult * this.studioParams.playerSpeedMult
      pc.speed = Math.max(-0.65, Math.min(maxSpd, pc.speed + throttle * 2.2 * dt))
    } else {
      pc.speed *= 0.94 // Desaceleracao suave por atrito < 0.02) pc.speed = 0
    }


    // Drif (Barrel Roll) - LB segurar + soltar, ou botao drift do toque
    const handbrake = (gp.connected && gp.handbrake) || this.keys['KeyF'] || this.touch.drift
    const barrelRoll = this.touch.roll
    const handbrakeJustPressed = handbrake && !this.handbrakeHeld
    const handbrakeJustReleased = !handbrake && this.handbrakeHeld
    this.handbrakeHeld = handbrake

    if (handbrakeJustPressed && pc.grounded && pc.speed > 0.35) {
      pc.drifting = true
      pc.driftCharge = 0
    }
    if (handbrakeJustReleased && pc.drifting) {
      if (pc.driftCharge > 0.35) {
        pc.drifting = false
        pc.rollAngle = 0
        pc.speed = Math.min(pc.speed + 0.85, 1.75 * this.studioParams.playerSpeedMult)
        this.audio.playDash()
        this.emitTireSmoke(pc)
      } else {
        pc.drifting = false
        pc.driftCharge = 0
      }
    }
    if (pc.drifting && handbrake) {
      pc.speed *= 0.87
      pc.driftCharge += dt * 2.4
      this.skidMarkTimer -= dt
      if (this.skidMarkTimer <= 0) {
        this.skidMarkTimer = 0.04
        this.emitSkidMarks(pc)
      }
    }

    if ((barrelRoll || (gp.connected && gp.roll)) && !this.barrelRollHeld) {
      this.barrelRollHeld = true
      pc.rollAngle = 0
      pc.speed = Math.min(pc.speed + 0.55, 1.75 * this.studioParams.playerSpeedMult)
      this.audio.playDash()
      this.emitTireSmoke(pc)
    }
    if (!barrelRoll) this.barrelRollHeld = false

    const jumpBtn = gp.connected && gp.jump
    const jumpKey = this.keys['Space'] || this.touch.jump
    const jumpNow = jumpKey || jumpBtn
    const jumpJustPressed = jumpNow && !this.jumpHeld
    this.jumpHeld = jumpNow

    // ── NITRO NO AR DIRECIONAL (Pulo + Nitro obedece o direcional do controle sem girar o carro em falso) ──
    const isNitroPressed = (gp.connected && gp.boost) || this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touch.boost
    if (!pc.grounded && isNitroPressed && pc.boost > 0) {
      let inputX = 0 // -1 = Esquerda, +1 = Direita
      let inputZ = 0 // +1 = Frente, -1 = Trás

      if (gp.connected) {
        if (Math.abs(gp.steerX) > 0.15) inputX = gp.steerX
        if (Math.abs(gp.stickY) > 0.15) inputZ = -gp.stickY // frente (-stickY) = +1, trás (+stickY) = -1
        if (gp.dpadUp)    inputZ = +1
        if (gp.dpadDown)  inputZ = -1
        if (gp.dpadLeft)  inputX = -1
        if (gp.dpadRight) inputX = +1
        if (inputZ === 0) {
          if (gp.rtThrottle > 0.15) inputZ = +1
          if (gp.ltBrake > 0.15)    inputZ = -1
        }
      } else {
        if (this.keys['KeyW'] || this.keys['ArrowUp'])    inputZ = +1
        if (this.keys['KeyS'] || this.keys['ArrowDown'])  inputZ = -1
        if (this.keys['KeyA'] || this.keys['ArrowLeft'])  inputX = -1
        if (this.keys['KeyD'] || this.keys['ArrowRight']) inputX = +1
        if (this.touch.steer)    inputX = this.touch.steer
        if (this.touch.throttle) inputZ = this.touch.throttle
      }

      // Se nenhum direcional for inclinado, empurra para a FRENTE do carro
      if (Math.abs(inputX) < 0.15 && Math.abs(inputZ) < 0.15) {
        inputZ = 1.0
      }

      // Converte o direcional para o espaço da arena mantendo a orientação do carro
      const fwdX = Math.sin(pc.yaw), fwdZ = Math.cos(pc.yaw)
      const rightX = Math.cos(pc.yaw), rightZ = -Math.sin(pc.yaw)

      // Se inputZ for negativo (puxar direcional para trás), o impulso é exatamente para TRÁS!
      let boostDirX = fwdX * inputZ + rightX * inputX
      let boostDirZ = fwdZ * inputZ + rightZ * inputX

      const dirLen = Math.hypot(boostDirX, boostDirZ) || 1
      boostDirX /= dirLen
      boostDirZ /= dirLen

      // Impulso horizontal firme
      const nitroAirThrust = 68 * dt
      pc.velX = (pc.velX || 0) + boostDirX * nitroAirThrust
      pc.velZ = (pc.velZ || 0) + boostDirZ * nitroAirThrust

      const maxAirSpd = 50
      const curAirSpd = Math.hypot(pc.velX, pc.velZ)
      if (curAirSpd > maxAirSpd) {
        pc.velX = (pc.velX / curAirSpd) * maxAirSpd
        pc.velZ = (pc.velZ / curAirSpd) * maxAirSpd
      }

      if (this.isTraining) pc.boost = 100
      else pc.boost = Math.max(0, pc.boost - 32 * dt)
      pc.showFlame(true)
    }

    // ── PULO 1 e PULO 2 / FLIP DIRECIONAL (como no Turbo Soccer original) ──
    if (jumpJustPressed) {
      if (pc.grounded && pc.jumpCount === 0) {
        // 1º PULO: impulso vertical limpo + preserva momentum do movimento do carro no solo!
        const fwdSpeed = pc.speed * 50
        pc.velX = Math.sin(pc.yaw) * fwdSpeed
        pc.velZ = Math.cos(pc.yaw) * fwdSpeed
        pc.velY = this.studioParams.jumpForce + this.carAttrs.jumpBonus
        pc.jumpHoldTimer = 0.20 // permite segurar A/Espaço por 0.20s para Super Jump
        pc.grounded = false
        pc.jumpCount = 1
        pc.flipLocked = false
        this.audio.playDash()
        this.emitTireSmoke(pc, true)
      } else if (!pc.grounded && pc.jumpCount <= 1 && pc.flipTimer <= 0) {
        // 2º PULO = FLIP DIRECIONAL baseado no analógico (como no RL/Turbo Soccer)
        let inputX = 0, inputZ = 0
        if (gp.connected) {
          if (Math.abs(gp.steerX) > 0.18) inputX = Math.sign(gp.steerX)
          if (Math.abs(gp.stickY) > 0.18) inputZ = -Math.sign(gp.stickY) // frente (-stickY) = flip frontal (+1), trás (+stickY) = backflip (-1)
          if (gp.dpadUp) inputZ = +1
          if (gp.dpadDown) inputZ = -1
          if (gp.dpadLeft) inputX = -1
          if (gp.dpadRight) inputX = +1
          if (inputZ === 0) {
            if (gp.rtThrottle > 0.3) inputZ = +1
            if (gp.ltBrake > 0.3)    inputZ = -1
          }
        }
        // Teclado (sempre lido para funcionar com controle ou teclado)
        if (this.keys['KeyA'] || this.keys['ArrowLeft'])  inputX = -1
        if (this.keys['KeyD'] || this.keys['ArrowRight']) inputX = +1
        if (this.keys['KeyW'] || this.keys['ArrowUp'])    inputZ = +1
        if (this.keys['KeyS'] || this.keys['ArrowDown'])  inputZ = -1
        if (this.touch.steer) inputX = Math.sign(this.touch.steer)
        if (this.touch.throttle) inputZ = Math.sign(this.touch.throttle)

        const hasDir = Math.abs(inputX) > 0.1 || Math.abs(inputZ) > 0.1
        if (hasDir) {
          // FLIP DIRECIONAL: impulso equilibrado (Rocket League / Turbo Soccer) sem atravessar o campo
          const flipThrust = 19.5
          const sinY = Math.sin(pc.yaw), cosY = Math.cos(pc.yaw)
          const thrustX = (inputX * cosY + inputZ * sinY) * flipThrust
          const thrustZ = (-inputX * sinY + inputZ * cosY) * flipThrust
          pc.velX = pc.velX * 0.25 + thrustX
          pc.velZ = pc.velZ * 0.25 + thrustZ
          // Impulso vertical controlado para bater e cair estável nas 4 rodas
          pc.pos.y = Math.max(pc.pos.y, 1.2)
          pc.velY = Math.max(pc.velY + 4.5, 7.5)
          pc.flipDirX = inputX
          pc.flipDirZ = inputZ
          pc.flipTimer = 0.001
          pc.flipLocked = true
        } else {
          // SEM DIREÇÃO → pulo duplo vertical controlado
          pc.velY = Math.max(pc.velY + (this.studioParams.jumpForce + this.carAttrs.jumpBonus) * 0.85, (this.studioParams.jumpForce + this.carAttrs.jumpBonus) * 1.15)
          pc.flipLocked = false
        }
        pc.jumpCount = 2
        this.audio.playDash()
      }
    }

    // Sustentação dinâmica do 1º pulo ao segurar A/Espaço
    if (jumpNow && pc.jumpHoldTimer > 0 && !pc.grounded && pc.jumpCount === 1) {
      pc.velY += 30 * dt
      pc.jumpHoldTimer -= dt
    }

    // ── FLIP CANCEL (Rocket League Pro Mechanic) ──
    // Se o jogador pressionar o direcional oposto durante o flip, cancela a rotação mantendo o impulso!
    if (pc.flipTimer > 0) {
      let cancelZ = 0
      if (gp.connected && Math.abs(gp.stickY) > 0.35) cancelZ = -Math.sign(gp.stickY)
      if (this.keys['KeyS'] || this.keys['ArrowDown']) cancelZ = -1
      if (this.keys['KeyW'] || this.keys['ArrowUp'])   cancelZ = 1
      if (cancelZ !== 0 && pc.flipDirZ !== 0 && Math.sign(cancelZ) !== Math.sign(pc.flipDirZ)) {
        pc.flipTimer = 0.44 // finaliza a rotação do flip imediatamente
        pc.pitch = 0
        pc.aerialPitch = 0
      }
    }

    // ── CONTROLE AÉREO CONTÍNUO (PITCH E ROLL NO AR — Rocket League / Turbo Soccer) ──
    if (!pc.grounded && pc.flipTimer <= 0 && !pc.flipLocked) {
      let pitchInput = 0
      let rollInput = 0
      if (gp.connected) {
        if (Math.abs(gp.stickY) > 0.18) pitchInput = -gp.stickY // frente (-stickY) = pitch DOWN (+), trás = pitch UP (-)
        if (Math.abs(gp.steerX) > 0.18) rollInput = gp.steerX
        if (gp.lb) rollInput -= 1.0 // Air Roll Esquerda
        if (gp.rb) rollInput += 1.0 // Air Roll Direita
      } else {
        if (this.keys['KeyW'] || this.keys['ArrowUp'])   pitchInput = 1
        if (this.keys['KeyS'] || this.keys['ArrowDown']) pitchInput = -1
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) rollInput = -1
        if (this.keys['KeyD'] || this.keys['ArrowRight']) rollInput = 1
        if (this.keys['KeyQ']) rollInput = -1.2 // Air Roll Livre Q
        if (this.keys['KeyE']) rollInput = 1.2  // Air Roll Livre E
      }

      if (pitchInput !== 0) {
        pc.aerialPitch += pitchInput * 3.5 * dt
      } else {
        pc.aerialPitch *= 0.90
      }
      if (rollInput !== 0) {
        pc.aerialRoll += rollInput * 3.8 * dt
      } else {
        pc.aerialRoll *= 0.90
      }

      // Se não estiver em voo livre com boost, trava limite seguro para NUNCA cair de cabeça para baixo
      if (!this.aerialBoostHeld) {
        pc.aerialPitch = Math.max(-0.70, Math.min(0.70, pc.aerialPitch))
        pc.aerialRoll  = Math.max(-0.70, Math.min(0.70, pc.aerialRoll))
      }
    }


    // D-Pad Quick Chat Emotes (Controle Xbox)
    if (gp.connected) {
      // Disparo de Power-up via RB no controle do Xbox (apenas na borda de subida do botão)
      if (gp.rb && !this.prevRb) {
        this.activatePlayerRumble()
      }
      this.prevRb = gp.rb

      if (gp.dpadUp && !this.prevDpadUp)       this.showQuickChat('⚽ Golaço! VAI!')
      if (gp.dpadDown && !this.prevDpadDown)   this.showQuickChat('🛡️ Grande defesa!')
      if (gp.dpadLeft && !this.prevDpadLeft)   this.showQuickChat('⚡ Passa a bola aqui!')
      if (gp.dpadRight && !this.prevDpadRight) this.showQuickChat('🔥 Que manobra!')
      this.prevDpadUp = gp.dpadUp
      this.prevDpadDown = gp.dpadDown
      this.prevDpadLeft = gp.dpadLeft
      this.prevDpadRight = gp.dpadRight
    }

    if (gp.connected) {
      if (Math.abs(gp.cameraX) > 0.15) {
        this.camOrbitH = Math.max(-Math.PI, Math.min(Math.PI, this.camOrbitH + gp.cameraX * 3.2 * dt))
      } else {
        this.camOrbitH *= 0.92
      }
      if (Math.abs(gp.cameraY) > 0.15) {
        this.camOrbitV = Math.max(-0.4, Math.min(0.8, this.camOrbitV - gp.cameraY * 2.2 * dt))
      } else {
        this.camOrbitV *= 0.92
      }
    }

    this.applyCarPhysics(pc, dt)
  }

  private applyCarPhysics(car: CarObject, dt: number) {
    if (car.isDemoed) return  // demoed cars are frozen by demoRespawn logic

    // ── FLIP DIRECIONAL 360° COM AUTO-RECUPERAÇÃO (Turbo Soccer / Rocket League) ──
    const FLIP_DURATION = 0.44
    if (car.flipTimer > 0) {
      car.flipTimer += dt
      const t = Math.min(1.0, car.flipTimer / FLIP_DURATION)
      // Cambalhota perfeita de 360° (2π radianos)
      const angle = t * Math.PI * 2

      // Gravidade anulada temporariamente para a cambalhota completar no ar sem raspar o solo (Dodge do Rocket League)
      if (t < 0.85) {
        car.velY = Math.max(car.velY, 0)
      }

      if (Math.abs(car.flipDirZ) >= Math.abs(car.flipDirX)) {
        // Frontflip (flipDirZ > 0): gira nariz para frente (+angle); Backflip (flipDirZ < 0): gira para trás (-angle)
        car.pitch = car.flipDirZ * angle
        car.rollAngle = 0
      } else {
        // Sideflip: esquerda (-1) gira +angle, direita (+1) gira -angle
        car.rollAngle = -car.flipDirX * angle
        car.pitch = 0
      }
      car.aerialPitch = car.pitch
      car.aerialRoll = car.rollAngle

      if (car.flipTimer >= FLIP_DURATION) {
        car.aerialPitch = 0
        car.aerialRoll  = 0
        car.pitch       = 0
        car.rollAngle   = 0
        car.flipTimer   = 0
        car.flipDirX    = 0
        car.flipDirZ    = 0
        // flipLocked permanece true até aterrissar para manter as 4 rodas sempre voltadas para o solo!
      }
    } else if (car.grounded) {
      // 4 rodas rigorosamente niveladas no gramado quando no solo
      car.aerialPitch = 0
      car.aerialRoll  = 0
      car.pitch       = 0
      car.rollAngle   = 0
      car.flipLocked  = false
    } else {
      // No ar sem flip ativo
      if (car.flipLocked) {
        car.aerialPitch = 0
        car.aerialRoll  = 0
        car.pitch       = 0
        car.rollAngle   = 0
      } else {
        car.aerialPitch *= 0.90
        car.aerialRoll  *= 0.90
      }
    }

    // ── BARREL ROLL (X, C) ──
    if (car.isRolling) {
      car.rollAngle += Math.PI * 2 * dt * 2.8
      if (car.rollAngle >= Math.PI * 2) {
        car.rollAngle = 0
        car.isRolling = false
      }
    } else if (!car.flipTimer) {
      car.rollAngle = car.aerialRoll
    }

    // ── FÍSICA VERTICAL (GRAVIDADE / QUEDA / ATERRISSAGEM COM 4 RODAS NO SOLO) ──
    if (!car.grounded) {
      car.velY -= this.studioParams.gravity * dt

      // Movimentos aéreos via velX/velZ são aplicados diretamente
      car.pos.x += car.velX * dt
      car.pos.z += car.velZ * dt

      car.pos.y += car.velY * dt
      if (car.pos.y <= 0) {
        // Wave Dash (Rocket League): contato no solo com flip ativo converte o ângulo em burst de aceleração!
        if (car.flipTimer > 0 && Math.abs(car.flipDirZ) > 0.1) {
          const waveDashBurst = car.flipDirZ * 0.42
          car.speed = Math.max(-0.6, Math.min(1.75 * this.studioParams.playerSpeedMult, car.speed + waveDashBurst))
          this.audio.playDash()
          this.emitTireSmoke(car, true)
          if (car === this.playerCar) {
            this.showQuickChat('⚡ WAVE DASH!')
          }
        }
        car.pos.y      = 0
        car.velY       = 0
        car.velX       = 0
        car.velZ       = 0
        car.grounded   = true
        car.jumpCount  = 0
        car.flipTimer  = 0
        car.flipDirX   = 0
        car.flipDirZ   = 0
        car.flipLocked = false
        // Nivelamento imediato: as 4 rodas pousam sempre retas no gramado
        car.aerialPitch = 0
        car.aerialRoll  = 0
        car.pitch       = 0
        car.rollAngle   = 0
      }
    }

    // ── MOVIMENTO HORIZONTAL NO SOLO & BARREIRAS DO CAMPO (Sem subir paredes/teto/arquibancadas) ──
    const limX = FIELD_W / 2 - 2.8
    const limZ = FIELD_L / 2 - 2.8

    // Trava de altura de segurança: permite pulos duplos altos e defesas aéreas, com teto elevado (CEIL_H = 58)
    const MAX_CAR_HEIGHT = 28.0
    if (car.pos.y > MAX_CAR_HEIGHT) {
      car.pos.y = MAX_CAR_HEIGHT
      if (car.velY > 0) car.velY = 0
    }

    // Colisão com as paredes de vidro da arena: o carro para e rebate suavemente, sem escalar paredes
    if (Math.abs(car.pos.x) >= limX) {
      car.pos.x = Math.sign(car.pos.x) * limX
      car.speed *= 0.55
      if (!car.grounded) car.velX = -car.velX * 0.3
    }
    if (Math.abs(car.pos.z) >= limZ && Math.abs(car.pos.x) > GOAL_W / 2) {
      car.pos.z = Math.sign(car.pos.z) * limZ
      car.speed *= 0.55
      if (!car.grounded) car.velZ = -car.velZ * 0.3
    }

    if (car.grounded) {
      const spd = car.speed * 50 * dt
      car.pos.x += Math.sin(car.yaw) * spd
      car.pos.z += Math.cos(car.yaw) * spd
      car.pitch = 0
      car.rollAngle = 0
    } else {
      car.pitch = car.aerialPitch
      car.rollAngle = car.isRolling ? car.rollAngle : car.aerialRoll
    }

    car.pos.x = Math.max(-limX, Math.min(limX, car.pos.x))
    car.pos.z = Math.max(-limZ, Math.min(limZ, car.pos.z))

    car.applyTransform()
    car.wheelSpinAngle += car.speed * 360 * dt
  }




  
  
  // ── MOEDAS REDONDAS DE NITRO COM CIFRÃO ($) CARTOON ────────────────
  private buildBoostCoins() {
    this.boostCoins = []

    const createCoinTexture = (isLarge: boolean) => {
      const c = document.createElement('canvas')
      c.width = 256
      c.height = 256
      const ctx = c.getContext('2d')!

      // Fundo circular vibrante cartoon
      ctx.fillStyle = isLarge ? '#ffb703' : '#00b4d8'
      ctx.beginPath()
      ctx.arc(128, 128, 122, 0, Math.PI * 2)
      ctx.fill()

      // Borda escura cartoon estilo HQ
      ctx.lineWidth = 14
      ctx.strokeStyle = '#0f172a'
      ctx.stroke()

      // Anel interno de relevo dourado/ciano
      ctx.lineWidth = 6
      ctx.strokeStyle = isLarge ? '#ffe484' : '#90e0ef'
      ctx.beginPath()
      ctx.arc(128, 128, 102, 0, Math.PI * 2)
      ctx.stroke()

      // Cifrão cartoon central ($) com sombra e brilho
      ctx.fillStyle = '#0f172a'
      ctx.font = '900 136px "Arial Black", Impact, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('$', 132, 136)

      ctx.fillStyle = '#ffffff'
      ctx.font = '900 130px "Arial Black", Impact, sans-serif'
      ctx.fillText('$', 128, 132)

      const tex = new THREE.CanvasTexture(c)
      return tex
    }

    const largeTex = createCoinTexture(true)
    const smallTex = createCoinTexture(false)

    // Posições adaptadas para o campo 2× maior (160m × 260m)
    const padPositions: [number, number, number][] = [
      // 4 Pads GRANDES nos cantos (100% boost)
      [-65, -95, 100], [ 65, -95, 100], [-65,  95, 100], [ 65,  95, 100],
      // 2 Pads GRANDES no centro da lateral (100% boost)
      [-70,   0, 100], [ 70,   0, 100],
      // 8 Pads PEQUENOS nas laterais do meio-campo (+12 boost)
      [-35, -55, 12], [ 35, -55, 12], [-35,  55, 12], [ 35,  55, 12],
      [-35, -28, 12], [ 35, -28, 12], [-35,  28, 12], [ 35,  28, 12],
      // 4 Pads PEQUENOS no centro (+12 boost)
      [-14, 0, 12], [14, 0, 12], [0, -22, 12], [0, 22, 12]
    ]

    for (const [x, z, val] of padPositions) {
      const isLarge = val >= 100
      const g = new THREE.Group()
      g.position.set(x, 0, z)

      const radius = isLarge ? 2.2 : 1.45
      const thickness = 0.42
      const coinGeo = new THREE.CylinderGeometry(radius, radius, thickness, 32)

      // Rotação para a face da moeda ficar vertical
      coinGeo.rotateX(Math.PI / 2)

      const faceMat = new THREE.MeshToonMaterial({
        map: isLarge ? largeTex : smallTex,
        gradientMap: TOON_GRADIENT
      })
      const edgeMat = new THREE.MeshToonMaterial({
        color: isLarge ? 0xf59e0b : 0x0284c7,
        gradientMap: TOON_GRADIENT
      })

      const coinMesh = new THREE.Mesh(coinGeo, [edgeMat, faceMat, faceMat])
      // Garante altura de flutuação segura para a moeda nunca penetrar no gramado
      const coinCenterY = radius + 1.2
      coinMesh.position.y = coinCenterY
      coinMesh.castShadow = true
      g.add(coinMesh)

      // Borda de contorno cartoon preto expressivo na moeda (estilo cel-shading nítido)
      const coinOutlineGeo = new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, thickness * 1.15, 32)
      coinOutlineGeo.rotateX(Math.PI / 2)
      const coinOutlineMat = new THREE.MeshBasicMaterial({ color: 0x070b16, side: THREE.BackSide })
      const coinOutlineMesh = new THREE.Mesh(coinOutlineGeo, coinOutlineMat)
      coinMesh.add(coinOutlineMesh)

      // Base luminosa no chão
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.8, radius * 1.35, 32),
        new THREE.MeshBasicMaterial({
          color: isLarge ? 0xffaa00 : 0x00cfff,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide
        })
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.04
      g.add(ring)

      // Sombra cartoon no chão
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.9, 24),
        new THREE.MeshBasicMaterial({ color: 0x0a1020, transparent: true, opacity: 0.35 })
      )
      shadow.rotation.x = -Math.PI / 2
      shadow.position.y = 0.03
      g.add(shadow)

      // Luz cartoon
      const light = new THREE.PointLight(isLarge ? 0xffaa00 : 0x00cfff, isLarge ? 1.5 : 0.8, isLarge ? 8 : 4.5)
      light.position.y = 1.0
      g.add(light)

      this.scene.add(g)
      this.boostCoins.push({
        group: g,
        coinMesh,
        pos: new THREE.Vector3(x, coinCenterY, z),
        active: true,
        respawnTimer: 0,
        value: val
      })
    }
  }

  private updateBoostCoins(dt: number) {
    const time = Date.now() * 0.0035

    for (let i = 0; i < this.boostCoins.length; i++) {
      const coin = this.boostCoins[i]
      if (coin.active) {
        // Giro e flutuação suave cartoon da moeda (sempre no ar, sem afundar)
        coin.coinMesh.rotation.y += 2.8 * dt
        coin.coinMesh.position.y = coin.pos.y + Math.sin(time + i * 0.9) * 0.22

        // Checa coleta por todos os carros
        for (const car of this.allCars) {
          const cDist = Math.hypot(car.pos.x - coin.pos.x, car.pos.z - coin.pos.z)
          if (cDist < 3.8) {
            car.boost = Math.min(100, car.boost + coin.value)
            coin.active = false
            coin.respawnTimer = 5.5
            coin.group.visible = false
            if (car === this.playerCar) {
              this.audio.playBoost()
              this.triggerImpactFlash(coin.pos)
            }
            break
          }
        }
      } else {
        coin.respawnTimer -= dt
        if (coin.respawnTimer <= 0) {
          coin.active = true
          coin.group.visible = true
        }
      }
    }
  }

  // ── CAIXAS DE ITENS MISTERIOSAS (MARIO KART / RUMBLE) ──────────────
  private buildMysteryBoxes() {
    this.mysteryBoxes = []

    const createQCanvas = () => {
      const c = document.createElement('canvas')
      c.width = 256
      c.height = 256
      const ctx = c.getContext('2d')!

      // Fundo dourado saturado cartoon com borda grossa de quadrinhos
      ctx.fillStyle = '#f59e0b'
      ctx.fillRect(0, 0, 256, 256)

      ctx.lineWidth = 18
      ctx.strokeStyle = '#141426'
      ctx.strokeRect(9, 9, 238, 238)

      // Cantoneiras decorativas estilo caixa de surpresa
      ctx.fillStyle = '#fbbf24'
      ctx.fillRect(18, 18, 40, 40)
      ctx.fillRect(198, 18, 40, 40)
      ctx.fillRect(18, 198, 40, 40)
      ctx.fillRect(198, 198, 40, 40)

      // Ponto de interrogação com sombra preta cel-shading
      ctx.font = '900 150px "Arial Black", Impact, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      ctx.fillStyle = '#141426'
      ctx.fillText('?', 134, 136)

      ctx.fillStyle = '#ffffff'
      ctx.fillText('?', 128, 130)

      const tex = new THREE.CanvasTexture(c)
      return tex
    }

    const boxTex = createQCanvas()
    const boxMat = new THREE.MeshToonMaterial({
      map: boxTex,
      color: 0xffffff,
      gradientMap: TOON_GRADIENT
    })

    // Spawns de caixas estratégicos separados de moedas e launch pads (distância mínima > 22 metros)
    const spawns = [
      { x: -38, z: 0 },
      { x:  38, z: 0 },
      { x: -48, z:  80 },
      { x:  48, z:  80 },
      { x: -48, z: -80 },
      { x:  48, z: -80 },
      { x:   0, z:  68 },
      { x:   0, z: -68 },
      { x: -72, z:  38 },
      { x:  72, z:  38 },
      { x: -72, z: -38 },
      { x:  72, z: -38 }
    ]

    for (const sp of spawns) {
      const g = new THREE.Group()
      g.position.set(sp.x, 2.5, sp.z)

      const boxGeo = new THREE.BoxGeometry(3.2, 3.2, 3.2)
      const boxMesh = new THREE.Mesh(boxGeo, boxMat)
      boxMesh.castShadow = true
      g.add(boxMesh)

      // Borda preta de contorno cartoon 3D expressiva
      const outlineGeo = new THREE.BoxGeometry(3.38, 3.38, 3.38)
      const outlineMat = new THREE.MeshBasicMaterial({ color: 0x070b16, side: THREE.BackSide })
      const outlineMesh = new THREE.Mesh(outlineGeo, outlineMat)
      boxMesh.add(outlineMesh)

      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(2.4, 24),
        new THREE.MeshBasicMaterial({ color: 0x050814, transparent: true, opacity: 0.45 })
      )
      shadow.rotation.x = -Math.PI / 2
      shadow.position.y = -2.45
      g.add(shadow)

      const light = new THREE.PointLight(0xfacc15, 1.6, 14)
      light.position.y = 0
      g.add(light)

      this.scene.add(g)
      this.mysteryBoxes.push({
        group: g,
        boxMesh,
        qMesh: boxMesh,
        pos: new THREE.Vector3(sp.x, 2.5, sp.z),
        active: true,
        respawnTimer: 0
      })
    }
  }

  private updateMysteryBoxes(dt: number) {
    const time = Date.now() * 0.003
    // Pool balanceada com mais caixas de míssil teleguiado cartoon
    const pool: RumblePowerup[] = ['missile', 'missile', 'freeze', 'oil', 'magnet', 'shockwave', 'punch', 'overdrive']

    for (let i = 0; i < this.mysteryBoxes.length; i++) {
      const mb = this.mysteryBoxes[i]
      if (mb.active) {
        mb.boxMesh.rotation.y += 2.2 * dt
        mb.boxMesh.rotation.x = Math.sin(time + i) * 0.2
        mb.boxMesh.position.y = Math.sin(time * 1.5 + i * 0.8) * 0.35

        for (const car of this.allCars) {
          if (!car.group.visible || car.isDemoed) continue
          const d = Math.hypot(car.pos.x - mb.pos.x, car.pos.z - mb.pos.z)
          if (d < 4.2) {
            mb.active = false
            mb.respawnTimer = 6.0
            mb.group.visible = false

            const awarded = pool[Math.floor(Math.random() * pool.length)]

            if (car === this.playerCar) {
              if (this.isRouletteSpinning || this.rumblePowerup || this.rumbleActive) {
                // Já possui poder ou está sorteando
                break
              }
              // SOM DE EXPLOSÃO DA CAIXA: playDemo() = postHit + powerHit = efeito de impacto forte
              this.audio.playDemo()
              this.triggerImpactFlash(mb.pos)
              this.emitCartoonStarBurst(mb.pos, 24, 0xfacc15)
              this.emitCartoonStarBurst(mb.pos, 12, 0xff5500)
              const itemNames: Record<RumblePowerup, string> = {
                missile: '🚀 MÍSSIL TELEGUIDADO!',
                freeze: '🧊 RAIO DE GELO!',
                oil: '🛢️ MANCHA DE ÓLEO!',
                magnet: '🧲 ÍMÃ DA BOLA!',
                shockwave: '💨 ONDA DE CHOQUE!',
                punch: '🥊 SUPER SOCO!',
                overdrive: '⚡ NITRO OVERDRIVE!'
              }
              const label = itemNames[awarded] || '📦 ITEM OBTIDO!'
              // Inicia a Roleta de poderes no HUD (0.75s de suspense antes de revelar)
              this.startRouletteSpin(awarded, label)
            } else {
              const bst = this.botRumbleStates.get(car)
              if (bst && !bst.active && !bst.powerup) {
                bst.powerup = awarded
              }
            }
            break
          }
        }
      } else {
        mb.respawnTimer -= dt
        if (mb.respawnTimer <= 0) {
          mb.active = true
          mb.group.visible = true
        }
      }
    }
  }

  // ── GERADOR DE ÍCONES CARTOON ILUSTRADOS PARA PODERES (100% CEL-SHADING SEM EMOJIS GENÉRICOS) ──
  private getCartoonPowerupSVG(power: RumblePowerup, size = 44): string {
    switch (power) {
      case 'punch':
        return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" fill="#f59e0b" stroke="#0f172a" stroke-width="2.5"/>
          <circle cx="32" cy="32" r="28" fill="#fbbf24" opacity="0.4"/>
          <!-- Mola mecânica cartoon espiral -->
          <path d="M10 44 C 16 42, 14 34, 20 36 C 24 38, 22 30, 28 32" fill="none" stroke="#e2e8f0" stroke-width="3.5" stroke-linecap="round"/>
          <path d="M10 44 C 16 42, 14 34, 20 36 C 24 38, 22 30, 28 32" fill="none" stroke="#475569" stroke-width="1.5" stroke-linecap="round"/>
          <!-- Luva de Boxe Vermelha Super Soco -->
          <path d="M26 34 C 24 24, 30 14, 42 16 C 50 18, 54 26, 52 34 C 50 42, 42 46, 32 44 C 26 42, 24 36, 26 34 Z" fill="#ef4444" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M30 26 C 24 24, 22 18, 28 16 C 34 14, 36 20, 34 24 Z" fill="#dc2626" stroke="#0f172a" stroke-width="2"/>
          <rect x="20" y="36" width="7" height="11" rx="2" transform="rotate(-30 20 36)" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>
          <path d="M38 20 C 44 20, 48 24, 48 28" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>
          <!-- Explosão de impacto POW -->
          <polygon points="50,14 54,20 60,18 56,24 62,28 54,29 55,36 49,31 44,35 46,28 40,26 47,23" fill="#facc15" stroke="#0f172a" stroke-width="1.5"/>
        </svg>`

      case 'missile':
        return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" fill="#ef4444" stroke="#0f172a" stroke-width="2.5"/>
          <circle cx="32" cy="32" r="28" fill="#f87171" opacity="0.3"/>
          <polygon points="12,48 6,56 16,52 14,60 22,50" fill="#facc15" stroke="#ea580c" stroke-width="1.5"/>
          <path d="M18 46 L38 26 C 46 18, 54 14, 56 16 C 58 18, 54 26, 46 34 L26 54 Z" fill="#0284c7" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M42 22 C 48 16, 54 14, 56 16 C 58 18, 56 24, 50 30 Z" fill="#dc2626" stroke="#0f172a" stroke-width="2"/>
          <polygon points="40,28 42,24 44,28 46,24 48,28" fill="#ffffff" stroke="#0f172a" stroke-width="1"/>
          <circle cx="48" cy="20" r="2.5" fill="#facc15" stroke="#0f172a" stroke-width="1"/>
          <polygon points="20,44 14,38 24,36" fill="#1e293b" stroke="#0f172a" stroke-width="2"/>
          <polygon points="28,52 26,62 34,56" fill="#1e293b" stroke="#0f172a" stroke-width="2"/>
        </svg>`

      case 'freeze':
        return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" fill="#0284c7" stroke="#0f172a" stroke-width="2.5"/>
          <circle cx="32" cy="32" r="28" fill="#38bdf8" opacity="0.35"/>
          <polygon points="32,14 50,22 32,32 14,22" fill="#bae6fd" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round"/>
          <polygon points="14,22 32,32 32,52 14,40" fill="#38bdf8" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round"/>
          <polygon points="50,22 32,32 32,52 50,40" fill="#0284c7" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M20 25 L28 35 M36 36 L44 26" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
          <circle cx="44" cy="18" r="2" fill="#ffffff"/>
          <circle cx="20" cy="46" r="2" fill="#ffffff"/>
        </svg>`

      case 'oil':
        return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" fill="#ca8a04" stroke="#0f172a" stroke-width="2.5"/>
          <circle cx="32" cy="32" r="28" fill="#facc15" opacity="0.3"/>
          <ellipse cx="36" cy="48" rx="22" ry="9" fill="#0f172a" stroke="#000" stroke-width="2"/>
          <ellipse cx="38" cy="47" rx="14" ry="4" fill="#334155" opacity="0.7"/>
          <circle cx="46" cy="40" r="3" fill="#0f172a"/>
          <g transform="rotate(-35 24 30)">
            <rect x="14" y="16" width="22" height="28" rx="4" fill="#eab308" stroke="#0f172a" stroke-width="2.5"/>
            <line x1="14" y1="24" x2="36" y2="24" stroke="#0f172a" stroke-width="2"/>
            <line x1="14" y1="36" x2="36" y2="36" stroke="#0f172a" stroke-width="2"/>
            <circle cx="25" cy="30" r="4" fill="#0f172a"/>
            <polygon points="25,28 23,32 27,32" fill="#facc15"/>
          </g>
        </svg>`

      case 'magnet':
        return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" fill="#7c3aed" stroke="#0f172a" stroke-width="2.5"/>
          <circle cx="32" cy="32" r="28" fill="#a855f7" opacity="0.35"/>
          <path d="M18 42 L18 26 C 18 16, 46 16, 46 26 L46 42 L38 42 L38 28 C 38 23, 26 23, 26 28 L26 42 Z" fill="#ef4444" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round"/>
          <rect x="18" y="34" width="8" height="8" fill="#e2e8f0" stroke="#0f172a" stroke-width="2"/>
          <rect x="38" y="34" width="8" height="8" fill="#e2e8f0" stroke="#0f172a" stroke-width="2"/>
          <path d="M22 46 C 22 52, 42 52, 42 46" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-dasharray="3,3" stroke-linecap="round"/>
          <path d="M20 50 C 20 58, 44 58, 44 50" fill="none" stroke="#facc15" stroke-width="2" stroke-linecap="round"/>
        </svg>`

      case 'shockwave':
        return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" fill="#ea580c" stroke="#0f172a" stroke-width="2.5"/>
          <circle cx="32" cy="32" r="28" fill="#fb923c" opacity="0.35"/>
          <circle cx="32" cy="32" r="20" fill="none" stroke="#ffffff" stroke-width="3" stroke-dasharray="6,4" opacity="0.9"/>
          <circle cx="32" cy="32" r="14" fill="none" stroke="#facc15" stroke-width="3.5" stroke-dasharray="8,5"/>
          <circle cx="32" cy="32" r="7" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>
          <path d="M32 10 L34 18 M54 32 L46 34 M32 54 L30 46 M10 32 L18 30" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round"/>
        </svg>`

      case 'overdrive':
        return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" fill="#d97706" stroke="#0f172a" stroke-width="2.5"/>
          <circle cx="32" cy="32" r="28" fill="#f59e0b" opacity="0.4"/>
          <path d="M22 46 C 18 36, 26 24, 32 20 C 38 24, 46 36, 42 46 C 36 52, 28 52, 22 46 Z" fill="#00cfff" stroke="#0f172a" stroke-width="2.5"/>
          <path d="M26 44 C 24 38, 28 30, 32 26 C 36 30, 40 38, 38 44 Z" fill="#ffffff"/>
          <polygon points="34,8 20,32 30,32 26,56 46,26 34,26" fill="#facc15" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round"/>
        </svg>`
    }
  }

  // ── ROLETA DE ITENS CARTOON NO HUD (MARIO KART / RUMBLE STYLE) ──────
  private startRouletteSpin(awarded: RumblePowerup, label: string) {
    this.isRouletteSpinning = true
    this.rouletteTimer = 0.75
    this.rouletteTickTimer = 0
    this.rouletteTarget = awarded
    this.rouletteTargetLabel = label
    if (this.hudRumbleCard) {
      this.hudRumbleCard.style.display = 'flex'
      this.hudRumbleCard.style.borderColor = '#ffd23f'
      this.hudRumbleCard.style.boxShadow = '0 0 35px rgba(255, 210, 63, 0.95)'
    }
    if (this.hudRumbleHint) {
      this.hudRumbleHint.textContent = 'SORTEANDO PODER...'
    }
    const useBtn = document.getElementById('turbo-use-btn') as HTMLButtonElement | null
    if (useBtn) useBtn.style.display = 'none'
    const tBtn = document.getElementById('tt-use-powerup') as HTMLButtonElement | null
    if (tBtn) tBtn.style.display = 'none'
  }

  private updateRoulette(dt: number) {
    if (!this.isRouletteSpinning) return
    this.rouletteTimer -= dt
    this.rouletteTickTimer -= dt

    const icons: RumblePowerup[] = ['missile', 'freeze', 'oil', 'magnet', 'shockwave', 'punch', 'overdrive']

    if (this.rouletteTickTimer <= 0) {
      this.rouletteTickTimer = 0.075
      const randomPower = icons[Math.floor(Math.random() * icons.length)]
      if (this.hudRumbleIcon) this.hudRumbleIcon.innerHTML = this.getCartoonPowerupSVG(randomPower, 40)
      if (this.hudRumbleName) this.hudRumbleName.textContent = 'SORTEANDO...'
      this.audio.playRouletteTick()
    }

    if (this.rouletteTimer <= 0) {
      this.isRouletteSpinning = false
      this.rumblePowerup = this.rouletteTarget
      this.audio.playCoin()
      this.updateRumbleHUD()
      this.showItemAwardBanner(this.rouletteTarget, this.rouletteTargetLabel)
    }
  }

  // ── LAUNCH PADS CARTOON NA ARENA POWER-KICK ────────────────────────
  private buildLaunchPads() {
    this.launchPads = []
    if (this.theme !== 'classic' && this.gameMode !== 'rumble') return

    const padPositions = [
      { x: -FIELD_W * 0.35, z:  FIELD_L * 0.18, targetYaw: Math.PI },
      { x:  FIELD_W * 0.35, z:  FIELD_L * 0.18, targetYaw: Math.PI },
      { x: -FIELD_W * 0.35, z: -FIELD_L * 0.18, targetYaw: 0 },
      { x:  FIELD_W * 0.35, z: -FIELD_L * 0.18, targetYaw: 0 }
    ]

    for (const p of padPositions) {
      const g = new THREE.Group()
      g.position.set(p.x, 0.08, p.z)

      const baseGeo = new THREE.CylinderGeometry(4.2, 4.5, 0.25, 20)
      const baseMat = new THREE.MeshToonMaterial({ color: 0x1e293b, gradientMap: TOON_GRADIENT })
      const baseMesh = new THREE.Mesh(baseGeo, baseMat)
      g.add(baseMesh)

      const borderGeo = new THREE.CylinderGeometry(4.55, 4.85, 0.22, 20)
      const borderMat = new THREE.MeshBasicMaterial({ color: 0x070b16, side: THREE.BackSide })
      baseMesh.add(new THREE.Mesh(borderGeo, borderMat))

      const c = document.createElement('canvas')
      c.width = 256
      c.height = 256
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(128, 128, 122, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 14
      ctx.strokeStyle = '#facc15'
      ctx.stroke()

      ctx.fillStyle = '#facc15'
      ctx.beginPath()
      ctx.moveTo(128, 35)
      ctx.lineTo(210, 115)
      ctx.lineTo(170, 115)
      ctx.lineTo(128, 75)
      ctx.lineTo(86, 115)
      ctx.lineTo(46, 115)
      ctx.closePath()
      ctx.fill()

      ctx.beginPath()
      ctx.moveTo(128, 115)
      ctx.lineTo(210, 195)
      ctx.lineTo(170, 195)
      ctx.lineTo(128, 155)
      ctx.lineTo(86, 195)
      ctx.lineTo(46, 195)
      ctx.closePath()
      ctx.fill()

      const chevronTex = new THREE.CanvasTexture(c)
      const decalGeo = new THREE.PlaneGeometry(8.2, 8.2)
      const decalMat = new THREE.MeshBasicMaterial({
        map: chevronTex,
        transparent: true
      })
      const decal = new THREE.Mesh(decalGeo, decalMat)
      decal.rotation.x = -Math.PI / 2
      decal.rotation.z = p.targetYaw
      decal.position.y = 0.16
      g.add(decal)

      const light = new THREE.PointLight(0xfacc15, 2.0, 14)
      light.position.y = 0.9
      g.add(light)

      this.scene.add(g)
      this.launchPads.push({
        mesh: g,
        pos: new THREE.Vector3(p.x, 0, p.z),
        cooldown: 0
      })
    }
  }

  private updateLaunchPads(dt: number) {
    if (this.launchPads.length === 0) return
    for (const pad of this.launchPads) {
      if (pad.cooldown > 0) {
        pad.cooldown -= dt
        pad.mesh.scale.setScalar(0.92 + Math.max(0, pad.cooldown) * 0.04)
        continue
      }
      pad.mesh.scale.setScalar(1.0 + Math.sin(Date.now() * 0.005) * 0.04)

      for (const car of this.allCars) {
        if (!car.group.visible || car.isDemoed) continue
        const d = Math.hypot(car.pos.x - pad.pos.x, car.pos.z - pad.pos.z)
        if (d < 4.2) {
          pad.cooldown = 2.0
          this.audio.playLaunchPad()
          this.emitCartoonStarBurst(car.pos, 28, 0xfacc15)
          this.emitCartoonStarBurst(car.pos, 16, 0x00cfff)
          this.triggerCameraShake(0.85)

          // Impulso moderado e calibrado (sem exageros para não quebrar a física aérea)
          const boostSpd = 42
          car.velX += Math.sin(car.yaw) * boostSpd
          car.velZ += Math.cos(car.yaw) * boostSpd
          car.velY = Math.max(car.velY, 21.0)
          car.grounded = false
          car.boost = Math.min(100, car.boost + 30)
          if (car === this.playerCar) {
            this.showQuickChat('🚀 SUPER SALTO!')
          }
          break
        }
      }
    }
  }

  // ── FEIXE ELÉTRICO VISUAL DO SUPER ÍMÃ ─────────────────────────────
  private buildMagnetArc() {
    const pointsCount = 16
    const positions = new Float32Array(pointsCount * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      linewidth: 3,
      transparent: true,
      opacity: 0.95
    })
    const line = new THREE.Line(geo, mat)
    line.visible = false
    this.scene.add(line)
    this.magnetArcLine = line
    this.magnetArcGeometry = geo
  }

  private updateMagnetArc() {
    if (!this.magnetArcLine || !this.magnetArcGeometry) return
    const isMagnetActive = this.rumbleActive?.type === 'magnet'

    if (isMagnetActive) {
      this.magnetArcLine.visible = true
      const p1 = this.playerCar.pos.clone().add(new THREE.Vector3(0, 1.2, 0))
      const p2 = this.ball.pos.clone().add(new THREE.Vector3(0, 1.3, 0))
      const count = 16
      const attr = this.magnetArcGeometry.attributes.position as THREE.BufferAttribute
      const arr = attr.array as Float32Array

      for (let i = 0; i < count; i++) {
        const t = i / (count - 1)
        const cur = p1.clone().lerp(p2, t)
        if (i > 0 && i < count - 1) {
          const jitterAmount = Math.min(2.0, p1.distanceTo(p2) * 0.08)
          cur.x += (Math.random() - 0.5) * jitterAmount
          cur.y += (Math.random() - 0.5) * jitterAmount * 0.8
          cur.z += (Math.random() - 0.5) * jitterAmount
        }
        arr[i * 3]     = cur.x
        arr[i * 3 + 1] = cur.y
        arr[i * 3 + 2] = cur.z
      }
      attr.needsUpdate = true

      if (Math.random() < 0.22) {
        this.audio.playElectricZap()
      }
    } else {
      if (this.magnetArcLine.visible) {
        this.magnetArcLine.visible = false
      }
    }
  }

  // ── ALERTA DE MÍSSIL TELEGUIADO NO JOGADOR (RWR) ───────────────────
  private updateMissileAlert(dt: number) {
    let targeting = false
    let minDist = 999
    for (const m of this.activeMissiles) {
      if (m.target === this.playerCar && !this.playerCar.isDemoed) {
        targeting = true
        const d = m.pos.distanceTo(this.playerCar.pos)
        if (d < minDist) minDist = d
      }
    }

    if (targeting && minDist < 80) {
      this.missileLockAlertTimer -= dt
      if (this.missileLockAlertTimer <= 0) {
        this.audio.playLockOnAlert()
        this.missileLockAlertTimer = Math.max(0.12, (minDist / 80) * 0.38)
      }
      if (this.missileWarningHUD) {
        this.missileWarningHUD.style.display = 'block'
        this.missileWarningHUD.innerHTML = `🚨 <b>ALERTA DE MÍSSIL!</b> [${minDist.toFixed(0)}m]`
      }
    } else {
      if (this.missileWarningHUD && this.missileWarningHUD.style.display !== 'none') {
        this.missileWarningHUD.style.display = 'none'
      }
    }
  }

  private firePlayerMissile() {
    // Acha o adversário mais à frente
    let target: CarObject | null = null
    let closestDist = 180

    for (const opp of this.blueCars) {
      if (!opp.group.visible || opp.isDemoed) continue
      const d = this.playerCar.pos.distanceTo(opp.pos)
      if (d < closestDist) {
        closestDist = d
        target = opp
      }
    }

    const mGroup = new THREE.Group()

    // Corpo estilizado do míssil cartoon com ogiva e barbatana
    const bodyGeo = new THREE.CylinderGeometry(0.55, 0.65, 2.6, 16)
    const bodyMat = new THREE.MeshToonMaterial({ color: 0xef4444, gradientMap: TOON_GRADIENT })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.rotation.x = Math.PI / 2
    mGroup.add(body)

    const noseGeo = new THREE.ConeGeometry(0.55, 1.2, 16)
    const noseMat = new THREE.MeshToonMaterial({ color: 0xfacc15, gradientMap: TOON_GRADIENT })
    const nose = new THREE.Mesh(noseGeo, noseMat)
    nose.rotation.x = Math.PI / 2
    nose.position.z = 1.8
    mGroup.add(nose)

    // Barbatanas brancas cartoon cel-shading
    const finMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const finH = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.15, 0.8), finMat)
    finH.position.z = -0.8
    mGroup.add(finH)
    const finV = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.0, 0.8), finMat)
    finV.position.z = -0.8
    mGroup.add(finV)

    const pLight = new THREE.PointLight(0xff5500, 3, 14)
    mGroup.add(pLight)

    const spawnPos = this.playerCar.pos.clone().add(new THREE.Vector3(Math.sin(this.playerCar.yaw) * 4, 1.3, Math.cos(this.playerCar.yaw) * 4))
    mGroup.position.copy(spawnPos)
    this.scene.add(mGroup)

    const fwd = new THREE.Vector3(Math.sin(this.playerCar.yaw), 0, Math.cos(this.playerCar.yaw)).normalize().multiplyScalar(58)

    this.activeMissiles.push({
      group: mGroup,
      pos: spawnPos,
      vel: fwd,
      owner: this.playerCar,
      target,
      lifetime: 5.0
    })

    this.audio.playMissileLaunch()
    this.showQuickChat('🚀 MÍSSIL DISPARADO!')
  }

  private firePlayerFreeze() {
    const pGroup = new THREE.Group()

    // Cristal de gelo multifacetado com núcleo brilhante
    const iceGeo = new THREE.DodecahedronGeometry(1.4)
    const iceMat = new THREE.MeshToonMaterial({
      color: 0x38bdf8,
      gradientMap: TOON_GRADIENT,
      transparent: true,
      opacity: 0.88
    })
    pGroup.add(new THREE.Mesh(iceGeo, iceMat))

    const spikeGeo = new THREE.ConeGeometry(0.4, 2.4, 8)
    const spikeMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe })
    for (let s = 0; s < 4; s++) {
      const sp = new THREE.Mesh(spikeGeo, spikeMat)
      sp.rotation.z = (Math.PI / 2) * s
      pGroup.add(sp)
    }

    const pLight = new THREE.PointLight(0x38bdf8, 3, 12)
    pGroup.add(pLight)

    const spawnPos = this.playerCar.pos.clone().add(new THREE.Vector3(Math.sin(this.playerCar.yaw) * 4, 1.2, Math.cos(this.playerCar.yaw) * 4))
    pGroup.position.copy(spawnPos)
    this.scene.add(pGroup)

    const fwd = new THREE.Vector3(Math.sin(this.playerCar.yaw), 0, Math.cos(this.playerCar.yaw)).normalize().multiplyScalar(72)

    this.activeIceProjectiles.push({
      group: pGroup,
      pos: spawnPos,
      vel: fwd,
      owner: this.playerCar,
      lifetime: 3.5
    })

    this.audio.playDash()
    this.showQuickChat('🧊 RAIO DE GELO DISPARADO!')
  }

  private dropPlayerOil() {
    const oilGeo = new THREE.CircleGeometry(4.4, 24)
    const oilMat = new THREE.MeshBasicMaterial({ color: 0x090d16, side: THREE.DoubleSide })
    const oilMesh = new THREE.Mesh(oilGeo, oilMat)
    oilMesh.rotation.x = -Math.PI / 2

    // Bordas brilhantes de óleo iridescente cartoon
    const ringGeo = new THREE.RingGeometry(3.9, 4.4, 24)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xa855f7, side: THREE.DoubleSide })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    oilMesh.add(ring)

    // Solta a poça para TRÁS do carro (a uma distância segura de 10 metros na retaguarda)
    // Dessa forma, quem estiver perseguindo você derrapa imediatamente, e você NUNCA passa por cima dela ao acelerar!
    const forwardX = Math.sin(this.playerCar.yaw)
    const forwardZ = Math.cos(this.playerCar.yaw)
    const dropPos = this.playerCar.pos.clone().add(new THREE.Vector3(-forwardX * 10, 0.05, -forwardZ * 10))
    oilMesh.position.copy(dropPos)
    this.scene.add(oilMesh)

    // Efeito visual cartoon de óleo derramado na retaguarda
    this.emitCartoonStarBurst(this.playerCar.pos, 8, 0x111827)
    this.emitCartoonStarBurst(dropPos, 14, 0xa855f7)

    this.activeOilSlicks.push({
      mesh: oilMesh,
      pos: dropPos,
      owner: this.playerCar,
      lifetime: 20.0,
      armTimer: 0.1
    })

    this.audio.playDash()
    this.showQuickChat('🛢️ POÇA DE ÓLEO DEIXADA PARA TRÁS!')
  }

  private updateProjectilesAndTraps(dt: number) {
    // 1. MÍSSEIS TELEGUIDADOS
    for (let i = this.activeMissiles.length - 1; i >= 0; i--) {
      const m = this.activeMissiles[i]
      m.lifetime -= dt

      if (m.target && m.target.group.visible && !m.target.isDemoed) {
        const toTarget = m.target.pos.clone().add(new THREE.Vector3(0, 0.8, 0)).sub(m.pos)
        toTarget.normalize()
        m.vel.lerp(toTarget.multiplyScalar(66), dt * 5.0)
      }

      m.pos.addScaledVector(m.vel, dt)
      m.group.position.copy(m.pos)
      m.group.lookAt(m.pos.clone().add(m.vel))

      // Efeito de fumaça na cauda do míssil com faíscas laranjas
      if (Math.random() < 0.45) {
        this.emitCartoonStarBurst(m.pos, 2, 0xff7700)
      }

      // Colisão com carros rivais
      let hit = false
      for (let slot = 0; slot < this.allCars.length; slot++) {
        const c = this.allCars[slot]
        if (c === m.owner || !c.group.visible || c.isDemoed) continue
        if (c.pos.distanceTo(m.pos) < 4.2) {
          hit = true
          // EFEITO DEVASTADOR: Lançado aos ares + Spin-out de 2.2s + Explosão Web Audio
          c.applySpinOut(2.2)
          c.velY = 22
          c.grounded = false
          this.triggerShockwave(c.pos)
          this.audio.synthesizeBoom(160, 0.65, 1.0)
          this.triggerCameraShake(1.6)
          this.triggerImpactFlash(c.pos)
          this.emitCartoonStarBurst(c.pos, 32, 0xff2200)
          this.emitCartoonStarBurst(c.pos, 16, 0xfacc15)
          if (this.isOnline1v1 && this.turboNet?.isHost) {
            this.turboNet.broadcastCarHit(slot, 'spin')
          }
          break
        }
      }

      if (hit || m.lifetime <= 0) {
        this.emitCartoonStarBurst(m.pos, 24, 0xff3300)
        this.scene.remove(m.group)
        this.activeMissiles.splice(i, 1)
      }
    }

    // 2. PROJÉTEIS DE GELO
    for (let i = this.activeIceProjectiles.length - 1; i >= 0; i--) {
      const p = this.activeIceProjectiles[i]
      p.lifetime -= dt
      p.pos.addScaledVector(p.vel, dt)
      p.group.position.copy(p.pos)
      p.group.rotation.x += dt * 10
      p.group.rotation.y += dt * 10

      let hit = false
      for (let slot = 0; slot < this.allCars.length; slot++) {
        const c = this.allCars[slot]
        if (c === p.owner || !c.group.visible || c.isDemoed) continue
        if (c.pos.distanceTo(p.pos) < 3.8) {
          hit = true
          // CONGELAMENTO REAL E DEVASTADOR: 2.8s paralisado no cubo de gelo + som de congelamento
          c.applyFreeze(2.8)
          this.audio.playIceFreeze()
          this.triggerCameraShake(0.8)
          this.emitCartoonStarBurst(c.pos, 32, 0x38bdf8)
          this.emitCartoonStarBurst(c.pos, 16, 0xe0f2fe)
          if (this.isOnline1v1 && this.turboNet?.isHost) {
            this.turboNet.broadcastCarHit(slot, 'freeze')
          }
          break
        }
      }

      if (hit || p.lifetime <= 0) {
        this.emitCartoonStarBurst(p.pos, 16, 0x38bdf8)
        this.scene.remove(p.group)
        this.activeIceProjectiles.splice(i, 1)
      }
    }

    // 3. MANCHAS DE ÓLEO
    for (let i = this.activeOilSlicks.length - 1; i >= 0; i--) {
      const o = this.activeOilSlicks[i]
      o.lifetime -= dt
      o.armTimer -= dt

      if (o.armTimer <= 0) {
        for (let slot = 0; slot < this.allCars.length; slot++) {
          const c = this.allCars[slot]
          if (!c.group.visible || c.isDemoed) continue
          // O dono que soltou a poça não cai nela imediatamente nos primeiros 2.5 segundos
          if (c === o.owner && o.lifetime > 17.5) continue

          const d = Math.hypot(c.pos.x - o.pos.x, c.pos.z - o.pos.z)
          if (d < 4.4) {
            // Efeito de derrapagem desgovernada
            c.applySpinOut(1.8)
            this.audio.playDash()
            this.audio.synthesizeBoom(110, 0.3, 0.6)
            this.emitTireSmoke(c, true)
            this.emitCartoonStarBurst(c.pos, 16, 0xa855f7)
            if (this.isOnline1v1 && this.turboNet?.isHost) {
              this.turboNet.broadcastCarHit(slot, 'spin')
            }
            this.scene.remove(o.mesh)
            this.activeOilSlicks.splice(i, 1)
            break
          }
        }
      }

      if (o.lifetime <= 0 && this.activeOilSlicks.includes(o)) {
        this.scene.remove(o.mesh)
        this.activeOilSlicks.splice(i, 1)
      }
    }

    // 4. SUPER SOCO CARTOON COM MOLA 3D (HAYMAKER PROJECTILE COM HOMING E MOLA ESPIRAL)
    for (let i = this.activePunches.length - 1; i >= 0; i--) {
      const p = this.activePunches[i]
      p.lifetime -= dt
      const step = p.speed * dt
      p.distTraveled += step

      // Homing suave em direção ao alvo travado (bola ou rival)
      if (p.target) {
        const targetPos = p.target === 'ball'
          ? this.ball.pos.clone().add(new THREE.Vector3(0, 1.0, 0))
          : (p.target.group.visible && !p.target.isDemoed ? p.target.pos.clone().add(new THREE.Vector3(0, 1.0, 0)) : null)
        if (targetPos) {
          const toTgt = targetPos.sub(p.group.position).normalize()
          p.dir.lerp(toTgt, dt * 5.5).normalize()
        }
      }

      // Estica a mola do carro até a luva
      const currentPos = p.origin.clone().addScaledVector(p.dir, p.distTraveled)
      p.group.position.copy(currentPos)
      p.group.lookAt(currentPos.clone().add(p.dir))

      // Distribui os anéis da mola sanfonada 3D cartoon entre o carro e a luva
      for (let c = 0; c < p.springCoils.length; c++) {
        const t = (c + 1) / (p.springCoils.length + 1)
        p.springCoils[c].position.z = -t * p.distTraveled
        p.springCoils[c].rotation.z = c * 0.5 + p.distTraveled * 0.25
      }

      // Animação de rotação cartoon e efeito de rastro
      p.gloveMesh.rotation.z += 6 * dt
      if (Math.random() < 0.4) {
        this.emitCartoonStarBurst(currentPos, 2, 0xfacc15)
      }

      let hit = false

      // A) Atinge a Bola
      const dBall = currentPos.distanceTo(this.ball.pos)
      if (dBall < 4.6) {
        hit = true
        // Porrada violenta na bola em direção ao gol
        this.ball.vel.copy(p.dir.clone().multiplyScalar(76))
        this.ball.vel.y = Math.max(18, this.ball.vel.y + 12)
        this.audio.playPunchImpact()
        this.triggerCameraShake(1.5)
        this.triggerImpactFlash(this.ball.pos)
        this.emitCartoonStarBurst(this.ball.pos, 36, 0xff3300)
        this.emitCartoonStarBurst(currentPos, 20, 0xfacc15)
        this.showQuickChat('🥊 SOCO DEVASTADOR NA BOLA!')
      }

      // B) Atinge Carros Adversários
      if (!hit) {
        for (let slot = 0; slot < this.allCars.length; slot++) {
          const c = this.allCars[slot]
          if (c === p.owner || !c.group.visible || c.isDemoed) continue
          if (currentPos.distanceTo(c.pos) < 4.4) {
            hit = true
            // Nocaute no rival: arremessado para o alto e gira desgovernado
            c.applySpinOut(2.5)
            c.velX = p.dir.x * 64
            c.velZ = p.dir.z * 64
            c.velY = 24
            c.grounded = false
            this.audio.playPunchImpact()
            this.triggerCameraShake(1.6)
            this.triggerImpactFlash(c.pos)
            this.emitCartoonStarBurst(c.pos, 40, 0xff2200)
            this.emitCartoonStarBurst(c.pos, 20, 0xfacc15)
            if (this.isOnline1v1 && this.turboNet?.isHost) {
              this.turboNet.broadcastCarHit(slot, 'spin')
            }
            this.showQuickChat('🥊 NOCAUTE NO RIVAL!')
            break
          }
        }
      }

      if (hit || p.distTraveled >= p.maxDist || p.lifetime <= 0) {
        this.scene.remove(p.group)
        this.activePunches.splice(i, 1)
      }
    }
  }

  /** Dispara a luva de boxe gigante cartoon com mola espiral 3D e mira teleguiada em 60m */
  private fireSpringPunch(owner: CarObject) {
    const pGroup = new THREE.Group()

    // 1. Luva de boxe vermelha cartoon gigante
    const gloveMat = new THREE.MeshToonMaterial({
      color: 0xef4444,
      gradientMap: TOON_GRADIENT
    })
    const gloveBody = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 20), gloveMat)
    gloveBody.scale.set(1.2, 1.35, 1.55)

    // Contorno preto cel-shading expressivo na luva
    const gloveOut = new THREE.Mesh(
      new THREE.SphereGeometry(2.32, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0x070b16, side: THREE.BackSide })
    )
    gloveOut.scale.set(1.2, 1.35, 1.55)
    gloveBody.add(gloveOut)

    // Polegar da luva
    const thumbMat = new THREE.MeshToonMaterial({ color: 0xdc2626, gradientMap: TOON_GRADIENT })
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 14), thumbMat)
    thumb.position.set(1.5, 0.45, 0.35)
    gloveBody.add(thumb)

    // Punho branco da luva
    const cuffMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.75, 20), cuffMat)
    cuff.rotation.x = Math.PI / 2
    cuff.position.z = -1.4
    gloveBody.add(cuff)

    pGroup.add(gloveBody)

    // 2. Mola espiral sanfonada amarela cartoon (anéis 3D entre o carro e a luva)
    const springCoils: THREE.Mesh[] = []
    const springMat = new THREE.MeshToonMaterial({
      color: 0xfacc15,
      gradientMap: TOON_GRADIENT
    })
    const coilCount = 9
    for (let c = 0; c < coilCount; c++) {
      const ringGeo = new THREE.TorusGeometry(0.85, 0.18, 8, 16)
      const ringMesh = new THREE.Mesh(ringGeo, springMat)
      pGroup.add(ringMesh)
      springCoils.push(ringMesh)
    }

    const fwdX = Math.sin(owner.yaw)
    const fwdZ = Math.cos(owner.yaw)
    let dir = new THREE.Vector3(fwdX, 0, fwdZ).normalize()

    // Busca alvo mais próximo à frente (bola ou rival em até 60m)
    let bestTarget: CarObject | 'ball' | null = null
    let minDist = 60.0

    // Checa a bola
    const toBall = this.ball.pos.clone().sub(owner.pos)
    const dBall = toBall.length()
    if (dBall < minDist) {
      toBall.normalize()
      if (toBall.dot(dir) > 0.42) {
        bestTarget = 'ball'
        minDist = dBall
        dir.copy(toBall)
      }
    }

    // Checa rivais à frente
    for (const rival of this.allCars) {
      if (rival === owner || !rival.group.visible || rival.isDemoed) continue
      if (this.orangeCars.includes(owner) && this.orangeCars.includes(rival)) continue
      if (this.blueCars.includes(owner) && this.blueCars.includes(rival)) continue

      const toRival = rival.pos.clone().sub(owner.pos)
      const dRival = toRival.length()
      if (dRival < minDist) {
        toRival.normalize()
        if (toRival.dot(new THREE.Vector3(fwdX, 0, fwdZ)) > 0.40) {
          bestTarget = rival
          minDist = dRival
          dir.copy(toRival)
        }
      }
    }

    const origin = owner.pos.clone().add(new THREE.Vector3(fwdX * 2.2, 1.2, fwdZ * 2.2))
    pGroup.position.copy(origin)
    pGroup.lookAt(origin.clone().add(dir))

    this.scene.add(pGroup)

    this.activePunches.push({
      group: pGroup,
      gloveMesh: gloveBody,
      springCoils,
      owner,
      origin: origin.clone(),
      dir,
      target: bestTarget,
      distTraveled: 0,
      maxDist: 60.0, // Alcance épico de 60 metros!
      speed: 46.0,   // Velocidade calibrada de 46 m/s (dura ~1.3s - perfeitamente visível!)
      lifetime: 2.0
    })

    this.audio.playPunchImpact()
    this.showQuickChat('🥊 SUPER SOCO DISPARADO!')
  }

  // ── OBSTÁCULOS DINÂMICOS 3D (BARRIS & CONES COM TAMANHO REAL E SEM AFUNDAR) ─────
  private buildObstacles3D() {
    this.dynamicObstacles = []

    const addBarrel = (x: number, z: number) => {
      const g = new THREE.Group()
      const barrelH = 3.4
      const bellyR = 1.65
      const rimR = 1.28

      g.position.set(x, barrelH / 2, z)

      const woodMat = new THREE.MeshToonMaterial({
        color: 0xd97706, // Madeira/óleo rústico cartoon
        gradientMap: TOON_GRADIENT
      })
      const ironMat = new THREE.MeshToonMaterial({
        color: 0x1e293b, // Aro de ferro escuro
        gradientMap: TOON_GRADIENT
      })
      const capMat = new THREE.MeshToonMaterial({
        color: 0xb45309,
        gradientMap: TOON_GRADIENT
      })

      // Formato clássico abaulado de barril real (mais largo no centro)
      const topHalf = new THREE.Mesh(new THREE.CylinderGeometry(rimR, bellyR, barrelH / 2, 24), woodMat)
      topHalf.position.y = barrelH / 4
      topHalf.castShadow = true
      g.add(topHalf)

      const btmHalf = new THREE.Mesh(new THREE.CylinderGeometry(bellyR, rimR, barrelH / 2, 24), woodMat)
      btmHalf.position.y = -barrelH / 4
      btmHalf.castShadow = true
      g.add(btmHalf)

      // Tampas superior e inferior
      const topCap = new THREE.Mesh(new THREE.CylinderGeometry(rimR - 0.05, rimR - 0.05, 0.12, 24), capMat)
      topCap.position.y = barrelH / 2
      g.add(topCap)

      // 4 Aros de ferro clássicos de reforço com relevo
      const ringOffsets = [barrelH * 0.42, barrelH * 0.14, -barrelH * 0.14, -barrelH * 0.42]
      const ringRadii   = [rimR + 0.06, bellyR + 0.05, bellyR + 0.05, rimR + 0.06]
      for (let i = 0; i < ringOffsets.length; i++) {
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(ringRadii[i], ringRadii[i], 0.22, 24), ironMat)
        rim.position.y = ringOffsets[i]
        g.add(rim)
      }

      this.scene.add(g)
      this.dynamicObstacles.push({
        group: g,
        pos: new THREE.Vector3(x, barrelH / 2, z),
        vel: new THREE.Vector3(0, 0, 0),
        rot: new THREE.Euler(0, Math.random() * Math.PI, 0),
        rotVel: new THREE.Vector3(0, 0, 0),
        radius: bellyR,
        height: barrelH,
        type: 'barrel',
        selfRightTimer: 0
      })
    }

    const addCone = (x: number, z: number) => {
      const g = new THREE.Group()
      const coneH = 3.2
      const coneBaseR = 1.2
      g.position.set(x, coneH / 2, z)

      const coneMat = new THREE.MeshToonMaterial({
        color: 0xff5500, // Laranja fluorescente de trânsito
        gradientMap: TOON_GRADIENT
      })
      const whiteMat = new THREE.MeshToonMaterial({
        color: 0xffffff,
        gradientMap: TOON_GRADIENT
      })
      const baseMat = new THREE.MeshToonMaterial({
        color: 0x0f172a, // Base pesada de borracha preta
        gradientMap: TOON_GRADIENT
      })

      // Base quadrada pesada
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.32, 2.7), baseMat)
      base.position.y = -coneH / 2 + 0.16
      base.castShadow = true
      g.add(base)

      // Corpo cônico robusto
      const cone = new THREE.Mesh(new THREE.ConeGeometry(coneBaseR, coneH, 24), coneMat)
      cone.position.y = 0.1
      cone.castShadow = true
      g.add(cone)

      // Faixas refletivas brancas duplas
      const stripe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.65, 24), whiteMat)
      stripe1.position.y = 0.25
      g.add(stripe1)

      const stripe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.02, 0.55, 24), whiteMat)
      stripe2.position.y = -0.65
      g.add(stripe2)

      this.scene.add(g)
      this.dynamicObstacles.push({
        group: g,
        pos: new THREE.Vector3(x, coneH / 2, z),
        vel: new THREE.Vector3(0, 0, 0),
        rot: new THREE.Euler(0, Math.random() * Math.PI, 0),
        rotVel: new THREE.Vector3(0, 0, 0),
        radius: 1.45,
        height: coneH,
        type: 'cone',
        selfRightTimer: 0
      })
    }

    // Barris e Cones maiores posicionados na arena
    addBarrel(-28, 0)
    addBarrel(28, 0)
    addBarrel(-22, 50)
    addBarrel(22, -50)

    addCone(-35, 35)
    addCone(35, 35)
    addCone(-35, -35)
    addCone(35, -35)
  }

  private updateDynamicObstacles(dt: number) {
    const halfW = FIELD_W / 2 - 2.0
    const halfL = FIELD_L / 2 - 2.0

    for (const obs of this.dynamicObstacles) {
      // Gravidade
      obs.vel.y -= GRAVITY * dt
      obs.pos.addScaledVector(obs.vel, dt)

      // Trava de Solo Dinâmica: Calcula altura real mesmo quando inclinado/tombado para NUNCA afundar na grama!
      const tilt = Math.min(1.0, Math.hypot(Math.sin(obs.rot.x), Math.sin(obs.rot.z)))
      const effectiveGroundY = (obs.height / 2) * (1 - tilt) + obs.radius * tilt + 0.08

      if (obs.pos.y <= effectiveGroundY) {
        obs.pos.y = effectiveGroundY
        obs.vel.y = -obs.vel.y * 0.35 // Quique elástico
        if (Math.abs(obs.vel.y) < 0.25) obs.vel.y = 0
        // Atrito forte no solo
        obs.vel.x *= Math.pow(0.84, dt * 60)
        obs.vel.z *= Math.pow(0.84, dt * 60)
      }
      obs.pos.y = Math.max(effectiveGroundY, obs.pos.y) // Trava absoluta contra afundamento

      // Rotação física e tombamento
      obs.rot.x += obs.rotVel.x * dt
      obs.rot.y += obs.rotVel.y * dt
      obs.rot.z += obs.rotVel.z * dt
      obs.rotVel.multiplyScalar(0.92)

      // Auto-reerguimento gradual ("João-bobo" cartoon após tombar)
      const isTilted = Math.abs(obs.rot.x) > 0.25 || Math.abs(obs.rot.z) > 0.25
      if (isTilted && obs.pos.y <= effectiveGroundY + 0.15 && obs.vel.length() < 1.2) {
        obs.selfRightTimer += dt
        if (obs.selfRightTimer > 2.0) {
          obs.rot.x *= Math.pow(0.85, dt * 60)
          obs.rot.z *= Math.pow(0.85, dt * 60)
          obs.rotVel.x *= 0.8
          obs.rotVel.z *= 0.8
          if (Math.abs(obs.rot.x) < 0.04 && Math.abs(obs.rot.z) < 0.04) {
            obs.rot.x = 0
            obs.rot.z = 0
            obs.selfRightTimer = 0
          }
        }
      } else {
        obs.selfRightTimer = 0
      }

      // Limites nas paredes da arena
      if (Math.abs(obs.pos.x) > halfW) {
        obs.pos.x = Math.sign(obs.pos.x) * halfW
        obs.vel.x = -obs.vel.x * 0.6
      }
      if (Math.abs(obs.pos.z) > halfL) {
        obs.pos.z = Math.sign(obs.pos.z) * halfL
        obs.vel.z = -obs.vel.z * 0.6
      }

      // Sincroniza malha 3D
      obs.group.position.copy(obs.pos)
      obs.group.rotation.copy(obs.rot)

      // Colisão Dinâmica com Carro do Jogador
      this.checkObstacleCar(obs, this.playerCar)
      // Colisão Dinâmica com Carro do Bot
      this.checkObstacleCar(obs, this.botCar)
      // Colisão Dinâmica com a Bola
      this.checkObstacleBall(obs)
    }
  }

  private checkObstacleCar(obs: any, car: CarObject) {
    const dx = obs.pos.x - car.pos.x
    const dz = obs.pos.z - car.pos.z
    const dist = Math.hypot(dx, dz)
    const minDist = 2.4 + obs.radius

    if (dist < minDist && dist > 0.001) {
      const nx = dx / dist
      const nz = dz / dist
      const impactSpeed = Math.abs(car.speed) * 45 + 5

      // O obstáculo é arremessado com força proporcional ao carro!
      obs.vel.x = nx * impactSpeed + Math.sin(car.yaw) * car.speed * 20
      obs.vel.z = nz * impactSpeed + Math.cos(car.yaw) * car.speed * 20
      obs.vel.y = Math.min(18, impactSpeed * 0.45 + 3.5) // Voa no ar!
      obs.rotVel.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 16)

      // O carro é desacelerado pelo impacto
      car.speed *= 0.65
      this.audio.playPowerHit()
      this.triggerImpactFlash(obs.pos)
    }
  }

  private checkObstacleBall(obs: any) {
    const b = this.ball
    const dx = obs.pos.x - b.pos.x
    const dz = obs.pos.z - b.pos.z
    const dist = Math.hypot(dx, dz)
    const minDist = BALL_R + obs.radius

    if (dist < minDist && dist > 0.001 && Math.abs(b.pos.y - obs.pos.y) < obs.height + BALL_R) {
      const nx = dx / dist
      const nz = dz / dist
      const overlap = minDist - dist

      // Separação geométrica imediata
      b.pos.x -= nx * overlap * 0.5
      b.pos.z -= nz * overlap * 0.5
      obs.pos.x += nx * overlap * 0.5
      obs.pos.z += nz * overlap * 0.5

      // A bola ricocheteia no obstáculo, desviando de direção!
      const dot = b.vel.x * nx + b.vel.z * nz
      if (dot > 0) {
        b.vel.x -= 1.85 * dot * nx
        b.vel.z -= 1.85 * dot * nz
        b.vel.y = Math.max(b.vel.y, 4.5)
      } else {
        b.vel.x = -nx * Math.max(12, b.vel.length() * 0.8)
        b.vel.z = -nz * Math.max(12, b.vel.length() * 0.8)
        b.vel.y = Math.max(b.vel.y, 4.5)
      }

      // O obstáculo é arremessado pelo impacto da bola!
      const ballSpd = b.vel.length()
      const pushForce = Math.min(22, ballSpd * 0.75 + 8)
      obs.vel.x += nx * pushForce
      obs.vel.z += nz * pushForce
      obs.vel.y = Math.min(14, pushForce * 0.5 + 2.5)
      obs.rotVel.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 14)

      this.audio.playHit()
      this.triggerImpactFlash(b.pos)
      this.emitCartoonStarBurst(b.pos, 8, 0xffa500)
    }
  }
private resolveCarCarCollision() {
    const limX = FIELD_W / 2 - 2.8
    const limZ = FIELD_L / 2 - 2.8
    const cars = this.allCars
    const minDist = 4.8

    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i]
        const b = cars[j]
        if (a.isDemoed || b.isDemoed) continue
        if (Math.abs(a.pos.y - b.pos.y) > 2.2) continue

        const dx = b.pos.x - a.pos.x
        const dz = b.pos.z - a.pos.z
        const dist = Math.hypot(dx, dz)
        if (dist <= 0.0001 || dist >= minDist) continue

        const nx = dx / dist
        const nz = dz / dist
        const overlap = (minDist - dist) / 2

        a.pos.x -= nx * overlap
        a.pos.z -= nz * overlap
        b.pos.x += nx * overlap
        b.pos.z += nz * overlap

        const vAx = Math.sin(a.yaw) * a.speed + (a.velX || 0) * 0.02
        const vAz = Math.cos(a.yaw) * a.speed + (a.velZ || 0) * 0.02
        const vBx = Math.sin(b.yaw) * b.speed + (b.velX || 0) * 0.02
        const vBz = Math.cos(b.yaw) * b.speed + (b.velZ || 0) * 0.02
        const approach = (vAx - vBx) * nx + (vAz - vBz) * nz
        const speedA = Math.hypot(vAx, vAz)
        const speedB = Math.hypot(vBx, vBz)

        if (approach > 0.35 && this.carHitCooldown <= 0) {
          this.carHitCooldown = 0.3
          const mx = (a.pos.x + b.pos.x) / 2
          const mz = (a.pos.z + b.pos.z) / 2
          const my = Math.max(a.pos.y, b.pos.y) + 1.0
          const hitPt = new THREE.Vector3(mx, my, mz)
          this.triggerImpactFlash(hitPt)
          this.emitCartoonStarBurst(hitPt, 14, 0xffd23f)

          // ── SOM ESPACIAL 3D EM CAMADAS PELO IMPACTO CARRO-CARRO ──
          const impactCarSpeed = approach
          this.audio.playCollisionTiered(impactCarSpeed * 30, hitPt.x, hitPt.y, hitPt.z)
          if (impactCarSpeed > 1.5) {
            this.audio.playDemo()
            this.triggerCameraShake(1.0)
            this.emitCartoonStarBurst(hitPt, 18, 0xff3300)
          } else if (impactCarSpeed > 0.75) {
            this.triggerCameraShake(0.45)
          } else {
            this.triggerCameraShake(0.2)
          }

          this.emitTireSmoke(a)
          this.emitTireSmoke(b)

          // Demo only allowed: player car (a===playerCar) demolishing blue team OR blue demolishing player
          const isAPlayer = a === this.playerCar
          const isBPlayer = b === this.playerCar
          const aIsOrange = this.orangeCars.includes(a)
          const bIsOrange = this.orangeCars.includes(b)

          if (isAPlayer && this.playerBoosting && speedA > 0.95 && !bIsOrange && !b.isDemoed) {
            this.triggerDemo('bot')
            this.showQuickChat('💥 DEMOLIÇÃO!')
          } else if (isBPlayer && this.playerBoosting && speedB > 0.95 && !aIsOrange && !a.isDemoed) {
            this.triggerDemo('bot')
            this.showQuickChat('💥 DEMOLIÇÃO!')
          } else if (!aIsOrange && bIsOrange && b.boost > 0 && speedB > 0.95 && !a.isDemoed) {
            if (a === this.playerCar) {
              this.triggerDemo('player')
              this.showQuickChat('💥 DESTRUÍDO PELO RIVAL!')
            }
          } else if (!bIsOrange && aIsOrange && a.boost > 0 && speedA > 0.95 && !b.isDemoed) {
            if (b === this.playerCar) {
              this.triggerDemo('player')
              this.showQuickChat('💥 DESTRUÍDO PELO RIVAL!')
            }
          }
        }

        a.speed *= 0.72
        b.speed *= 0.72

        // Titan Shift pushBonus: se o carro do jogador é 'a' ou 'b', aplica força extra de empurrão
        if (approach > 0.1) {
          const isAPlayer = a === this.playerCar
          const isBPlayer = b === this.playerCar
          if ((isAPlayer || isBPlayer) && this.carAttrs.pushBonus > 1.0) {
            const extra = (this.carAttrs.pushBonus - 1.0) * approach * 2.0
            if (isAPlayer) {
              b.velX = (b.velX || 0) + nx * extra * 50
              b.velZ = (b.velZ || 0) + nz * extra * 50
              b.speed *= 0.85
            } else {
              a.velX = (a.velX || 0) - nx * extra * 50
              a.velZ = (a.velZ || 0) - nz * extra * 50
              a.speed *= 0.85
            }
          }
        }

        a.pos.x = Math.max(-limX, Math.min(limX, a.pos.x))
        a.pos.z = Math.max(-limZ, Math.min(limZ, a.pos.z))
        b.pos.x = Math.max(-limX, Math.min(limX, b.pos.x))
        b.pos.z = Math.max(-limZ, Math.min(limZ, b.pos.z))

        a.applyTransform()
        b.applyTransform()
      }
    }
  }

  // ── SISTEMA DE DEMO (EXPLOSÃO CARTOON & RESPAWN) ──
  private triggerDemo(target: 'player' | 'bot') {
    const car = target === 'player' ? this.playerCar : this.botCar
    if (car.isDemoed) return
    car.isDemoed = true
    car.speed    = 0
    car.velY     = 0
    car.velX     = 0
    car.velZ     = 0

    // Emite nuvem de fumaça cartoon, estrelas explosivas e flash
    for (let i = 0; i < 12; i++) this.emitTireSmoke(car)
    this.emitCartoonStarBurst(car.pos.clone().setY(1.2), 26, 0xff3300)
    this.emitCartoonStarBurst(car.pos.clone().setY(1.2), 16, 0xffd23f)
    this.triggerImpactFlash(car.pos.clone().setY(1.2))
    this.triggerCameraShake(0.75)
    this.audio.playPowerHit()

    // Esconde o carro
    car.group.visible = false

    // Inicia timer de respawn
    if (target === 'player') {
      this.demoRespawnTimer = 2.5
    } else {
      this.botDemoRespawnTimer = 2.5
    }
  }

  // Atualiza timers de respawn pós-demo
  private updateDemoRespawn(dt: number) {
    if (this.demoRespawnTimer > 0) {
      this.demoRespawnTimer -= dt
      if (this.demoRespawnTimer <= 0) {
        this.demoRespawnTimer = 0
        const pc = this.playerCar
        pc.isDemoed   = false
        pc.group.visible = true
        // Reposiciona no próprio campo a ~15m do gol
        pc.pos.set(0, 0, FIELD_L / 4)
        pc.yaw        = Math.PI
        pc.speed      = 0
        pc.velY       = 0
        pc.velX       = 0
        pc.velZ       = 0
        pc.grounded   = true
        pc.jumpCount  = 0
        pc.aerialPitch = 0
        pc.aerialRoll  = 0
        pc.applyTransform()
      }
    }
    if (this.botDemoRespawnTimer > 0) {
      this.botDemoRespawnTimer -= dt
      if (this.botDemoRespawnTimer <= 0) {
        this.botDemoRespawnTimer = 0
        const bc = this.botCar
        bc.isDemoed   = false
        bc.group.visible = true
        bc.pos.set(0, 0, -FIELD_L / 4)
        bc.yaw        = 0
        bc.speed      = 0
        bc.velY       = 0
        bc.velX       = 0
        bc.velZ       = 0
        bc.grounded   = true
        bc.jumpCount  = 0
        bc.aerialPitch = 0
        bc.aerialRoll  = 0
        bc.applyTransform()
      }
    }
    // Extra bots: auto-respawn after 3s
    for (const car of this.allCars) {
      if (car === this.playerCar || car === this.botCar) continue
      if (car.isDemoed) {
        const isBlue = this.blueCars.includes(car)
        car.isDemoed = false
        car.group.visible = true
        car.pos.set((Math.random() - 0.5) * FIELD_W * 0.5, 0, isBlue ? -FIELD_L / 4 : FIELD_L / 4)
        car.yaw = isBlue ? 0 : Math.PI
        car.speed = 0; car.velY = 0; car.velX = 0; car.velZ = 0
        car.grounded = true; car.jumpCount = 0
        car.aerialPitch = 0; car.aerialRoll = 0
        car.applyTransform()
      }
    }
  }


  //  ONLINE 1v1 — MÉTODOS DE INTEGRAÇÃO DE REDE

  /**
   * Executado a cada frame quando isOnline1v1 === true e !matchEnded.
   *   Host  → consome input do cliente, roda física do próprio carro e,
   *            como o cliente mandou o input, usa-o para o botCar (slot remoto).
   *   Client → envia input numerado; aplica predição local no playerCar;
   *            o botCar é atualizado via snapshot (applyRemoteCarFromSnapshot).
   */
  private updateOnlineFrame(dt: number) {
    if (!this.turboNet) return

    if (this.turboNet.isHost) {
      // 1. Física do carro local do Host (playerCar — orange)
      this.updatePlayerInput(dt)

      // 2. Aplica fila de inputs do cliente remoto no botCar (blue) em ordem estrita
      const pendingInputs = this.turboNet.consumePendingClientInputsOnHost(4)
      if (pendingInputs.length > 0) {
        const subDt = dt / pendingInputs.length
        for (const input of pendingInputs) {
          this.applyRemoteInputToCar(this.botCar, input, subDt)
        }
        // Correção suave de desvio cumulativo usando debugPos seguro (sem teletransporte)
        const latest = pendingInputs[pendingInputs.length - 1]
        if (latest.debugPos) {
          this.reconcileRemoteCarPos(this.botCar, latest.debugPos)
        }
      } else {
        // Sem input do cliente: mantém botCar desacelerando suavemente
        this.botCar.speed *= 0.92
        this.applyCarPhysics(this.botCar, dt)
      }
    } else {
      // Cliente: lê inputs locais, envia numerado, aplica predição local
      this.updatePlayerInputAndSendOnline(dt)
      // Predição física local da colisão com a bola (evita atravessar a bola antes do snapshot)
      this.checkCarBallCollision(this.playerCar)
      // botCar é atualizado via snapshot em applyRemoteCarFromSnapshot (chamado em updateHUD)
    }
  }

  /**
   * Host: Corrige desvios microscópicos cumulativos entre o botCar no Host e a posição do Cliente.
   * Não permite teletransporte, valida limites da arena e aplica lerp suave apenas se a distância for moderada.
   */
  private reconcileRemoteCarPos(car: CarObject, targetPos: { x: number; y: number; z: number }) {
    if (!Number.isFinite(targetPos.x) || !Number.isFinite(targetPos.y) || !Number.isFinite(targetPos.z)) return

    const limX = FIELD_W / 2 - 2.8
    const limZ = FIELD_L / 2 - 2.8

    // Rejeita coordenadas fora dos limites da arena
    if (Math.abs(targetPos.x) > limX || Math.abs(targetPos.z) > limZ || targetPos.y < 0 || targetPos.y > CEIL_H) {
      return
    }

    const dx = targetPos.x - car.pos.x
    const dy = targetPos.y - car.pos.y
    const dz = targetPos.z - car.pos.z
    const dist = Math.hypot(dx, dy, dz)

    // Rejeita discrepâncias anômalas (> 4m) para evitar trapaça ou teleportes bruscos
    if (dist > 4.0) return

    // Se houver um pequeno drift acumulado (entre 0.12m e 3.0m), aplica micro-lerp suave (8% por frame)
    if (dist > 0.12) {
      const blend = 0.08
      car.pos.x += dx * blend
      car.pos.y += dy * blend
      car.pos.z += dz * blend
      car.applyTransform()
    }
  }

  /**
   * Cliente: lê o input local, aplica ao playerCar (predição) e envia ao Host.
   */
  private updatePlayerInputAndSendOnline(dt: number) {
    const gp = this.gamepad.getState()
    const pc = this.playerCar
    if (pc.isDemoed) return

    if (gp.connected) {
      if (gp.rb && !this.prevRb) {
        this.activatePlayerRumble()
      }
      this.prevRb = gp.rb
    }

    // Coleta inputs do frame
    let throttle = 0
    if (gp.connected) {
      if (gp.rtThrottle > 0.1)  throttle =  gp.rtThrottle
      else if (gp.ltBrake > 0.1) throttle = -gp.ltBrake
    } else {
      if (this.keys['KeyW'] || this.keys['ArrowUp'])    throttle += 1
      if (this.keys['KeyS'] || this.keys['ArrowDown'])  throttle -= 1
      throttle += this.touch.throttle
      throttle = Math.max(-1, Math.min(1, throttle))
    }

    let steer = 0
    if (gp.connected) {
      if (Math.abs(gp.steerX) > 0.15) steer = gp.steerX
    } else {
      if (this.keys['KeyA'] || this.keys['ArrowLeft'])  steer -= 1
      if (this.keys['KeyD'] || this.keys['ArrowRight']) steer += 1
      steer += this.touch.steer
      steer = Math.max(-1, Math.min(1, steer))
    }

    const boostBtn = gp.connected && gp.boost
    const boostKey = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touch.boost
    const isBoosting = (boostBtn || boostKey) && pc.boost > 0

    const jump = this.keys['Space'] || this.touch.jump || (gp.connected && gp.jump) || false
    const drift = this.keys['KeyF'] || this.touch.drift || (gp.connected && gp.handbrake) || false

    // Envia input numerado ao Host
    this.turboNet!.sendClientInput(
      steer, throttle, 0, 0, jump, isBoosting, drift,
      { x: pc.pos.x, y: pc.pos.y, z: pc.pos.z }
    )

    // Predição local: aplica o mesmo input ao playerCar
    this.applyRemoteInputToCar(pc, {
      steer, throttle,
      jump, boost: isBoosting, drift
    }, dt)

    this.playerBoosting = isBoosting
  }

  /**
   * Aplica um TurboInputPacket diretamente a um CarObject (usado pelo Host para o botCar
   * e pelo Cliente para predição local do playerCar).
   */
  private applyRemoteInputToCar(
    car: CarObject,
    input: { steer: number; throttle: number; boost: boolean; jump: boolean; drift: boolean },
    dt: number
  ) {
    // Virar
    if (input.steer !== 0) {
      const turnMult = car.drifting ? 2.1 : car.speed < -0.1 ? -1 : 1
      car.yaw -= input.steer * this.studioParams.turnRate * turnMult * dt
      car.steerFront(-input.steer * 0.45)
    } else {
      car.steerFront(0)
    }

    // Boost
    const isBoosting = input.boost && car.boost > 0
    if (isBoosting) {
      car.boost = Math.max(0, car.boost - 32 * dt)
      car.showFlame(true)
    } else {
      car.showFlame(false)
    }

    // Aceleração
    if (input.throttle !== 0) {
      const maxSpd = (isBoosting ? 1.75 : 1.25) * this.studioParams.playerSpeedMult
      car.speed = Math.max(-0.65, Math.min(maxSpd, car.speed + input.throttle * 2.2 * dt))
    } else {
      car.speed *= 0.94
    }

    // Drift
    if (input.drift && car.grounded && car.speed > 0.35) {
      car.drifting = true
    } else if (!input.drift && car.drifting) {
      car.drifting = false
      car.driftCharge = 0
    }

    // Pulo & Sustentação (1º pulo com momentum real e sustentação variável)
    if (input.jump && car.grounded && car.jumpCount === 0) {
      const fwdSpeed = car.speed * 50
      car.velX = Math.sin(car.yaw) * fwdSpeed
      car.velZ = Math.cos(car.yaw) * fwdSpeed
      car.velY = this.studioParams.jumpForce
      car.grounded = false
      car.jumpCount = 1
      car.jumpHoldTimer = 0.20
      this.audio.playDash()
      this.emitTireSmoke(car, true)
    } else if (input.jump && car.jumpHoldTimer > 0 && !car.grounded && car.jumpCount === 1) {
      car.velY += 30 * dt
      car.jumpHoldTimer -= dt
    } else if (input.jump && !car.grounded && car.jumpCount === 1) {
      // 2º pulo (pulo duplo calibrado)
      pc.velY = Math.max(pc.velY + this.studioParams.jumpForce * 0.85, this.studioParams.jumpForce * 1.15)
      car.jumpCount = 2
      this.audio.playDash()
    }

    // Nitro no ar (remoto / predição na direção do controle)
    if (isBoosting && !car.grounded) {
      let inputX = input.steer
      let inputZ = input.throttle
      if (Math.abs(inputX) < 0.15 && Math.abs(inputZ) < 0.15) {
        inputZ = 1.0
      }
      const fwdX = Math.sin(car.yaw), fwdZ = Math.cos(car.yaw)
      const rightX = Math.cos(car.yaw), rightZ = -Math.sin(car.yaw)
      let boostDirX = fwdX * inputZ + rightX * inputX
      let boostDirZ = fwdZ * inputZ + rightZ * inputX
      const dirLen = Math.hypot(boostDirX, boostDirZ) || 1
      boostDirX /= dirLen
      boostDirZ /= dirLen

      const nitroAirThrust = 68 * dt
      car.velX = (car.velX || 0) + boostDirX * nitroAirThrust
      car.velZ = (car.velZ || 0) + boostDirZ * nitroAirThrust

      const maxAirSpd = 50
      const curAirSpd = Math.hypot(car.velX, car.velZ)
      if (curAirSpd > maxAirSpd) {
        car.velX = (car.velX / curAirSpd) * maxAirSpd
        car.velZ = (car.velZ / curAirSpd) * maxAirSpd
      }
    }

    this.applyCarPhysics(car, dt)
  }

  /**
   * Cliente: aplica o snapshot mais recente do Host ao botCar (carro remoto).
   * Usa interpolação suave de posição/rotação para evitar teleports visíveis.
   */
  private applyRemoteCarFromSnapshot() {
    if (!this.turboNet || this.turboNet.isHost) return

    // Atualiza timer do Host pelo snapshot
    const snap = this.turboNet.getLatestServerSnapshot()
    if (snap) {
      // Sincroniza o timer (usa o valor do Host)
      this.matchTimer = snap.timeRemainingSec

      // Aplica posição/vel da bola do Host ao cliente (blend exponencial responsivo)
      const b = this.ball
      const sb = snap.ball
      const ballAlpha = 0.30   // blend responsivo: 30% do alvo por frame
      b.pos.x += (sb.x - b.pos.x) * ballAlpha
      b.pos.y += (sb.y - b.pos.y) * ballAlpha
      b.pos.z += (sb.z - b.pos.z) * ballAlpha
      b.vel.x += (sb.vx - b.vel.x) * ballAlpha
      b.vel.y += (sb.vy - b.vel.y) * ballAlpha
      b.vel.z += (sb.vz - b.vel.z) * ballAlpha

      // Scores do Host:
      // No Cliente: scorePlayer = scores.blue (o próprio jogador azul), scoreBot = scores.orange (Host laranja)
      this.scorePlayer = snap.scores.blue
      this.scoreBot    = snap.scores.orange
      this.updateScoreboardDisplay()
    }

    // Interpolação do carro remoto do Host (slot 0 = Laranja) no botCar do Cliente:
    const remoteSlot = 0  // Host é sempre slot 0 (Laranja)
    const interpolated = this.turboNet.getInterpolatedRemoteCar(remoteSlot)
    if (interpolated) {
      const bc = this.botCar
      // Blend exponencial de posição (evita snap, 25% do alvo por frame)
      const posAlpha = 0.25
      bc.pos.x += (interpolated.pos.x - bc.pos.x) * posAlpha
      bc.pos.y += (interpolated.pos.y - bc.pos.y) * posAlpha
      bc.pos.z += (interpolated.pos.z - bc.pos.z) * posAlpha
      // Rotações via lerp angular
      const lerpAngle = (a: number, b: number, t: number) => {
        let d = (b - a) % (Math.PI * 2)
        if (d >  Math.PI) d -= Math.PI * 2
        if (d < -Math.PI) d += Math.PI * 2
        return a + d * t
      }
      bc.yaw        = lerpAngle(bc.yaw, interpolated.yaw, 0.3)
      bc.pitch      = lerpAngle(bc.pitch, interpolated.pitch, 0.3)
      bc.rollAngle  = lerpAngle(bc.rollAngle, interpolated.rollAngle, 0.3)
      bc.applyTransform()
    }
  }

  /**
   * Cliente: aplica o valor de countdown enviado autoritativamente pelo Host.
   */
  private applyCountdownValue(currentSec: number) {
    const cdWrap = document.getElementById('turbo-countdown-overlay')
    if (!cdWrap) return

    if (currentSec <= 0) {
      this.hudCountdown.textContent = 'VAI! ⚽'
      this.hudCountdown.style.color = '#22c55e'
      this.audio.playCountdownGo()
      this.audio.startBGM()
      this.audio.startEngine()
      this.audio.startCrowd()
      this.kickoffCountdown = 0
      this.isKickoffActive = false
      setTimeout(() => {
        const wrap = document.getElementById('turbo-countdown-overlay')
        if (wrap) wrap.style.display = 'none'
      }, 600)
    } else {
      cdWrap.style.display = 'flex'
      this.isKickoffActive = true
      this.kickoffCountdown = currentSec + 0.5
      this.hudCountdown.textContent = String(currentSec)
      this.hudCountdown.style.color = currentSec === 3 ? '#ef4444' : currentSec === 2 ? '#f59e0b' : '#10b981'
      this.audio.playCountdown()
    }
    this.lastCountdownSec = currentSec
  }

  /**
   * Host: constrói e envia um snapshot completo ao cliente.
   */
  private broadcastOnlineSnapshot() {
    if (!this.turboNet || !this.turboNet.isHost) return

    const cars = this.allCars.map((c, i) => ({
      slot: i,
      x: c.pos.x, y: c.pos.y, z: c.pos.z,
      yaw: c.yaw, pitch: c.pitch, rollAngle: c.rollAngle,
      vx: c.velX, vy: c.velY, vz: c.velZ,
      boost: c.boost,
      isBoosting: c.boost < 95,
      isDemoed: c.isDemoed
    }))

    this.turboNet.broadcastSnapshot(
      this.matchTimer,
      { orange: this.scorePlayer, blue: this.scoreBot },
      {
        x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z,
        vx: this.ball.vel.x, vy: this.ball.vel.y, vz: this.ball.vel.z
      },
      cars
    )
  }

  /**
   * Exibe overlay de desconexão e retorna ao menu após 4 segundos.
   */
  private handleOnlineDisconnect() {
    if (this.onlineDisconnectShown || this.destroyed) return
    this.onlineDisconnectShown = true
    this.isRunning = false   // para o loop

    const isHost = this.turboNet?.isHost ?? false
    const disconnectMsg = isHost
      ? 'O adversário desconectou da partida.'
      : 'O host encerrou ou desconectou da partida.'

    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position:absolute;inset:0;background:rgba(0,0,0,0.88);display:flex;flex-direction:column;
      align-items:center;justify-content:center;z-index:999;
      font-family:'Luckiest Guy','Orbitron',sans-serif;
    `
    overlay.innerHTML = `
      <div style="font-size:22px;color:#ff2d78;letter-spacing:3px;text-shadow:0 2px 0 #000;">
        📡 CONEXÃO ENCERRADA
      </div>
      <div style="font-size:13px;margin-top:10px;color:rgba(255,255,255,0.65);font-family:monospace;letter-spacing:1px;">
        ${disconnectMsg}
      </div>
      <button
        style="margin-top:20px;padding:12px 28px;background:#ff2d78;border:none;
               color:#fff;font-family:'Luckiest Guy',cursive;font-size:14px;letter-spacing:2px;
               cursor:pointer;border-radius:10px;box-shadow:0 5px 0 #8b0032;"
        onclick="window.location.reload()">
        🏠 VOLTAR AO MENU
      </button>
    `
    this.container.appendChild(overlay)
    setTimeout(() => {
      if (!this.destroyed) this.onExit?.()
    }, 5000)
  }


  // ════════════════════════════════════════════════════════════════════════════════════════
  //  BOT IA COMPETITIVO — ARQUITETURA HFSM / ÁRVORE DE DECISÃO PROFISSIONAL (4 NÍVEIS)
  //  - Níveis: FÁCIL (easy), MÉDIO (medium), DIFÍCIL (hard), CAMPEÃO (expert)
  //  - Predição Balística da Bola com Física e Quiques
  //  - Distribuição Tática Dinâmica de Papéis (Atacante, Meio-Campo, Goleiro, Flanker)
  //  - Fim de Giros em Círculos: Desaceleração tática, alinhamento parado e marcha à ré
  //  - Prevenção Rigorosa de Gol Contra (Desvio para a lateral se houver risco de auto-gol)
  //  - Sabotagem com Poderes: Disparos letais de mísseis, gelo e super socos calculados
  // ════════════════════════════════════════════════════════════════════════════════════════

  private updateBotAI(dt: number) {
    // 1. Agrupa os carros ativos por equipe para distribuição dinâmica de papéis
    const blueActive = this.blueCars.filter(c => !c.isDemoed && (!this.isOnline1v1 || c !== this.botCar))
    const orangeActive = this.orangeCars.filter(c => !c.isDemoed && (c !== this.playerCar || this.spectatorMode))

    this.assignTeamRolesAndRun(blueActive, true, dt)
    this.assignTeamRolesAndRun(orangeActive, false, dt)
  }

  private assignTeamRolesAndRun(teamCars: CarObject[], isBlue: boolean, dt: number) {
    if (teamCars.length === 0) return

    const bp = this.ball.pos
    const bv = this.ball.vel
    const opponentGoalZ = isBlue ? FIELD_L / 2 : -FIELD_L / 2
    const ownGoalZ = isBlue ? -FIELD_L / 2 : FIELD_L / 2

    // Calibração do tempo de predição balística pelo nível de dificuldade
    const predTime = this.botLevel === 'easy' ? 0.16 : this.botLevel === 'medium' ? 0.38 : this.botLevel === 'hard' ? 0.65 : 0.90
    const predX = Math.max(-FIELD_W / 2 + 4, Math.min(FIELD_W / 2 - 4, bp.x + bv.x * predTime))
    const predZ = Math.max(-FIELD_L / 2 + 4, Math.min(FIELD_L / 2 - 4, bp.z + bv.z * predTime))
    const predY = Math.max(BALL_R, bp.y + bv.y * predTime - 0.5 * this.studioParams.gravity * predTime * predTime)

    // Avalia e classifica os membros da equipe pela melhor oportunidade de finalização
    const scoredCars = teamCars.map(c => {
      const dBall = Math.hypot(predX - c.pos.x, predZ - c.pos.z)
      // Bônus se o carro já estiver posicionado atrás da bola em relação ao gol adversário
      const isBehindBall = isBlue ? c.pos.z < predZ - 1.5 : c.pos.z > predZ + 1.5
      const alignmentBonus = isBehindBall ? -22 : 15
      return { car: c, score: dBall + alignmentBonus }
    })

    scoredCars.sort((a, b) => a.score - b.score)

    // Atribuição Dinâmica de Papéis
    // 0: Atacante Principal (Striker)
    // 1: Suporte / Rebote Ofensivo / Coletor de Poderes (Support)
    // 2: Goleiro / Último Homem de Defesa (Goalkeeper)
    // 3: Flanker / Sabotador Agressivo (Flanker)
    for (let i = 0; i < scoredCars.length; i++) {
      const { car } = scoredCars[i]
      const role = i === 0 ? 'striker' : i === 1 ? 'support' : i === 2 ? 'goalie' : 'flanker'
      this.runSingleBotHFSM(car, isBlue, role, dt, predX, predY, predZ, opponentGoalZ, ownGoalZ)
    }
  }

  private runSingleBotHFSM(
    bc: CarObject,
    isBlue: boolean,
    role: 'striker' | 'support' | 'goalie' | 'flanker',
    dt: number,
    predX: number,
    predY: number,
    predZ: number,
    opponentGoalZ: number,
    ownGoalZ: number
  ) {
    const bp = this.ball.pos
    const distBall = Math.hypot(bp.x - bc.pos.x, bp.z - bc.pos.z)
    const distPred = Math.hypot(predX - bc.pos.x, predZ - bc.pos.z)

    let botState = this.botRumbleStates.get(bc)
    if (!botState) {
      botState = { powerup: null, timer: 5.0, active: null }
      this.botRumbleStates.set(bc, botState)
    }

    // ── 1. USO TÁTICO E SABOTAGEM COM PODERES ─────────────────────────────
    if (botState.powerup && !botState.active) {
      const rivalCars = isBlue
        ? this.orangeCars.filter(c => !c.isDemoed)
        : this.blueCars.filter(c => !c.isDemoed)

      let nearestRival: CarObject | null = null
      let nearestRivalDist = 999
      for (const r of rivalCars) {
        const d = bc.pos.distanceTo(r.pos)
        if (d < nearestRivalDist) {
          nearestRivalDist = d
          nearestRival = r
        }
      }

      const distGoalOpponent = Math.abs(predZ - opponentGoalZ)

      if (botState.powerup === 'punch') {
        // Super Soco: aciona se estiver perto da bola para mandar um canhão a gol, ou para desarmar
        if (distBall < 18 || (distBall < 35 && distGoalOpponent < 65)) {
          this.activateBotRumble(bc, botState)
        }
      } else if (botState.powerup === 'missile') {
        // Míssil: dispara no rival se ele estiver à frente e a até 85m
        if (nearestRival && nearestRivalDist < 85) {
          this.activateBotRumble(bc, botState)
        }
      } else if (botState.powerup === 'freeze') {
        // Gelo: congela o rival se ele estiver com a bola ou em perigo
        if (nearestRival && nearestRivalDist < 65) {
          this.activateBotRumble(bc, botState)
        }
      } else if (botState.powerup === 'oil') {
        // Óleo: larga na traseira se um rival estiver perseguindo
        if (nearestRival && nearestRivalDist < 20) {
          this.activateBotRumble(bc, botState)
        }
      } else if (botState.powerup === 'magnet') {
        // Ímã: atrai a bola solta
        if (distBall > 16 && distBall < 45) {
          this.activateBotRumble(bc, botState)
        }
      } else if (botState.powerup === 'shockwave') {
        // Choque: afasta rivais da área
        if (distBall < 22 || nearestRivalDist < 18) {
          this.activateBotRumble(bc, botState)
        }
      } else if (botState.powerup === 'overdrive') {
        if (role === 'striker' || distBall > 30) {
          this.activateBotRumble(bc, botState)
        }
      }
    }

    // ── 2. DETERMINAÇÃO DE DESTINO (ÁRVORE DE COMPORTAMENTO) ──────────────
    let targetX = predX
    let targetZ = predZ
    let shouldBrakeAtTarget = false

    // Vetor bola -> gol adversário
    const toOppGoalX = 0 - predX
    const toOppGoalZ = opponentGoalZ - predZ
    const oppDist = Math.hypot(toOppGoalX, toOppGoalZ) || 1
    const normOppX = toOppGoalX / oppDist
    const normOppZ = toOppGoalZ / oppDist

    // PREVENÇÃO REAL DE GOL CONTRA:
    // Se o bot estiver entre a bola e o próprio gol, bater reto empurraria a bola para dentro da meta!
    const isDangerousOwnGoalAngle = isBlue
      ? (bc.pos.z > bp.z && bp.z < -FIELD_L * 0.25)
      : (bc.pos.z < bp.z && bp.z > FIELD_L * 0.25)

    if (isDangerousOwnGoalAngle && distBall < 25) {
      // Manobra de segurança: afasta-se na lateral para rebater a bola em diagonal para a parede lateral
      const safeSide = bc.pos.x >= 0 ? 1 : -1
      targetX = bp.x + safeSide * 14
      targetZ = bp.z - (isBlue ? 6 : -6)
    } else if (role === 'goalie') {
      // GOLEIRO / ÂNCORA DEFENSIVA:
      // Fica posicionado cobrindo o gol próprio. Se a bola invadir a área de risco (< 38m da baliza), sai e isola!
      const ballNearOurGoal = isBlue ? bp.z < -FIELD_L * 0.35 : bp.z > FIELD_L * 0.35
      if (ballNearOurGoal && Math.abs(bp.x) < GOAL_W) {
        // Sai do gol para dar o chutão de alívio para longe
        targetX = predX
        targetZ = predZ
      } else {
        // Cobre a linha da trave acompanhando o ângulo da bola
        const defZ = isBlue ? -FIELD_L * 0.44 : FIELD_L * 0.44
        targetX = Math.max(-GOAL_W * 0.42, Math.min(GOAL_W * 0.42, bp.x * 0.65))
        targetZ = defZ
        shouldBrakeAtTarget = true
      }
    } else if (role === 'support' || role === 'flanker') {
      // MEIO-CAMPO / APOIO OU FLANKER:
      // Se não tiver poder, prioriza pegar uma caixa ativa próxima
      let nearestBoxPos: THREE.Vector3 | null = null
      let nearestBoxDist = 48
      if (!botState.powerup && !botState.active) {
        for (const mb of this.mysteryBoxes) {
          if (!mb.active) continue
          const d = bc.pos.distanceTo(mb.pos)
          if (d < nearestBoxDist) {
            nearestBoxDist = d
            nearestBoxPos = mb.pos
          }
        }
      }

      if (nearestBoxPos) {
        targetX = nearestBoxPos.x
        targetZ = nearestBoxPos.z
      } else {
        // Posicionamento de contenção e rebote atrás do atacante
        const offsetZ = isBlue ? -32 : 32
        const offsetX = role === 'flanker' ? (bc.pos.x >= 0 ? 28 : -28) : 0
        targetX = Math.max(-FIELD_W * 0.38, Math.min(FIELD_W * 0.38, bp.x * 0.5 + offsetX))
        targetZ = Math.max(-FIELD_L * 0.38, Math.min(FIELD_L * 0.38, bp.z + offsetZ))
        shouldBrakeAtTarget = true
      }
    } else {
      // ATACANTE PRINCIPAL (STRIKER):
      // Ponto de armação de chute: posiciona-se exatamente atrás da bola alinhado com a baliza rival
      const strikeBehindX = predX - normOppX * 4.8
      const strikeBehindZ = predZ - normOppZ * 4.8
      const distBehind = Math.hypot(strikeBehindX - bc.pos.x, strikeBehindZ - bc.pos.z)

      const isWellPositionedBehind = isBlue ? bc.pos.z < predZ - 1.8 : bc.pos.z > predZ + 1.8

      if (!isWellPositionedBehind && distBall < 28) {
        // Contorno tático suave: circula pela lateral para ficar atrás da bola
        const sideSign = (bc.pos.x - predX) >= 0 ? 1 : -1
        targetX = predX + sideSign * 8.5
        targetZ = strikeBehindZ
      } else if (distBehind > 3.0) {
        targetX = strikeBehindX
        targetZ = strikeBehindZ
      } else {
        // Disparada fulminante para estufar as redes adversárias
        targetX = predX + normOppX * 2.5
        targetZ = predZ + normOppZ * 2.5
      }
    }

    // Limites de segurança da arena física
    targetX = Math.max(-FIELD_W / 2 + 3.5, Math.min(FIELD_W / 2 - 3.5, targetX))
    targetZ = Math.max(-FIELD_L / 2 + 3.5, Math.min(FIELD_L / 2 - 3.5, targetZ))

    // ── 3. NAVEGAÇÃO E ELIMINAÇÃO TOTAL DE GIROS EM CÍRCULOS ──────────────
    const dx = targetX - bc.pos.x
    const dz = targetZ - bc.pos.z
    const distTarget = Math.hypot(dx, dz)

    let targetYaw = Math.atan2(dx, dz)

    // Se o bot estiver no alvo de posicionamento tático (defesa ou apoio):
    // Desacelera para zero e gira o carro PARADO para encarar a bola (zero voltas em círculos!)
    if (shouldBrakeAtTarget && distTarget < 4.2) {
      bc.speed = Math.max(0, bc.speed - 2.5 * dt)
      if (bc.speed < 0.05) bc.speed = 0

      // Encarar a bola diretamente
      const toBallYaw = Math.atan2(bp.x - bc.pos.x, bp.z - bc.pos.z)
      let faceAngleDiff = toBallYaw - bc.yaw
      while (faceAngleDiff > Math.PI)  faceAngleDiff -= Math.PI * 2
      while (faceAngleDiff < -Math.PI) faceAngleDiff += Math.PI * 2
      bc.yaw += Math.max(-3.5 * dt, Math.min(3.5 * dt, faceAngleDiff * 3.5 * dt))
      bc.steerFront(0)
      this.applyCarPhysics(bc, dt)
      return
    }

    let angleDiff = targetYaw - bc.yaw
    while (angleDiff > Math.PI)  angleDiff -= Math.PI * 2
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2

    // Parâmetros calibrados para os 4 níveis de inteligência
    const turnGain = this.botLevel === 'easy' ? 3.0
      : this.botLevel === 'medium' ? 4.2
      : this.botLevel === 'hard' ? 5.4
      : 6.8 // expert / campeão

    const speedCap = this.botLevel === 'easy' ? 0.82
      : this.botLevel === 'medium' ? 0.98
      : this.botLevel === 'hard' ? 1.18
      : 1.30 // expert / campeão

    const accel = this.botLevel === 'easy' ? 1.6
      : this.botLevel === 'medium' ? 2.1
      : this.botLevel === 'hard' ? 2.7
      : 3.4

    // Manobra rápida de marcha à ré: se o alvo estiver a mais de 105° atrás e perto, dá ré em vez de dar uma volta inteira
    const isTargetBehind = Math.abs(angleDiff) > Math.PI * 0.60
    if (isTargetBehind && distTarget < 16 && Math.abs(bc.speed) < 0.4) {
      bc.speed = Math.max(-0.55, bc.speed - accel * dt)
      const reverseSteer = angleDiff > 0 ? 0.45 : -0.45
      bc.yaw -= reverseSteer * 2.2 * dt
      bc.steerFront(reverseSteer)
      this.applyCarPhysics(bc, dt)
      return
    }

    // Esterço e alinhamento do carro
    const maxTurnStep = (this.botLevel === 'expert' ? 5.2 : 4.0) * dt
    bc.yaw += Math.max(-maxTurnStep, Math.min(maxTurnStep, angleDiff * turnGain * dt))
    bc.steerFront(Math.max(-0.48, Math.min(0.48, angleDiff * 0.9)))

    const isLinedUp = Math.abs(angleDiff) < 0.40
    const striking = distBall < 7.0 && isLinedUp
    const baseSpeed = striking
      ? speedCap * 1.10
      : isLinedUp ? speedCap : speedCap * 0.60

    bc.speed = Math.max(-0.35, Math.min(baseSpeed, bc.speed + accel * dt))

    // ── 4. JOGADAS AÉREAS E FINALIZAÇÕES ACROBÁTICAS ───────────────────────
    const canAerial = this.botLevel !== 'easy'
    if (canAerial && predY > 2.2 && distBall < 9.5 && bc.grounded && isLinedUp) {
      const jumpImpulse = this.botLevel === 'expert' ? 17.5 : this.botLevel === 'hard' ? 15.5 : 13.5
      bc.velY = jumpImpulse
      bc.grounded = false

      // Acrobacia aérea / flip nos níveis avançados
      if (this.botLevel === 'expert' && distBall < 6.0) {
        bc.pitch = 0.5
        bc.rollAngle = 0.4
      }
    }

    this.applyCarPhysics(bc, dt)
  }




  private updateBall(dt: number) {
    const b = this.ball

    // Se a bola estiver agarrada na mão do Kong Gorak, acompanha a mão sem gravidade
    if (b.userData?.kongHeld) {
      b.vel.set(0, 0, 0)
      if (b.mesh) {
        b.mesh.getWorldPosition(b.pos)
      }
      b.shadow.position.set(b.pos.x, 0.04, b.pos.z)
      return
    }

    // Gravidade
    b.vel.y -= this.studioParams.gravity * dt

    // Arrasto aerodinâmico (Air Drag / Resistência do ar realista estilo Rocket League)
    // Permite que a bola desacelere suavemente de chutes super rápidos em vez de atravessar o campo descontrolada
    const airDrag = Math.pow(0.988, dt * 60)
    b.vel.x *= airDrag
    b.vel.z *= airDrag

    b.pos.addScaledVector(b.vel, dt)

    // Colisão com o solo & Atrito de rolamento no gramado
    if (b.pos.y <= BALL_R) {
      b.pos.y = BALL_R
      if (Math.abs(b.vel.y) > 0.4) {
        b.vel.y = -b.vel.y * Math.max(0.55, this.studioParams.ballBounce) // Quique elástico amortecido e realista
        // Squash no solo só ocorre em impacto forte (> 14 m/s)
        if (Math.abs(b.vel.y) > 14) {
          b.targetSquash.set(1.35, 0.65, 1.35)
          this.emitCartoonStarBurst(b.pos.clone().setY(0.2), 6, 0xffd23f)
        }
      } else {
        b.vel.y = 0
      }

      // Fricção no gramado (impede a bola de rolar infinitamente e entrar no gol sozinha)
      const baseFriction = this.gameMode === 'snowday' ? 0.995 : 0.978
      const grassFriction = Math.pow(baseFriction, dt * 60)
      b.vel.x *= grassFriction
      b.vel.z *= grassFriction
      if (Math.hypot(b.vel.x, b.vel.z) < 0.14) {
        b.vel.x = 0
        b.vel.z = 0
      }
    }

    if (b.pos.y >= CEIL_H - BALL_R) {
      b.pos.y = CEIL_H - BALL_R
      b.vel.y = -Math.abs(b.vel.y) * 0.7
      if (Math.abs(b.vel.y) > 14) {
        b.targetSquash.set(1.25, 0.75, 1.25)
      }
      this.emitCartoonStarBurst(b.pos, 4, 0x00cfff)
    }

    const wallX = FIELD_W / 2 - BALL_R
    if (Math.abs(b.pos.x) >= wallX) {
      b.pos.x = Math.sign(b.pos.x) * wallX
      b.vel.x = -b.vel.x * 0.75
      if (Math.abs(b.vel.x) > 14) {
        b.targetSquash.set(0.65, 1.25, 1.25)
      }
      this.audio.playWallBounce()
      this.emitCartoonStarBurst(b.pos, 6, 0xffaa00)
    }

    const wallZ = FIELD_L / 2 - BALL_R
    const inGoalW = Math.abs(b.pos.x) < GOAL_W / 2 - 0.5
    const inGoalH = b.pos.y < GOAL_H - 0.2

    // ── VALIDAÇÃO REAL DE GOL (SEM BLOQUEIOS ARTIFICIAIS) ──
    // Meta do Bot / Azul (z negativo): gol marcado pelo Jogador / Laranja
    if (b.pos.z <= -FIELD_L / 2 - BALL_R * 0.25 && inGoalW && inGoalH) {
      this.emitCartoonStarBurst(b.pos, 28, 0xffd23f)
      this.onGoalScored('player')
      return
    }

    // Meta do Jogador / Laranja (z positivo): gol marcado pelo Bot / Azul
    if (b.pos.z >= FIELD_L / 2 + BALL_R * 0.25 && inGoalW && inGoalH) {
      this.emitCartoonStarBurst(b.pos, 28, 0x00cfff)
      this.onGoalScored('bot')
      return
    }

    // Contenção da rede dentro da trave
    if (inGoalW && inGoalH) {
      const maxGoalZ = FIELD_L / 2 + GOAL_D - BALL_R
      if (Math.abs(b.pos.z) >= maxGoalZ) {
        b.pos.z = Math.sign(b.pos.z) * maxGoalZ
        b.vel.z = -b.vel.z * 0.25
      }
    } else if (Math.abs(b.pos.z) >= wallZ) {
      // Se bater na parede de fundo FORA da boca do gol: rebate!
      b.pos.z = Math.sign(b.pos.z) * wallZ
      b.vel.z = -b.vel.z * 0.75
      if (Math.abs(b.vel.z) > 14) {
        b.targetSquash.set(1.25, 1.25, 0.65)
      }
      this.audio.playWallBounce()
      this.emitCartoonStarBurst(b.pos, 6, 0xffaa00)
    }

    for (const car of this.allCars) {
      this.checkCarBallCollision(car)
    }

    b.mesh.position.copy(b.pos)
    const speed = b.vel.length()
    if (speed > 0.05) {
      const rotAngle = (speed / BALL_R) * dt
      b.rotAxis.set(-b.vel.z, 0, b.vel.x).normalize()
      const q = new THREE.Quaternion().setFromAxisAngle(b.rotAxis, rotAngle)
      b.mesh.quaternion.premultiply(q)
    }

    // ── SQUASH & STRETCH ELÁSTICO CARTOON (SÓ EM IMPACTOS PESADOS > 24 m/s) ──
    if (speed > 24) {
      const stretch = 1.0 + Math.min(0.35, ((speed - 24) / 32) * 0.35)
      const squash = 1.0 / Math.sqrt(stretch)
      b.targetSquash.lerp(new THREE.Vector3(squash, stretch, squash), 12 * dt)
    } else {
      b.targetSquash.lerp(new THREE.Vector3(1, 1, 1), 20 * dt)
    }
    b.squash.lerp(b.targetSquash, 25 * dt)
    b.mesh.scale.copy(b.squash)

    // ── RASTRO DE FITA VIBRANTE CARTOON DA BOLA (SPEED > 18 m/s) ──
    if (speed > 18) {
      this.emitBallRibbonSegment(this.lastBallTrailPos, b.pos, speed)
    }
    this.lastBallTrailPos.copy(b.pos)

    // Sombra Cartoon Projetada no Gramado (acompanha a deformação elástica)
    b.shadow.position.set(b.pos.x, 0.04, b.pos.z)
    const shadowScale = Math.max(0.4, 1.0 - (b.pos.y - BALL_R) / 18)
    b.shadow.scale.set(shadowScale * b.squash.x, shadowScale * b.squash.z, 1)
  }

  // ── COLISÃO DE ALTA PRECISÃO (OBB: BUMPER FRONTAL, TETO/DRIBBLE & FLICK) ──
  private checkCarBallCollision(car: CarObject) {
    if (car.isDemoed) return
    const b = this.ball
    const dx = b.pos.x - car.pos.x
    const dy = b.pos.y - (car.pos.y + 0.85)
    const dz = b.pos.z - car.pos.z

    // Coordenadas relativas locais do carro (rotacionadas pelo yaw)
    const cosY = Math.cos(-car.yaw)
    const sinY = Math.sin(-car.yaw)
    const localX = dx * cosY - dz * sinY
    const localZ = dx * sinY + dz * cosY

    // Dimensões do Hitbox OBB do Carro (padrão Octane/Dominus cartoon)
    const halfW = 1.35
    const halfL = 2.45
    const halfH = 0.88

    const cx = Math.max(-halfW, Math.min(halfW, localX))
    const cy = Math.max(-halfH, Math.min(halfH, dy))
    const cz = Math.max(-halfL, Math.min(halfL, localZ))

    const dist = Math.hypot(localX - cx, dy - cy, localZ - cz)
    const hitRadius = BALL_R

    if (dist < hitRadius) {
      this.lastToucher = this.orangeCars.includes(car) ? 'player' : 'bot'
      const lnx = dist > 0.001 ? (localX - cx) / dist : 0
      const lny = dist > 0.001 ? (dy - cy) / dist : 1
      const lnz = dist > 0.001 ? (localZ - cz) / dist : 1

      // Converte normal de volta ao espaço global
      const nx = lnx * cosY + lnz * sinY
      const ny = lny
      const nz = -lnx * sinY + lnz * cosY

      const overlap = hitRadius - dist
      b.pos.x += nx * overlap
      b.pos.y += ny * overlap
      b.pos.z += nz * overlap

      const carSpd = Math.hypot(car.speed, (car.velX || 0) * 0.02, (car.velZ || 0) * 0.02)
      const isFrontBumper = cz > 1.35 && Math.abs(cx) < 1.2
      const isRoof = cy > 0.52 && Math.abs(cz) < 1.95 && Math.abs(cx) < 1.15
      const isWheels = cy < -0.4

      if (isRoof) {
        // DRIBBLE / CARRY: a bola equilibra e rola suavemente no teto do carro
        if (car.flipTimer > 0) {
          // FLICK AÉREO: se der flip com a bola no teto, projeta a bola em altíssima velocidade!
          b.vel.x = Math.sin(car.yaw) * 38 + (car.flipDirX * 14)
          b.vel.z = Math.cos(car.yaw) * 38 + (car.flipDirZ * 14)
          b.vel.y = 19
          this.triggerCameraShake(0.65)
          this.audio.playPowerHit()
          this.triggerImpactFlash(b.pos)
        } else {
          // Dribble suave mantendo a bola estável em cima do carro
          b.vel.x = Math.sin(car.yaw) * carSpd * 40
          b.vel.z = Math.cos(car.yaw) * carSpd * 40
          b.vel.y = Math.max(0.5, b.vel.y * 0.25)
          this.audio.playDash()
        }
      } else if (isFrontBumper) {
        // POWER SHOT DO BUMPER FRONTAL (estilo Rocket League: velocidade equilibrada para gol e troca de passes)
        const powerF = 20 + carSpd * 26
        b.vel.x = Math.sin(car.yaw) * powerF + nx * 8
        b.vel.z = Math.cos(car.yaw) * powerF + nz * 8
        // Elevação controlada: a bola sobe para vencer o goleiro, mas não vai no teto
        const aerialLift = (!car.grounded || car.flipTimer > 0) ? 12.0 : 7.0
        b.vel.y = Math.max(aerialLift, 5.0 + carSpd * 8 + Math.max(0, ny) * 6)
        this.triggerCameraShake(0.45)
        // ── SOM ESPACIAL 3D EM CAMADAS PELO IMPACTO TOTAL CARRO-BOLA ──
        const impactSpeedBumper = b.vel.length() + carSpd
        this.audio.playCollisionTiered(impactSpeedBumper, b.pos.x, b.pos.y, b.pos.z)
        if (impactSpeedBumper > 55) {
          this.audio.playDemo()
          this.triggerCameraShake(1.0)
          this.emitCartoonStarBurst(b.pos, 18, 0xff3300)
        } else if (impactSpeedBumper > 28) {
          this.triggerCameraShake(0.4)
        }
        this.triggerImpactFlash(b.pos)
        this.emitCartoonStarBurst(b.pos, 14, 0xffd23f)
        b.targetSquash.set(1.48, 0.48, 1.48) // Compressão violenta no impacto
        this.gamepad.vibrate(200, 0.9, 0.7)
      } else if (isWheels) {
        // AMORTECIMENTO DAS RODAS (soft touch para controle)
        b.vel.x = nx * 10
        b.vel.z = nz * 10
        b.vel.y = Math.max(2.5, ny * 8)
      } else {
        // Colisão padrão lateral/traseira — também ganha elevação vertical
        const impF = 18 + carSpd * 22
        b.vel.x = nx * impF + Math.sin(car.yaw) * carSpd * 12
        b.vel.z = nz * impF + Math.cos(car.yaw) * carSpd * 12
        b.vel.y = Math.max(b.vel.y, 8.5 + carSpd * 12 + Math.max(0, ny) * 10)
        const impactSpeedLateral = b.vel.length() + carSpd
        this.audio.playCollisionTiered(impactSpeedLateral, b.pos.x, b.pos.y, b.pos.z)
        if (impactSpeedLateral > 55) {
          this.audio.playDemo()
          this.triggerCameraShake(1.0)
          this.emitCartoonStarBurst(b.pos, 18, 0xff3300)
        } else if (impactSpeedLateral > 28) {
          this.triggerCameraShake(0.4)
        } else {
          this.triggerCameraShake(0.25)
        }
      }

      // EFEITO DO SUPER SOCO / BOLA DE FOGO NO IMPACTO COM A BOLA
      const isPunchActive = (car === this.playerCar && this.rumbleActive?.type === 'punch') ||
        (this.botRumbleStates.get(car)?.active?.type === 'punch')
      if (isPunchActive) {
        b.vel.multiplyScalar(2.25)
        this.emitCartoonStarBurst(b.pos, 32, 0xff3300)
        this.triggerCameraShake(1.1)
        this.audio.playDemo()
        if (car === this.playerCar) {
          this.rumbleActive = null
          this.rumbleTimer = 10.0
          this.updateRumbleHUD()
        } else {
          const st = this.botRumbleStates.get(car)
          if (st) {
            st.active = null
            st.timer = 12.0
          }
        }
      }

      const maxBallSpeed = 52
      if (b.vel.length() > maxBallSpeed) {
        b.vel.setLength(maxBallSpeed)
      }
    }
  }




  private updateCamera(dt: number) {
    if (this.spectatorMode) {
      // CÂMERA DE TRANSMISSÃO TV AO VIVO: Acompanha a ação e a bola de forma cinematográfica
      this._camTargetPos.set(FIELD_W * 0.38, 22, this.ball.pos.z * 0.55)
      this._camTargetLook.copy(this.ball.pos)
      this._camTargetLook.y += 1.2
      this.camCurrentPos.lerp(this._camTargetPos, 4 * dt)
      this.camCurrentLook.lerp(this._camTargetLook, 7 * dt)
      this.camera.position.copy(this.camCurrentPos)
      this.camera.lookAt(this.camCurrentLook)
      return
    }

    const pc = this.playerCar

    if (this.isBallCam) {

      this._camToBall.set(this.ball.pos.x - pc.pos.x, 0, this.ball.pos.z - pc.pos.z)
      const ballDist = this._camToBall.length()
      if (ballDist > 0.5) {
        this._camDir.copy(this._camToBall).normalize().negate()
      } else {
        this._camDir.set(0, 0, -1)
      }

      const sinH = Math.sin(this.camOrbitH), cosH = Math.cos(this.camOrbitH)
      this._camOd.set(
        this._camDir.x * cosH - this._camDir.z * sinH,
        0,
        this._camDir.x * sinH + this._camDir.z * cosH
      )

      const CAM_DIST = this.studioParams.camDist
      const CAM_H    = this.studioParams.camH + this.camOrbitV * 4.0

      this._camTargetPos.set(
        pc.pos.x + this._camOd.x * CAM_DIST,
        pc.pos.y + CAM_H,
        pc.pos.z + this._camOd.z * CAM_DIST
      )

      if (ballDist < 8.0) {
        this._camTargetPos.y += (8.0 - ballDist) * 0.45
      }

      // Olha para um ponto ligeiramente acima do meio entre carro e bola
      this._camTargetLook.copy(pc.pos).lerp(this.ball.pos, 0.35)
      this._camTargetLook.y = Math.max(pc.pos.y + 1.8, this.ball.pos.y * 0.45 + 1.6)

    } else {

      const CAM_DIST = this.studioParams.camDist
      const CAM_H    = this.studioParams.camH + this.camOrbitV * 3.5

      const ya = pc.yaw + this.camOrbitH
      this._camTargetPos.set(
        pc.pos.x - Math.sin(ya) * CAM_DIST,
        pc.pos.y + CAM_H,
        pc.pos.z - Math.cos(ya) * CAM_DIST
      )

      this._camTargetLook.set(
        pc.pos.x + Math.sin(pc.yaw) * 6.5,
        pc.pos.y + 2.0,
        pc.pos.z + Math.cos(pc.yaw) * 6.5
      )
    }

    this._camTargetPos.y = Math.max(2.6, this._camTargetPos.y)

    this.camCurrentPos.lerp(this._camTargetPos, 12 * dt)
    this.camCurrentLook.lerp(this._camTargetLook, 14 * dt)

    this.camera.position.copy(this.camCurrentPos)
    if (this.camShakeIntensity > 0.01) {
      const sx = (Math.random() - 0.5) * 2 * this.camShakeIntensity
      const sy = (Math.random() - 0.5) * 2 * this.camShakeIntensity
      const sz = (Math.random() - 0.5) * 2 * this.camShakeIntensity
      this.camera.position.x += sx
      this.camera.position.y += sy
      this.camera.position.z += sz
      this.camShakeIntensity = Math.max(0, this.camShakeIntensity - this.camShakeIntensity * this.camShakeDecay * dt)
    }
    this.camera.lookAt(this.camCurrentLook)
  }





  public triggerCameraShake(intensity = 0.45) {
    this.camShakeIntensity = Math.min(1.2, this.camShakeIntensity + intensity)
    this.gamepad.vibrate(160, 0.7, 0.5)
  }

  public showQuickChat(msg: string) {
    const root = document.getElementById('turbo-hud-root')
    if (!root) return

    let chat = document.getElementById('turbo-quick-chat')
    if (!chat) {
      chat = document.createElement('div')
      chat.id = 'turbo-quick-chat'
      chat.style.position = 'absolute'
      chat.style.top = '78px'
      chat.style.left = '28px'
      chat.style.background = '#22345c'
      chat.style.border = '3px solid #141426'
      chat.style.borderRadius = '16px'
      chat.style.padding = '8px 18px'
      chat.style.fontFamily = "'Luckiest Guy', cursive"
      chat.style.fontSize = '16px'
      chat.style.color = '#ffd23f'
      chat.style.boxShadow = '0 6px 0 #141426'
      chat.style.zIndex = '120'
      chat.style.pointerEvents = 'none'
      chat.style.transition = 'opacity 0.25s, transform 0.25s'
      root.appendChild(chat)
    }

    chat.textContent = msg
    chat.style.opacity = '1'
    chat.style.transform = 'translateY(0)'

    if (this.quickChatTimer) clearTimeout(this.quickChatTimer)
    this.quickChatTimer = window.setTimeout(() => {
      if (chat) {
        chat.style.opacity = '0'
        chat.style.transform = 'translateY(-6px)'
      }
    }, 2400)
  }

  /** Banner grande animado exibido quando o jogador coleta um item de mystery box */
  private showItemAwardBanner(type: RumblePowerup, label: string) {
    const root = document.getElementById('turbo-hud-root')
    if (!root) return

    // Remove banner anterior se existir
    const old = document.getElementById('turbo-item-award-banner')
    if (old) old.remove()
    if ((this as any)._itemBannerTimer) clearTimeout((this as any)._itemBannerTimer)

    const colorMap: Record<RumblePowerup, string> = {
      missile:   '#ef4444',
      freeze:    '#38bdf8',
      oil:       '#a3e635',
      magnet:    '#a855f7',
      shockwave: '#f97316',
      punch:     '#fbbf24',
      overdrive: '#facc15'
    }
    const hintMap: Record<RumblePowerup, string> = {
      missile:   'Mira no adversário e destrói!',
      freeze:    'Congela o rival no lugar!',
      oil:       'Deixa rastro escorregadio!',
      magnet:    'Atrai a bola para você!',
      shockwave: 'Onda de choque devastadora!',
      punch:     'Soco potente na bola!',
      overdrive: 'Nitro infinito por 5s!'
    }

    const color = colorMap[type] || '#facc15'
    const hint  = hintMap[type]  || 'Pressione [R] ou [RB] para usar!'

    const banner = document.createElement('div')
    banner.id = 'turbo-item-award-banner'
    banner.style.cssText = `
      position:absolute;
      top:82px;left:24px;
      transform:translateX(-40px) scale(0.92);
      background:rgba(12,20,44,0.95);
      border:3px solid ${color};
      border-radius:20px;
      padding:12px 20px;
      display:flex;
      align-items:center;
      gap:14px;
      pointer-events:none;
      z-index:250;
      box-shadow:0 0 25px ${color}66, 0 6px 0 #141426;
      transition:transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s;
      opacity:0;
    `
    banner.innerHTML = `
      <div style="filter:drop-shadow(0 0 10px ${color});display:flex;align-items:center;justify-content:center;">${this.getCartoonPowerupSVG(type, 46)}</div>
      <div style="display:flex;flex-direction:column;text-align:left;">
        <div style="font-family:'Luckiest Guy',cursive;font-size:10px;letter-spacing:2px;color:rgba(255,255,255,0.6);">ITEM COLETADO!</div>
        <div style="font-family:'Luckiest Guy',cursive;font-size:16px;color:${color};letter-spacing:1px;line-height:1.2;">${label.replace(label.split(' ')[0] + ' ', '')}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.8);margin-top:2px;">${hint}</div>
        <div style="font-family:'Luckiest Guy',cursive;font-size:10px;color:#00ff88;margin-top:4px;letter-spacing:1px;">USE COM: [R] / [RB] / CLIQUE NO CARD</div>
      </div>
    `
    root.appendChild(banner)

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        banner.style.transform = 'translateX(0) scale(1)'
        banner.style.opacity = '1'
      })
    })

    // Fade out after 2.8s
    ;(this as any)._itemBannerTimer = setTimeout(() => {
      banner.style.transform = 'translateX(-25px) scale(0.95)'
      banner.style.opacity = '0'
      setTimeout(() => { try { banner.remove() } catch {} }, 280)
    }, 2800)
  }

  private onGoalScored(scorer: 'player' | 'bot') {
    if (this.goalCooldown > 0) return
    this.goalCooldown = 4.2

    const scoreBefore = scorer === 'player' ? this.scorePlayer : this.scoreBot

    // Detecta se foi GOL CONTRA (último toque foi da equipe defensora da meta invadida)
    const isOwnGoal = (scorer === 'bot' && this.lastToucher === 'player') ||
                      (scorer === 'player' && this.lastToucher === 'bot')

    if (scorer === 'player') {
      // Offline ou Host Online: incrementa placar do time local
      if (!this.isOnline1v1 || this.turboNet?.isHost) this.scorePlayer++
      this.updateScoreboardDisplay()

      if (isOwnGoal) {
        this.hudGoalTitle.textContent = '💥 GOL CONTRA DO ADVERSÁRIO!'
        this.hudGoalTitle.style.color = '#00ff88'
      } else {
        this.hudGoalTitle.textContent = this.isOnline1v1
          ? (this.turboNet?.isHost ? '🎉 GOL DO TIME LARANJA!' : '🎉 GOL DO TIME AZUL!')
          : '🎉 GOLAZO DO JOGADOR!'
        this.hudGoalTitle.style.color = '#ff6600'
      }
      this.audio.playGoal()
      this.audio.playVictory()
      this.audio.playCheer()
    } else {
      // Offline ou Host Online: incrementa placar do rival
      if (!this.isOnline1v1 || this.turboNet?.isHost) this.scoreBot++
      this.updateScoreboardDisplay()

      if (isOwnGoal) {
        this.hudGoalTitle.textContent = '🤦 GOL CONTRA!'
        this.hudGoalTitle.style.color = '#ef4444'
      } else {
        this.hudGoalTitle.textContent = this.isOnline1v1
          ? (this.turboNet?.isHost ? '🤖 GOL DO TIME AZUL!' : '🤖 GOL DO TIME LARANJA!')
          : '🤖 GOL DO BOT RIVAL!'
        this.hudGoalTitle.style.color = '#0088ff'
      }
      this.audio.playGoal()
      this.audio.playCheer()
    }

    // Log de diagnóstico temporário (disparado apenas 1 vez no momento do gol, nunca por frame)
    if (this.isOnline1v1) {
      console.log('[TurboGoalDebug]', {
        role: this.turboNet?.isHost ? 'host' : 'client',
        ballZ: Number(this.ball.pos.z.toFixed(2)),
        ballVelocityZ: Number(this.ball.vel.z.toFixed(2)),
        goalSide: this.ball.pos.z < 0 ? 'blue_goal' : 'orange_goal',
        scorer: scorer === 'player' ? (this.turboNet?.isHost ? 'orange' : 'blue') : (this.turboNet?.isHost ? 'blue' : 'orange'),
        scoreBefore,
        scoreAfter: scorer === 'player' ? this.scorePlayer : this.scoreBot
      })
    }

    // Online 1v1 Host: envia evento autoritativo de gol ao cliente
    if (this.isOnline1v1 && this.turboNet?.isHost) {
      const netScorer = scorer === 'player' ? 'orange' : 'blue'
      this.turboNet.sendGoalEvent(
        netScorer,
        { orange: this.scorePlayer, blue: this.scoreBot },
        { x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z }
      )
    }

    this.triggerGoalExplosion(this.ball.pos, this.goalExplosion, scorer)

    const sub = document.getElementById('turbo-goal-sub')!
    if (sub) {
      if (this.isOnline1v1) {
        sub.textContent = this.turboNet?.isHost
          ? `LARANJA ${this.scorePlayer} × ${this.scoreBot} AZUL`
          : `AZUL ${this.scorePlayer} × ${this.scoreBot} LARANJA`
      } else {
        sub.textContent = `${this.scorePlayer} × ${this.scoreBot}`
      }
    }

    const endActions = document.getElementById('turbo-end-actions')
    if (endActions) endActions.style.display = 'none'
    this.hudGoalBanner.style.pointerEvents = 'none'

    this.hudGoalBanner.style.display = 'flex'
    this.drawScoreboard()

    setTimeout(() => {
      if (this.destroyed) return
      this.hudGoalBanner.style.display = 'none'
      // Online 1v1 Host: envia reset ao cliente antes de replay
      if (this.isOnline1v1 && this.turboNet?.isHost) {
        this.turboNet.sendResetEvent()
      }
      this.startGoalReplay()
    }, 1800)
  }

  private triggerGoalExplosion(pos: THREE.Vector3, type: GoalExplosionType, scorer: 'player' | 'bot') {
    // 1. Shockwave empurrando todos os carros para longe do gol
    for (const car of this.allCars) {
      const d = car.pos.distanceTo(pos)
      if (d < 95 && d > 1) {
        const dir = car.pos.clone().sub(pos).normalize()
        const force = Math.max(0, (95 - d) / 95) * 52
        car.velX = (car.velX || 0) + dir.x * force
        car.velZ = (car.velZ || 0) + dir.z * force
        car.velY = (car.velY || 0) + 20 * (1 - d / 95)
        car.grounded = false
      }
    }

    // 2. Efeito visual temático da Goal Explosion
    if (type === 'supernova') {
      this.emitCartoonStarBurst(pos, 45, 0xa855f7)
      this.emitCartoonStarBurst(pos.clone().add(new THREE.Vector3(0, 4, 0)), 35, 0x06b6d4)
      this.triggerCameraShake(1.2)
      this.audio.playVictory()
      confetti({
        particleCount: 160,
        spread: 120,
        origin: { y: 0.5 },
        colors: ['#a855f7', '#06b6d4', '#ec4899', '#3b82f6', '#ffffff']
      })
    } else if (type === 'lightning') {
      this.emitCartoonStarBurst(pos, 35, 0x00e5ff)
      this.emitCartoonStarBurst(pos.clone().add(new THREE.Vector3(0, 6, 0)), 25, 0xffffff)
      this.triggerCameraShake(1.05)
      this.audio.playDemo()
      confetti({
        particleCount: 140,
        spread: 100,
        origin: { y: 0.5 },
        colors: ['#00e5ff', '#38bdf8', '#ffffff', '#ffd23f']
      })
    } else if (type === 'confetti') {
      this.emitCartoonStarBurst(pos, 28, 0x22c55e)
      this.triggerCameraShake(0.7)
      this.audio.playCheer()
      confetti({
        particleCount: 320,
        spread: 140,
        origin: { y: 0.45 },
        colors: ['#ff0055', '#00ff88', '#00cfff', '#ffd23f', '#ff6600', '#a855f7']
      })
    } else {
      // 'toon' clássico
      this.emitCartoonStarBurst(pos, 32, scorer === 'player' ? 0xffd23f : 0x00cfff)
      this.triggerCameraShake(0.85)
      confetti({
        particleCount: 140,
        spread: 95,
        origin: { y: 0.55 },
        colors: ['#ff5500', '#facc15', '#22c55e', '#38bdf8', '#ffffff']
      })
    }
  }

  private startGoalReplay() {
    if (this.replayTotalStored < 30) {
      this.resetKickoff()
      return
    }

    this.isReplaying = true
    this.replayPlaybackFrames = []
    const startIdx = this.replayTotalStored < TurboSoccerGame.MAX_REPLAY_FRAMES ? 0 : this.replayHead
    for (let i = 0; i < this.replayTotalStored; i++) {
      const idx = (startIdx + i) % TurboSoccerGame.MAX_REPLAY_FRAMES
      this.replayPlaybackFrames.push(this.replayRingBuffer[idx])
    }
    this.replayPlaybackIdx = 0

    if (this.hudReplayBanner) {
      this.hudReplayBanner.style.display = 'flex'
    }

    // Timeout de segurança longo (12s) para nunca cortar o replay no meio
    setTimeout(() => {
      if (this.isReplaying) {
        this.stopGoalReplay()
      }
    }, 12000)
  }

  public stopGoalReplay() {
    if (!this.isReplaying) return
    this.isReplaying = false
    if (this.hudReplayBanner) {
      this.hudReplayBanner.style.display = 'none'
    }
    this.resetKickoff()
  }

  private updateReplayPlayback(dt: number) {
    if (!this.isReplaying || this.replayPlaybackFrames.length === 0) return

    // Pular replay imediatamente se qualquer botão do controle estiver pressionado
    if (this.gamepad.isAnyButtonPressed()) {
      this.stopGoalReplay()
      return
    }

    // Câmera lenta dramática (Slow Motion 0.6x) nos últimos 25% da jogada quando a bola entra no gol
    const progress = this.replayPlaybackIdx / this.replayPlaybackFrames.length
    const isClimax = progress > 0.72
    const frameStep = isClimax ? Math.max(1, Math.round(dt * 30)) : Math.max(1, Math.round(dt * 60))

    this.replayPlaybackIdx += frameStep

    if (this.replayPlaybackIdx >= this.replayPlaybackFrames.length) {
      this.stopGoalReplay()
      return
    }

    const frame = this.replayPlaybackFrames[this.replayPlaybackIdx]
    if (!frame) return

    this.ball.pos.copy(frame.ballPos)
    this.ball.mesh.position.copy(frame.ballPos)
    this.ball.mesh.rotation.copy(frame.ballRot)

    for (let i = 0; i < this.allCars.length && i < frame.cars.length; i++) {
      const c = this.allCars[i]
      const cf = frame.cars[i]
      c.pos.copy(cf.pos)
      c.yaw = cf.yaw
      c.pitch = cf.pitch
      c.rollAngle = cf.roll
      c.applyTransform()
    }

    // Câmera Dinâmica de Transmissão de TV (Broadcast Arena Angle)
    // Ângulo elevado cinematográfico que acompanha a jogada com naturalidade sem distorcer os modelos
    const camSide = frame.ballPos.x >= 0 ? 1 : -1
    const targetCamX = frame.ballPos.x * 0.35 + (camSide * 38)
    const targetCamY = 15.5 + Math.max(0, frame.ballPos.y * 0.4)
    const targetCamZ = frame.ballPos.z * 0.65 - 20 * (frame.ballPos.z >= 0 ? 1 : -1)

    this._camReplayTarget.set(targetCamX, targetCamY, targetCamZ)
    this.camera.position.lerp(this._camReplayTarget, 0.08)
    this.camera.lookAt(frame.ballPos)
  }

  public activatePlayerRumble() {
    if (!this.rumblePowerup || this.rumbleActive) return
    const p = this.rumblePowerup
    this.rumblePowerup = null

    if (p === 'missile') {
      this.firePlayerMissile()
      this.updateRumbleHUD()
      return
    }

    if (p === 'freeze') {
      this.firePlayerFreeze()
      this.updateRumbleHUD()
      return
    }

    if (p === 'oil') {
      this.dropPlayerOil()
      this.updateRumbleHUD()
      return
    }

    if (p === 'shockwave') {
      this.triggerShockwave(this.playerCar.pos)
      this.rumbleTimer = 10.0
      this.updateRumbleHUD()
      this.showQuickChat('💨 ONDA DE CHOQUE!')
      return
    }

    if (p === 'magnet') {
      this.rumbleActive = { type: 'magnet', timeLeft: 6.0 }
      this.audio.playCheer()
      this.showQuickChat('🧲 SUPER ÍMÃ ATIVADO!')
    } else if (p === 'punch') {
      // Disparo do Super Soco / Haymaker Cartoon com Mola 3D e Luva
      this.fireSpringPunch(this.playerCar)
    } else if (p === 'overdrive') {
      // Nova Forge shieldBonus: aumenta duração do overdrive/escudo
      this.rumbleActive = { type: 'overdrive', timeLeft: 5.0 + this.carAttrs.shieldBonus }
      this.audio.playVictory()
      this.showQuickChat('⚡ NITRO OVERDRIVE!')
    }
    this.updateRumbleHUD()
  }

  private activateBotRumble(bot: CarObject, st: { powerup: RumblePowerup | null; timer: number; active: { type: RumblePowerup; timeLeft: number } | null }) {
    if (!st.powerup || st.active) return
    const p = st.powerup
    st.powerup = null

    // Seleciona o alvo adversário mais próximo (se for azul mira nos laranjas/jogador; se for laranja mira nos azuis)
    const isBlue = this.blueCars.includes(bot)
    const rivalCars = isBlue ? this.orangeCars.filter(c => !c.isDemoed) : this.blueCars.filter(c => !c.isDemoed)
    let bestTarget: CarObject = isBlue ? this.playerCar : (this.blueCars[0] || this.playerCar)
    let minD = 999
    for (const r of rivalCars) {
      const d = bot.pos.distanceTo(r.pos)
      if (d < minD) {
        minD = d
        bestTarget = r
      }
    }

    if (p === 'missile') {
      const mGroup = new THREE.Group()
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.8, 2.4, 12),
        new THREE.MeshToonMaterial({ color: 0x38bdf8, gradientMap: TOON_GRADIENT })
      )
      cone.rotation.x = Math.PI / 2
      mGroup.add(cone)
      const pLight = new THREE.PointLight(0x00cfff, 2, 8)
      mGroup.add(pLight)
      const spawnPos = bot.pos.clone().add(new THREE.Vector3(Math.sin(bot.yaw) * 4, 1.2, Math.cos(bot.yaw) * 4))
      mGroup.position.copy(spawnPos)
      this.scene.add(mGroup)
      const fwd = new THREE.Vector3(Math.sin(bot.yaw), 0, Math.cos(bot.yaw)).normalize().multiplyScalar(55)
      this.activeMissiles.push({
        group: mGroup,
        pos: spawnPos,
        vel: fwd,
        owner: bot,
        target: bestTarget,
        lifetime: 4.5
      })
      this.showQuickChat('🤖 BOT DISPAROU MÍSSIL!')
      return
    }

    if (p === 'freeze') {
      const pGroup = new THREE.Group()
      const iceGeo = new THREE.DodecahedronGeometry(1.2)
      const iceMat = new THREE.MeshToonMaterial({ color: 0x38bdf8, gradientMap: TOON_GRADIENT })
      pGroup.add(new THREE.Mesh(iceGeo, iceMat))
      const spawnPos = bot.pos.clone().add(new THREE.Vector3(Math.sin(bot.yaw) * 4, 1.2, Math.cos(bot.yaw) * 4))
      pGroup.position.copy(spawnPos)
      this.scene.add(pGroup)
      const fwd = new THREE.Vector3(Math.sin(bot.yaw), 0, Math.cos(bot.yaw)).normalize().multiplyScalar(68)
      this.activeIceProjectiles.push({
        group: pGroup,
        pos: spawnPos,
        vel: fwd,
        owner: bot,
        lifetime: 3.5
      })
      this.showQuickChat('🤖 BOT DISPAROU GELO!')
      return
    }

    if (p === 'oil') {
      const oilGeo = new THREE.CircleGeometry(3.6, 24)
      const oilMat = new THREE.MeshBasicMaterial({ color: 0x111827, side: THREE.DoubleSide })
      const oilMesh = new THREE.Mesh(oilGeo, oilMat)
      oilMesh.rotation.x = -Math.PI / 2
      const dropPos = bot.pos.clone().add(new THREE.Vector3(-Math.sin(bot.yaw) * 3.5, 0.05, -Math.cos(bot.yaw) * 3.5))
      oilMesh.position.copy(dropPos)
      this.scene.add(oilMesh)
      this.activeOilSlicks.push({
        mesh: oilMesh,
        pos: dropPos,
        owner: bot,
        lifetime: 18.0,
        armTimer: 0.6
      })
      return
    }

    if (p === 'shockwave') {
      this.triggerShockwave(bot.pos)
      st.timer = 11.0 + Math.random() * 4.0
      return
    }

    if (p === 'magnet') {
      st.active = { type: 'magnet', timeLeft: 3.5 }
    } else if (p === 'punch') {
      this.fireSpringPunch(bot)
      return
    } else if (p === 'overdrive') {
      st.active = { type: 'overdrive', timeLeft: 4.5 }
      bot.boost = 100
    }
  }

  private triggerShockwave(origin: THREE.Vector3) {
    this.audio.playDemo()
    this.triggerCameraShake(1.4)
    this.emitCartoonStarBurst(origin, 36, 0x00cfff)
    this.emitCartoonStarBurst(origin, 20, 0xffffff)
    this.triggerImpactFlash(origin)

    for (const car of this.allCars) {
      const d = car.pos.distanceTo(origin)
      if (d > 0.5 && d < 55) {
        const factor = 1 - d / 55
        const dir = car.pos.clone().sub(origin).normalize()
        const force = factor * 72
        car.velX = (car.velX || 0) + dir.x * force
        car.velZ = (car.velZ || 0) + dir.z * force
        car.velY = (car.velY || 0) + 26 * factor
        car.grounded = false
        // Efeito devastador de spin-out e perda de controle no impacto da onda
        car.applySpinOut(1.8)
        this.emitTireSmoke(car, true)
        this.emitCartoonStarBurst(car.pos, 10, 0x38bdf8)
      }
    }

    const ballD = this.ball.pos.distanceTo(origin)
    if (ballD < 55) {
      const factor = 1 - ballD / 55
      const dir = this.ball.pos.clone().sub(origin).normalize()
      const force = factor * 75
      this.ball.vel.add(dir.multiplyScalar(force))
      this.ball.vel.y += 22 * factor
      this.emitCartoonStarBurst(this.ball.pos, 16, 0xfacc15)
    }
  }

  /**
   * Aplica efeitos de power-ups coletados via mystery boxes em QUALQUER modo de jogo.
   * Não concede power-ups automáticos (isso é exclusivo do modo rumble).
   */
  private updateRumbleEffectsOnly(dt: number) {
    if (this.rumbleActive) {
      this.rumbleActive.timeLeft -= dt
      // Efeito de ímã: atrai a bola para o carro a grandes distâncias (alcance de 115 metros!)
      if (this.rumbleActive.type === 'magnet') {
        const toCar = this.playerCar.pos.clone().sub(this.ball.pos)
        const dist = toCar.length()
        if (dist < 115 && dist > 1.5) {
          toCar.normalize()
          // Força magnética crescente com feixe cel-shading
          const pullForce = 62 + (1 - dist / 115) * 35
          this.ball.vel.add(toCar.multiplyScalar(pullForce * dt))
          this.emitCartoonStarBurst(this.ball.pos.clone().addScaledVector(toCar, 0.4), 2, 0x00cfff)
          this.emitCartoonStarBurst(this.playerCar.pos, 1, 0xa855f7)
        }
      } else if (this.rumbleActive.type === 'overdrive') {
        // Overdrive: mantém boost e velocidade máxima
        this.playerCar.boost = 100
        this.playerCar.speed = Math.max(this.playerCar.speed, 1.45)
      } else if (this.rumbleActive.type === 'punch') {
        // Punch ativo: se aproximar da bola (< 12m), solta a pancada automática de nocaute
        const toball = this.ball.pos.clone().sub(this.playerCar.pos)
        const dBall = toball.length()
        if (dBall < 12) {
          toball.normalize()
          this.ball.vel.add(toball.multiplyScalar(65))
          this.ball.vel.y += 16
          this.audio.playPunchImpact()
          this.triggerCameraShake(1.0)
          this.emitCartoonStarBurst(this.ball.pos, 28, 0xff3300)
          this.rumbleActive = null
        }
      }
      if (this.rumbleActive.timeLeft <= 0) {
        this.rumbleActive = null
        this.updateRumbleHUD()
      } else {
        this.updateRumbleHUD()
      }
    }
  }

  private updateRumble(dt: number) {
    if (this.rumblePowerup === null && !this.rumbleActive) {
      this.rumbleTimer -= dt
      if (this.rumbleTimer <= 0) {
        const pool: RumblePowerup[] = ['magnet', 'shockwave', 'punch', 'overdrive']
        this.rumblePowerup = pool[Math.floor(Math.random() * pool.length)]
        this.updateRumbleHUD()
        this.audio.playCoin()
      } else {
        this.updateRumbleHUD()
      }
    }

    if (this.rumbleActive) {
      this.rumbleActive.timeLeft -= dt
      if (this.rumbleActive.type === 'magnet') {
        const toCar = this.playerCar.pos.clone().sub(this.ball.pos)
        const dist = toCar.length()
        if (dist < 115 && dist > 1.5) {
          toCar.normalize()
          const pullForce = 62 + (1 - dist / 115) * 35
          this.ball.vel.add(toCar.multiplyScalar(pullForce * dt))
          this.emitCartoonStarBurst(this.ball.pos.clone().addScaledVector(toCar, 0.4), 2, 0x00cfff)
          this.emitCartoonStarBurst(this.playerCar.pos, 1, 0xa855f7)
        }
      } else if (this.rumbleActive.type === 'overdrive') {
        this.playerCar.boost = 100
        this.playerCar.speed = Math.max(this.playerCar.speed, 1.45)
      } else if (this.rumbleActive.type === 'punch') {
        // Punch ativo: se aproximar da bola (< 12m), solta a pancada automática de nocaute
        const toball = this.ball.pos.clone().sub(this.playerCar.pos)
        const dBall = toball.length()
        if (dBall < 12) {
          toball.normalize()
          this.ball.vel.add(toball.multiplyScalar(65))
          this.ball.vel.y += 16
          this.audio.playPunchImpact()
          this.triggerCameraShake(1.0)
          this.emitCartoonStarBurst(this.ball.pos, 28, 0xff3300)
          this.rumbleActive = null
        }
      }

      if (this.rumbleActive.timeLeft <= 0) {
        this.rumbleActive = null
        this.rumbleTimer = 10.0
        this.updateRumbleHUD()
      }
    }

    for (const bot of this.allCars) {
      if (bot === this.playerCar) continue
      let st = this.botRumbleStates.get(bot)
      if (!st) {
        st = { powerup: null, timer: 7.0 + Math.random() * 5.0, active: null }
        this.botRumbleStates.set(bot, st)
      }

      if (st.powerup === null && !st.active) {
        st.timer -= dt
        if (st.timer <= 0) {
          const pool: RumblePowerup[] = ['missile', 'freeze', 'oil', 'magnet', 'shockwave', 'punch', 'overdrive']
          st.powerup = pool[Math.floor(Math.random() * pool.length)]
        }
      }

      if (st.powerup && !st.active) {
        const d = bot.pos.distanceTo(this.ball.pos)
        const dPlayer = bot.pos.distanceTo(this.playerCar.pos)
        if (st.powerup === 'missile' && dPlayer < 80) {
          this.activateBotRumble(bot, st)
        } else if (st.powerup === 'freeze' && dPlayer < 60) {
          this.activateBotRumble(bot, st)
        } else if (st.powerup === 'oil' && dPlayer < 25) {
          this.activateBotRumble(bot, st)
        } else if (st.powerup === 'magnet' && d < 40) {
          this.activateBotRumble(bot, st)
        } else if (st.powerup === 'shockwave' && d < 18) {
          this.activateBotRumble(bot, st)
        } else if (st.powerup === 'punch' && d < 25) {
          this.activateBotRumble(bot, st)
        } else if (st.powerup === 'overdrive' && d > 35) {
          this.activateBotRumble(bot, st)
        }
      }

      if (st.active) {
        st.active.timeLeft -= dt
        if (st.active.type === 'magnet') {
          const toCar = bot.pos.clone().sub(this.ball.pos)
          const dist = toCar.length()
          if (dist < 45 && dist > 2) {
            toCar.normalize()
            this.ball.vel.add(toCar.multiplyScalar(36 * dt))
          }
        }
        if (st.active.timeLeft <= 0) {
          st.active = null
          st.timer = 11.0 + Math.random() * 4.0
        }
      }
    }
  }

  private updateRumbleHUD() {
    if (this.isRouletteSpinning) return
    if (!this.hudRumbleCard || !this.hudRumbleIcon || !this.hudRumbleName) return

    // Mostra o card em QUALQUER modo de jogo quando o jogador tem item ou está usando
    // (mystery boxes existem em todos os modos, não só no rumble)
    const hasItem = !!this.rumblePowerup || !!this.rumbleActive
    if (!hasItem && this.gameMode !== 'rumble') {
      this.hudRumbleCard.style.display = 'none'
      return
    }
    if (!hasItem) {
      // No modo rumble sem item: exibe o cooldown
      this.hudRumbleCard.style.display = 'flex'
      this.hudRumbleIcon.textContent = '⏳'
      this.hudRumbleName.textContent = `RECARGA: ${Math.ceil(this.rumbleTimer)}s`
      this.hudRumbleCard.style.borderColor = 'rgba(255,255,255,0.25)'
      this.hudRumbleCard.style.boxShadow = 'none'
      if (this.hudRumbleHint) this.hudRumbleHint.textContent = 'AGUARDE POWER-UP'
      return
    }

    this.hudRumbleCard.style.display = 'flex'

    if (this.rumbleActive) {
      const names: Record<RumblePowerup, string> = {
        magnet: 'ÍMÃ ATIVO',
        shockwave: 'CHOQUE!',
        punch: 'SUPER SOCO!',
        overdrive: 'OVERDRIVE!',
        missile: 'MÍSSIL!',
        freeze: 'CONGELANDO!',
        oil: 'ÓLEO!'
      }
      this.hudRumbleIcon.innerHTML = this.getCartoonPowerupSVG(this.rumbleActive.type, 38)
      this.hudRumbleName.textContent = `${names[this.rumbleActive.type]} (${this.rumbleActive.timeLeft.toFixed(1)}s)`
      this.hudRumbleCard.style.borderColor = '#00ff88'
      this.hudRumbleCard.style.boxShadow = '0 0 25px rgba(0,255,136,0.7)'
      // Esconde o botão USE enquanto item está ativo
      const useBtn = document.getElementById('turbo-use-btn') as HTMLButtonElement | null
      if (useBtn) useBtn.style.display = 'none'
      const tBtn = document.getElementById('tt-use-powerup') as HTMLButtonElement | null
      if (tBtn) tBtn.style.display = 'none'
      return
    }

    if (this.rumblePowerup) {
      const names: Record<RumblePowerup, string> = {
        magnet: 'ÍMÃ DA BOLA',
        shockwave: 'ONDA DE CHOQUE',
        punch: 'SUPER SOCO',
        overdrive: 'SUPER NITRO',
        missile: 'MÍSSIL TELEGUIDADO',
        freeze: 'RAIO DE GELO',
        oil: 'MANCHA DE ÓLEO'
      }
      this.hudRumbleIcon.innerHTML = this.getCartoonPowerupSVG(this.rumblePowerup, 40)
      this.hudRumbleName.textContent = names[this.rumblePowerup]
      this.hudRumbleCard.style.borderColor = '#ffd23f'
      this.hudRumbleCard.style.boxShadow = '0 0 25px rgba(255,210,63,0.7)'
      if (this.hudRumbleHint) this.hudRumbleHint.textContent = 'APERTE [R] / [RB] OU CLIQUE!'
      // Mostra botão USE (desktop e mobile)
      const useBtn2 = document.getElementById('turbo-use-btn') as HTMLButtonElement | null
      if (useBtn2) useBtn2.style.display = 'block'
      const tBtn2 = document.getElementById('tt-use-powerup') as HTMLButtonElement | null
      if (tBtn2) tBtn2.style.display = 'flex'
    } else {
      this.hudRumbleIcon.innerHTML = `<span style="font-size:32px;">⏳</span>`
      this.hudRumbleName.textContent = `RECARGA: ${Math.ceil(this.rumbleTimer)}s`
      this.hudRumbleCard.style.borderColor = 'rgba(255,255,255,0.25)'
      this.hudRumbleCard.style.boxShadow = 'none'
      if (this.hudRumbleHint) this.hudRumbleHint.textContent = 'AGUARDE POWER-UP'
      // Esconde botão USE
      const useBtn3 = document.getElementById('turbo-use-btn') as HTMLButtonElement | null
      if (useBtn3) useBtn3.style.display = 'none'
      const tBtn3 = document.getElementById('tt-use-powerup') as HTMLButtonElement | null
      if (tBtn3) tBtn3.style.display = 'none'
    }
  }

  private getKickoffSpawns() {
    // 1v1 / Equipes: Kickoff diagonal nas laterais (estilo Rocket League oficial)
    // Carros NUNCA nascem de frente alinhados com o gol aberto!
    // A disputa acontece na diagonal em 45°, ricocheteando a bola na lateral ou para o alto!
    const orangeSpawns = [
      { x: -FIELD_W * 0.22, z: FIELD_L * 0.16, yaw: Math.PI - 0.70 }, // Slot 0: Diagonal Lateral Esquerda
      { x: FIELD_W * 0.22,  z: FIELD_L * 0.16, yaw: Math.PI + 0.70 }, // Slot 1: Diagonal Lateral Direita
      { x: 0,               z: FIELD_L * 0.32, yaw: Math.PI },        // Slot 2: Goleiro Recuado na Trave
      { x: -FIELD_W * 0.34, z: FIELD_L * 0.12, yaw: Math.PI - 0.50 }  // Slot 3: Ponta Aberto
    ]

    const blueSpawns = [
      { x: FIELD_W * 0.22,  z: -FIELD_L * 0.16, yaw: -0.70 },          // Slot 0: Diagonal Oposta
      { x: -FIELD_W * 0.22, z: -FIELD_L * 0.16, yaw: 0.70 },           // Slot 1: Diagonal Oposta
      { x: 0,               z: -FIELD_L * 0.32, yaw: 0 },              // Slot 2: Goleiro Recuado na Trave
      { x: FIELD_W * 0.34,  z: -FIELD_L * 0.12, yaw: 0.50 }            // Slot 3: Ponta Aberto
    ]

    return { orangeSpawns, blueSpawns }
  }

  private resetKickoff() {
    this.lastToucher = null
    this.ball.pos.set(0, BALL_R + 0.1, 0)
    this.ball.vel.set(0, 0, 0)

    if (this.isTraining) {
      this.playerCar.setPosition(-FIELD_W * 0.22, 0, FIELD_L * 0.16)
      this.playerCar.yaw = Math.PI - 0.70
      this.playerCar.freeze()
      this.playerCar.applyTransform()
      this.playerCar.boost = 100
      for (const car of this.allCars) {
        if (car !== this.playerCar) {
          car.freeze()
          car.group.visible = false
        }
      }
      this.kickoffCountdown = 0
      this.isKickoffActive = false
      const cdWrap = document.getElementById('turbo-countdown-overlay')
      if (cdWrap) cdWrap.style.display = 'none'
      if (this.hudTimer) this.hudTimer.textContent = 'TREINO'
      return
    }

    // Reposiciona todos os carros nos slots de kickoff laterais em ângulo
    const teamSize = this.orangeCars.length
    const { orangeSpawns, blueSpawns } = this.getKickoffSpawns()

    for (let i = 0; i < teamSize; i++) {
      const oc = this.orangeCars[i]
      const sp = orangeSpawns[i] ?? orangeSpawns[0]
      oc.setPosition(sp.x, 0, sp.z)
      oc.yaw = sp.yaw
      oc.freeze()
      oc.applyTransform()
    }
    for (let i = 0; i < teamSize; i++) {
      const bc = this.blueCars[i]
      const sp = blueSpawns[i] ?? blueSpawns[0]
      bc.setPosition(sp.x, 0, sp.z)
      bc.yaw = sp.yaw
      bc.freeze()
      bc.applyTransform()
    }

    if (this.isOnline1v1) {
      const isClient = !this.turboNet?.isHost
      const sp = isClient ? blueSpawns[0] : orangeSpawns[0]
      this.camCurrentPos.set(sp.x - Math.sin(sp.yaw) * 16, 8.5, sp.z - Math.cos(sp.yaw) * 16)
      this.camCurrentLook.set(sp.x + Math.sin(sp.yaw) * 10, 2.0, sp.z + Math.cos(sp.yaw) * 10)
      this.camera.position.copy(this.camCurrentPos)
      this.camera.lookAt(this.camCurrentLook)
    }

    this.kickoffCountdown = 3.5
    this.isKickoffActive = true
    this.lastCountdownSec = -1
  }

  private restartMatch() {
    if (this.destroyed) return

    this.scorePlayer = 0
    this.scoreBot = 0
    this.matchTimer = 300
    this.matchEnded = false
    this.goalCooldown = 0
    this.lastBoardSec = -1
    this.lastCountdownSec = -1

    this.hudScoreP.textContent = '0'
    this.hudScoreB.textContent = '0'
    this.hudTimer.textContent = '5:00'

    const endActions = document.getElementById('turbo-end-actions')
    if (endActions) endActions.style.display = 'none'
    const sub = document.getElementById('turbo-goal-sub')
    if (sub) sub.style.display = 'none'
    this.hudGoalBanner.style.display = 'none'
    this.hudGoalBanner.style.pointerEvents = 'none'

    for (const car of this.allCars) {
      car.boost = 100
      car.isDemoed = false
      car.group.visible = true
    }
    this.demoRespawnTimer = 0
    this.botDemoRespawnTimer = 0

    this.resetKickoff()
    if (this.kongGorak) {
      this.kongGorak.state = 'PATROL'
      if (this.kongGorak.rootGroup) {
        this.kongGorak.rootGroup.position.set(18, 0, 0)
        this.kongGorak.rootGroup.rotation.y = -Math.PI / 2
      }
    }
    this.drawScoreboard()
  }

  private updateHUD(dt: number) {
    // Velocidade em KM/H
    const kmh = Math.floor(Math.abs(this.playerCar.speed) * 105)
    this.hudSpeed.textContent = String(kmh)

    // Nitro
    const bv = Math.floor(this.playerCar.boost)
    this.hudBoost.textContent = String(bv)
    if (this.hudNitroArc) {
      this.hudNitroArc.setAttribute('stroke-dashoffset', String(301.6 * (1 - bv / 100)))
      this.hudNitroArc.setAttribute('stroke', bv > 50 ? '#ff6600' : bv > 25 ? '#ffaa00' : '#ef4444')
    }

    // ── BÚSSOLA / GUIA DIRECIONAL DE ATAQUE (ONDE FAZER GOL) ──
    if (this.hudGoalNav && this.hudGoalNavArrow && this.hudGoalNavText && this.hudGoalNavDist) {
      const isClient = this.isOnline1v1 && !this.turboNet?.isHost
      const targetZ = isClient ? (FIELD_L / 2) : (-FIELD_L / 2)
      const dx = 0 - this.playerCar.pos.x
      const dz = targetZ - this.playerCar.pos.z
      const dist = Math.hypot(dx, dz)

      // Vetor frontal do carro do jogador
      const fx = Math.sin(this.playerCar.yaw)
      const fz = Math.cos(this.playerCar.yaw)
      const ndx = dist > 0.001 ? dx / dist : 0
      const ndz = dist > 0.001 ? dz / dist : 1

      // Produto escalar e vetorial
      const dot = fx * ndx + fz * ndz
      const cross = fx * ndz - fz * ndx

      if (dot > 0.45) {
        this.hudGoalNavArrow.textContent = '⬆️'
        this.hudGoalNavText.textContent = '🎯 ATAQUE: GOL ADVERSÁRIO'
        this.hudGoalNav.style.borderColor = '#00ff88'
        this.hudGoalNav.style.boxShadow = '0 0 16px rgba(0,255,136,0.25), 0 4px 0 #070b16'
        this.hudGoalNavText.style.color = '#00ff88'
      } else if (dot < -0.45) {
        this.hudGoalNavArrow.textContent = '⬇️'
        this.hudGoalNavText.textContent = '🛡️ SUA DEFESA (Vire 180°)'
        this.hudGoalNav.style.borderColor = '#f59e0b'
        this.hudGoalNav.style.boxShadow = '0 0 16px rgba(245,158,11,0.25), 0 4px 0 #070b16'
        this.hudGoalNavText.style.color = '#ffd23f'
      } else if (cross > 0) {
        this.hudGoalNavArrow.textContent = '➡️'
        this.hudGoalNavText.textContent = '🎯 ATAQUE À DIREITA ➔'
        this.hudGoalNav.style.borderColor = '#00cfff'
        this.hudGoalNav.style.boxShadow = '0 0 16px rgba(0,207,255,0.25), 0 4px 0 #070b16'
        this.hudGoalNavText.style.color = '#00cfff'
      } else {
        this.hudGoalNavArrow.textContent = '⬅️'
        this.hudGoalNavText.textContent = '⬅️ 🎯 ATAQUE À ESQUERDA'
        this.hudGoalNav.style.borderColor = '#00cfff'
        this.hudGoalNav.style.boxShadow = '0 0 16px rgba(0,207,255,0.25), 0 4px 0 #070b16'
        this.hudGoalNavText.style.color = '#00cfff'
      }
      this.hudGoalNavDist.textContent = `${Math.floor(dist)}m`
    }

    // ── ONLINE 1v1: ping HUD ──────────────────────────────────
    if (this.isOnline1v1 && this.turboNet) {
      this.turboNet.updatePing(dt)
      if (this.hudPingEl) {
        const ping = this.turboNet.currentPing
        this.hudPingEl.textContent = ping === 0 ? 'PING: --ms' : `PING: ${ping}ms`
        this.hudPingEl.style.color = ping === 0 ? '#00cfff' : ping < 80 ? '#00ff88' : ping < 150 ? '#ffd23f' : '#ff2d78'
      }
      // Cliente: aplica snapshot do Host ao carro remoto (botCar)
      if (!this.turboNet.isHost) {
        this.applyRemoteCarFromSnapshot()
      }
    }

    if (!this.matchEnded && this.kickoffCountdown <= 0 && this.goalCooldown <= 0) {
      // Apenas o Host (online) ou solo decrementa o timer localmente
      // Cliente recebe via snapshot
      if (!this.isOnline1v1 || this.turboNet?.isHost) {
        this.matchTimer = Math.max(0, this.matchTimer - dt)
      }
      const m = Math.floor(this.matchTimer / 60)
      const s = Math.floor(this.matchTimer % 60)
      this.hudTimer.textContent = `${m}:${s < 10 ? '0' : ''}${s}`

      const secTotal = Math.floor(this.matchTimer)
      if (secTotal !== this.lastBoardSec) {
        this.lastBoardSec = secTotal
        this.drawScoreboard()
      }

      if (this.matchTimer <= 0) this.endMatch()
    }
  }

  private endMatch() {
    if (this.matchEnded) return
    this.matchEnded = true

    for (const car of this.allCars) car.freeze()

    const isDraw = this.scorePlayer === this.scoreBot
    const isWin = this.scorePlayer > this.scoreBot

    // Online 1v1 Host: notifica o cliente do fim de partida
    if (this.isOnline1v1 && this.turboNet?.isHost) {
      const winner = isDraw ? 'draw' : isWin ? 'orange' : 'blue'
      this.turboNet.sendMatchEndEvent(winner, { orange: this.scorePlayer, blue: this.scoreBot })
    }

    // Registra pontuação no Supabase / Leaderboard ELO local
    dbService.recordMatchResult('Jogador 1', isWin, this.scorePlayer)

    this.hudGoalTitle.textContent = isDraw ? '🤝 EMPATE!' : isWin ? '🏆 VITORIA!' : '💥 DERROTA!'
    this.hudGoalTitle.style.color = isDraw ? '#facc15' : isWin ? '#22c55e' : '#ef4444'

    const sub = document.getElementById('turbo-goal-sub')!
    sub.textContent = `${this.scorePlayer} × ${this.scoreBot} - Fim de Partida`
    sub.style.display = 'block'

    const endActions = document.getElementById('turbo-end-actions')
    if (endActions) endActions.style.display = 'flex'
    this.hudGoalBanner.style.pointerEvents = 'all'

    this.hudGoalBanner.style.display = 'flex'
    this.drawScoreboard()

    if (isWin) {
      this.audio.playVictory()
      confetti({
        particleCount: 160,
        spread: 100,
        origin: { y: 0.5 },
        colors: ['#ff5500', '#facc15', '#22c55e', '#38bdf8', '#ffffff']
      })
    } else {
      this.audio.playGoal()
    }
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.outlineEffect.setSize(window.innerWidth, window.innerHeight)
    if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight)
  }

  public destroy() {
    this.destroyed = true
    this.isRunning = false
    this.pauseOverlay = null
    cancelAnimationFrame(this.animId)
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.gamepad.onBallCamToggle = undefined
    this.audio.stopAll()
    this.audio.destroy()
    if (this.gui) {
      this.gui.destroy()
      this.gui = null
    }

    const root = document.getElementById('turbo-hud-root')
    if (root) root.remove()

    // Remove todos os carros e sombras da cena
    for (const car of this.allCars) {
      this.scene.remove(car.group)
      if ((car as any).shadowMesh && (car as any).shadowMesh.parent) {
        (car as any).shadowMesh.parent.remove((car as any).shadowMesh)
      }
    }
    this.allCars = []
    this.orangeCars = []
    this.blueCars = []

    for (const mb of this.mysteryBoxes) {
      this.scene.remove(mb.group)
    }
    this.mysteryBoxes = []

    for (const m of this.activeMissiles) {
      this.scene.remove(m.group)
    }
    this.activeMissiles = []

    for (const ice of this.activeIceProjectiles) {
      this.scene.remove(ice.group)
    }
    this.activeIceProjectiles = []

    for (const o of this.activeOilSlicks) {
      this.scene.remove(o.mesh)
    }
    this.activeOilSlicks = []

    for (const p of this.activePunches) {
      this.scene.remove(p.group)
    }
    this.activePunches = []

    for (const lp of this.launchPads) {
      this.scene.remove(lp.mesh)
    }
    this.launchPads = []

    if (this.magnetArcLine) {
      this.scene.remove(this.magnetArcLine)
      this.magnetArcGeometry?.dispose()
      this.magnetArcLine = undefined
      this.magnetArcGeometry = undefined
    }

    if (this.missileWarningHUD) {
      this.missileWarningHUD.remove()
      this.missileWarningHUD = undefined
    }

    for (const p of this.smokePuffs) {
      this.scene.remove(p.mesh)
      ;(p.mesh.material as THREE.Material).dispose()
    }
    this.smokePuffs = []
    this.smokeGeo.dispose()

    // ── Limpeza Arena Kong ──
    if (this.kongGorak) {
      this.scene.remove(this.kongGorak.rootGroup)
      this.kongGorak.dispose()
      this.kongGorak = null
    }
    if (this.kongEnvResult) {
      this.kongEnvResult.dispose()
      this.kongEnvResult = null
    }
    if (this.kongBackdropMesh) {
      this.scene.remove(this.kongBackdropMesh)
      this.kongBackdropMesh.geometry?.dispose()
      if (this.kongBackdropMesh.material) {
        const m = this.kongBackdropMesh.material as THREE.MeshBasicMaterial
        m.map?.dispose()
        m.dispose()
      }
      this.kongBackdropMesh = null
    }

    this.renderer.dispose()
    if (this.composer) {
      this.composer.dispose()
      this.composer = null
    }
    if (this.stats && this.stats.dom?.parentElement) {
      this.stats.dom.parentElement.removeChild(this.stats.dom)
    }
    this.stats = null
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement)
    }
  }
}

// ============================================================
//  CLASSE DO CARRO 3D CARTOON (ESCULTURA TOON COM CEL-SHADING)
// ============================================================
export class CarObject {
  public group          = new THREE.Group()
  public pos            = new THREE.Vector3()
  public yaw            = 0
  public pitch          = 0
  public speed          = 0
  public velY           = 0
  public velX           = 0  // velocidade lateral no ar (aéreo)
  public velZ           = 0  // velocidade frontal no ar (aéreo)
  public grounded       = true
  public jumpCount      = 0
  public flipTimer      = 0
  public flipLocked     = false // Trava aérea pós-flip: garante que o carro caia 100% sobre as 4 rodas
  public flipDirX       = 0  // direção do flip: -1 lateral esq, +1 lateral dir
  public flipDirZ       = 0  // direção do flip: -1 traseiro, +1 frontal
  public aerialPitch    = 0  // inclinação aérea real (pitch durante voo)
  public aerialRoll     = 0  // roll aéro real
  public jumpHoldTimer  = 0  // sustentação do pulo (Super Jump dinâmico)
  public boost          = 100
  public isDemoed       = false  // se foi demolido (explodiu)
  public wheelSpinAngle = 0
  public rollAngle      = 0
  public isRolling      = false
  public driftCharge    = 0
  public drifting       = false
  public spinOutTimer   = 0     // Tempo de giro desgovernado (míssil / óleo)
  public freezeTimer    = 0     // Tempo de congelamento
  public starTimer      = 0     // Tempo de super estrela invulnerável
  public iceBlockMesh:  THREE.Mesh | null = null

  private flameGroup!:   THREE.Group
  private wheels:        THREE.Group[] = []
  private steerWheels:   THREE.Group[] = []
  private shadowMesh!:   THREE.Mesh
  private scene:         THREE.Scene
  private teamColor:     number
  public isBot:         boolean
  public forceTeamColor: boolean = false
  public teamBadgeMesh: THREE.Sprite | null = null

  constructor(scene: THREE.Scene, color: number, isBot: boolean, forceTeamColor = false) {
    this.scene          = scene
    this.teamColor      = color
    this.isBot          = isBot
    this.forceTeamColor = forceTeamColor

    // Sombra permanente no solo
    this.shadowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(2.8, 24),
      new THREE.MeshBasicMaterial({ color: 0x060b14, transparent: true, opacity: 0.45 })
    )
    this.shadowMesh.rotation.x = -Math.PI / 2
    this.shadowMesh.position.set(this.pos.x, 0.04, this.pos.z)
    this.scene.add(this.shadowMesh)

    // Fogo de Nitro Traseiro
    this.flameGroup = this.buildFlame()
    this.group.add(this.flameGroup)

    scene.add(this.group)
  }

  /** Cria indicador cartoon acima do teto do carro para identificar aliados e rivais */
  public attachTeamBadge(text: string, bgColor: string, textColor: string) {
    if (this.teamBadgeMesh) {
      this.group.remove(this.teamBadgeMesh)
      this.teamBadgeMesh.material.dispose()
      this.teamBadgeMesh = null
    }

    const c = document.createElement('canvas')
    c.width = 256
    c.height = 80
    const ctx = c.getContext('2d')!

    // Fundo estilizado com borda cel-shading
    ctx.fillStyle = bgColor
    ctx.beginPath()
    ctx.roundRect(10, 10, 236, 60, 20)
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#0a0f1d'
    ctx.stroke()

    ctx.font = '900 28px "Arial Black", Impact, sans-serif'
    ctx.fillStyle = textColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 128, 40)

    const tex = new THREE.CanvasTexture(c)
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(4.2, 1.35, 1.0)
    sprite.position.set(0, 3.4, 0)
    this.teamBadgeMesh = sprite
    this.group.add(sprite)
  }

  setPosition(x: number, y: number, z: number) {
    this.pos.set(x, y, z)
    this.applyTransform()
  }

  applyTransform() {
    this.group.position.copy(this.pos)
    this.group.rotation.order = 'YXZ'
    this.group.rotation.y = this.yaw
    this.group.rotation.x = this.pitch
    this.group.rotation.z = this.rollAngle

    if (this.shadowMesh) {
      this.shadowMesh.position.set(this.pos.x, 0.04, this.pos.z)
      const s = Math.max(0.55, 1 - this.pos.y * 0.05)
      this.shadowMesh.scale.set(s, s, 1)
    }
  }

  freeze() {
    this.speed = 0
    this.velY = 0
    this.showFlame(false)
  }

  applyFreeze(duration = 2.0) {
    if (this.starTimer > 0) return
    this.freezeTimer = duration
    this.speed = 0
    this.showFlame(false)
    if (!this.iceBlockMesh) {
      const iceGeo = new THREE.BoxGeometry(4.8, 3.4, 6.2)
      const iceMat = new THREE.MeshToonMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.68,
        gradientMap: TOON_GRADIENT
      })
      this.iceBlockMesh = new THREE.Mesh(iceGeo, iceMat)
      this.iceBlockMesh.position.set(0, 1.2, 0)
      this.group.add(this.iceBlockMesh)
    }
  }

  removeFreeze() {
    this.freezeTimer = 0
    if (this.iceBlockMesh) {
      this.group.remove(this.iceBlockMesh)
      this.iceBlockMesh.geometry.dispose()
      ;(this.iceBlockMesh.material as THREE.Material).dispose()
      this.iceBlockMesh = null
    }
  }

  applySpinOut(duration = 1.4) {
    if (this.starTimer > 0) return
    this.spinOutTimer = duration
    this.speed *= 0.25
  }

  async loadModel(modelId: string): Promise<void> {
    // Modelos personalizados construídos exclusivamente com Three.js de alta fidelidade
    if (modelId === 'guincho-tody' || modelId === 'van-gost') {
      while (this.group.children.length > 0) {
        this.group.remove(this.group.children[0])
      }
      this.wheels = []
      this.steerWheels = []

      const res = modelId === 'guincho-tody' ? buildGuinchoTodyVehicle() : buildVanGostVehicle()
      this.wheels = res.wheels
      this.steerWheels = res.steerWheels
      this.group.add(res.group)

      const underglow = new THREE.PointLight(res.underglowColor, 2.8, 10)
      underglow.position.set(0, 0.4, 0)
      this.group.add(underglow)

      if (this.forceTeamColor) {
        const roofMarker = new THREE.Mesh(
          new THREE.SphereGeometry(0.26, 12, 12),
          new THREE.MeshBasicMaterial({ color: this.teamColor })
        )
        roofMarker.position.set(0, res.roofMarkerY, 0)
        this.group.add(roofMarker)
      }

      this.flameGroup = this.buildFlame()
      this.flameGroup.position.set(0, 0.1, 0)
      this.group.add(this.flameGroup)

      return Promise.resolve()
    }

    const file = CAR_MODELS[modelId]?.file || '/models/vehicle-truck-red.glb'

    return new Promise((resolve) => {
      let resolved = false
      const done = () => {
        if (!resolved) {
          resolved = true
          resolve()
        }
      }
      setTimeout(done, 15000)

      const loader = new GLTFLoader()
      const applyGltf = (gltf: any) => {
        try {
          while (this.group.children.length > 0) {
            this.group.remove(this.group.children[0])
          }
          this.wheels = []
          this.steerWheels = []

          const model = gltf.scene.clone(true)
          model.updateMatrixWorld(true)
          let bbox = new THREE.Box3().setFromObject(model)
          const rawSize = bbox.getSize(new THREE.Vector3())

          if (rawSize.x > rawSize.z) model.rotation.y = -Math.PI / 2

          // Normaliza o comprimento para ~5.2 m (porte ágil e esportivo)
          const longLen = Math.max(rawSize.x, rawSize.z)
          if (longLen > 0.0001) model.scale.setScalar(5.2 / longLen)

          model.updateMatrixWorld(true)
          bbox = new THREE.Box3().setFromObject(model)
          const center = bbox.getCenter(new THREE.Vector3())
          model.position.x -= center.x
          model.position.z -= center.z
          model.position.y = Number.isFinite(bbox.min.y) ? -bbox.min.y + 0.05 : 0.15

          model.traverse((child: any) => {
            const cname = (child.name || '').toLowerCase()
            if (cname.includes('wheel') || cname.includes('tire') || cname.includes('roda')) {
              this.wheels.push(child)
              if (cname.includes('front') || cname.includes('f_') || cname.includes('diant')) {
                this.steerWheels.push(child)
              }
            }

            if (child.isMesh) {
              child.castShadow = true
              child.receiveShadow = true
              const mesh = child as THREE.Mesh
              const origMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as any
              if (origMat) {
                let origColor = origMat.color && typeof origMat.color.clone === 'function'
                  ? origMat.color.clone()
                  : new THREE.Color(0xffffff)
                let origMap = origMat.map || null

                if (origMap) {
                  // Configura SRGBColorSpace para reprodução fiel das cores albedo do GLB
                  origMap.colorSpace = THREE.SRGBColorSpace
                  origMap.needsUpdate = true
                  origColor = new THREE.Color(0xffffff)
                }

                if (this.forceTeamColor && !origMap) {
                  const mname = (child.name || '').toLowerCase()
                  const matName = (origMat.name || '').toLowerCase()
                  const isNeutral = mname.includes('wheel') || mname.includes('tire') || mname.includes('roda') ||
                                    mname.includes('glass') || mname.includes('window') || mname.includes('vidro') ||
                                    mname.includes('light') || mname.includes('farol') || mname.includes('black') ||
                                    matName.includes('glass') || matName.includes('tire') || matName.includes('wheel')
                  if (!isNeutral) {
                    origColor = new THREE.Color(this.teamColor)
                  }
                }

                mesh.material = new THREE.MeshToonMaterial({
                  color: origColor,
                  map: origMap,
                  gradientMap: TOON_GRADIENT
                })
              }
            }
          })

          this.group.add(model)

          // Luz Neon Underglow no chão sob o veículo
          const underglowColor = modelId === 'nova-forge' ? 0x00f0ff : this.teamColor
          const underglow = new THREE.PointLight(underglowColor, 2.8, 10)
          underglow.position.set(0, 0.4, 0)
          this.group.add(underglow)

          // Indicador luminoso de equipe no teto para identificação online nítida
          if (this.forceTeamColor) {
            const roofMarker = new THREE.Mesh(
              new THREE.SphereGeometry(0.26, 12, 12),
              new THREE.MeshBasicMaterial({ color: this.teamColor })
            )
            roofMarker.position.set(0, 2.35, 0)
            this.group.add(roofMarker)
          }

          // Fogo de Nitro Traseiro
          this.flameGroup = this.buildFlame()
          this.flameGroup.position.set(0, 0.1, 0)
          this.group.add(this.flameGroup)

          done()
        } catch (err) {
          console.warn('[CarObject] Erro aplicando modelo:', err)
          done()
        }
      }

      loader.load(
        file,
        (gltf) => applyGltf(gltf),
        undefined,
        () => {
          if (file !== '/models/vehicle-truck-red.glb') {
            loader.load('/models/vehicle-truck-red.glb', (fGltf) => applyGltf(fGltf), undefined, () => done())
          } else {
            done()
          }
        }
      )
    })
  }


  private buildFlame(): THREE.Group {
    const fg = new THREE.Group()
    const f1 = new THREE.MeshBasicMaterial({ color: 0xff3300 })
    const f2 = new THREE.MeshBasicMaterial({ color: 0xffcc00 })
    const f3 = new THREE.MeshBasicMaterial({ color: 0x00f0ff }) // Nucleo azul de nitro potente

    const cones: [number, THREE.Material, number][] = [
      [-0.45, f1, 2.2], [0.45, f1, 2.2],
      [-0.45, f2, 1.6], [0.45, f2, 1.6],
      [0.0,   f3, 2.6]
    ]

    for (const [dx, mat, h] of cones) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, h, 8), mat)
      cone.rotation.x = -Math.PI / 2
      cone.position.set(dx, 0.65, -2.8 - h / 2)
      fg.add(cone)
    }

    const fl = new THREE.PointLight(0xff6600, 2.5, 10)
    fl.position.set(0, 0.65, -3.2)
    fg.add(fl)

    fg.visible = false
    return fg
  }

  showFlame(v: boolean) {
    if (this.flameGroup) this.flameGroup.visible = v
  }

  steerFront(angle: number) {
    this.steerWheels.forEach(w => {
      w.rotation.y = angle
    })
  }

  update(dt: number) {
    if (this.freezeTimer > 0) {
      this.freezeTimer -= dt
      this.speed = 0
      this.velX *= 0.95
      this.velZ *= 0.95
      if (this.freezeTimer <= 0) {
        this.removeFreeze()
      }
    }

    if (this.spinOutTimer > 0) {
      this.spinOutTimer -= dt
      this.yaw += dt * 14.0 // Roda desgovernado no eixo
      this.applyTransform()
    }

    if (this.starTimer > 0) {
      this.starTimer -= dt
    }

    if (this.flameGroup?.visible) {
      const sc = 0.85 + Math.sin(Date.now() * 0.04) * 0.25
      this.flameGroup.scale.set(sc, sc, sc * 1.1)
    }
    this.wheels.forEach(w => {
      w.rotation.x = this.wheelSpinAngle
    })
  }
}
