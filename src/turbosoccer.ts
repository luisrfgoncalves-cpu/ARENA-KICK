// ============================================================

//  100% CARTOON: Cel-Shading com OutlineEffect & MeshToonMaterial,



//  Countdown 3.. 2.. 1.. VAI! com Sons Procedurais e Bot Justo e Divertido
// ============================================================
import * as THREE from 'three'
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import confetti from 'canvas-confetti'
import GUI from 'lil-gui'
import { GamepadManager } from './gamepad'
import { initAudio, AudioManager, setAudioMuted, isAudioMuted } from './audio'
import { CAR_MODELS } from './carModels'


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

export type TurboTheme = 'classic' | 'cyber' | 'futsal'

export type TurboBotLevel = 'easy' | 'medium' | 'hard'
export type TurboMatchFormat = '1v1' | '2v2' | '3v3' | '4v4'

export interface TurboTuning {
  playerSpeedMult?: number
  turnRate?: number
  jumpForce?: number
  ballBounce?: number
  theme?: TurboTheme
  botLevel?: TurboBotLevel
  matchFormat?: TurboMatchFormat
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
  private clock          = new THREE.Clock()
  private animId         = 0
  private isRunning      = true
  private destroyed      = false
  private paused         = false
  private pauseOverlay: HTMLElement | null = null

  private isTouchDevice  = 'ontouchstart' in window || navigator.maxTouchPoints > 0
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

  constructor(container: HTMLElement, carModelId = 'octane-cartoon', tuning?: TurboTuning) {
    this.container = container
    this.selectedCarModelId = carModelId
    this.theme = tuning?.theme ?? 'classic'
    this.botLevel = tuning?.botLevel ?? 'medium'
    this.matchFormat = tuning?.matchFormat ?? '1v1'

    if (tuning) {
      if (tuning.playerSpeedMult !== undefined) this.studioParams.playerSpeedMult = tuning.playerSpeedMult
      if (tuning.turnRate !== undefined) this.studioParams.turnRate = tuning.turnRate
      if (tuning.jumpForce !== undefined) this.studioParams.jumpForce = tuning.jumpForce
      if (tuning.ballBounce !== undefined) this.studioParams.ballBounce = tuning.ballBounce
    }

    initAudio()
    this.audio = new AudioManager()

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
    const themeBg = this.theme === 'cyber' ? 0x0b1020 : this.theme === 'futsal' ? 0x1e293b : 0x38bdf8
    this.scene.background = new THREE.Color(themeBg)


    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 1000)

    // 3. WebGLRenderer com Cores Vivas
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
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

