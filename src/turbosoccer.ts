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
import { dbService } from './supabase'


const FIELD_W  = 220      // Arena 4v4 épica (era 160)
const FIELD_L  = 360      // Arena 4v4 épica (era 260)
const CEIL_H   = 46       // Teto alto para acrobacias (era 38)
const BALL_R   = 2.2      // Raio da bola cartoon
const GRAVITY  = 30       // Gravidade arcade

const GOAL_W   = 38.0     // Trave proporcional 4v4 (era 30)
const GOAL_H   = 14.0     // Altura da trave 4v4 (era 10.5)
const GOAL_D   = 16.0     // Profundidade da rede (era 12)


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

export type TurboTheme = 'classic' | 'cyber' | 'futsal' | 'snowday'

export type TurboBotLevel = 'easy' | 'medium' | 'hard'
export type TurboMatchFormat = '1v1' | '2v2' | '3v3' | '4v4'
export type GoalExplosionType = 'toon' | 'supernova' | 'lightning' | 'confetti'
export type TurboGameMode = 'standard' | 'rumble' | 'snowday'
export type RumblePowerup = 'magnet' | 'shockwave' | 'punch' | 'overdrive'

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
    // ── MOEDAS DE NITRO & OBSTÁCULOS DINÂMICOS ────────────────
  private boostCoins: {
    group: THREE.Group
    coinMesh: THREE.Mesh
    pos: THREE.Vector3
    active: boolean
    respawnTimer: number
    value: number
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

  private keys: Record<string, boolean> = {}


  private sunLight!: THREE.DirectionalLight
  private gui: GUI | null = null
  private studioParams = {
    outlineThickness: 0.007,
    sunIntensity: 1.15,
    exposure: 1.05,
    playerSpeedMult: 1.0,
    turnRate: 2.8,
    jumpForce: 14,
    gravity: 30,
    ballBounce: 0.68,
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
  private crowdInstances: { mesh: THREE.InstancedMesh; items: { x: number; feetY: number; z: number; phase: number; yaw: number }[] }[] = []
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
  private theme: TurboTheme = 'classic'
  private botLevel: TurboBotLevel = 'medium'
  private goalExplosion: GoalExplosionType = 'toon'
  private gameMode: TurboGameMode = 'standard'
  private spectatorMode = false

  // Rumble
  private rumblePowerup: RumblePowerup | null = null
  private rumbleTimer = 7.0
  private rumbleActive: { type: RumblePowerup; timeLeft: number } | null = null
  private botRumbleStates: Map<CarObject, { powerup: RumblePowerup | null; timer: number; active: { type: RumblePowerup; timeLeft: number } | null }> = new Map()

  // Instant Replay (Zero-Allocation Preallocated Ring Buffer para 60 FPS estavel sem GC pauses)
  private static readonly MAX_REPLAY_FRAMES = 200
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

  // Scratch vectors reutilizaveis (Zero Allocation no game loop a 60 FPS)
  private readonly _camTargetPos = new THREE.Vector3()
  private readonly _camTargetLook = new THREE.Vector3()
  private readonly _camToBall = new THREE.Vector3()
  private readonly _camDir = new THREE.Vector3()
  private readonly _camOd = new THREE.Vector3()
  private readonly _camOffset = new THREE.Vector3(0, 18, 36)
  private readonly _camReplayTarget = new THREE.Vector3()

  constructor(container: HTMLElement, carModelId = 'octane-cartoon', tuning?: TurboTuning) {
    this.container = container
    this.selectedCarModelId = carModelId
    this.theme = tuning?.theme ?? 'classic'
    this.botLevel = tuning?.botLevel ?? 'medium'
    this.matchFormat = tuning?.matchFormat ?? '1v1'
    this.goalExplosion = tuning?.goalExplosion ?? 'toon'
    this.gameMode = tuning?.gameMode ?? 'standard'
    this.spectatorMode = tuning?.spectatorMode ?? false
    if (this.gameMode === 'snowday') {
      this.theme = 'snowday'
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
    const themeBg = this.theme === 'cyber' ? 0x0b1020 : this.theme === 'futsal' ? 0x1e293b : this.theme === 'snowday' ? 0x93c5fd : 0x38bdf8
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
      this.buildGoals()
      this.buildBall()
      this.loadSceneryClouds()
      this.loadCornerFlags()
      this.buildCartoonCrowd()
      this.buildImpactFlash()

      // ── SPAWN DE CARROS CONFORME FORMATO ESCOLHIDO ──────────
      // Configuração de times: Laranja (jogador + aliados bot) vs Azul (todos bots)
      const teamSizes: Record<TurboMatchFormat, number> = { '1v1': 1, '2v2': 2, '3v3': 3, '4v4': 4 }
      const teamSize = teamSizes[this.matchFormat]

      // Posições de kickoff por slot (Laranja ataca para -Z, Azul ataca para +Z)
      const orangeSpawnZ = [FIELD_L * 0.18, FIELD_L * 0.08, FIELD_L * 0.25, FIELD_L * 0.08]
      const orangeSpawnX = [0, -FIELD_W * 0.22, FIELD_W * 0.22, FIELD_W * 0.36]
      const blueSpawnZ   = [-FIELD_L * 0.18, -FIELD_L * 0.08, -FIELD_L * 0.25, -FIELD_L * 0.08]
      const blueSpawnX   = [0, FIELD_W * 0.22, -FIELD_W * 0.22, -FIELD_W * 0.36]

      // Carro do Jogador (Laranja — slot 0)
      this.playerCar = new CarObject(this.scene, 0xff4500, false)
      this.playerCar.setPosition(orangeSpawnX[0], 0, orangeSpawnZ[0])
      this.playerCar.yaw = Math.PI
      this.playerCar.applyTransform()
      this.orangeCars.push(this.playerCar)

      // Aliados Bot Laranja (slots 1..teamSize-1)
      const orangeBotColors = [0xff8800, 0xffaa00, 0xffcc00]
      for (let i = 1; i < teamSize; i++) {
        const ally = new CarObject(this.scene, orangeBotColors[i - 1] ?? 0xff8800, true)
        ally.setPosition(orangeSpawnX[i], 0, orangeSpawnZ[i])
        ally.yaw = Math.PI
        ally.applyTransform()
        this.orangeCars.push(ally)
      }

      // Carro do Bot Rival (Azul — slot 0)
      this.botCar = new CarObject(this.scene, 0x0099ff, true)
      this.botCar.setPosition(blueSpawnX[0], 0, blueSpawnZ[0])
      this.botCar.yaw = 0
      this.botCar.applyTransform()
      this.blueCars.push(this.botCar)

      // Rivais Bot Azul adicionais (slots 1..teamSize-1)
      const blueBotColors = [0x00cfff, 0x00eeff, 0x44aaff]
      for (let i = 1; i < teamSize; i++) {
        const rival = new CarObject(this.scene, blueBotColors[i - 1] ?? 0x00cfff, true)
        rival.setPosition(blueSpawnX[i], 0, blueSpawnZ[i])
        rival.yaw = 0
        rival.applyTransform()
        this.blueCars.push(rival)
      }

      // Lista mestre com todos os carros
      this.allCars = [...this.orangeCars, ...this.blueCars]

      // Posiciona câmera e inicializa HUD e loop imediatamente
      this.camCurrentPos.set(0, 8.5, orangeSpawnZ[0] + 18)
      this.camCurrentLook.set(0, 2.2, orangeSpawnZ[0] - 6)
      this.camera.position.copy(this.camCurrentPos)
      this.camera.lookAt(this.camCurrentLook)

      this.buildHUD()

      this.gamepad.onBallCamToggle = () => this.toggleBallCam()
      window.addEventListener('resize', this.onResize)
      window.addEventListener('keydown', this.onKeyDown)
      window.addEventListener('keyup', this.onKeyUp)

      this.loop()
      if (this.isTraining) {
        this.setTrainingMode(true)
      }

      // Carrega modelos 3D reais (GLB) para todos os carros — variedade total sem caixas geométricas
      const botModelPool = ['buggy', 'ferrari', 'toycar', 'cartoon-yellow', 'cartoon-green', 'cartoon-purple', 'cartoon-moto', 'sportscar']
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
    const loader = new GLTFLoader()
    loader.load('/models/cloud.glb', (gltf) => {
      const positions: [number, number, number, number][] = [
        [-45, 34, -55, 6.0],
        [48, 30, -65, 7.5],
        [-52, 36, 35, 6.5],
        [50, 32, 45, 7.0],
        [0, 42, -75, 9.0],
        [-30, 38, 0, 5.5],
        [35, 36, -20, 6.0]
      ]
      positions.forEach(([cx, cy, cz, sc]) => {
        const cloud = gltf.scene.clone()
        cloud.scale.set(sc, sc, sc)
        cloud.position.set(cx, cy, cz)
        cloud.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true
          }
        })
        this.scene.add(cloud)
      })
    }, undefined, () => {})
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
    const grassA = isSnow ? '#f0f9ff' : this.theme === 'cyber' ? '#0b1220' : this.theme === 'futsal' ? '#b45309' : '#22c55e'
    const grassB = isSnow ? '#e0f2fe' : this.theme === 'cyber' ? '#1e1b4b' : this.theme === 'futsal' ? '#92400e' : '#16a34a'
    const lineCol = isSnow ? '#0284c7' : this.theme === 'cyber' ? '#00cfff' : '#ffffff'


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
    const glassMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    })


    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, CEIL_H, FIELD_L), glassMat)
      wall.position.set(side * FIELD_W / 2, CEIL_H / 2, 0)
      this.scene.add(wall)
    }


    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(FIELD_W, CEIL_H, 0.4), glassMat)
      wall.position.set(0, CEIL_H / 2, side * (FIELD_L / 2 + GOAL_D))
      this.scene.add(wall)
    }


    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, FIELD_L), glassMat)
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
    lctx.fillText('⚡ ARENA KICK ⚽  TURBO SOCCER  ⚡ ARENA KICK ⚽  TURBO SOCCER  ⚡', 20, 84)

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


    for (const side of [-1, 1]) {
      for (let r = 0; r < 8; r++) {
        const posZ = side * (FIELD_L / 2 + 6.5 + r * rowD)
        const posY = r * rowH * 0.7 + 1.0

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
    canvas.width = 1024
    canvas.height = 384
    this.scoreboardCanvas = canvas
    this.scoreboardCtx = canvas.getContext('2d')!

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    this.scoreboardTex = tex

    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 11.25),
      new THREE.MeshBasicMaterial({ map: tex })
    )
    board.position.set(0, 15.5, -(FIELD_L / 2 + 2.5))
    this.scene.add(board)

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(31.5, 12.5, 0.8),
      new THREE.MeshToonMaterial({ color: 0x0f172a, gradientMap: TOON_GRADIENT })
    )
    back.position.set(0, 15.5, -(FIELD_L / 2 + 3.1))
    back.castShadow = true
    this.scene.add(back)

    this.drawScoreboard()
  }

  private drawScoreboard() {
    if (!this.scoreboardCtx || !this.scoreboardTex) return
    const ctx = this.scoreboardCtx
    const w = 1024
    const h = 384

    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#0284c7'
    ctx.fillRect(0, 0, w, 14)
    ctx.fillRect(0, h - 14, w, 14)

    ctx.fillStyle = '#ff5500'
    ctx.fillRect(30, 60, 260, 264)
    ctx.fillStyle = '#0088ff'
    ctx.fillRect(w - 290, 60, 260, 264)

    ctx.fillStyle = '#0b1220'
    ctx.font = '900 150px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(this.scorePlayer), 160, 192)
    ctx.fillText(String(this.scoreBot), w - 160, 192)

    const m = Math.floor(this.matchTimer / 60)
    const s = Math.floor(this.matchTimer % 60)
    ctx.fillStyle = '#ffe600'
    ctx.font = '900 96px Arial, sans-serif'
    ctx.fillText(`${m}:${s < 10 ? '0' : ''}${s}`, w / 2, 160)

    ctx.fillStyle = '#e2e8f0'
    ctx.font = '900 44px Arial, sans-serif'
    ctx.fillText('ARENA KICK', w / 2, 302)

    this.scoreboardTex.needsUpdate = true
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
    const rimMat = new THREE.MeshToonMaterial({
      color: teamColor,
      gradientMap: TOON_GRADIENT
    })

    const pR = 0.45 // Postes tubulares cartoon grossos

    for (const x of [-GOAL_W / 2, GOAL_W / 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(pR, pR, GOAL_H, 20), postMat)
      post.position.set(x, GOAL_H / 2, 0)
      post.castShadow = true
      group.add(post)

      // Faixas coloridas nos postes
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(pR + 0.04, pR + 0.04, 0.8, 20), rimMat)
      rim.position.set(x, GOAL_H * 0.55, 0)
      group.add(rim)
    }


    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(pR, pR, GOAL_W + pR * 2, 20), postMat)
    crossbar.rotation.z = Math.PI / 2
    crossbar.position.set(0, GOAL_H, 0)
    crossbar.castShadow = true
    group.add(crossbar)

    // Suportes Diagonais Traseiros
    const dir = flipZ ? -1 : 1
    const supLen = Math.hypot(GOAL_H, GOAL_D)
    const supAngle = Math.atan2(GOAL_D, GOAL_H)

    for (const x of [-GOAL_W / 2, GOAL_W / 2]) {
      const sup = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, supLen, 12), postMat)
      sup.position.set(x, GOAL_H / 2, dir * GOAL_D / 2)
      sup.rotation.x = dir * supAngle
      group.add(sup)
    }

    // Rede Hexagonal Iluminada Cartoon
    const netCanvas = document.createElement('canvas')
    netCanvas.width = 128
    netCanvas.height = 128
    const nctx = netCanvas.getContext('2d')!
    nctx.strokeStyle = '#ffffff'
    nctx.lineWidth = 3
    for (let i = 0; i <= 128; i += 20) {
      nctx.beginPath(); nctx.moveTo(i, 0); nctx.lineTo(i, 128); nctx.stroke()
      nctx.beginPath(); nctx.moveTo(0, i); nctx.lineTo(128, i); nctx.stroke()
    }
    const netTex = new THREE.CanvasTexture(netCanvas)
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping
    netTex.repeat.set(6, 4)

    const netMat = new THREE.MeshBasicMaterial({
      map: netTex,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide
    })

    const netBack = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_H), netMat)
    netBack.position.set(0, GOAL_H / 2, dir * GOAL_D)
    group.add(netBack)

    const netTop = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_D), netMat)
    netTop.rotation.x = Math.PI / 2
    netTop.position.set(0, GOAL_H, dir * GOAL_D / 2)
    group.add(netTop)

    for (const x of [-GOAL_W / 2, GOAL_W / 2]) {
      const ns = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_D, GOAL_H), netMat)
      ns.rotation.y = Math.PI / 2
      ns.position.set(x, GOAL_H / 2, dir * GOAL_D / 2)
      group.add(ns)
    }

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
        <div style="display:flex;align-items:center;gap:12px;padding:8px 24px;">
          <div style="width:16px;height:16px;border-radius:4px;background:#ff5500;box-shadow:0 0 10px #ff5500;"></div>
          <div style="color:#ff5500;font-weight:900;font-size:34px;min-width:32px;text-align:center;" id="turbo-score-p">0</div>
        </div>
        <div style="background:#ffd23f;padding:8px 18px;font-size:18px;font-weight:900;color:#141426;letter-spacing:2px;" id="turbo-timer">
          5:00
        </div>
        <div style="display:flex;align-items:center;gap:12px;padding:8px 24px;">
          <div style="color:#0088ff;font-weight:900;font-size:34px;min-width:32px;text-align:center;" id="turbo-score-b">0</div>
          <div style="width:16px;height:16px;border-radius:4px;background:#0088ff;box-shadow:0 0 10px #0088ff;"></div>
        </div>
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
RT Acelerar &nbsp; LT Ré &nbsp; LS Direção &nbsp; RS Câmera &nbsp; A Pulo/Flip &nbsp; B Nitro &nbsp; X Barrel Roll &nbsp; LB Drift &nbsp; Y Cam &nbsp; ESC Pausa
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
        <span style="color:#00cfff;font-weight:900;font-size:13px;letter-spacing:2px;">REPLAY DA JOGADA (CÂMERA LENTA)</span>
        <button id="btn-skip-replay" style="background:#ff5500;border:none;color:white;border-radius:12px;
          padding:5px 14px;font-size:10px;font-weight:900;cursor:pointer;font-family:'Orbitron',sans-serif;margin-left:6px;">PULAR [ESPAÇO]</button>
      </div>

      <!-- CARD DE POWER-UP RUMBLE -->
      <div id="turbo-rumble-card" style="position:absolute;bottom:140px;right:28px;display:none;
        background:rgba(30,41,59,0.92);border:3px solid #facc15;border-radius:18px;padding:10px 16px;
        align-items:center;gap:12px;box-shadow:0 0 20px rgba(250,204,21,0.5);
        pointer-events:all;cursor:pointer;user-select:none;z-index:110;">
        <div id="turbo-rumble-icon" style="font-size:30px;filter:drop-shadow(0 0 8px #facc15);">⏳</div>
        <div>
          <div id="turbo-rumble-name" style="font-size:11px;font-weight:900;color:#facc15;letter-spacing:1px;">CARREGANDO...</div>
          <div id="turbo-rumble-hint" style="font-size:9px;color:rgba(255,255,255,0.7);margin-top:2px;">[R] OU [CTRL]</div>
        </div>
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

    if (this.gameMode === 'rumble' && this.hudRumbleCard) {
      this.hudRumbleCard.style.display = 'flex'
      this.hudRumbleCard.addEventListener('click', () => this.activatePlayerRumble())
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
        this.updateCountdownDisplay()
        for (const car of this.allCars) car.freeze()
      } else if (this.goalCooldown > 0) {
        this.goalCooldown -= dt
        for (const car of this.allCars) car.freeze()
      } else if (!this.matchEnded) {
        if (!this.spectatorMode) {
          this.updatePlayerInput(dt)
        }
        this.updateBotAI(dt)
        this.resolveCarCarCollision()
        this.updateBall(dt)
        this.updateDynamicObstacles(dt)
        this.updateBoostCoins(dt)
        this.updateDemoRespawn(dt)

        if (this.gameMode === 'rumble') {
          this.updateRumble(dt)
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
            slot.roll = c.roll
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

    let throttle = 0
    if (gp.connected) {
      if (gp.rtThrottle > 0.1) throttle = gp.rtThrottle
      else if (gp.ltBrake > 0.1) throttle = -gp.ltBrake
    } else {
      if (this.keys['KeyW'] || this.keys['ArrowUp'])   throttle += 1
      if (this.keys['KeyS'] || this.keys['ArrowDown']) throttle -= 1
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
      throttle = Math.max(throttle, 1.0) * 1.55
      this.emitTireSmoke(pc)
    } else {
      this.boostSfxHeld = false
      pc.showFlame(false)
      // Nitro não recarrega sozinho: colete moedas cartoon no campo!
    }


    if (throttle !== 0) {
      const maxSpd = (isBoosting ? 1.75 : 1.25) * this.studioParams.playerSpeedMult
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

    // ── VOO LIVRE AÉREO (A + BOOST no ar — como no Turbo Soccer/RL original) ──
    // Enquanto BOOST estiver pressionado no ar, o carro voa na direção do analógico
    const boostNowForAerial = (gp.connected && gp.boost) || this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touch.boost
    if (!pc.grounded && boostNowForAerial && pc.boost > 0 && !this.aerialBoostHeld) {
      this.aerialBoostHeld = true
    }
    if (this.aerialBoostHeld && boostNowForAerial && !pc.grounded && pc.boost > 0) {
      // Thrust aéreo direcional — aplica força na direção do analógico / tecla
      const thrustForce = 18 * dt
      let thrustX = 0
      let thrustZ = 0
      if (gp.connected) {
        if (Math.abs(gp.steerX) > 0.15) thrustX = gp.steerX
        if (gp.rtThrottle > 0.1) thrustZ = -gp.rtThrottle  // RT = empurra para frente
        if (gp.ltBrake > 0.1)    thrustZ = gp.ltBrake       // LT = empurra para trás
      } else {
        if (this.keys['KeyA'] || this.keys['ArrowLeft'])  thrustX = -1
        if (this.keys['KeyD'] || this.keys['ArrowRight']) thrustX = +1
        if (this.keys['KeyW'] || this.keys['ArrowUp'])    thrustZ = -1
        if (this.keys['KeyS'] || this.keys['ArrowDown'])  thrustZ = +1
        thrustX += this.touch.steer
        thrustX = Math.max(-1, Math.min(1, thrustX))
      }
      // Aplica thrust no eixo do carro (mundo)
      const sinY = Math.sin(pc.yaw), cosY = Math.cos(pc.yaw)
      pc.velX = (pc.velX || 0) + (thrustX * cosY + thrustZ * sinY) * thrustForce * 60
      pc.velZ = (pc.velZ || 0) + (-thrustX * sinY + thrustZ * cosY) * thrustForce * 60
      pc.velY += thrustForce * 50  // leve impulso para cima também (mantém altitude)
      // Clamp para não voar demais
      const maxAerialSpd = 55
      const aerSpd = Math.hypot(pc.velX, pc.velZ)
      if (aerSpd > maxAerialSpd) {
        pc.velX = (pc.velX / aerSpd) * maxAerialSpd
        pc.velZ = (pc.velZ / aerSpd) * maxAerialSpd
      }
      pc.velY = Math.min(pc.velY, 20)
      pc.boost = Math.max(0, pc.boost - 28 * dt)
      pc.showFlame(true)
    } else {
      this.aerialBoostHeld = false
    }
    if (pc.grounded) this.aerialBoostHeld = false

    // ── PULO 1 e PULO 2 / FLIP DIRECIONAL (como no Turbo Soccer original) ──
    if (jumpJustPressed) {
      if (pc.grounded && pc.jumpCount === 0) {
        // 1º PULO: impulso vertical limpo + preserva momentum do movimento do carro no solo!
        const fwdSpeed = pc.speed * 50
        pc.velX = Math.sin(pc.yaw) * fwdSpeed
        pc.velZ = Math.cos(pc.yaw) * fwdSpeed
        pc.velY = this.studioParams.jumpForce
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
          // FLIP DIRECIONAL: impulso forte + cambalhota acrobática de 360°
          const flipThrust = 34.0
          const sinY = Math.sin(pc.yaw), cosY = Math.cos(pc.yaw)
          const thrustX = (inputX * cosY + inputZ * sinY) * flipThrust
          const thrustZ = (-inputX * sinY + inputZ * cosY) * flipThrust
          pc.velX = pc.velX * 0.35 + thrustX
          pc.velZ = pc.velZ * 0.35 + thrustZ
          // Sustentação vertical para o flip completar no ar sem tocar o solo prematuramente
          pc.pos.y = Math.max(pc.pos.y, 1.4)
          pc.velY = Math.max(pc.velY, 5.5)
          pc.flipDirX = inputX
          pc.flipDirZ = inputZ
          pc.flipTimer = 0.001
          pc.flipLocked = true
        } else {
          // SEM DIREÇÃO → pulo duplo reto para CIMA (mais alto)
          pc.velY = this.studioParams.jumpForce * 1.3
          pc.flipLocked = false
        }
        pc.jumpCount = 2
        this.audio.playDash()
      }
    }

    // Sustentação do 1º pulo se o jogador mantiver pressionado (Pulo Variável / Super Jump)
    if (jumpNow && pc.jumpHoldTimer > 0 && !pc.grounded && pc.jumpCount === 1) {
      pc.velY += 40 * dt
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

    // ── MOVIMENTO HORIZONTAL NO SOLO & WALL RIDING (Rocket League Style) ──
    const limX = FIELD_W / 2 - 2.8
    const limZ = FIELD_L / 2 - 2.8
    const nearWallX = Math.abs(car.pos.x) >= limX - 1.2
    const nearWallZ = Math.abs(car.pos.z) >= limZ - 1.2 && Math.abs(car.pos.x) > GOAL_W / 2

    // Wall Riding: quando o carro atinge as paredes com velocidade, sobe a rampa curva e anda na parede
    if ((nearWallX || nearWallZ) && Math.abs(car.speed) > 0.35) {
      const climbSpeed = Math.abs(car.speed) * 28 * dt
      car.pos.y = Math.min(CEIL_H - 2.5, car.pos.y + climbSpeed)
      car.grounded = true // permite pular da parede!
      car.jumpCount = 0
      if (nearWallX) {
        const wallSide = Math.sign(car.pos.x)
        car.rollAngle = -wallSide * Math.PI * 0.45 // inclina as rodas contra a parede
      }
    }

    if (car.grounded) {
      const spd = car.speed * 50 * dt
      car.pos.x += Math.sin(car.yaw) * spd
      car.pos.z += Math.cos(car.yaw) * spd
      car.pitch = car.aerialPitch
    }

    // Aplica pitch/roll visual aereo
    car.pitch     = car.aerialPitch
    car.rollAngle = car.isRolling ? car.rollAngle : (nearWallX && car.pos.y > 1.0 ? car.rollAngle : car.aerialRoll)

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

      const radius = isLarge ? 2.2 : 1.35
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
      coinMesh.position.y = 1.4 // Flutua confortavelmente acima do gramado (nunca encosta no chão)
      coinMesh.castShadow = true
      g.add(coinMesh)

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
        pos: new THREE.Vector3(x, 1.4, z),
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
        coin.coinMesh.position.y = 1.4 + Math.sin(time + i * 0.9) * 0.18

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

  // ── OBSTÁCULOS DINÂMICOS 3D (BARRIS & CONES COM FÍSICA REAL) ─────
  private buildObstacles3D() {
    this.dynamicObstacles = []

    const addBarrel = (x: number, z: number) => {
      const g = new THREE.Group()
      g.position.set(x, 1.3, z)

      const barrelMat = new THREE.MeshToonMaterial({
        color: 0xf59e0b, // Amarelo industrial cartoon
        gradientMap: TOON_GRADIENT
      })
      const rimMat = new THREE.MeshToonMaterial({
        color: 0x0f172a,
        gradientMap: TOON_GRADIENT
      })

      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.6, 20), barrelMat)
      body.castShadow = true
      g.add(body)

      for (const yOffset of [-0.9, 0, 0.9]) {
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.26, 1.26, 0.2, 20), rimMat)
        rim.position.y = yOffset
        g.add(rim)
      }

      this.scene.add(g)
      this.dynamicObstacles.push({
        group: g,
        pos: new THREE.Vector3(x, 1.3, z),
        vel: new THREE.Vector3(0, 0, 0),
        rot: new THREE.Euler(0, Math.random() * Math.PI, 0),
        rotVel: new THREE.Vector3(0, 0, 0),
        radius: 1.3,
        height: 2.6,
        type: 'barrel',
        selfRightTimer: 0
      })
    }

    const addCone = (x: number, z: number) => {
      const g = new THREE.Group()
      g.position.set(x, 1.2, z)

      const coneMat = new THREE.MeshToonMaterial({
        color: 0xff5500, // Laranja neon cartoon
        gradientMap: TOON_GRADIENT
      })
      const whiteMat = new THREE.MeshToonMaterial({
        color: 0xffffff,
        gradientMap: TOON_GRADIENT
      })
      const baseMat = new THREE.MeshToonMaterial({
        color: 0x0f172a,
        gradientMap: TOON_GRADIENT
      })

      const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.22, 2.2), baseMat)
      base.position.y = -1.1
      base.castShadow = true
      g.add(base)

      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.4, 20), coneMat)
      cone.castShadow = true
      g.add(cone)

      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.68, 0.55, 20), whiteMat)
      stripe.position.y = -0.05
      g.add(stripe)

      this.scene.add(g)
      this.dynamicObstacles.push({
        group: g,
        pos: new THREE.Vector3(x, 1.2, z),
        vel: new THREE.Vector3(0, 0, 0),
        rot: new THREE.Euler(0, Math.random() * Math.PI, 0),
        rotVel: new THREE.Vector3(0, 0, 0),
        radius: 1.2,
        height: 2.4,
        type: 'cone',
        selfRightTimer: 0
      })
    }

    // Barris e Cones distribuídos proporcionalmente na arena maior
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

      // Colisão com o solo (quica e desliza - clamp rígido para NUNCA entrar no chão)
      const groundY = obs.height / 2
      if (obs.pos.y <= groundY) {
        obs.pos.y = groundY
        obs.vel.y = -obs.vel.y * 0.35 // Quique
        if (Math.abs(obs.vel.y) < 0.2) obs.vel.y = 0
        // Atrito forte no chão para desacelerar gradativamente
        obs.vel.x *= Math.pow(0.85, dt * 60)
        obs.vel.z *= Math.pow(0.85, dt * 60)
      }
      obs.pos.y = Math.max(groundY, obs.pos.y) // Trava absoluta de segurança contra afundar

      // Rotação física e tombamento
      obs.rot.x += obs.rotVel.x * dt
      obs.rot.y += obs.rotVel.y * dt
      obs.rot.z += obs.rotVel.z * dt
      obs.rotVel.multiplyScalar(0.92)

      // Auto-reerguimento gradual ("João-bobo" cartoon após tombar)
      const isTilted = Math.abs(obs.rot.x) > 0.25 || Math.abs(obs.rot.z) > 0.25
      if (isTilted && obs.pos.y <= groundY + 0.1 && obs.vel.length() < 1.2) {
        obs.selfRightTimer += dt
        if (obs.selfRightTimer > 1.8) {
          obs.rot.x *= Math.pow(0.86, dt * 60)
          obs.rot.z *= Math.pow(0.86, dt * 60)
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


  //  BOT IA COMPETITIVO E BALANCEADO (DISPUTA JUSTA & HUMANA)

  private updateBotAI(dt: number) {
    // Roda a IA para todos os carros bot (blue team + orange aliados)
    for (const car of this.allCars) {
      if ((car === this.playerCar && !this.spectatorMode) || car.isDemoed) continue
      this.runSingleBotAI(car, dt)
    }
  }

  private runSingleBotAI(bc: CarObject, dt: number) {
    const bp = this.ball.pos
    const isBlue = this.blueCars.includes(bc)
    // Blue ataca em -Z, Orange aliados atacam em +Z
    const ownGoalZ = isBlue ? -FIELD_L / 2 : FIELD_L / 2

    let bx = bp.x
    let bz = bp.z - ownGoalZ
    const bl = Math.hypot(bx, bz) || 1
    bx /= bl; bz /= bl
    const behindX = bp.x + bx * 3.6
    const behindZ = bp.z + bz * 3.6

    const distBall = Math.hypot(bp.x - bc.pos.x, bp.z - bc.pos.z)
    const distBehind = Math.hypot(behindX - bc.pos.x, behindZ - bc.pos.z)
    const ballInOwnHalf = isBlue ? bp.z < 0 : bp.z > 0

    let targetX: number
    let targetZ: number

    if (ballInOwnHalf && distBall > 4.5 && distBehind > 3.0) {
      targetX = bp.x * 0.5
      targetZ = (bp.z + ownGoalZ) * 0.5
    } else if (distBehind > 2.4) {
      targetX = behindX
      targetZ = behindZ
    } else {
      targetX = bp.x
      targetZ = bp.z + (isBlue ? 1.0 : -1.0)
    }

    // Nunca mira fora do campo (evita travar nas paredes)
    targetX = Math.max(-FIELD_W / 2 + 3, Math.min(FIELD_W / 2 - 3, targetX))
    targetZ = Math.max(-FIELD_L / 2 + 3, Math.min(FIELD_L / 2 - 3, targetZ))

    const dx = targetX - bc.pos.x
    const dz = targetZ - bc.pos.z
    const targetYaw = Math.atan2(dx, dz)

    let angleDiff = targetYaw - bc.yaw
    while (angleDiff > Math.PI)  angleDiff -= Math.PI * 2
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2

    const turnGain = this.botLevel === 'easy' ? 2.5 : this.botLevel === 'hard' ? 4.4 : 3.5
    const speedCap = this.botLevel === 'easy' ? 0.76 : this.botLevel === 'hard' ? 1.12 : 0.92
    const accel = this.botLevel === 'easy' ? 1.4 : this.botLevel === 'hard' ? 2.2 : 1.8

    // Giro suave humano do bot
    bc.yaw += Math.max(-2.6 * dt, Math.min(2.6 * dt, angleDiff * turnGain * dt))
    bc.steerFront(Math.max(-0.4, Math.min(0.4, angleDiff * 0.8)))

    // Acelera no chute quando alinhado com a bola
    const striking = distBall < 5.5 && Math.abs(angleDiff) < 0.55
    const baseSpeed = striking
      ? speedCap
      : Math.abs(angleDiff) < 0.6 ? speedCap * 0.92 : speedCap * 0.46
    bc.speed = Math.max(-0.3, Math.min(baseSpeed, bc.speed + accel * dt))

    // O bot pula se a bola estiver um pouco acima
    if (bp.y > 2.8 && distBall < 8.0 && bc.grounded) {
      bc.velY = 12
      bc.grounded = false
    }

    this.applyCarPhysics(bc, dt)
  }




  private updateBall(dt: number) {
    const b = this.ball

    // Gravidade
    b.vel.y -= this.studioParams.gravity * dt
    b.pos.addScaledVector(b.vel, dt)

    // Colisão com o solo & Atrito de rolamento no gramado
    if (b.pos.y <= BALL_R) {
      b.pos.y = BALL_R
      if (Math.abs(b.vel.y) > 0.5) {
        b.vel.y = -b.vel.y * this.studioParams.ballBounce // Quique configurável
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

    // ── VALIDAÇÃO DE GOL PROFUNDO & ANTI-GOL-CONTRA ──
    // Meta do Bot (z negativo): gol marcado pelo Jogador
    if (b.pos.z <= -FIELD_L / 2 && inGoalW && inGoalH) {
      if (this.lastToucher === 'bot') {
        // Anti-gol contra: zagueiro bot rebate na linha
        b.vel.z = Math.abs(b.vel.z) * 0.85 + 14
        b.vel.y = Math.max(b.vel.y, 4.5)
        this.audio.playWallBounce()
        this.showQuickChat('🛡️ SALVAMENTO NA LINHA!')
      } else if (b.pos.z <= -FIELD_L / 2 - BALL_R - 1.2) {
        // A bola deve entrar inteira na profundidade da rede para valer o gol!
        this.emitCartoonStarBurst(b.pos, 20, 0xffd23f)
        this.onGoalScored('player')
        return
      }
    }

    // Meta do Jogador (z positivo): gol marcado pelo Bot
    if (b.pos.z >= FIELD_L / 2 && inGoalW && inGoalH) {
      if (this.lastToucher === 'player') {
        // Anti-gol contra: jogador rebate na própria meta
        b.vel.z = -Math.abs(b.vel.z) * 0.85 - 14
        b.vel.y = Math.max(b.vel.y, 4.5)
        this.audio.playWallBounce()
        this.showQuickChat('🛡️ SALVAMENTO NA LINHA!')
      } else if (b.pos.z >= FIELD_L / 2 + BALL_R + 1.2) {
        // A bola deve entrar inteira na profundidade da rede para valer o gol!
        this.emitCartoonStarBurst(b.pos, 20, 0x00cfff)
        this.onGoalScored('bot')
        return
      }
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
        // POWER SHOT DO BUMPER FRONTAL (estilo Rocket League / Turbo Soccer)
        const powerF = (24 + carSpd * 32) * 1.55
        b.vel.x = Math.sin(car.yaw) * powerF + nx * 10
        b.vel.z = Math.cos(car.yaw) * powerF + nz * 10
        b.vel.y = Math.max(6.0, 10.0 + ny * 16)
        this.triggerCameraShake(0.55)
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
        // Colisão padrão lateral/traseira — também tiered e espacial
        const impF = 18 + carSpd * 22
        b.vel.x = nx * impF + Math.sin(car.yaw) * carSpd * 12
        b.vel.z = nz * impF + Math.cos(car.yaw) * carSpd * 12
        b.vel.y = Math.max(b.vel.y, 5.0 + ny * 12)
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

  private onGoalScored(scorer: 'player' | 'bot') {
    if (this.goalCooldown > 0) return
    this.goalCooldown = 4.2

    if (scorer === 'player') {
      this.scorePlayer++
      this.hudScoreP.textContent = String(this.scorePlayer)
      this.hudGoalTitle.textContent = '🎉 GOLAZO DO JOGADOR!'
      this.hudGoalTitle.style.color = '#ff6600'
      this.audio.playGoal()
      this.audio.playVictory()
      this.audio.playCheer()
    } else {
      this.scoreBot++
      this.hudScoreB.textContent = String(this.scoreBot)
      this.hudGoalTitle.textContent = '🤖 GOL DO BOT RIVAL!'
      this.hudGoalTitle.style.color = '#0088ff'
      this.audio.playGoal()
      this.audio.playCheer()
    }

    this.triggerGoalExplosion(this.ball.pos, this.goalExplosion, scorer)

    const sub = document.getElementById('turbo-goal-sub')!
    sub.textContent = `${this.scorePlayer} × ${this.scoreBot}`

    const endActions = document.getElementById('turbo-end-actions')
    if (endActions) endActions.style.display = 'none'
    this.hudGoalBanner.style.pointerEvents = 'none'

    this.hudGoalBanner.style.display = 'flex'
    this.drawScoreboard()

    setTimeout(() => {
      if (this.destroyed) return
      this.hudGoalBanner.style.display = 'none'
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
        car.vel.add(dir.multiplyScalar(force))
        car.vel.y += 20 * (1 - d / 95)
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

    setTimeout(() => {
      if (this.isReplaying) {
        this.stopGoalReplay()
      }
    }, 3500)
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

    this.replayPlaybackIdx += Math.max(1, Math.round(dt * 30))

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
      c.roll = cf.roll
      c.mesh.position.copy(cf.pos)
      c.mesh.rotation.set(cf.pitch, cf.yaw, cf.roll, 'YXZ')
    }

    this._camReplayTarget.copy(this.ball.pos).add(this._camOffset)
    this.camera.position.lerp(this._camReplayTarget, 0.12)
    this.camera.lookAt(this.ball.pos)
  }

  public activatePlayerRumble() {
    if (this.gameMode !== 'rumble' || !this.rumblePowerup || this.rumbleActive) return
    const p = this.rumblePowerup
    this.rumblePowerup = null

    if (p === 'shockwave') {
      this.triggerShockwave(this.playerCar.pos)
      this.rumbleTimer = 10.0
      this.updateRumbleHUD()
      this.showQuickChat('💨 ONDA DE CHOQUE!')
      return
    }

    if (p === 'magnet') {
      this.rumbleActive = { type: 'magnet', timeLeft: 4.0 }
      this.audio.playCheer()
      this.showQuickChat('🧲 ÍMÃ ATIVADO!')
    } else if (p === 'punch') {
      this.rumbleActive = { type: 'punch', timeLeft: 7.0 }
      this.audio.playGoal()
      this.showQuickChat('🔥 SUPER SOCO PRONTO!')
    } else if (p === 'overdrive') {
      this.rumbleActive = { type: 'overdrive', timeLeft: 5.0 }
      this.audio.playVictory()
      this.showQuickChat('⚡ NITRO OVERDRIVE!')
    }
    this.updateRumbleHUD()
  }

  private activateBotRumble(bot: CarObject, st: { powerup: RumblePowerup | null; timer: number; active: { type: RumblePowerup; timeLeft: number } | null }) {
    if (!st.powerup || st.active) return
    const p = st.powerup
    st.powerup = null

    if (p === 'shockwave') {
      this.triggerShockwave(bot.pos)
      st.timer = 11.0 + Math.random() * 4.0
      return
    }

    if (p === 'magnet') {
      st.active = { type: 'magnet', timeLeft: 3.5 }
    } else if (p === 'punch') {
      st.active = { type: 'punch', timeLeft: 6.0 }
    } else if (p === 'overdrive') {
      st.active = { type: 'overdrive', timeLeft: 4.5 }
      bot.boost = 100
    }
  }

  private triggerShockwave(origin: THREE.Vector3) {
    this.audio.playDemo()
    this.triggerCameraShake(0.9)
    this.emitCartoonStarBurst(origin, 28, 0x00cfff)

    for (const car of this.allCars) {
      const d = car.pos.distanceTo(origin)
      if (d > 0.5 && d < 44) {
        const dir = car.pos.clone().sub(origin).normalize()
        const force = (1 - d / 44) * 48
        car.vel.add(dir.multiplyScalar(force))
        car.vel.y += 18 * (1 - d / 44)
      }
    }

    const ballD = this.ball.pos.distanceTo(origin)
    if (ballD < 45) {
      const dir = this.ball.pos.clone().sub(origin).normalize()
      const force = (1 - ballD / 45) * 58
      this.ball.vel.add(dir.multiplyScalar(force))
      this.ball.vel.y += 16
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
        if (dist < 55 && dist > 2) {
          toCar.normalize()
          this.ball.vel.add(toCar.multiplyScalar(44 * dt))
          this.emitCartoonStarBurst(this.ball.pos.clone().addScaledVector(toCar, 0.5), 1, 0x00cfff)
        }
      } else if (this.rumbleActive.type === 'overdrive') {
        this.playerBoost = 100
        this.playerCar.speed = Math.max(this.playerCar.speed, 1.45)
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
          const pool: RumblePowerup[] = ['magnet', 'shockwave', 'punch', 'overdrive']
          st.powerup = pool[Math.floor(Math.random() * pool.length)]
        }
      }

      if (st.powerup && !st.active) {
        const d = bot.pos.distanceTo(this.ball.pos)
        if (st.powerup === 'magnet' && d < 40) {
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
    if (!this.hudRumbleCard || !this.hudRumbleIcon || !this.hudRumbleName) return
    if (this.gameMode !== 'rumble') {
      this.hudRumbleCard.style.display = 'none'
      return
    }

    this.hudRumbleCard.style.display = 'flex'

    if (this.rumbleActive) {
      const icons: Record<RumblePowerup, string> = {
        magnet: '🧲',
        shockwave: '💨',
        punch: '🔥',
        overdrive: '⚡'
      }
      const names: Record<RumblePowerup, string> = {
        magnet: 'ÍMÃ ATIVO',
        shockwave: 'CHOQUE!',
        punch: 'SUPER SOCO!',
        overdrive: 'OVERDRIVE!'
      }
      this.hudRumbleIcon.textContent = icons[this.rumbleActive.type]
      this.hudRumbleName.textContent = `${names[this.rumbleActive.type]} (${this.rumbleActive.timeLeft.toFixed(1)}s)`
      this.hudRumbleCard.style.borderColor = '#00ff88'
      this.hudRumbleCard.style.boxShadow = '0 0 25px rgba(0,255,136,0.7)'
      return
    }

    if (this.rumblePowerup) {
      const icons: Record<RumblePowerup, string> = {
        magnet: '🧲',
        shockwave: '💨',
        punch: '🔥',
        overdrive: '⚡'
      }
      const names: Record<RumblePowerup, string> = {
        magnet: 'ÍMÃ DA BOLA',
        shockwave: 'ONDA DE CHOQUE',
        punch: 'SUPER SOCO',
        overdrive: 'SUPER NITRO'
      }
      this.hudRumbleIcon.textContent = icons[this.rumblePowerup]
      this.hudRumbleName.textContent = names[this.rumblePowerup]
      this.hudRumbleCard.style.borderColor = '#ffd23f'
      this.hudRumbleCard.style.boxShadow = '0 0 25px rgba(255,210,63,0.7)'
      if (this.hudRumbleHint) this.hudRumbleHint.textContent = 'APERTE [R] OU CLIQUE!'
    } else {
      this.hudRumbleIcon.textContent = '⏳'
      this.hudRumbleName.textContent = `RECARGA: ${Math.ceil(this.rumbleTimer)}s`
      this.hudRumbleCard.style.borderColor = 'rgba(255,255,255,0.25)'
      this.hudRumbleCard.style.boxShadow = 'none'
      if (this.hudRumbleHint) this.hudRumbleHint.textContent = 'AGUARDE POWER-UP'
    }
  }

  private resetKickoff() {
    this.lastToucher = null
    this.ball.pos.set(0, BALL_R + 0.1, 0)
    this.ball.vel.set(0, 0, 0)

    if (this.isTraining) {
      this.playerCar.setPosition(0, 0, FIELD_L * 0.18)
      this.playerCar.yaw = Math.PI
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

    // Reposiciona todos os carros nos slots de kickoff
    const teamSize = this.orangeCars.length
    const orangeSpawnZ = [FIELD_L * 0.18, FIELD_L * 0.08, FIELD_L * 0.25, FIELD_L * 0.08]
    const orangeSpawnX = [0, -FIELD_W * 0.22, FIELD_W * 0.22, FIELD_W * 0.36]
    const blueSpawnZ   = [-FIELD_L * 0.18, -FIELD_L * 0.08, -FIELD_L * 0.25, -FIELD_L * 0.08]
    const blueSpawnX   = [0, FIELD_W * 0.22, -FIELD_W * 0.22, -FIELD_W * 0.36]

    for (let i = 0; i < teamSize; i++) {
      const oc = this.orangeCars[i]
      oc.setPosition(orangeSpawnX[i] ?? 0, 0, orangeSpawnZ[i] ?? FIELD_L * 0.18)
      oc.yaw = Math.PI
      oc.freeze()
      oc.applyTransform()
    }
    for (let i = 0; i < teamSize; i++) {
      const bc = this.blueCars[i]
      bc.setPosition(blueSpawnX[i] ?? 0, 0, blueSpawnZ[i] ?? -FIELD_L * 0.18)
      bc.yaw = 0
      bc.freeze()
      bc.applyTransform()
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


    if (!this.matchEnded && this.kickoffCountdown <= 0 && this.goalCooldown <= 0) {
      this.matchTimer = Math.max(0, this.matchTimer - dt)
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

    for (const p of this.smokePuffs) {
      this.scene.remove(p.mesh)
      ;(p.mesh.material as THREE.Material).dispose()
    }
    this.smokePuffs = []
    this.smokeGeo.dispose()

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

  private flameGroup!:   THREE.Group
  private wheels:        THREE.Group[] = []
  private steerWheels:   THREE.Group[] = []
  private shadowMesh!:   THREE.Mesh
  private scene:         THREE.Scene
  private teamColor:     number
  private isBot:         boolean

  constructor(scene: THREE.Scene, color: number, isBot: boolean) {
    this.scene     = scene
    this.teamColor = color
    this.isBot     = isBot

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

  async loadModel(modelId: string): Promise<void> {
    const file = CAR_MODELS[modelId]?.file || '/models/vehicle-truck-red.glb'

    return new Promise((resolve) => {
      let resolved = false
      const done = () => {
        if (!resolved) {
          resolved = true
          resolve()
        }
      }
      setTimeout(done, 3500)

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
                const origColor = origMat.color && typeof origMat.color.clone === 'function'
                  ? origMat.color.clone()
                  : new THREE.Color(this.teamColor)
                const origMap = origMat.map || null
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
          const underglow = new THREE.PointLight(this.teamColor, 2.2, 9)
          underglow.position.set(0, 0.4, 0)
          this.group.add(underglow)

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
    if (this.flameGroup?.visible) {
      const sc = 0.85 + Math.sin(Date.now() * 0.04) * 0.25
      this.flameGroup.scale.set(sc, sc, sc * 1.1)
    }
    this.wheels.forEach(w => {
      w.rotation.x = this.wheelSpinAngle
    })
    void dt
  }
}
