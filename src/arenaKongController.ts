// ============================================================
//  arenaKongController.ts — Controlador IA e Poses Procedurais
//  do Gorila Neutro "Kong Gorak" na Arena Kong (Versão Atualizada)
//  - Clipes reais do GLB: idle, standing_relax, walk
//  - Poses procedurais não-acumulativas restaurando pose base (_rest)
//  - Locomoção pausada durante ataques para evitar sobrescrita do mixer
//  - Agarrar e soltar bola com attach/detach na mão direita (rightHand)
//  - Impulsos físicos lineares e angulares nos carros e na bola
//  - Tremor de câmera, partículas e efeitos sonoros
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

interface BoneRestTransform {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

export class KongGorak {
  public rootGroup = new THREE.Group()
  public model: THREE.Object3D | null = null
  public mixer: THREE.AnimationMixer | null = null
  public clips: Record<string, THREE.AnimationClip> = {}

  public state: KongState = 'PATROL'
  public stateTime = 0
  public actionCooldown = 0
  public walkDirection = 1
  public speed = 18.0
  public impactRadius = 36.0

  private _hit = false
  private _heldBall: any = null
  private _locomotionAction: THREE.AnimationAction | null = null
  private _previousAction: THREE.AnimationAction | null = null

  private _bones: BoneMap = { all: [] }
  private _rest = new Map<THREE.Bone, BoneRestTransform>()
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

      // Normaliza para gorila gigante colossal (~28 metros de altura)
      const bbox = new THREE.Box3().setFromObject(this.model)
      const size = bbox.getSize(new THREE.Vector3())
      const targetHeight = 28.0
      if (size.y > 0.1) {
        const scale = targetHeight / size.y
        this.model.scale.setScalar(scale)
      }

      this.model.position.set(16, 0, 0)
      this.model.lookAt(0, 0, 0)

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

      // Mapeamento dos ossos e gravação exata da pose de repouso (REST POSE)
      this._bones = this._findBones(this.model)
      this._rest.clear()
      this._bones.all.forEach((bone) => {
        bone.updateMatrixWorld(true)
        this._rest.set(bone, {
          position: bone.position.clone(),
          quaternion: bone.quaternion.clone(),
          scale: bone.scale.clone()
        })
      })

      // Configuração do AnimationMixer com os clipes oficiais
      this.mixer = new THREE.AnimationMixer(this.model)
      gltf.animations.forEach((clip) => {
        this.clips[clip.name.toLowerCase()] = clip
      })

      this._setLocomotion('idle')
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
    const find = (...terms: string[]) =>
      all.find((bone) => {
        const name = bone.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        return terms.some((term) => name.includes(term))
      })

    return {
      all,
      hips: find('hips', 'pelvis', 'root'),
      spine: find('spine', 'chest', 'torso'),
      head: find('head'),
      jaw: find('jaw', 'mouth'),
      leftUpperArm: find('leftupperarm', 'lupperarm', 'upperarml', 'arml'),
      rightUpperArm: find('rightupperarm', 'rupperarm', 'upperarmr', 'armr'),
      leftForearm: find('leftforearm', 'lforearm', 'forearml'),
      rightForearm: find('rightforearm', 'rforearm', 'forearmr'),
      leftHand: find('lefthand', 'lhand', 'handl'),
      rightHand: find('righthand', 'rhand', 'handr'),
      leftThigh: find('leftthigh', 'lthigh', 'thighl'),
      rightThigh: find('rightthigh', 'rthigh', 'thighr'),
      leftShin: find('leftshin', 'lshin', 'calfl'),
      rightShin: find('rightshin', 'rshin', 'calfr'),
      leftFoot: find('leftfoot', 'lfoot', 'footl'),
      rightFoot: find('rightfoot', 'rfoot', 'footr')
    }
  }