      // Carrega modelos 3D em segundo plano
      void this.playerCar.loadModel(this.selectedCarModelId)
      for (let i = 1; i < this.orangeCars.length; i++) {
        void this.orangeCars[i].loadModel(this.selectedCarModelId)
      }
      void this.botCar.loadModel('cartoon-yellow')
      for (let i = 1; i < this.blueCars.length; i++) {
        void this.blueCars[i].loadModel('cartoon-yellow')
      }
    } catch (err) {
      console.error('[TurboSoccer] Falha crítica no initAsync:', err)
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true
    if (e.code === 'KeyC') {
      this.triggerBarrelRoll()
    }
    if (e.code === 'KeyH') {
      this.toggleStudioGUI()
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault()
      this.togglePause()
    }
    // Teclas de Quick Chat / Emote (1, 2, 3, 4)
    if (e.code === 'Digit1') this.showQuickChat('⚽ Golaço! VAI!')
    if (e.code === 'Digit2') this.showQuickChat('🛡️ Grande defesa!')
    if (e.code === 'Digit3') this.showQuickChat('⚡ Passa a bola aqui!')
    if (e.code === 'Digit4') this.showQuickChat('🔥 Que manobra!')
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false
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
    sun.shadow.mapSize.set(2048, 2048)
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

    const grassA = this.theme === 'cyber' ? '#0b1220' : this.theme === 'futsal' ? '#b45309' : '#22c55e'
    const grassB = this.theme === 'cyber' ? '#1e1b4b' : this.theme === 'futsal' ? '#92400e' : '#16a34a'
    const lineCol = this.theme === 'cyber' ? '#00cfff' : '#ffffff'


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
    if (!this.isTouchDevice) return
    const wrap = document.createElement('div')
    wrap.id = 'turbo-touch-controls'
    wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:120;'

    const mk = (id: string, label: string, style: string) => {
      const b = document.createElement('button')
      b.id = id
      b.textContent = label
      b.style.cssText =
        'position:absolute;pointer-events:all;border-radius:50%;border:2px solid rgba(255,255,255,0.5);' +
        'background:rgba(15,23,42,0.7);color:white;font-weight:900;user-select:none;touch-action:none;' + style
      wrap.appendChild(b)
      return b
    }

    const left  = mk('tt-left',  '◄', 'left:22px;bottom:150px;width:64px;height:64px;font-size:22px;')
    const right = mk('tt-right', '►', 'left:98px;bottom:150px;width:64px;height:64px;font-size:22px;')
    const accel = mk('tt-accel', '▲', 'right:22px;bottom:230px;width:64px;height:64px;font-size:22px;')
    const brake = mk('tt-brake', '▼', 'right:22px;bottom:150px;width:64px;height:64px;font-size:22px;')
    const boost = mk('tt-boost', 'N2O', 'right:98px;bottom:120px;width:64px;height:64px;font-size:12px;')
    const jump  = mk('tt-jump',  'FLIP', 'right:22px;bottom:72px;width:64px;height:64px;font-size:12px;')
    const drift = mk('tt-drift', 'DRIFT', 'right:22px;bottom:34px;width:64px;height:64px;font-size:10px;')
    const roll  = mk('tt-roll',  'ROLL',  'right:98px;bottom:34px;width:64px;height:64px;font-size:10px;')

    root.appendChild(wrap)

    const bind = (el: HTMLElement, on: () => void, off: () => void) => {
      el.addEventListener('pointerdown', e => { e.preventDefault(); on() })
      el.addEventListener('pointerup', e => { e.preventDefault(); off() })
      el.addEventListener('pointerleave', off)
      el.addEventListener('pointercancel', off)
    }

    bind(left,  () => { this.touch.steer = -1 }, () => { if (this.touch.steer === -1) this.touch.steer = 0 })
    bind(right, () => { this.touch.steer = 1 },  () => { if (this.touch.steer === 1) this.touch.steer = 0 })
    bind(accel, () => { this.touch.throttle = 1 },  () => { if (this.touch.throttle === 1) this.touch.throttle = 0 })
    bind(brake, () => { this.touch.throttle = -1 }, () => { if (this.touch.throttle === -1) this.touch.throttle = 0 })
    bind(boost, () => { this.touch.boost = true },  () => { this.touch.boost = false })
    bind(jump,  () => { this.touch.jump = true },   () => { this.touch.jump = false })
    bind(drift, () => { this.touch.drift = true },  () => { this.touch.drift = false })
    bind(roll,  () => { this.touch.roll = true },    () => { this.touch.roll = false })
  }


  //  LOOP PRINCIPAL DO JOGO

  private loop = () => {
    if (!this.isRunning) return
    this.animId = requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta(), 0.05)

    if (!this.paused) {
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
        this.updatePlayerInput(dt)
        this.updateBotAI(dt)
        this.resolveCarCarCollision()
        this.updateBall(dt)
        this.updateDynamicObstacles(dt)
        this.updateBoostCoins(dt)
        this.updateDemoRespawn(dt)
      } else {
        for (const car of this.allCars) car.freeze()
      }

      this.updateSmoke(dt)
      this.updateCrowd(dt)
      this.updateCamera(dt)
      this.updateHUD(dt)
      for (const car of this.allCars) car.update(dt)
      this.audio.updateEngine(Math.min(1, Math.abs(this.playerCar.speed) / 1.3), this.playerBoosting)
    } else {
      this.audio.updateEngine(0, false)
    }

    // Renderiza com Contorno Cartoon Cel-Shaded
    this.outlineEffect.render(this.scene, this.camera)
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
      pc.boost = Math.max(0, pc.boost - 32 * dt)
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

    // ── CONTROLE AÉREO CONTÍNUO (PITCH E ROLL NO AR — Rocket League / Turbo Soccer) ──
    if (!pc.grounded && pc.flipTimer <= 0 && !pc.flipLocked) {
      let pitchInput = 0
      let rollInput = 0
      if (gp.connected) {
        if (Math.abs(gp.stickY) > 0.18) pitchInput = -gp.stickY // frente (-stickY) = pitch DOWN (+), trás = pitch UP (-)
        if (Math.abs(gp.steerX) > 0.18) rollInput = gp.steerX
      } else {
        if (this.keys['KeyW'] || this.keys['ArrowUp'])   pitchInput = 1
        if (this.keys['KeyS'] || this.keys['ArrowDown']) pitchInput = -1
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) rollInput = -1
        if (this.keys['KeyD'] || this.keys['ArrowRight']) rollInput = 1
      }

      if (pitchInput !== 0) {
        pc.aerialPitch += pitchInput * 3.5 * dt
      } else {
        pc.aerialPitch *= 0.90
      }
      if (rollInput !== 0) {
        pc.aerialRoll += rollInput * 3.5 * dt
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

    // ── MOVIMENTO HORIZONTAL NO SOLO ──
    if (car.grounded) {
      const spd = car.speed * 50 * dt
      car.pos.x += Math.sin(car.yaw) * spd
      car.pos.z += Math.cos(car.yaw) * spd
      car.pitch = car.aerialPitch
    }

    // Aplica pitch/roll visual aereo
    car.pitch     = car.aerialPitch
    car.rollAngle = car.isRolling ? car.rollAngle : car.aerialRoll

    const limX = FIELD_W / 2 - 2.8
    const limZ = FIELD_L / 2 - 2.8
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
          this.triggerCameraShake(0.35)
          this.audio.playPowerHit()
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
      if (car === this.playerCar || car.isDemoed) continue
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
      const grassFriction = Math.pow(0.978, dt * 60)
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
        this.audio.playPowerHit()
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
        // Colisão padrão lateral/traseira
        const impF = 18 + carSpd * 22
        b.vel.x = nx * impF + Math.sin(car.yaw) * carSpd * 12
        b.vel.z = nz * impF + Math.cos(car.yaw) * carSpd * 12
        b.vel.y = Math.max(b.vel.y, 5.0 + ny * 12)
        this.audio.playHit()
        this.triggerCameraShake(0.25)
      }

      const maxBallSpeed = 52
      if (b.vel.length() > maxBallSpeed) {
        b.vel.setLength(maxBallSpeed)
      }
    }
  }




  private updateCamera(dt: number) {
    const pc = this.playerCar
    let targetPos: THREE.Vector3
    let targetLook: THREE.Vector3

    if (this.isBallCam) {

      const toBall = new THREE.Vector3(this.ball.pos.x - pc.pos.x, 0, this.ball.pos.z - pc.pos.z)
      const ballDist = toBall.length()
      const ballDir = ballDist > 0.5 ? toBall.normalize() : new THREE.Vector3(0, 0, -1)
      const camDir = ballDir.clone().negate()


      const sinH = Math.sin(this.camOrbitH), cosH = Math.cos(this.camOrbitH)
      const od = new THREE.Vector3(
        camDir.x * cosH - camDir.z * sinH,
        0,
        camDir.x * sinH + camDir.z * cosH
      )


      const CAM_DIST = this.studioParams.camDist
      const CAM_H    = this.studioParams.camH + this.camOrbitV * 4.0

      targetPos = new THREE.Vector3(
        pc.pos.x + od.x * CAM_DIST,
        pc.pos.y + CAM_H,
        pc.pos.z + od.z * CAM_DIST
      )


      if (ballDist < 8.0) {
        targetPos.y += (8.0 - ballDist) * 0.45
      }

      // Olha para um ponto ligeiramente acima do meio entre carro e bola
      targetLook = pc.pos.clone().lerp(this.ball.pos, 0.35)
      targetLook.y = Math.max(pc.pos.y + 1.8, this.ball.pos.y * 0.45 + 1.6)

    } else {

      const CAM_DIST = this.studioParams.camDist
      const CAM_H    = this.studioParams.camH + this.camOrbitV * 3.5

      const ya = pc.yaw + this.camOrbitH
      targetPos = new THREE.Vector3(
        pc.pos.x - Math.sin(ya) * CAM_DIST,
        pc.pos.y + CAM_H,
        pc.pos.z - Math.cos(ya) * CAM_DIST
      )


      targetLook = new THREE.Vector3(
        pc.pos.x + Math.sin(pc.yaw) * 6.5,
        pc.pos.y + 2.0,
        pc.pos.z + Math.cos(pc.yaw) * 6.5
      )
    }


    targetPos.y = Math.max(2.6, targetPos.y)


    this.camCurrentPos.lerp(targetPos, 12 * dt)
    this.camCurrentLook.lerp(targetLook, 14 * dt)

    this.camera.position.copy(this.camCurrentPos)
    if (this.camShakeIntensity > 0.01) {
      const sx = (Math.random() - 0.5) * 2 * this.camShakeIntensity
      const sy = (Math.random() - 0.5) * 2 * this.camShakeIntensity
      const sz = (Math.random() - 0.5) * 2 * this.camShakeIntensity
      this.camera.position.add(new THREE.Vector3(sx, sy, sz))
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
    this.goalCooldown = 3.5

    if (scorer === 'player') {
      this.scorePlayer++
      this.hudScoreP.textContent = String(this.scorePlayer)
      this.hudGoalTitle.textContent = '🎉 GOLAZO DO JOGADOR!'
      this.hudGoalTitle.style.color = '#ff6600'
      this.audio.playGoal()
      this.audio.playVictory()
      this.audio.playCheer()


      this.emitCartoonStarBurst(this.ball.pos, 24, scorer === 'player' ? 0xffd23f : 0x00cfff)
      this.triggerCameraShake(0.85)
      confetti({
        particleCount: 120,
        spread: 90,
        origin: { y: 0.55 },
        colors: ['#ff5500', '#facc15', '#22c55e', '#38bdf8', '#ffffff']
      })
    } else {
      this.scoreBot++
      this.hudScoreB.textContent = String(this.scoreBot)
      this.hudGoalTitle.textContent = '🤖 GOL DO BOT RIVAL!'
      this.hudGoalTitle.style.color = '#0088ff'
      this.audio.playGoal()
      this.audio.playCheer()
    }

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
      this.resetKickoff()
    }, 2800)
  }

  private resetKickoff() {
    this.lastToucher = null
    this.ball.pos.set(0, BALL_R + 0.1, 0)
    this.ball.vel.set(0, 0, 0)

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
    const arc = document.getElementById('nitro-arc')
    if (arc) {
      arc.setAttribute('stroke-dashoffset', String(301.6 * (1 - bv / 100)))
      arc.setAttribute('stroke', bv > 50 ? '#ff6600' : bv > 25 ? '#ffaa00' : '#ef4444')
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

    // Remove todos os carros da cena
    for (const car of this.allCars) {
      this.scene.remove(car.group)
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
    this.buildSculptedCar()
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
      // Timeout de segurança: se o carregamento demorar, segue com o carro escupido
      setTimeout(done, 2500)

      const loader = new GLTFLoader()
      loader.load(
        file,
        (gltf) => {
          try {
            while (this.group.children.length > 0) {
              this.group.remove(this.group.children[0])
            }
            this.wheels = []
            this.steerWheels = []

            const model = gltf.scene
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

            model.traverse((child) => {
              const cname = (child.name || '').toLowerCase()
              if (cname.includes('wheel') || cname.includes('tire') || cname.includes('roda')) {
                this.wheels.push(child as any)
                if (cname.includes('front') || cname.includes('f_') || cname.includes('diant')) {
                  this.steerWheels.push(child as any)
                }
              }

              if ((child as THREE.Mesh).isMesh) {
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
            this.buildSculptedCar()
            done()
          }
        },
        undefined,
        () => {
          // Fallback gracioso se houver falha de rede
          this.buildSculptedCar()
          done()
        }
      )
    })
  }


  private buildSculptedCar() {
    const bodyMat = new THREE.MeshToonMaterial({
      color: this.teamColor,
      gradientMap: TOON_GRADIENT
    })
    const darkChassiMat = new THREE.MeshToonMaterial({
      color: 0x0f172a,
      gradientMap: TOON_GRADIENT
    })
    const stripeMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      gradientMap: TOON_GRADIENT
    })
    const cabinMat = new THREE.MeshToonMaterial({
      color: 0x1e293b,
      gradientMap: TOON_GRADIENT
    })
    const rimMat = new THREE.MeshToonMaterial({
      color: 0xfacc15, // Dourado cartoon
      gradientMap: TOON_GRADIENT
    })

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px=0, py=0, pz=0, rx=0, ry=0, rz=0) => {
      const m = new THREE.Mesh(geo, mat)
      m.castShadow = true
      m.receiveShadow = true
      m.position.set(px, py, pz)
      m.rotation.set(rx, ry, rz)
      this.group.add(m)
      return m
    }


    add(new THREE.BoxGeometry(2.8, 0.75, 5.2), bodyMat, 0, 0.65, 0)
    add(new THREE.BoxGeometry(2.95, 0.25, 5.4), darkChassiMat, 0, 0.2, 0)


    add(new THREE.BoxGeometry(2.6, 0.5, 1.9), bodyMat, 0, 0.98, 2.1, 0.12)
    add(new THREE.BoxGeometry(2.5, 0.35, 0.6), darkChassiMat, 0, 0.45, 2.8)

    // 3. Cockpit / Cabine Toon Arredondada
    add(new THREE.BoxGeometry(2.2, 0.75, 2.5), cabinMat, 0, 1.6, -0.35, -0.05)
    // Brilho de reflexo branco no vidro
    add(new THREE.BoxGeometry(1.8, 0.55, 0.04), stripeMat, 0, 1.62, 0.95, -0.3)

    // 4. Traseira & Spoiler Esportivo
    add(new THREE.BoxGeometry(2.5, 0.55, 1.1), bodyMat, 0, 1.0, -2.4)

    add(new THREE.BoxGeometry(3.1, 0.15, 0.85), bodyMat, 0, 2.05, -2.55)
    for (const sx of [-1.55, 1.55]) {
      add(new THREE.BoxGeometry(0.08, 0.45, 0.9), darkChassiMat, sx, 2.15, -2.55)
    }
    for (const sx of [-1.05, 1.05]) {
      add(new THREE.BoxGeometry(0.12, 0.6, 0.14), darkChassiMat, sx, 1.72, -2.55)
    }

    // 5. Faixas Duplas de Corrida Brancas no Centro
    for (const sx of [-0.3, 0.3]) {
      add(new THREE.BoxGeometry(0.2, 0.05, 4.8), stripeMat, sx, 1.3, 0)
    }


    const ledMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff })
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff0044 })
    for (const sx of [-0.95, 0.95]) {
      add(new THREE.BoxGeometry(0.5, 0.22, 0.08), ledMat, sx, 0.85, 2.65)
      add(new THREE.BoxGeometry(0.65, 0.25, 0.08), tailMat, sx, 0.85, -2.65)
    }

    // Escapamentos Duplos Cartoon
    const pipeMat = new THREE.MeshToonMaterial({ color: 0x334155, gradientMap: TOON_GRADIENT })
    const innerPipeMat = new THREE.MeshBasicMaterial({ color: 0xff4400 })
    for (const sx of [-0.65, 0.65]) {
      add(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 12), pipeMat, sx, 0.5, -2.75, Math.PI / 2)
      add(new THREE.CircleGeometry(0.14, 12), innerPipeMat, sx, 0.5, -2.96, 0, Math.PI)
    }

    // Luz Neon Underglow sob o Chassi Cartoon
    const underglow = new THREE.PointLight(this.teamColor, 2.0, 8.5)
    underglow.position.set(0, 0.35, 0)
    this.group.add(underglow)

    // 7. Rodas Grandes Cartoon
    const wheelPositions: [number, number, number, boolean][] = [
      [-1.55, 0.65, 1.6, true],   // Dianteira Esquerda
      [1.55, 0.65, 1.6, true],    // Dianteira Direita
      [-1.55, 0.65, -1.6, false], // Traseira Esquerda
      [1.55, 0.65, -1.6, false]   // Traseira Direita
    ]

    this.wheels = []
    this.steerWheels = []
    const tireGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.6, 24)
    const tireMat = new THREE.MeshToonMaterial({
      color: 0x0f172a,
      gradientMap: TOON_GRADIENT
    })

    wheelPositions.forEach(([wx, wy, wz, isFront]) => {
      const wg = new THREE.Group()

      const spinGroup = new THREE.Group()
      const tire = new THREE.Mesh(tireGeo, tireMat)
      tire.rotation.z = Math.PI / 2
      tire.castShadow = true
      spinGroup.add(tire)

      // Roda com Estrela Amarela Central
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.64, 12), rimMat)
      rim.rotation.z = Math.PI / 2
      spinGroup.add(rim)

      wg.add(spinGroup)
      wg.position.set(wx, wy, wz)
      this.group.add(wg)

      this.wheels.push(spinGroup)
      if (isFront) this.steerWheels.push(wg)
    })

    // Fogo de Nitro Traseiro
    this.flameGroup = this.buildFlame()
    this.group.add(this.flameGroup)


    this.shadowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(2.9, 24),
      new THREE.MeshBasicMaterial({ color: 0x0a1020, transparent: true, opacity: 0.4 })
    )
    this.shadowMesh.rotation.x = -Math.PI / 2
    this.shadowMesh.position.set(this.pos.x, 0.04, this.pos.z)
    this.scene.add(this.shadowMesh)
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
