// ============================================================
//  arenaKongController.ts — Controlador IA e Poses Procedurais
//  Kong Gorak na Arena Kong (Versão Fluida com Alta Reatividade)
//  - Locomoção contínua: o clipe walk NUNCA é resetado enquanto roda
//  - Orientação no plano XZ: sempre olha para o alvo ativo
//  - Percepção ampla: persegue a bola em QUALQUER região do estádio
//  - Hierarquia de prioridade: Bola -> Carros -> Butt Slam -> Patrulha
//  - Poses procedurais limpas com restauração de pose base (_rest)
//  - Agarre e arremesso real com bola presa ao osso rightHand
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
  public speed = 20.0
  public impactRadius = 38.0

  private _hit = false
  private _heldBall: any = null
  private _locomotionAction: THREE.AnimationAction | null = null
  private _currentClipName = ''

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

      // Normaliza para gorila colossal (~28 metros de altura)
      const bbox = new THREE.Box3().setFromObject(this.model)
      const size = bbox.getSize(new THREE.Vector3())
      const targetHeight = 28.0
      if (size.y > 0.1) {
        const scale = targetHeight / size.y
        this.model.scale.setScalar(scale)
      }

      // Posição inicial ao lado da bola no meio-campo virado para o centro
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

      // Mapeamento preciso dos ossos principais (excluindo twists auxiliares)
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

      // Inicia em caminhada imediatamente
      this._setLocomotion('walk')
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
          return cleanB.includes(cleanT) && !cleanB.includes('twist')
        })
        if (found) return found
      }
      return undefined
    }

    return {
      all,
      hips: findExact('Pelvis', 'Hip', 'Waist', 'Root'),
      spine: findExact('Spine02', 'Spine01', 'Spine'),
      head: findExact('Head'),
      jaw: findExact('Jaw', 'Head'),
      leftUpperArm: findExact('L_Upperarm', 'LeftUpperArm'),
      rightUpperArm: findExact('R_Upperarm', 'RightUpperArm'),
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

  private _lookAtTarget(target: THREE.Vector3) {
    if (!this.model) return
    const direction = target.clone().sub(this.model.position)
    direction.y = 0
    if (direction.lengthSq() > 0.001) {
      this.model.lookAt(target.x, this.model.position.y, target.z)
    }
  }

  public update(dt: number) {
    if (!this.model) return
    this.stateTime += dt
    this.actionCooldown = Math.max(0, this.actionCooldown - dt)

    // 1. mixer.update(dt) UMA ÚNICA VEZ por frame antes da lógica
    if (this.mixer) {
      this.mixer.update(dt)
    }

    // 2. Mantém a bola na mão caso esteja agarrada
    if (this._heldBall) {
      this._keepBallInHand()
    }

    // 3. Executa a máquina de estados
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

  /**
   * Locomoção contínua e fluida:
   * Se a ação já estiver rodando, NUNCA chama reset() ou play(),
   * permitindo que o ciclo da caminhada (walk) complete naturalmente.
   */
  private _setLocomotion(name: string) {
    if (!this.mixer || !this.clips[name]) return

    // Se já é a animação atual e não está pausada, RETORNA IMEDIATAMENTE!
    if (this._currentClipName === name && this._locomotionAction && !this._locomotionAction.paused) {
      return
    }

    const nextAction = this.mixer.clipAction(this.clips[name])
    nextAction.enabled = true
    nextAction.setLoop(THREE.LoopRepeat, Infinity)

    // Se a mesma animação estava pausada, despausa sem resetar o tempo
    if (this._currentClipName === name && this._locomotionAction && this._locomotionAction.paused) {
      this._locomotionAction.paused = false
      return
    }

    // Transição suave (crossFade) entre idle e walk
    if (this._locomotionAction && this._locomotionAction !== nextAction) {
      nextAction.reset()
      nextAction.play()
      this._locomotionAction.crossFadeTo(nextAction, 0.25, true)
    } else {
      nextAction.reset().play()
    }

    this._locomotionAction = nextAction
    this._currentClipName = name
  }

  private _pauseLocomotion() {
    if (this._locomotionAction) {
      this._locomotionAction.fadeOut(0.08)
      this._locomotionAction.paused = true
    }
    this._restoreRestPose()
  }

  private _resumeLocomotion(name = 'walk') {
    this._restoreRestPose()
    if (this._locomotionAction) {
      this._locomotionAction.paused = false
      this._locomotionAction.fadeIn(0.18).play()
    }
    this._setLocomotion(name)
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

  /**
   * Prioridade de comportamento orientada a alvos reais (sem depender de Math.random):
   * 1. Bola próxima (< 18m) -> Chutar ou Agarrar
   * 2. Carros próximos (< 20m) -> Bater com o punho/mão
   * 3. Múltiplos alvos próximos (< 22m) -> Butt Slam
   * 4. Bola no campo (em qualquer lugar!) -> Olhar para ela e Perseguir
   * 5. Nenhum alvo -> Patrulhar
   */
  private _chooseAction() {
    if (this.actionCooldown > 0 || this.stateTime < 0.6 || !this.model) return

    const ballPos = this.getBallPosition()
    const kongPos = this.model.position
    const ballDistance = ballPos ? kongPos.distanceTo(ballPos) : Infinity

    const cars = this.getCars().filter(Boolean)
    let nearestCar: any = null
    let minCarDist = Infinity
    let carsNearCount = 0

    for (const car of cars) {
      const cPos = this.getCarPosition(car)
      if (!cPos) continue
      const d = kongPos.distanceTo(cPos)
      if (d < 22.0) carsNearCount++
      if (d < minCarDist) {
        minCarDist = d
        nearestCar = car
      }
    }

    // 1. Múltiplos objetos muito próximos -> Butt Slam esmagador
    if ((carsNearCount >= 2 || (carsNearCount >= 1 && ballDistance < 20.0)) && Math.random() < 0.35) {
      return this._start('BUTT_SLAM')
    }

    // 2. Bola ao alcance de toque
    if (ballPos && ballDistance < 18.0) {
      this._lookAtTarget(ballPos)
      // Se estiver muito perto, alterna entre agarrar e chutar
      if (ballDistance < 13.0 && Math.random() < 0.45) {
        return this._start('GRAB_BALL')
      }
      return this._start('KICK_BALL')
    }

    // 3. Carro em alcance de soco
    if (nearestCar && minCarDist < 20.0) {
      const cPos = this.getCarPosition(nearestCar)
      if (cPos) this._lookAtTarget(cPos)
      return this._start('PUNCH_CAR')
    }

    // 4. Percepção ampla da bola em QUALQUER região do campo (sem restrição de Z)
    if (ballPos && this.state !== 'CHASE_BALL') {
      return this._start('CHASE_BALL')
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

  private _finish(next: KongState = 'CHASE_BALL') {
    this._hit = false
    this.state = next
    this.stateTime = 0
    this.actionCooldown = 0.8
    this._restoreRestPose()
    this._resumeLocomotion(next === 'CHASE_BALL' ? 'walk' : 'idle')
  }

  private _patrol(dt: number) {
    if (!this.model) return
    const ballPos = this.getBallPosition()
    if (ballPos) {
      this._start('CHASE_BALL')
      return
    }

    this._setLocomotion('walk')
    this.model.position.x += this.walkDirection * this.speed * dt

    if (Math.abs(this.model.position.x) > 65) {
      this.walkDirection *= -1
      this.model.rotation.y = this.walkDirection > 0 ? Math.PI / 2 : -Math.PI / 2
    }
  }

  private _chaseBall(dt: number) {
    if (!this.model) return
    this._setLocomotion('walk')
    const ballPos = this.getBallPosition()
    if (!ballPos) return this._finish('PATROL')

    // SEMPRE vira o corpo e olha diretamente para a bola no plano XZ
    this._lookAtTarget(ballPos)

    const direction = ballPos.clone().sub(this.model.position)
    direction.y = 0
    const dist = direction.length()

    // Avança em direção à bola com passos largos
    if (dist > 14.0) {
      direction.normalize()
      this.model.position.addScaledVector(direction, this.speed * 1.35 * dt)
    } else {
      // Chegou na bola: escolhe chute ou agarre
      this._chooseAction()
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
      this._finish('CHASE_BALL')
    }
  }

  private _kickBall() {
    const ballPos = this.getBallPosition()
    if (ballPos) this._lookAtTarget(ballPos)

    const t = Math.min(1, this.stateTime / 0.9)
    this._poseKick(t)

    // Impacto exatamente no momento de contato da perna
    if (this.stateTime > 0.45 && !this._hit) {
      this._hit = true
      this._ballImpulse(75)
      this.effects.kick?.(ballPos || undefined)
    }
    if (this.stateTime > 0.95) this._finish('CHASE_BALL')
  }

  private _punchCar() {
    const car = this._nearestCar()
    const carPos = car ? this.getCarPosition(car) : null
    if (carPos) this._lookAtTarget(carPos)

    const t = Math.min(1, this.stateTime / 0.85)
    this._posePunch(t)

    // Impacto no momento que o braço conecta
    if (this.stateTime > 0.42 && !this._hit) {
      this._hit = true
      this._carImpulse(55)
      this.effects.punch?.(carPos || undefined)
    }
    if (this.stateTime > 0.92) this._finish('CHASE_BALL')
  }

  private _grabBall() {
    const ballPos = this.getBallPosition()
    if (ballPos) this._lookAtTarget(ballPos)

    const t = Math.min(1, this.stateTime / 0.8)
    this._poseGrab(t)

    if (this.stateTime > 0.42 && !this._hit) {
      this._hit = true
      this._attachBallToHand()
      this.effects.grab?.(ballPos || undefined)
    }
    if (this.stateTime > 1.05) this._start('THROW_BALL')
  }

  private _throwBall() {
    const t = Math.min(1, this.stateTime / 0.85)
    this._poseThrow(t)

    if (this.stateTime > 0.34 && !this._hit) {
      this._hit = true
      this._releaseBallWithArc()
      this.effects.throw?.(this.getBallPosition() || undefined)
    }
    if (this.stateTime > 0.92) this._finish('CHASE_BALL')
  }

  private _buttSlam() {
    const t = Math.min(1, this.stateTime / 1.25)
    this._poseSlam(t)

    // Salto no ar e queda esmagadora de bunda
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
    if (this.stateTime > 1.35) {
      if (this.model) this.model.position.y = 0
      this._finish('CHASE_BALL')
    }
  }

  private _recover() {
    if (this.stateTime > 0.4) this._finish('CHASE_BALL')
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
    this.physics.applyImpulse?.(ball, direction.multiplyScalar(75))
    this._heldBall = null
  }

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
    direction.y = 0.28
    direction.normalize()
    this.physics.applyImpulse?.(this.ball, direction.multiplyScalar(force))
  }

  private _carImpulse(force: number) {
    const car = this._nearestCar()
    if (!car || !this.model) return
    const cPos = this.getCarPosition(car)
    if (!cPos) return
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
      const objPos = object === this.ball ? this.getBallPosition() : this.getCarPosition(object)
      if (!objPos) continue
      const direction = objPos.clone().sub(this.model.position)
      const distance = Math.max(0.1, direction.length())
      if (distance < this.impactRadius) {
        direction.normalize().multiplyScalar(48 * (1 - distance / this.impactRadius))
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
