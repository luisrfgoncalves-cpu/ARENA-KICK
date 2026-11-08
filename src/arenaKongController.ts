// ============================================================
//  arenaKongController.ts — Controlador IA e Física de Contato Real
//  Kong Gorak na Arena Kong (Versão Cirúrgica Definitiva)
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

export class KongGorak {
  public rootGroup = new THREE.Group()
  public model: THREE.Object3D | null = null
  public mixer: THREE.AnimationMixer | null = null
  public clips: Record<string, THREE.AnimationClip> = {}
  public actions: Record<string, THREE.AnimationAction> = {}

  public state: KongState = 'PATROL'
  public stateTime = 0
  public actionCooldown = 0

  // Temporizador estrito para o Butt Slam: inicia com 10 segundos para NÃO pular no kickoff!
  public slamTimer = 10.0
  public walkSpeed = 9.5
  public walkDirection = 1
  public impactRadius = 45.0

  private _hitDone = false
  private _heldBall: any = null
  private _currentAction: THREE.AnimationAction | null = null
  private _currentActionName = ''
  private _bones: BoneMap = { all: [] }

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
      const gltf = await loader.loadAsync('/assets/arena-kong/arena-kong-gorak-final-complete.glb')
      this.model = gltf.scene
      this.model.name = 'KongGorakModel'

      // Ajusta para altura colossal de ~27 metros
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

      this._bones = this._findBones(this.model)

      // Inicializa o mixer com a cena do modelo
      this.mixer = new THREE.AnimationMixer(this.model)

      gltf.animations.forEach((clip) => {
        const key = clip.name.toLowerCase().replace(/\s+/g, '_')
        this.clips[key] = clip
        const action = this.mixer!.clipAction(clip)
        this.actions[key] = action

        if (['idle', 'standing_relax', 'walk', 'hold_ball'].includes(key)) {
          action.setLoop(THREE.LoopRepeat, Infinity)
        } else {
          action.setLoop(THREE.LoopOnce, 1)
          action.clampWhenFinished = true
        }
      })

      console.log('[KongGorak] Clipes carregados com sucesso:', Object.keys(this.clips))

      // Inicia em caminhada fluida
      this._playAction('walk', true)

