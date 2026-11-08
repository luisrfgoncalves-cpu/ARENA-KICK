// ============================================================
//  arenaKongController.ts — Controlador IA e Física de Contato Real
//  Kong Gorak na Arena Kong (Versão com 11 Animações Embutidas & Hitboxes)
// ============================================================
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type KongState =
  | 'PATROL'
  | 'CHASE_BALL'
  | 'RAGE'
  | 'PUNCH_CAR'
  | 'PUNCH_BALL'
  | 'KICK_BALL'
  | 'KICK_CAR'
  | 'GRAB_BALL'
  | 'HOLD_BALL'
  | 'THROW_BALL'
  | 'BUTT_SLAM'
  | 'RECOVER'

export interface KongPhysicsAdapter {
  applyImpulse?: (target: any, impulse: THREE.Vector3, worldPoint?: THREE.Vector3) => void
  applyAngularImpulse?: (target: any, angImpulse: THREE.Vector3, worldPoint?: THREE.Vector3) => void
  setKinematic?: (target: any, isKinematic: boolean) => void
  setSensor?: (target: any, isSensor: boolean) => void
}

export interface KongCameraAdapter {
  shake?: (duration: number, intensity: number) => void
}

export interface KongEffectsAdapter {
  kick?: (pos?: THREE.Vector3) => void
  punch?: (pos?: THREE.Vector3) => void
  grab?: (pos?: THREE.Vector3) => void
  throw?: (pos?: THREE.Vector3) => void
  slam?: (pos?: THREE.Vector3) => void
  rage?: (k: number) => void
  onState?: (state: KongState) => void
}

interface BoneMap {
  all: THREE.Bone[]
  hips?: THREE.Bone
  pelvis?: THREE.Bone
  spine?: THREE.Bone
  head?: THREE.Bone
  leftUpperArm?: THREE.Bone
  rightUpperArm?: THREE.Bone
  leftForearm?: THREE.Bone
  rightForearm?: THREE.Bone
  leftHand?: THREE.Bone
  rightHand?: THREE.Bone
  leftThigh?: THREE.Bone
  rightThigh?: THREE.Bone
  leftShin?: THREE.Bone
  rightShin?: THREE.Bone
  leftFoot?: THREE.Bone
  rightFoot?: THREE.Bone
}

interface HitboxItem {
  object: THREE.Mesh
  radiusLocal: number
  bone: THREE.Bone
}

const ATTACK_DURATION: Record<string, number> = {
  RAGE: 1.55,
  PUNCH_CAR: 0.92,
  PUNCH_BALL: 0.92,
  KICK_BALL: 1.05,
  KICK_CAR: 1.05,
  GRAB_BALL: 0.9,
  HOLD_BALL: 1.1,
  THROW_BALL: 0.95,
  BUTT_SLAM: 2.2,
  RECOVER: 0.45
}

// Janela normalizada de tempo [início, fim] onde o golpe tem contato físico
const CONTACT_WINDOW: Record<string, [number, number]> = {
  PUNCH_CAR: [0.30, 0.75],
  PUNCH_BALL: [0.30, 0.75],
  KICK_BALL: [0.32, 0.78],
  KICK_CAR: [0.32, 0.78],
  GRAB_BALL: [0.25, 0.80]
}

export class KongGorak {
  public rootGroup = new THREE.Group()
  public model: THREE.Object3D | null = null
  public mixer: THREE.AnimationMixer | null = null
  public clips: Record<string, THREE.AnimationClip> = {}
  public actions: Record<string, THREE.AnimationAction> = {}

  public state: KongState = 'PATROL'
  public stateTime = 0
  public actionCooldown = 0
  public slamTimer = 8.0 // Temporizador para o Butt Slam periódico
  public walkSpeed = 9.5
  public walkDirection = 1
  public impactRadius = 40.0

  private _hitDone = false
  private _heldBall: any = null
  private _currentAction: THREE.AnimationAction | null = null
  private _currentLocoClip = ''
  private _bones: BoneMap = { all: [] }
  private _hitboxes: Record<string, HitboxItem> = {}

  // Pulo do Butt Slam
  private _slamBaseY = 0
  private _slamLanded = false

