// ============================================================
//  arenaKongController.ts — Controlador IA e Poses Procedurais
//  Kong Gorak na Arena Kong (Versão Fluida, Orgânica & Empolgante)
// ============================================================
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type KongState =
  | 'PATROL'
  | 'CHASE_BALL'
  | 'RAGE'
  | 'KICK_BALL'
  | 'PUNCH_CAR'
  | 'GRAB_BALL'
  | 'THROW_BALL'
  | 'BUTT_SLAM'
  | 'RECOVER'

export interface KongPhysicsAdapter {
  applyImpulse?: (target: any, impulse: THREE.Vector3) => void
  applyAngularImpulse?: (target: any, angImpulse: THREE.Vector3) => void
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
  spine?: THREE.Bone
  head?: THREE.Bone
  jaw?: THREE.Bone
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

export class KongGorak {
  public rootGroup = new THREE.Group()
  public model: THREE.Object3D | null = null
  public mixer: THREE.AnimationMixer | null = null
  public clips: Record<string, THREE.AnimationClip> = {}

  public state: KongState = 'PATROL'
  public stateTime = 0
  public actionCooldown = 0
  public slamTimer = 4.0 // Primeiro slam após alguns segundos

  // Movimentação orgânica realista
  public walkSpeed = 9.5 // Velocidade compatível com a passada do gorila
  private _vel = new THREE.Vector3()
  private _targetYaw = 0
  private _currentYaw = 0
  public walkDirection = 1

  public impactRadius = 40.0
  private _hit = false
  private _heldBall: any = null

  // Ações de animação oficiais
  private _walkAction: THREE.AnimationAction | null = null
  private _idleAction: THREE.AnimationAction | null = null
  private _currentAction: THREE.AnimationAction | null = null
  private _isAttacking = false

  private _bones: BoneMap = { all: [] }
  private _eyeMaterials: THREE.MeshStandardMaterial[] = []

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
      const gltf = await loader.loadAsync('/assets/arena-kong/arena-kong-gorak-animated.glb')
      this.model = gltf.scene
      this.model.name = 'KongGorakModel'

      // Gorila colossal: ~26-28 metros de altura
      const bbox = new THREE.Box3().setFromObject(this.model)
      const size = bbox.getSize(new THREE.Vector3())
      const targetHeight = 27.0
      if (size.y > 0.1) {
        const scale = targetHeight / size.y
        this.model.scale.setScalar(scale)
      }

      // Posição inicial: ao lado da bola no círculo central virado para o meio
      this.model.position.set(18, 0, 0)
      this._targetYaw = -Math.PI / 2
      this._currentYaw = -Math.PI / 2
      this.model.rotation.y = this._currentYaw