      this.rootGroup.add(this.model)
    } catch (err) {
      console.error('[KongGorak] Erro ao carregar GLB:', err)
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

  // Executa uma animação de forma limpa garantindo que os ossos sejam afetados
  private _playAction(clipName: string, isLoop = false) {
    if (!this.mixer) return
    const action = this.actions[clipName] || this.actions['walk']
    if (!action) return

    if (this._currentActionName === clipName && action.isRunning()) {
      return
    }

    // Se for um ataque (LoopOnce), interrompe a locomoção anterior
    if (!isLoop) {
      if (this._currentAction) {
        this._currentAction.fadeOut(0.15)
      }
      action.reset()
      action.enabled = true
      action.setEffectiveWeight(1.0)
      action.fadeIn(0.15).play()
    } else {
      // Transição suave para loop
      action.enabled = true
      action.setEffectiveWeight(1.0)
      if (this._currentAction && this._currentAction !== action) {
        action.reset().play()
        this._currentAction.crossFadeTo(action, 0.25, true)
      } else {
        action.play()
      }
    }

    this._currentAction = action
    this._currentActionName = clipName
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

  private _getBoneWorldPosition(bone?: THREE.Bone): THREE.Vector3 | null {
    if (!bone) return null
    bone.updateWorldMatrix(true, false)
    return bone.getWorldPosition(new THREE.Vector3())
  }

  private _smoothLookAt(target: THREE.Vector3, dt: number) {
    const dx = target.x - this.rootGroup.position.x
    const dz = target.z - this.rootGroup.position.z
    if (dx * dx + dz * dz < 0.1) return

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

    // 1. Atualização do AnimationMixer UMA VEZ
    if (this.mixer) {
      this.mixer.update(safeDt)
    }

    // 2. Se a bola estiver agarrada na mão
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
        if (this.stateTime > 1.55) this._finish('CHASE_BALL')
        break
      case 'PUNCH_CAR':
      case 'PUNCH_BALL':
        this._updatePunch(safeDt)
        break
      case 'KICK_BALL':
        this._updateKick(safeDt)
        break
      case 'GRAB_BALL':
        this._updateGrab(safeDt)
        break
      case 'HOLD_BALL':
        if (this.stateTime > 1.0) this._start('THROW_BALL')
        break
      case 'THROW_BALL':
        this._updateThrow(safeDt)
        break
      case 'BUTT_SLAM':
        this._updateSlam(safeDt)
        break
      case 'RECOVER':
        if (this.stateTime > 0.4) this._finish('CHASE_BALL')
        break
      default:
        this._start('PATROL')
    }

    // 4. Decisão de combate contínua APENAS durante locomoção e sem cooldown
    if ((this.state === 'PATROL' || this.state === 'CHASE_BALL') && this.actionCooldown <= 0) {
      this._evaluateCombat()
    }
  }

  // ─── LOCOMOÇÃO FLUIDA ──────────────────────────────────────────────────────

  private _patrol(dt: number) {
    const ballPos = this.getBallPosition()
    if (ballPos) {
      this._start('CHASE_BALL')
      return
    }

    this._playAction('walk', true)
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

    // Vira suavemente de frente para a bola
    this._smoothLookAt(ballPos, dt)
    this._playAction('walk', true)

    const toBall = ballPos.clone().sub(this.rootGroup.position)
    toBall.y = 0
    const dist = toBall.length()

    // Avança rumo à bola com passos largos até chegar perto (11m)
    if (dist > 11.0) {
      toBall.normalize()
      this.rootGroup.position.addScaledVector(toBall, this.walkSpeed * dt)
    }
  }

  // ─── COMBATE AGRESSIVO E EQUILIBRADO ────────────────────────────────────────

  private _evaluateCombat() {
    if (this.actionCooldown > 0 || this.stateTime < 0.3) return

    const kongPos = this.rootGroup.position
    const ballPos = this.getBallPosition()
    const ballDist = ballPos ? kongPos.distanceTo(ballPos) : Infinity

    const cars = this.getCars().filter(Boolean)
    let nearestCar: any = null
    let minCarDist = Infinity
    let nearbyCarsCount = 0

    for (const car of cars) {
      const cPos = this.getCarPosition(car)
      if (!cPos) continue
      const d = kongPos.distanceTo(cPos)
      if (d < 20.0) nearbyCarsCount++
      if (d < minCarDist) {
        minCarDist = d
        nearestCar = car
      }
    }

    // 1. BUTT SLAM (Queda de bunda):
    // SOMENTE se o slamTimer zerou (mínimo 10 segundos entre cada pulo) E houver alvos próximos!
    if (this.slamTimer <= 0 && (nearbyCarsCount >= 2 || (nearbyCarsCount >= 1 && ballDist < 16.0))) {
      this.slamTimer = 10.0 + Math.random() * 5.0 // Garante 10 a 15 segundos até o próximo pulo!
      return this._start('BUTT_SLAM')
    }

    // 2. SOCO NO CARRO: se qualquer carro estiver no alcance de patada (< 15 metros)
    if (nearestCar && minCarDist < 15.0) {
      const cPos = this.getCarPosition(nearestCar)
      if (cPos) this._smoothLookAt(cPos, 1.0)
      return this._start('PUNCH_CAR')
    }

    // 3. AÇÕES NA BOLA: quando ela estiver a menos de 14 metros
    if (ballPos && ballDist < 14.0) {
      this._smoothLookAt(ballPos, 1.0)
      // Alterna entre agarrar (40%) e chutar com força (60%)
      if (ballDist < 10.5 && Math.random() < 0.4) {
        return this._start('GRAB_BALL')
      }
      return this._start('KICK_BALL')
    }

    // 4. Se a bola estiver longe, segue a bola
    if (ballPos && this.state !== 'CHASE_BALL') {
      this._start('CHASE_BALL')
    }
  }

  private _start(next: KongState) {
    this.state = next
    this.stateTime = 0
    this._hitDone = false

    switch (next) {
      case 'RAGE':
        this._playAction('roar_rage')
        break
      case 'PUNCH_CAR':
      case 'PUNCH_BALL':
        this._playAction(Math.random() < 0.5 ? 'punch_right' : 'punch_left')
        break
      case 'KICK_BALL':
        this._playAction('kick_ball')
        break
      case 'GRAB_BALL':
        this._playAction('grab_ball')
        break
      case 'HOLD_BALL':
        this._playAction('hold_ball', true)
        break
      case 'THROW_BALL':
        this._playAction('throw_ball')
        break
      case 'BUTT_SLAM':
        this._slamBaseY = this.rootGroup.position.y
        this._slamLanded = false
        this._playAction('butt_slam')
        break
    }

    this.effects.onState?.(next)
  }

  private _finish(next: KongState = 'CHASE_BALL') {
    this._hitDone = false
    this.state = next
    this.stateTime = 0
    // Cooldown obrigatório de 1 segundo para o Kong se mover antes de outro ataque
    this.actionCooldown = 1.0
    this._playAction('walk', true)
  }

  // ─── IMPACTO FÍSICO REAL (CONTATO DIRETO DOS MEMBROS) ──────────────────────

  private _updatePunch(_dt: number) {
    const duration = 0.95
    const progress = this.stateTime / duration

    // Janela de contato do golpe: entre 35% e 75% da animação
    if (!this._hitDone && progress >= 0.35 && progress <= 0.75) {
      const posR = this._getBoneWorldPosition(this._bones.rightHand)
      const posL = this._getBoneWorldPosition(this._bones.leftHand)
      const handPos = posR || posL || this.rootGroup.position

      // Verifica contato físico real com carros (raio de 6.0m ao redor da mão)
      const cars = this.getCars().filter(Boolean)
      for (const car of cars) {
        const cPos = this.getCarPosition(car)
        if (!cPos) continue
        if (handPos.distanceTo(cPos) <= 6.5) {
          this._hitDone = true
          this._applyCarImpulse(car, 65.0)
          this.effects.punch?.(cPos)
          break
        }
      }

      // Se não atingiu carro, testa se acertou a bola
      if (!this._hitDone) {
        const bPos = this.getBallPosition()
        if (bPos && handPos.distanceTo(bPos) <= 6.0) {
          this._hitDone = true
          this._applyBallImpulse(75.0)
          this.effects.punch?.(bPos)
        }
      }
    }

    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  private _updateKick(_dt: number) {
    const duration = 1.05
    const progress = this.stateTime / duration

    if (!this._hitDone && progress >= 0.35 && progress <= 0.75) {
      const footPos = this._getBoneWorldPosition(this._bones.rightFoot) || this.rootGroup.position
      const bPos = this.getBallPosition()
      if (bPos && footPos.distanceTo(bPos) <= 6.5) {
        this._hitDone = true
        this._applyBallImpulse(90.0)
        this.effects.kick?.(bPos)
      }
    }

    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  private _updateGrab(_dt: number) {
    const duration = 0.9
    const progress = this.stateTime / duration

    if (!this._hitDone && progress >= 0.30 && progress <= 0.75) {
      const handPos = this._getBoneWorldPosition(this._bones.rightHand) || this.rootGroup.position
      const bPos = this.getBallPosition()
      if (bPos && handPos.distanceTo(bPos) <= 6.5) {
        this._hitDone = true
        this._attachBallToHand()
        this.effects.grab?.(bPos)
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

  private _updateThrow(_dt: number) {
    const duration = 0.95
    if (!this._hitDone && this.stateTime >= 0.35) {
      this._hitDone = true
      this._releaseBallWithArc()
      this.effects.throw?.(this.getBallPosition() || undefined)
    }

    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  private _updateSlam(_dt: number) {
    const duration = 2.2
    const progress = this.stateTime / duration

    // Pulo vertical no ar (sobe até 14m e cai esmagando na descida)
    if (progress < 0.65) {
      const jumpArc = Math.sin((progress / 0.65) * Math.PI)
      this.rootGroup.position.y = this._slamBaseY + jumpArc * 14.0
    } else {
      this.rootGroup.position.y = this._slamBaseY
    }

    // Momento exato da colisão da bunda no chão (progress >= 60%)
    if (!this._slamLanded && progress >= 0.60) {
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

    // Lança a bola com força para frente e para cima
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
    this.actions = {}
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