  private scene: THREE.Scene
  private ball: any
  private getCars: () => any[]
  private physics: KongPhysicsAdapter
  private camera: KongCameraAdapter
  private effects: KongEffectsAdapter

  constructor({
    scene,
    ball,
    getCars,
    physics = {},
    camera = {},
    effects = {}
  }: {
    scene: THREE.Scene
    ball: any
    getCars: () => any[]
    physics?: KongPhysicsAdapter
    camera?: KongCameraAdapter
    effects?: KongEffectsAdapter
  }) {
    this.scene = scene
    this.ball = ball
    this.getCars = getCars
    this.physics = physics
    this.camera = camera
    this.effects = effects
    this.rootGroup.name = 'KongGorakEntity'
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader()
    try {
      // Carrega o GLB com 11 clipes completos
      const gltf = await loader.loadAsync('/assets/arena-kong/arena-kong-gorak-final-complete.glb')
      this.model = gltf.scene
      this.model.name = 'KongGorakModel'

      // Ajusta para altura colossal de ~27 metros (proporcional ao estádio de 220x360 e teto 58m)
      const bbox = new THREE.Box3().setFromObject(this.model)
      const size = bbox.getSize(new THREE.Vector3())
      const targetHeight = 27.0
      if (size.y > 0.1) {
        const scale = targetHeight / size.y
        this.model.scale.setScalar(scale)
      }

      // Posição inicial: ao lado da bola no círculo central virado para o meio
      this.rootGroup.position.set(18, 0, 0)
      this.rootGroup.rotation.y = -Math.PI / 2

      this.model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.castShadow = true
          mesh.receiveShadow = true
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            mats.forEach((m: any) => {
              if (m.map) m.map.colorSpace = THREE.SRGBColorSpace
            })
          }
        }
      })

      // Mapeamento dos ossos e criação das Hitboxes físicas
      this._bones = this._findBones(this.model)
      this._hitboxes = this._createHitboxes(this.model.scale.x)

      // AnimationMixer com todos os clipes do arquivo final
      this.mixer = new THREE.AnimationMixer(this.model)
      gltf.animations.forEach((clip) => {
        const key = clip.name.toLowerCase().replace(/\s+/g, '_')
        this.clips[key] = clip
        const action = this.mixer!.clipAction(clip)
        this.actions[key] = action

        // Configuração de loop
        if (['idle', 'standing_relax', 'walk', 'hold_ball'].includes(key)) {
          action.setLoop(THREE.LoopRepeat, Infinity)
        } else {
          action.setLoop(THREE.LoopOnce, 1)
          action.clampWhenFinished = true
        }
      })

      console.log('[KongGorak] Clipes carregados:', Object.keys(this.clips))

      // Inicia caminhando com o clipe walk oficial
      this._playLocomotion('walk')

      this.rootGroup.add(this.model)
    } catch (err) {
      console.error('[KongGorak] Erro ao carregar GLB animado final:', err)
      this._createProceduralFallback()
    }
  }

  private _findBones(root: THREE.Object3D): BoneMap {
    const all: THREE.Bone[] = []
    root.traverse((object) => {
      if ((object as THREE.Bone).isBone) all.push(object as THREE.Bone)
    })

    const findExact = (...terms: string[]): THREE.Bone | undefined => {
      for (const t of terms) {
        const found = all.find((b) => b.name.toLowerCase() === t.toLowerCase())
        if (found) return found
      }
      for (const t of terms) {
        const cleanT = t.toLowerCase().replace(/[^a-z0-9]/g, '')
        const found = all.find((b) => {
          const cleanB = b.name.toLowerCase().replace(/[^a-z0-9]/g, '')
          return cleanB.includes(cleanT) && !cleanB.includes('twist') && !cleanB.includes('roll')
        })
        if (found) return found
      }
      return undefined
    }

    const pelvis = findExact('Pelvis', 'Hips', 'Hip', 'Waist')
    return {
      all,
      hips: pelvis,
      pelvis,
      spine: findExact('Spine02', 'Spine01', 'Spine'),
      head: findExact('Head'),
      leftUpperArm: findExact('L_Upperarm', 'L_UpperArm', 'LeftUpperArm'),
      rightUpperArm: findExact('R_Upperarm', 'R_UpperArm', 'RightUpperArm'),
      leftForearm: findExact('L_Forearm', 'LeftForearm'),
      rightForearm: findExact('R_Forearm', 'RightForearm'),
      leftHand: findExact('L_Hand', 'LeftHand'),
      rightHand: findExact('R_Hand', 'RightHand'),
      leftThigh: findExact('L_Thigh', 'LeftThigh'),
      rightThigh: findExact('R_Thigh', 'RightThigh'),
      leftShin: findExact('L_Calf', 'LeftCalf', 'LeftShin'),
      rightShin: findExact('R_Calf', 'RightCalf', 'RightShin'),
      leftFoot: findExact('L_Foot', 'LeftFoot'),
      rightFoot: findExact('R_Foot', 'RightFoot')
    }
  }

  // Cria esferas de colisão física reais presas aos ossos de impacto
  private _createHitboxes(modelScale: number): Record<string, HitboxItem> {
    const result: Record<string, HitboxItem> = {}
    const defs: Record<string, { bone?: THREE.Bone; radius: number; offset: [number, number, number] }> = {
      leftHand: { bone: this._bones.leftHand, radius: 2.2, offset: [0, 0, 0] },
      rightHand: { bone: this._bones.rightHand, radius: 2.2, offset: [0, 0, 0] },
      rightFoot: { bone: this._bones.rightFoot, radius: 2.5, offset: [0, 0, 0] },
      leftFoot: { bone: this._bones.leftFoot, radius: 2.5, offset: [0, 0, 0] },
      pelvis: { bone: this._bones.pelvis, radius: 4.0, offset: [0, 0, 0] }
    }

    const mat = new THREE.MeshBasicMaterial({ visible: false })
    for (const [name, def] of Object.entries(defs)) {
      if (!def.bone) continue
      // Raio ajustado pelo scale do modelo
      const localRadius = def.radius / (modelScale || 1.0)
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(localRadius, 8, 6), mat)
      mesh.name = `KongHitbox_${name}`
      mesh.position.set(...def.offset)
      mesh.visible = false
      def.bone.add(mesh)
      result[name] = { object: mesh, radiusLocal: localRadius, bone: def.bone }
    }
    return result
  }

  public getBallPosition(): THREE.Vector3 | null {
    if (!this.ball) return null
    if (this.ball.pos && typeof this.ball.pos.x === 'number') return this.ball.pos
    if (this.ball.position && typeof this.ball.position.x === 'number') return this.ball.position
    if (this.ball.mesh && this.ball.mesh.position) return this.ball.mesh.position
    return null
  }

  public getCarPosition(car: any): THREE.Vector3 | null {
    if (!car) return null
    if (car.pos && typeof car.pos.x === 'number') return car.pos
    if (car.position && typeof car.position.x === 'number') return car.position
    if (car.group && car.group.position) return car.group.position
    return null
  }

  // Rotação suave do rootEntity em direção ao alvo
  private _smoothLookAt(target: THREE.Vector3, dt: number) {
    const dx = target.x - this.rootGroup.position.x
    const dz = target.z - this.rootGroup.position.z
    if (dx * dx + dz * dz < 0.1) return

    // Ângulo onde o modelo fica de frente para o alvo
    const targetYaw = Math.atan2(dx, dz)
    let diff = targetYaw - this.rootGroup.rotation.y
    while (diff < -Math.PI) diff += Math.PI * 2
    while (diff > Math.PI) diff -= Math.PI * 2

    this.rootGroup.rotation.y += diff * Math.min(1, dt * 5.0)
  }

  public update(dt: number) {
    if (!this.model) return

    const safeDt = Math.min(dt, 0.05)
    this.stateTime += safeDt
    this.actionCooldown = Math.max(0, this.actionCooldown - safeDt)
    this.slamTimer = Math.max(0, this.slamTimer - safeDt)

    // 1. Atualização do AnimationMixer
    if (this.mixer) {
      this.mixer.update(safeDt)
    }

    // 2. Mantém a bola na mão se estiver em agarre/espera
    if (this._heldBall) {
      this._keepBallInHand()
    }

    // 3. Máquina de Estados
    switch (this.state) {
      case 'PATROL':
        this._patrol(safeDt)
        break
      case 'CHASE_BALL':
        this._chaseBall(safeDt)
        break
      case 'RAGE':
        this._updateAttackState('roar_rage', ATTACK_DURATION.RAGE)
        break
      case 'PUNCH_CAR':
      case 'PUNCH_BALL':
        this._updatePunch(safeDt)
        break
      case 'KICK_BALL':
      case 'KICK_CAR':
        this._updateKick(safeDt)
        break
      case 'GRAB_BALL':
        this._updateGrab(safeDt)
        break
      case 'HOLD_BALL':
        this._updateHold(safeDt)
        break
      case 'THROW_BALL':
        this._updateThrow(safeDt)
        break
      case 'BUTT_SLAM':
        this._updateSlam(safeDt)
        break
      case 'RECOVER':
        if (this.stateTime > ATTACK_DURATION.RECOVER) this._finish('CHASE_BALL')
        break
      default:
        this._start('PATROL')
    }

    // 4. Decisão de combate contínua durante caminhada
    if ((this.state === 'PATROL' || this.state === 'CHASE_BALL') && this.actionCooldown <= 0) {
      this._evaluateCombat()
    }
  }

  // ─── LOCOMOÇÃO ─────────────────────────────────────────────────────────────

  private _playLocomotion(clipName: string) {
    if (this._currentLocoClip === clipName) return
    const action = this.actions[clipName] || this.actions['walk']
    if (!action) return

    action.reset().play()
    if (this._currentAction && this._currentAction !== action) {
      this._currentAction.crossFadeTo(action, 0.25, true)
    }
    this._currentAction = action
    this._currentLocoClip = clipName
  }

  private _playActionOnce(clipName: string) {
    const action = this.actions[clipName]
    if (!action) return
    action.reset().play()
    if (this._currentAction && this._currentAction !== action) {
      this._currentAction.crossFadeTo(action, 0.2, true)
    }
    this._currentAction = action
    this._currentLocoClip = ''
  }

  private _patrol(dt: number) {
    const ballPos = this.getBallPosition()
    if (ballPos) {
      this._start('CHASE_BALL')
      return
    }

    this._playLocomotion('walk')
    this.rootGroup.position.x += this.walkDirection * this.walkSpeed * dt
    this.rootGroup.rotation.y = this.walkDirection > 0 ? Math.PI / 2 : -Math.PI / 2

    if (Math.abs(this.rootGroup.position.x) > 65) {
      this.walkDirection *= -1
    }
  }

  private _chaseBall(dt: number) {
    const ballPos = this.getBallPosition()
    if (!ballPos) {
      this._start('PATROL')
      return
    }

    this._smoothLookAt(ballPos, dt)
    this._playLocomotion('walk')

    const toBall = ballPos.clone().sub(this.rootGroup.position)
    toBall.y = 0
    const dist = toBall.length()

    // Avança se estiver a mais de 12 metros
    if (dist > 12.0) {
      toBall.normalize()
      this.rootGroup.position.addScaledVector(toBall, this.walkSpeed * dt)
    }
  }

  // ─── TOMADA DE DECISÃO AGRESSIVA ───────────────────────────────────────────

  private _evaluateCombat() {
    if (this.actionCooldown > 0 || this.stateTime < 0.4) return

    const kongPos = this.rootGroup.position
    const ballPos = this.getBallPosition()
    const ballDist = ballPos ? kongPos.distanceTo(ballPos) : Infinity

    // Carros próximos
    const cars = this.getCars().filter(Boolean)
    let nearestCar: any = null
    let minCarDist = Infinity
    let nearbyCarsCount = 0

    for (const car of cars) {
      const cPos = this.getCarPosition(car)
      if (!cPos) continue
      const d = kongPos.distanceTo(cPos)
      if (d < 22.0) nearbyCarsCount++
      if (d < minCarDist) {
        minCarDist = d
        nearestCar = car
      }
    }

    // 1. BUTT SLAM: a cada ~8–12 segundos OU quando múltiplos alvos estão na zona de perigo
    if (this.slamTimer <= 0 || nearbyCarsCount >= 2 || (nearbyCarsCount >= 1 && ballDist < 18.0)) {
      this.slamTimer = 8.0 + Math.random() * 4.0
      return this._start('BUTT_SLAM')
    }

    // 2. SOCO NO CARRO: se qualquer carro estiver a menos de 16m
    if (nearestCar && minCarDist < 16.5) {
      const cPos = this.getCarPosition(nearestCar)
      if (cPos) this._smoothLookAt(cPos, 1.0)
      return this._start('PUNCH_CAR')
    }

    // 3. AÇÕES NA BOLA: se a bola estiver a menos de 15m
    if (ballPos && ballDist < 15.0) {
      this._smoothLookAt(ballPos, 1.0)
      if (ballDist < 11.5 && Math.random() < 0.45) {
        return this._start('GRAB_BALL')
      }
      return this._start('KICK_BALL')
    }

    // 4. Perseguição padrão
    if (ballPos && this.state !== 'CHASE_BALL') {
      this._start('CHASE_BALL')
    }
  }

  private _start(next: KongState) {
    this.state = next
    this.stateTime = 0
    this._hitDone = false

    // Dispara a animação baked oficial correspondente
    switch (next) {
      case 'RAGE':
        this._playActionOnce(this.clips['roar_rage'] ? 'roar_rage' : 'idle')
        break
      case 'PUNCH_CAR':
      case 'PUNCH_BALL':
        this._playActionOnce(Math.random() < 0.5 ? 'punch_right' : 'punch_left')
        break
      case 'KICK_BALL':
      case 'KICK_CAR':
        this._playActionOnce('kick_ball')
        break
      case 'GRAB_BALL':
        this._playActionOnce('grab_ball')
        break
      case 'HOLD_BALL':
        this._playLocomotion('hold_ball')
        break
      case 'THROW_BALL':
        this._playActionOnce('throw_ball')
        break
      case 'BUTT_SLAM':
        this._slamBaseY = this.rootGroup.position.y
        this._slamLanded = false
        this._playActionOnce('butt_slam')
        break
    }

    this.effects.onState?.(next)
  }

  private _finish(next: KongState = 'CHASE_BALL') {
    this._hitDone = false
    this.state = next
    this.stateTime = 0
    this.actionCooldown = 0.8
    this._playLocomotion('walk')
  }

  // ─── FÍSICA DE CONTATO REAL (HITBOXES) ──────────────────────────────────────

  // Retorna centro e raio de uma hitbox no espaço de mundo do Three.js
  private _getHitboxWorld(name: string): { center: THREE.Vector3; radius: number } | null {
    const item = this._hitboxes[name]
    if (!item || !item.object) return null
    item.object.updateWorldMatrix(true, false)
    const center = item.object.getWorldPosition(new THREE.Vector3())
    const scale = item.object.getWorldScale(new THREE.Vector3())
    return { center, radius: item.radiusLocal * Math.max(scale.x, scale.y, scale.z) }
  }

  // Testa contato da mão com carros ou bola
  private _updatePunch(_dt: number) {
    const duration = ATTACK_DURATION.PUNCH_CAR
    const progress = this.stateTime / duration
    const window = CONTACT_WINDOW.PUNCH_CAR

    // Na janela de contato, verifica se a mão encostou em algum carro
    if (!this._hitDone && progress >= window[0] && progress <= window[1]) {
      const hbR = this._getHitboxWorld('rightHand')
      const hbL = this._getHitboxWorld('leftHand')

      const cars = this.getCars().filter(Boolean)
      for (const car of cars) {
        const cPos = this.getCarPosition(car)
        if (!cPos) continue
        // Chassi do carro tem raio aproximado de 3.0m
        const carRadius = 3.0
        const hitR = hbR && hbR.center.distanceTo(cPos) <= (hbR.radius + carRadius)
        const hitL = hbL && hbL.center.distanceTo(cPos) <= (hbL.radius + carRadius)

        if (hitR || hitL) {
          this._hitDone = true
          this._applyCarImpulse(car, 60.0)
          this.effects.punch?.(cPos)
          break
        }
      }

      // Se não atingiu carro, testa se atingiu a bola
      if (!this._hitDone) {
        const bPos = this.getBallPosition()
        if (bPos) {
          const ballRadius = 2.2
          const hitR = hbR && hbR.center.distanceTo(bPos) <= (hbR.radius + ballRadius)
          const hitL = hbL && hbL.center.distanceTo(bPos) <= (hbL.radius + ballRadius)
          if (hitR || hitL) {
            this._hitDone = true
            this._applyBallImpulse(70.0)
            this.effects.punch?.(bPos)
          }
        }
      }
    }

    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  // Testa contato do pé com a bola
  private _updateKick(_dt: number) {
    const duration = ATTACK_DURATION.KICK_BALL
    const progress = this.stateTime / duration
    const window = CONTACT_WINDOW.KICK_BALL

    if (!this._hitDone && progress >= window[0] && progress <= window[1]) {
      const foot = this._getHitboxWorld('rightFoot')
      const bPos = this.getBallPosition()
      if (foot && bPos) {
        const ballRadius = 2.2
        if (foot.center.distanceTo(bPos) <= (foot.radius + ballRadius + 1.5)) {
          this._hitDone = true
          this._applyBallImpulse(85.0)
          this.effects.kick?.(bPos)
        }
      }
    }

    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  // Agarra a bola fisicamente na mão
  private _updateGrab(_dt: number) {
    const duration = ATTACK_DURATION.GRAB_BALL
    const progress = this.stateTime / duration
    const window = CONTACT_WINDOW.GRAB_BALL

    if (!this._hitDone && progress >= window[0] && progress <= window[1]) {
      const hand = this._getHitboxWorld('rightHand')
      const bPos = this.getBallPosition()
      if (hand && bPos) {
        if (hand.center.distanceTo(bPos) <= (hand.radius + 3.5)) {
          this._hitDone = true
          this._attachBallToHand()
          this.effects.grab?.(bPos)
        }
      }
    }

    if (this.stateTime >= duration) {
      if (this._heldBall) {
        this._start('HOLD_BALL')
      } else {
        this._finish('CHASE_BALL')
      }
    }
  }

  private _updateHold(_dt: number) {
    if (this.stateTime >= ATTACK_DURATION.HOLD_BALL) {
      this._start('THROW_BALL')
    }
  }

  // Arremessa a bola para frente
  private _updateThrow(_dt: number) {
    const duration = ATTACK_DURATION.THROW_BALL
    if (!this._hitDone && this.stateTime >= 0.38) {
      this._hitDone = true
      this._releaseBallWithArc()
      this.effects.throw?.(this.getBallPosition() || undefined)
    }

    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  // Queda de bunda (Butt Slam) com impacto no solo
  private _updateSlam(_dt: number) {
    const duration = ATTACK_DURATION.BUTT_SLAM
    const progress = this.stateTime / duration

    // Arco vertical do pulo: sobe até 15 metros e desce com tudo
    if (progress < 0.65) {
      const jumpArc = Math.sin((progress / 0.65) * Math.PI)
      this.rootGroup.position.y = this._slamBaseY + jumpArc * 15.0
    } else {
      this.rootGroup.position.y = this._slamBaseY
    }

    // Momento do impacto com o solo
    if (!this._slamLanded && progress >= 0.62) {
      this._slamLanded = true
      this.rootGroup.position.y = this._slamBaseY
      this._radialImpulse()
      this.effects.slam?.(this.rootGroup.position)
    }

    if (this.stateTime >= duration) {
      this.rootGroup.position.y = this._slamBaseY
      this._finish('CHASE_BALL')
    }
  }

  private _updateAttackState(clipName: string, duration: number) {
    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  // ─── BOLA ANEXADA À MÃO ────────────────────────────────────────────────────

  private _attachBallToHand() {
    if (!this.ball || !this._bones.rightHand || this._heldBall) return
    const hand = this._bones.rightHand
    hand.updateWorldMatrix(true, false)
    const ballObj = this.ball.mesh || this.ball
    hand.attach(ballObj)
    ballObj.position.set(0, 1.8, 0)

    this.ball.userData = this.ball.userData || {}
    this.ball.userData.kongHeld = true
    if (this.ball.mesh) this.ball.mesh.userData.kongHeld = true

    this._heldBall = this.ball
    this.physics.setKinematic?.(this.ball, true)
    this.physics.setSensor?.(this.ball, true)
  }

  private _keepBallInHand() {
    if (!this._heldBall || !this._bones.rightHand) return
    const ballObj = this._heldBall.mesh || this._heldBall
    ballObj.position.set(0, 1.8, 0)
    ballObj.quaternion.identity()
    if (this._heldBall.pos) {
      ballObj.getWorldPosition(this._heldBall.pos)
    }
  }

  private _releaseBallWithArc() {
    if (!this._heldBall || !this.model) return
    const ball = this._heldBall
    const ballObj = ball.mesh || ball
    const worldPosition = new THREE.Vector3()
    const worldQuaternion = new THREE.Quaternion()
    ballObj.getWorldPosition(worldPosition)
    ballObj.getWorldQuaternion(worldQuaternion)

    this.scene.attach(ballObj)
    ballObj.position.copy(worldPosition)
    ballObj.quaternion.copy(worldQuaternion)
    if (ball.pos) ball.pos.copy(worldPosition)

    ball.userData = ball.userData || {}
    ball.userData.kongHeld = false
    if (ball.mesh) ball.mesh.userData.kongHeld = false

    this.physics.setSensor?.(ball, false)
    this.physics.setKinematic?.(ball, false)

    // Arremesso para frente e para cima
    const direction = new THREE.Vector3()
    this.rootGroup.getWorldDirection(direction)
    direction.y = 0.45
    direction.normalize()
    this.physics.applyImpulse?.(ball, direction.multiplyScalar(85.0))
    this._heldBall = null
  }

  // ─── IMPULSOS FÍSICOS NATIVOS ──────────────────────────────────────────────

  private _applyBallImpulse(force: number) {
    if (!this.ball || this.ball.userData?.kongHeld) return
    const bPos = this.getBallPosition()
    if (!bPos) return
    const direction = bPos.clone().sub(this.rootGroup.position).normalize()
    direction.y = 0.35
    direction.normalize()
    this.physics.applyImpulse?.(this.ball, direction.multiplyScalar(force))
  }

  private _applyCarImpulse(car: any, force: number) {
    const cPos = this.getCarPosition(car)
    if (!cPos) return
    const direction = cPos.clone().sub(this.rootGroup.position).normalize()
    direction.y = 0.65
    direction.normalize()
    this.physics.applyImpulse?.(car, direction.multiplyScalar(force))
    this.physics.applyAngularImpulse?.(car, new THREE.Vector3(0, force * 0.45, force * 0.35))
  }

  private _radialImpulse() {
    const objects = [this.ball, ...this.getCars()].filter(Boolean)
    for (const object of objects) {
      const objPos = object === this.ball ? this.getBallPosition() : this.getCarPosition(object)
      if (!objPos) continue
      const direction = objPos.clone().sub(this.rootGroup.position)
      const distance = Math.max(0.1, direction.length())
      if (distance < this.impactRadius) {
        direction.normalize().multiplyScalar(55 * (1 - distance / this.impactRadius))
        direction.y = Math.max(direction.y, 0.5)
        this.physics.applyImpulse?.(object, direction)
        if (typeof object.applySpinOut === 'function') {
          object.applySpinOut(2.2)
        }
      }
    }
    this.camera?.shake?.(0.75, 1.0)
  }

  // ─── FALLBACK PROCEDURAL ───────────────────────────────────────────────────

  private _createProceduralFallback() {
    const group = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9 })
    const chest = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 8), mat)
    chest.position.y = 14
    group.add(chest)
    this.model = group
    this.rootGroup.add(group)
  }

  // ─── DISPOSE ───────────────────────────────────────────────────────────────

  public dispose() {
    if (this._heldBall) {
      try { this._releaseBallWithArc() } catch {}
    }
    if (this.mixer) {
      this.mixer.stopAllAction()
      this.mixer = null
    }
    for (const hitbox of Object.values(this._hitboxes)) {
      hitbox.object.parent?.remove(hitbox.object)
      hitbox.object.geometry?.dispose()
    }
    this._hitboxes = {}
    if (this.model) {
      this.rootGroup.remove(this.model)
      this.model.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose()
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach((m) => m?.dispose?.())
        }
      })
      this.model = null
    }
  }
}