      this.model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.castShadow = true
          mesh.receiveShadow = true
          const cname = (mesh.name || '').toLowerCase()
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            mats.forEach((m: any) => {
              if (m.map) m.map.colorSpace = THREE.SRGBColorSpace
              if (cname.includes('eye') || (m.name && m.name.toLowerCase().includes('eye'))) {
                this._eyeMaterials.push(m)
              }
            })
          }
        }
      })

      this._bones = this._findBones(this.model)

      // AnimationMixer com os clipes oficiais
      this.mixer = new THREE.AnimationMixer(this.model)
      gltf.animations.forEach((clip) => {
        const key = clip.name.toLowerCase().replace(/\s+/g, '_')
        this.clips[key] = clip
        this.clips[clip.name.toLowerCase()] = clip
      })

      const walkClip = this.clips['walk'] || this.clips['walking']
      const idleClip = this.clips['idle'] || this.clips['standing_relax']

      if (walkClip) {
        this._walkAction = this.mixer.clipAction(walkClip)
        this._walkAction.setLoop(THREE.LoopRepeat, Infinity)
      }
      if (idleClip) {
        this._idleAction = this.mixer.clipAction(idleClip)
        this._idleAction.setLoop(THREE.LoopRepeat, Infinity)
      }

      // Inicia imediatamente caminhando de forma fluida
      if (this._walkAction) {
        this._walkAction.reset().play()
        this._walkAction.setEffectiveWeight(1)
        this._currentAction = this._walkAction
      }

      this.rootGroup.add(this.model)
    } catch (err) {
      console.error('[KongGorak] Erro ao carregar GLB animado:', err)
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

    return {
      all,
      hips: findExact('Pelvis', 'Hips', 'Hip', 'Waist'),
      spine: findExact('Spine02', 'Spine01', 'Spine'),
      head: findExact('Head'),
      jaw: findExact('Jaw'),
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

  // Rotação suave natural do corpo pesado
  private _smoothLookAt(target: THREE.Vector3, dt: number) {
    if (!this.model) return
    const dx = target.x - this.model.position.x
    const dz = target.z - this.model.position.z
    if (dx * dx + dz * dz < 0.1) return

    this._targetYaw = Math.atan2(dx, dz)
    // Interpola o ângulo sem saltos
    let diff = this._targetYaw - this._currentYaw
    while (diff < -Math.PI) diff += Math.PI * 2
    while (diff > Math.PI) diff -= Math.PI * 2

    const turnSpeed = 4.2 // Rotação rápida mas orgânica
    this._currentYaw += diff * Math.min(1, dt * turnSpeed)
    this.model.rotation.y = this._currentYaw
  }

  public update(dt: number) {
    if (!this.model) return

    // Protege contra saltos de lag (cap em 0.05s)
    const safeDt = Math.min(dt, 0.05)

    this.stateTime += safeDt
    this.actionCooldown = Math.max(0, this.actionCooldown - safeDt)
    this.slamTimer = Math.max(0, this.slamTimer - safeDt)

    // 1. mixer.update executado antes das poses procedurais
    if (this.mixer) {
      this.mixer.update(safeDt)
    }

    // 2. Se a bola estiver agarrada na mão, atualiza a posição
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
        this._rage()
        break
      case 'KICK_BALL':
        this._kickBall()
        break
      case 'PUNCH_CAR':
        this._punchCar()
        break
      case 'GRAB_BALL':
        this._grabBall()
        break
      case 'THROW_BALL':
        this._throwBall()
        break
      case 'BUTT_SLAM':
        this._buttSlam()
        break
      case 'RECOVER':
        this._recover()
        break
      default:
        this._start('PATROL')
    }

    // 4. Se estiver em perseguição/patrulha, avalia alvos ao alcance
    if (this.state === 'PATROL' || this.state === 'CHASE_BALL') {
      this._evaluateCombat()
    }
  }

  // ─── LOCOMOÇÃO ─────────────────────────────────────────────────────────────

  private _playLocomotion(type: 'walk' | 'idle') {
    if (this._isAttacking) return
    const targetAction = type === 'walk' ? this._walkAction : this._idleAction
    if (!targetAction || this._currentAction === targetAction) return

    if (this._currentAction) {
      targetAction.reset().play()
      this._currentAction.crossFadeTo(targetAction, 0.35, true)
    } else {
      targetAction.reset().play()
    }
    this._currentAction = targetAction
  }

  private _patrol(dt: number) {
    if (!this.model) return
    const ballPos = this.getBallPosition()
    if (ballPos) {
      this._start('CHASE_BALL')
      return
    }

    this._playLocomotion('walk')
    this.model.position.x += this.walkDirection * this.walkSpeed * dt
    this._targetYaw = this.walkDirection > 0 ? Math.PI / 2 : -Math.PI / 2
    this.model.rotation.y = this._targetYaw
    this._currentYaw = this._targetYaw

    if (Math.abs(this.model.position.x) > 65) {
      this.walkDirection *= -1
    }
  }

  private _chaseBall(dt: number) {
    if (!this.model) return
    const ballPos = this.getBallPosition()
    if (!ballPos) {
      this._start('PATROL')
      return
    }

    // Olha suavemente para a bola
    this._smoothLookAt(ballPos, dt)
    this._playLocomotion('walk')

    const toBall = ballPos.clone().sub(this.model.position)
    toBall.y = 0
    const dist = toBall.length()

    // Se estiver a mais de 13 metros, caminha com passada natural
    if (dist > 13.0) {
      toBall.normalize()
      // Aceleração física suave
      const targetVel = toBall.multiplyScalar(this.walkSpeed)
      this._vel.lerp(targetVel, Math.min(1, dt * 5.0))
      this.model.position.addScaledVector(this._vel, dt)
    } else {
      // Perto da bola: desacelera e escolhe golpe
      this._vel.multiplyScalar(0.75)
      this.model.position.addScaledVector(this._vel, dt)
    }
  }

  // ─── TOMADA DE DECISÃO AGRESSIVA ───────────────────────────────────────────

  private _evaluateCombat() {
    if (!this.model || this.actionCooldown > 0 || this.stateTime < 0.4) return

    const kongPos = this.model.position
    const ballPos = this.getBallPosition()
    const ballDist = ballPos ? kongPos.distanceTo(ballPos) : Infinity

    // Verifica carros no estádio
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

    // 1. BUTT SLAM (Salto e queda de bunda esmagadora):
    // Dispara a cada ~8 segundos OU se tiver 2+ carros perto OU carro + bola juntos
    if (this.slamTimer <= 0 || nearbyCarsCount >= 2 || (nearbyCarsCount >= 1 && ballDist < 18.0)) {
      this.slamTimer = 8.0 + Math.random() * 4.0
      return this._start('BUTT_SLAM')
    }

    // 2. SOCO NO CARRO: se qualquer carro estiver no raio de patada (< 17m), prioriza bater no carro!
    if (nearestCar && minCarDist < 17.0) {
      const cPos = this.getCarPosition(nearestCar)
      if (cPos) this._smoothLookAt(cPos, 1.0)
      return this._start('PUNCH_CAR')
    }

    // 3. CHUTE OU AGARRE NA BOLA: se estiver a menos de 15m da bola
    if (ballPos && ballDist < 15.0) {
      this._smoothLookAt(ballPos, 1.0)
      // Alterna entre agarrar e chutar
      if (ballDist < 11.5 && Math.random() < 0.45) {
        return this._start('GRAB_BALL')
      }
      return this._start('KICK_BALL')
    }

    // 4. Se a bola estiver longe, garante que está no estado de perseguição
    if (ballPos && this.state !== 'CHASE_BALL') {
      this._start('CHASE_BALL')
    }
  }

  private _start(next: KongState) {
    this.state = next
    this.stateTime = 0
    this._hit = false
    this._vel.set(0, 0, 0)

    if (!['PATROL', 'CHASE_BALL'].includes(next)) {
      this._isAttacking = true
      // Reduz a influência da caminhada durante golpes
      if (this._walkAction) this._walkAction.setEffectiveWeight(0.15)
      if (this._idleAction) this._idleAction.setEffectiveWeight(0.15)
    } else {
      this._isAttacking = false
      if (this._walkAction) this._walkAction.setEffectiveWeight(1.0)
      if (this._idleAction) this._idleAction.setEffectiveWeight(1.0)
    }

    this.effects.onState?.(next)
  }

  private _finish(next: KongState = 'CHASE_BALL') {
    this._hit = false
    this.state = next
    this.stateTime = 0
    this.actionCooldown = 0.7
    this._isAttacking = false

    if (this._walkAction) this._walkAction.setEffectiveWeight(1.0)
    if (this._idleAction) this._idleAction.setEffectiveWeight(1.0)
    this._playLocomotion('walk')
  }

  // ─── GOLPES E ANIMAÇÕES PROCEDURAIS ────────────────────────────────────────

  private _kickBall() {
    const ballPos = this.getBallPosition()
    if (ballPos) this._smoothLookAt(ballPos, 0.1)

    const t = Math.min(1, this.stateTime / 0.85)
    const k = Math.sin(Math.PI * t)

    // Pose de chute vigoroso da perna direita
    if (this._bones.rightThigh) this._bones.rightThigh.rotation.x = -1.2 * k
    if (this._bones.rightShin) this._bones.rightShin.rotation.x = 1.4 * k
    if (this._bones.spine) this._bones.spine.rotation.x = 0.25 * k

    if (this.stateTime > 0.42 && !this._hit) {
      this._hit = true
      this._ballImpulse(78)
      this.effects.kick?.(ballPos || undefined)
    }

    if (this.stateTime > 0.9) {
      if (this._bones.rightThigh) this._bones.rightThigh.rotation.x = 0
      if (this._bones.rightShin) this._bones.rightShin.rotation.x = 0
      if (this._bones.spine) this._bones.spine.rotation.x = 0
      this._finish('CHASE_BALL')
    }
  }

  private _punchCar() {
    const car = this._nearestCar()
    const carPos = car ? this.getCarPosition(car) : null
    if (carPos) this._smoothLookAt(carPos, 0.1)

    const t = Math.min(1, this.stateTime / 0.8)
    const k = Math.sin(Math.PI * t)

    // Patada lateral esmagadora com o braço direito
    if (this._bones.rightUpperArm) {
      this._bones.rightUpperArm.rotation.x = -1.3 * k
      this._bones.rightUpperArm.rotation.z = -0.5 * k
    }
    if (this._bones.rightForearm) this._bones.rightForearm.rotation.x = -1.1 * k
    if (this._bones.spine) this._bones.spine.rotation.y = -0.4 * k

    if (this.stateTime > 0.38 && !this._hit) {
      this._hit = true
      this._carImpulse(58)
      this.effects.punch?.(carPos || undefined)
    }

    if (this.stateTime > 0.85) {
      if (this._bones.rightUpperArm) {
        this._bones.rightUpperArm.rotation.x = 0
        this._bones.rightUpperArm.rotation.z = 0
      }
      if (this._bones.rightForearm) this._bones.rightForearm.rotation.x = 0
      if (this._bones.spine) this._bones.spine.rotation.y = 0
      this._finish('CHASE_BALL')
    }
  }

  private _grabBall() {
    const ballPos = this.getBallPosition()
    if (ballPos) this._smoothLookAt(ballPos, 0.1)

    const t = Math.min(1, this.stateTime / 0.75)
    const k = Math.sin(Math.PI * t)

    // Abaixa o tronco e estica os dois braços para pegar a bola
    if (this._bones.spine) this._bones.spine.rotation.x = 0.35 * k
    if (this._bones.rightUpperArm) this._bones.rightUpperArm.rotation.x = -1.0 * k
    if (this._bones.leftUpperArm) this._bones.leftUpperArm.rotation.x = -1.0 * k

    if (this.stateTime > 0.38 && !this._hit) {
      this._hit = true
      this._attachBallToHand()
      this.effects.grab?.(ballPos || undefined)
    }

    if (this.stateTime > 0.85) {
      this._start('THROW_BALL')
    }
  }

  private _throwBall() {
    const t = Math.min(1, this.stateTime / 0.9)
    const k = Math.sin(Math.PI * t)

    // Ergue a mão acima da cabeça e arremessa para a frente
    if (this._bones.spine) this._bones.spine.rotation.x = -0.4 * k
    if (this._bones.rightUpperArm) this._bones.rightUpperArm.rotation.x = -1.5 * k

    if (this.stateTime > 0.36 && !this._hit) {
      this._hit = true
      this._releaseBallWithArc()
      this.effects.throw?.(this.getBallPosition() || undefined)
    }

    if (this.stateTime > 0.92) {
      if (this._bones.spine) this._bones.spine.rotation.x = 0
      if (this._bones.rightUpperArm) this._bones.rightUpperArm.rotation.x = 0
      if (this._bones.leftUpperArm) this._bones.leftUpperArm.rotation.x = 0
      this._finish('CHASE_BALL')
    }
  }

  private _buttSlam() {
    const duration = 1.3
    const t = Math.min(1, this.stateTime / duration)

    // Curva de pulo: sobe rápido até o topo e cai esmagando
    if (this.model) {
      const jumpArc = Math.sin(Math.PI * Math.min(1, this.stateTime / 1.05))
      this.model.position.y = Math.max(0, jumpArc * 15.0)
    }

    const k = Math.sin(Math.PI * t)
    // Encolhe as pernas no ar para preparar a queda de bunda
    if (this._bones.leftThigh) this._bones.leftThigh.rotation.x = -0.7 * k
    if (this._bones.rightThigh) this._bones.rightThigh.rotation.x = -0.7 * k
    if (this._bones.spine) this._bones.spine.rotation.x = 0.5 * k

    // Momento do impacto com o solo
    if (this.stateTime > 0.82 && !this._hit) {
      this._hit = true
      if (this.model) this.model.position.y = 0
      this._radialImpulse()
      this.effects.slam?.(this.model?.position)
    }

    if (this.stateTime > 1.35) {
      if (this.model) this.model.position.y = 0
      if (this._bones.leftThigh) this._bones.leftThigh.rotation.x = 0
      if (this._bones.rightThigh) this._bones.rightThigh.rotation.x = 0
      if (this._bones.spine) this._bones.spine.rotation.x = 0
      this._finish('CHASE_BALL')
    }
  }

  private _rage() {
    const k = Math.sin(Math.PI * Math.min(1, this.stateTime / 1.4))
    if (this._bones.spine) this._bones.spine.rotation.x = -0.3 * k
    if (this._bones.jaw) this._bones.jaw.rotation.x = 0.5 * k
    this.effects.rage?.(k)

    this._eyeMaterials.forEach((m) => {
      m.emissive = new THREE.Color(0x00f0ff)
      m.emissiveIntensity = k * 3.5
    })

    if (this.stateTime > 1.5) {
      this._eyeMaterials.forEach((m) => { m.emissiveIntensity = 0 })
      if (this._bones.spine) this._bones.spine.rotation.x = 0
      if (this._bones.jaw) this._bones.jaw.rotation.x = 0
      this._finish('CHASE_BALL')
    }
  }

  private _recover() {
    if (this.stateTime > 0.4) this._finish('CHASE_BALL')
  }

  // ─── BOLA NA MÃO ───────────────────────────────────────────────────────────

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

    const direction = this.model.getWorldDirection(new THREE.Vector3())
    direction.y = 0.45
    direction.normalize()
    this.physics.applyImpulse?.(ball, direction.multiplyScalar(80))
    this._heldBall = null
  }

  // ─── FÍSICA E IMPACTOS ─────────────────────────────────────────────────────

  private _nearestCar(): any {
    const cars = this.getCars().filter(Boolean)
    if (!cars.length || !this.model) return null
    return cars.sort((a, b) => {
      const pA = this.getCarPosition(a)
      const pB = this.getCarPosition(b)
      if (!pA || !pB) return 0
      return this.model!.position.distanceTo(pA) - this.model!.position.distanceTo(pB)
    })[0]
  }

  private _ballImpulse(force: number) {
    if (!this.ball || this.ball.userData?.kongHeld || !this.model) return
    const bPos = this.getBallPosition()
    if (!bPos) return
    const direction = bPos.clone().sub(this.model.position).normalize()
    direction.y = 0.32
    direction.normalize()
    this.physics.applyImpulse?.(this.ball, direction.multiplyScalar(force))
  }

  private _carImpulse(force: number) {
    const car = this._nearestCar()
    if (!car || !this.model) return
    const cPos = this.getCarPosition(car)
    if (!cPos) return
    const direction = cPos.clone().sub(this.model.position).normalize()
    direction.y = 0.7
    direction.normalize()
    this.physics.applyImpulse?.(car, direction.multiplyScalar(force))
    this.physics.applyAngularImpulse?.(car, new THREE.Vector3(0, force * 0.45, force * 0.35))
  }

  private _radialImpulse() {
    if (!this.model) return
    const objects = [this.ball, ...this.getCars()].filter(Boolean)
    for (const object of objects) {
      const objPos = object === this.ball ? this.getBallPosition() : this.getCarPosition(object)
      if (!objPos) continue
      const direction = objPos.clone().sub(this.model.position)
      const distance = Math.max(0.1, direction.length())
      if (distance < this.impactRadius) {
        direction.normalize().multiplyScalar(52 * (1 - distance / this.impactRadius))
        direction.y = Math.max(direction.y, 0.5)
        this.physics.applyImpulse?.(object, direction)
        if (typeof object.applySpinOut === 'function') {
          object.applySpinOut(2.0)
        }
      }
    }
    this.camera?.shake?.(0.7, 0.95)
  }

  // ─── PROCEDURAL FALLBACK ───────────────────────────────────────────────────

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
    this._walkAction = null
    this._idleAction = null
    this._currentAction = null
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