  public update(dt: number) {
    if (!this.model) return
    this.stateTime += dt
    this.actionCooldown = Math.max(0, this.actionCooldown - dt)

    // Atualiza mixer das animações de locomoção
    if (this.mixer) {
      this.mixer.update(dt)
    }

    if (this._heldBall) {
      this._keepBallInHand()
    }

    switch (this.state) {
      case 'PATROL':
        this._patrol(dt)
        break
      case 'CHASE_BALL':
        this._chaseBall(dt)
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

    if (this.state === 'PATROL' || this.state === 'CHASE_BALL') {
      this._chooseAction()
    }
  }

  private _setLocomotion(name: string) {
    if (!this.mixer || !this.clips[name]) return
    const next = this.mixer.clipAction(this.clips[name])
    next.enabled = true
    next.setLoop(THREE.LoopRepeat, Infinity)
    if (this._locomotionAction && this._locomotionAction !== next) {
      this._locomotionAction.fadeOut(0.16)
    }
    next.reset().fadeIn(0.16).play()
    this._locomotionAction = next
  }

  private _pauseLocomotion() {
    if (this._locomotionAction) {
      this._locomotionAction.fadeOut(0.08)
      this._locomotionAction.paused = true
      this._previousAction = this._locomotionAction
    }
    this._restoreRestPose()
  }

  private _resumeLocomotion(name = 'idle') {
    this._restoreRestPose()
    if (this._previousAction) {
      this._previousAction.paused = false
      this._previousAction.reset().fadeIn(0.16).play()
      this._locomotionAction = this._previousAction
      this._previousAction = null
    } else {
      this._setLocomotion(name)
    }
  }

  private _restoreRestPose() {
    for (const bone of this._bones.all) {
      const rest = this._rest.get(bone)
      if (!rest) continue
      bone.position.copy(rest.position)
      bone.quaternion.copy(rest.quaternion)
      bone.scale.copy(rest.scale)
    }
  }

  private _chooseAction() {
    if (this.actionCooldown > 0 || this.stateTime < 0.8 || !this.model) return

    const ballPos = this.ball?.pos || this.ball?.position || this.ball?.mesh?.position
    const kongPos = this.model.position
    const ballDistance = ballPos ? kongPos.distanceTo(ballPos) : Infinity
    const car = this._nearestCar()
    const carDistance = car ? kongPos.distanceTo(car.pos || car.position) : Infinity

    // Se a bola estiver prestes a entrar em qualquer um dos dois gols, corre para bloquear
    if (ballPos && Math.abs(ballPos.z) > 110 && ballDistance < 80) {
      return this._start('CHASE_BALL')
    }

    // Interações na bola
    if (ballDistance < 18.0) {
      if (ballDistance < 12.0 && Math.random() < 0.35) return this._start('GRAB_BALL')
      if (Math.random() < 0.50) return this._start('KICK_BALL')
    }

    // Interações nos carros
    if (carDistance < 20.0 && Math.random() < 0.40) {
      return this._start('PUNCH_CAR')
    }

    // Salto e terremoto se cercado por carros ou bola
    if ((carDistance < 24.0 || ballDistance < 24.0) && Math.random() < 0.15) {
      return this._start('BUTT_SLAM')
    }

    // Rugido agressivo espontâneo
    if (Math.random() < 0.03) {
      return this._start('RAGE')
    }
  }

  private _start(next: KongState) {
    this.state = next
    this.stateTime = 0
    this._hit = false
    if (!['PATROL', 'CHASE_BALL'].includes(next)) {
      this._pauseLocomotion()
    }
    this.effects.onState?.(next)
  }

  private _finish(next: KongState = 'PATROL') {
    this._hit = false
    this.state = next
    this.stateTime = 0
    this.actionCooldown = 1.2
    this._resumeLocomotion(next === 'PATROL' ? 'walk' : 'idle')
  }

  private _patrol(dt: number) {
    if (!this.model) return
    this._setLocomotion('walk')
    this.model.position.x += this.walkDirection * this.speed * dt

    if (Math.abs(this.model.position.x) > 65) {
      this.walkDirection *= -1
      this.model.rotation.y = this.walkDirection > 0 ? Math.PI / 2 : -Math.PI / 2
    }

    const ballPos = this.ball?.pos || this.ball?.position || this.ball?.mesh?.position
    if (ballPos && this.model.position.distanceTo(ballPos) < 45) {
      this._start('CHASE_BALL')
    }
  }

  private _chaseBall(dt: number) {
    if (!this.model) return
    this._setLocomotion('walk')
    const ballPos = this.ball?.pos || this.ball?.position || this.ball?.mesh?.position
    if (!ballPos) return this._finish()

    const direction = ballPos.clone().sub(this.model.position)
    direction.y = 0
    if (direction.length() > 14.0) {
      direction.normalize()
      this.model.position.addScaledVector(direction, this.speed * 1.35 * dt)
      this.model.lookAt(ballPos.x, this.model.position.y, ballPos.z)
    } else {
      this._finish('PATROL')
    }
  }

  private _rage() {
    const t = Math.min(1, this.stateTime / 0.42)
    const hold = Math.min(1, Math.max(0, (1.45 - this.stateTime) / 0.35))
    const k = Math.max(t, hold)
    this._poseRoar(k)
    this.effects.rage?.(k)

    // Brilho ciano nos olhos
    this._eyeMaterials.forEach((m) => {
      m.emissive = new THREE.Color(0x00f0ff)
      m.emissiveIntensity = k * 3.5
    })

    if (this.stateTime > 1.6) {
      this._eyeMaterials.forEach((m) => {
        m.emissiveIntensity = 0
      })
      this._finish()
    }
  }

  private _kickBall() {
    const t = Math.min(1, this.stateTime / 0.9)
    this._poseKick(t)
    if (this.stateTime > 0.48 && !this._hit) {
      this._hit = true
      this._ballImpulse(62)
      this.effects.kick?.(this.ball?.pos || this.ball?.position)
    }
    if (this.stateTime > 1.0) this._finish()
  }

  private _punchCar() {
    const t = Math.min(1, this.stateTime / 0.85)
    this._posePunch(t)
    if (this.stateTime > 0.42 && !this._hit) {
      this._hit = true
      this._carImpulse(48)
      const car = this._nearestCar()
      this.effects.punch?.(car?.pos || car?.position)
    }
    if (this.stateTime > 0.98) this._finish()
  }

  private _grabBall() {
    const t = Math.min(1, this.stateTime / 0.8)
    this._poseGrab(t)
    if (this.stateTime > 0.42 && !this._hit) {
      this._hit = true
      this._attachBallToHand()
      this.effects.grab?.(this.ball?.pos || this.ball?.position)
    }
    if (this.stateTime > 1.1) this._start('THROW_BALL')
  }

  private _throwBall() {
    const t = Math.min(1, this.stateTime / 0.85)
    this._poseThrow(t)
    if (this.stateTime > 0.34 && !this._hit) {
      this._hit = true
      this._releaseBallWithArc()
      this.effects.throw?.(this.ball?.pos || this.ball?.position)
    }
    if (this.stateTime > 0.95) this._finish()
  }

  private _buttSlam() {
    const t = Math.min(1, this.stateTime / 1.25)
    this._poseSlam(t)

    // Salto aéreo e queda esmagadora de bunda
    if (this.model) {
      const jumpProgress = Math.sin(Math.PI * Math.min(1, this.stateTime / 1.1))
      this.model.position.y = Math.max(0, jumpProgress * 14.0)
    }

    if (this.stateTime > 0.78 && !this._hit) {
      this._hit = true
      if (this.model) this.model.position.y = 0
      this._radialImpulse()
      this.effects.slam?.(this.model?.position)
    }
    if (this.stateTime > 1.38) {
      if (this.model) this.model.position.y = 0
      this._finish()
    }
  }

  private _recover() {
    if (this.stateTime > 0.5) this._finish()
  }

  private _poseRoar(k: number) {
    this._setEuler(this._bones.spine, -0.22 * k, 0, 0)
    this._setEuler(this._bones.leftUpperArm, -0.75 * k, 0, -0.35 * k)
    this._setEuler(this._bones.rightUpperArm, -0.75 * k, 0, 0.35 * k)
    this._setEuler(this._bones.leftForearm, -0.32 * k, 0, 0)
    this._setEuler(this._bones.rightForearm, -0.32 * k, 0, 0)
    if (this._bones.jaw) this._setEuler(this._bones.jaw, 0.55 * k, 0, 0)
  }

  private _poseKick(t: number) {
    const k = Math.sin(Math.PI * t)
    this._setEuler(this._bones.spine, 0.22 * k, 0, 0)
    this._setEuler(this._bones.leftThigh, 0.22 * k, 0, 0)
    this._setEuler(this._bones.rightThigh, -1.25 * k, 0, 0)
    this._setEuler(this._bones.rightShin, 1.55 * k, 0, 0)
    this._setEuler(this._bones.rightFoot, -0.35 * k, 0, 0)
  }

  private _posePunch(t: number) {
    const k = Math.sin(Math.PI * t)
    this._setEuler(this._bones.spine, 0, -0.45 * k, 0)
    this._setEuler(this._bones.rightUpperArm, -1.25 * k, -0.25 * k, -0.45 * k)
    this._setEuler(this._bones.rightForearm, -1.15 * k, 0, 0)
    this._setEuler(this._bones.leftUpperArm, 0.35 * k, 0, 0.25 * k)
  }

  private _poseGrab(t: number) {
    const k = Math.sin(Math.PI * t)
    this._setEuler(this._bones.spine, 0.28 * k, 0, 0)
    this._setEuler(this._bones.leftUpperArm, -0.92 * k, 0, -0.85 * k)
    this._setEuler(this._bones.rightUpperArm, -0.92 * k, 0, 0.85 * k)
    this._setEuler(this._bones.leftForearm, -0.65 * k, 0, 0)
    this._setEuler(this._bones.rightForearm, -0.65 * k, 0, 0)
  }

  private _poseThrow(t: number) {
    const k = Math.sin(Math.PI * t)
    this._setEuler(this._bones.spine, -0.35 * k, 0, 0)
    this._setEuler(this._bones.leftUpperArm, -1.35 * k, 0, -0.55 * k)
    this._setEuler(this._bones.rightUpperArm, -1.35 * k, 0, 0.55 * k)
    this._setEuler(this._bones.leftForearm, -0.45 * k, 0, 0)
    this._setEuler(this._bones.rightForearm, -0.45 * k, 0, 0)
  }

  private _poseSlam(t: number) {
    const k = Math.sin(Math.PI * t)
    this._setEuler(this._bones.hips, 0.45 * k, 0, 0)
    this._setEuler(this._bones.spine, 0.85 * k, 0, 0)
    this._setEuler(this._bones.leftUpperArm, 1.15 * k, 0, -0.4 * k)
    this._setEuler(this._bones.rightUpperArm, 1.15 * k, 0, 0.4 * k)
    this._setEuler(this._bones.leftThigh, -0.65 * k, 0, 0)
    this._setEuler(this._bones.rightThigh, -0.65 * k, 0, 0)
  }

  private _setEuler(bone: THREE.Bone | undefined, x: number, y: number, z: number) {
    if (!bone) return
    const rest = this._rest.get(bone)
    bone.quaternion.copy(rest ? rest.quaternion : new THREE.Quaternion())
    bone.rotateX(x)
    bone.rotateY(y)
    bone.rotateZ(z)
  }

  private _attachBallToHand() {
    if (!this.ball || !this._bones.rightHand || this._heldBall) return
    const hand = this._bones.rightHand
    hand.updateWorldMatrix(true, false)
    const ballObj = this.ball.mesh || this.ball
    hand.attach(ballObj)
    ballObj.position.set(0, 1.5, 0)

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
    ballObj.position.set(0, 1.5, 0)
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
    direction.y = 0.42
    direction.normalize()
    this.physics.applyImpulse?.(ball, direction.multiplyScalar(68))
    this._heldBall = null
  }

  private _nearestCar(): any {
    const cars = this.getCars().filter(Boolean)
    if (!cars.length || !this.model) return null
    return cars.sort((a, b) => {
      const pA = a.pos || a.position
      const pB = b.pos || b.position
      return this.model!.position.distanceTo(pA) - this.model!.position.distanceTo(pB)
    })[0]
  }

  private _ballImpulse(force: number) {
    if (!this.ball || this.ball.userData?.kongHeld || !this.model) return
    const bPos = this.ball.pos || this.ball.position || this.ball.mesh?.position
    if (!bPos) return
    const direction = bPos.clone().sub(this.model.position).normalize()
    direction.y = 0.28
    direction.normalize()
    this.physics.applyImpulse?.(this.ball, direction.multiplyScalar(force))
  }

  private _carImpulse(force: number) {
    const car = this._nearestCar()
    if (!car || !this.model) return
    const cPos = car.pos || car.position
    const direction = cPos.clone().sub(this.model.position).normalize()
    direction.y = 0.65
    direction.normalize()
    this.physics.applyImpulse?.(car, direction.multiplyScalar(force))
    this.physics.applyAngularImpulse?.(car, new THREE.Vector3(0, force * 0.4, force * 0.3))
  }

  private _radialImpulse() {
    if (!this.model) return
    const objects = [this.ball, ...this.getCars()].filter(Boolean)
    for (const object of objects) {
      const objPos = object.pos || object.position || object.mesh?.position
      if (!objPos) continue
      const direction = objPos.clone().sub(this.model.position)
      const distance = Math.max(0.1, direction.length())
      if (distance < this.impactRadius) {
        direction.normalize().multiplyScalar(45 * (1 - distance / this.impactRadius))
        direction.y = Math.max(direction.y, 0.45)
        this.physics.applyImpulse?.(object, direction)
        if (typeof object.applySpinOut === 'function') {
          object.applySpinOut(1.8)
        }
      }
    }
    this.camera?.shake?.(0.65, 0.85)
  }

  private _createProceduralFallback() {
    const group = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9 })
    const chest = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 8), mat)
    chest.position.y = 14
    group.add(chest)
    this.model = group
    this.rootGroup.add(group)
  }

  public dispose() {
    if (this._heldBall) {
      this._releaseBallWithArc()
    }
    this._rest.clear()
    if (this.mixer) {
      this.mixer.stopAllAction()
      this.mixer = null
    }
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
