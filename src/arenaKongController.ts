// ============================================================
//  arenaKongController.ts — Controlador Oficial Kong Gorak
//  Arena Kong / Turbo Soccer — Integração Fiel e Definitiva
// ============================================================
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type KongState =
  | 'PATROL'
  | 'CHASE_BALL'
  | 'SPRINT_BALL'
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
  hitObstacle?: (pos?: THREE.Vector3) => void
  step?: (pos?: THREE.Vector3) => void
  rage?: (k: number) => void
  onState?: (state: KongState) => void
}

export interface BoneMap {
  all: THREE.Bone[]
  root?: THREE.Bone
  hips?: THREE.Bone
  pelvis?: THREE.Bone
  spine01?: THREE.Bone
  spine02?: THREE.Bone
  neck?: THREE.Bone
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
  hitboxLHand?: THREE.Bone
  hitboxRHand?: THREE.Bone
  hitboxLFoot?: THREE.Bone
  hitboxRFoot?: THREE.Bone
  hitboxPelvis?: THREE.Bone
  ballHoldPoint?: THREE.Bone
}

export const EXPECTED_CLIPS = [
  'idle',
  'walk',
  'punch_left',
  'punch_right',
  'kick_ball',
  'grab_ball',
  'hold_ball',
  'throw_ball',
  'butt_slam',
  'roar_rage',
  'standing_relax'
] as const

// Aliases para mapear os nomes reais do MoCap do Mixamo
const CLIP_ALIASES: Record<string, string[]> = {
  walk: ['walk_monster', 'walking', 'walk', 'monster_walk'],
  idle: ['action_idle_to_fight_idle', 'standing_relax', 'idle', 'fight_idle'],
  roar_rage: ['idle_roar', 'roar', 'roar_rage'],
  punch_right: ['great_sword_slash', 'sword_and_shield_slash', 'punch_right', 'punch'],
  punch_left: ['sword_and_shield_slash', 'great_sword_slash', 'punch_left'],
  kick_ball: ['heavy_kick', 'drop_kick', 'kick_ball', 'kick'],
  grab_ball: ['grab_and_throw', 'throw_object', 'grab_ball'],
  hold_ball: ['grab_and_throw', 'hold_ball', 'throw_object'],
  throw_ball: ['throw', 'throw_object', 'throw_ball', 'grab_and_throw'],
  butt_slam: ['jump_impact_landing', 'jumping_down', 'stomp', 'butt_slam'],
  standing_relax: ['action_idle_to_fight_idle', 'standing_relax', 'idle']
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

  // Temporizador estrito para o Butt Slam: inicia com 10 segundos para não pular no kickoff
  public slamTimer = 10.0
  public walkSpeed = 9.5
  public walkDirection = 1
  public impactRadius = 45.0

  private _hitDone = false
  private _heldBall: any = null
  private _currentAction: THREE.AnimationAction | null = null
  private _currentActionName = ''
  private _bones: BoneMap = { all: [] }
  private _restPose = new Map<THREE.Bone, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>()
  private _punchSide: 'punch_left' | 'punch_right' = 'punch_right'
  private _footstepTimer = 0

  // Slam state
  private _slamBaseY = 0
  private _slamLanded = false
  private _slamDuration = 2.416

  // Collider de corpo periódico
  private _bodyColliderFrame = 0

  private scene: THREE.Scene
  private ball: any
  private getCars: () => any[]
  private getObstacles?: () => any[]
  private physics: KongPhysicsAdapter
  private camera: KongCameraAdapter
  private effects: KongEffectsAdapter

  constructor({
    scene,
    ball,
    getCars,
    getObstacles,
    physics = {},
    camera = {},
    effects = {}
  }: {
    scene: THREE.Scene
    ball: any
    getCars: () => any[]
    getObstacles?: () => any[]
    physics?: KongPhysicsAdapter
    camera?: KongCameraAdapter
    effects?: KongEffectsAdapter
  }) {
    this.scene = scene
    this.ball = ball
    this.getCars = getCars
    this.getObstacles = getObstacles
    this.physics = physics
    this.camera = camera
    this.effects = effects
    this.rootGroup.name = 'KongGorakEntity'
  }

  // ============================================================
  // ETAPA A: CARREGAMENTO DO GLB DEFINITIVO
  // ============================================================
  async load(): Promise<void> {
    const loader = new GLTFLoader()
    const glbPath = '/assets/arena-kong/gorilla_mocap_complete.glb'

    const gltf = await loader.loadAsync(glbPath)
    this.model = gltf.scene
    this.model.name = 'KongGorakModel'

    // ============================================================
    // ETAPA B: ESCALA E PIVÔ
    // ============================================================
    // Ajusta para altura calibrada de ~16.5m (harmoniosa com carros de 1.4m e bola de 2.0m)
    const initialBox = new THREE.Box3().setFromObject(this.model)
    const initialSize = initialBox.getSize(new THREE.Vector3())
    const targetHeight = 16.5
    if (initialSize.y > 0.1) {
      const scale = targetHeight / initialSize.y
      this.model.scale.setScalar(scale)
    }

    // Alinhamento único do pivô: solas dos pés exatamente no Y = 0 (sem afundar nem flutuar)
    this.model.updateMatrixWorld(true)
    const calibratedBox = new THREE.Box3().setFromObject(this.model)
    this.model.position.y = -calibratedBox.min.y
    this._slamBaseY = 0

    // Posição inicial no círculo central
    this.rootGroup.position.set(18, 0, 0)
    this.rootGroup.rotation.y = -Math.PI / 2

    // Configuração de sombras, colorSpace e iluminação de pelagem
    this.model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach((m: any) => {
            if (m.map) m.map.colorSpace = THREE.SRGBColorSpace
            if (typeof m.roughness === 'number') m.roughness = 0.8
            if (typeof m.metalness === 'number') m.metalness = 0.05
            if (m.emissive) m.emissive.setHex(0x181310)
          })
        }
      }
    })

    // ============================================================
    // ETAPA C: MAPEAMENTO DOS BONES E MARCADORES NATIVOS
    // ============================================================
    this._bones = this._findBones(this.model)
    this._logBoneMapping()

    // Salva rest pose de cada osso
    this._restPose.clear()
    this._bones.all.forEach((bone) => {
      this._restPose.set(bone, {
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone()
      })
    })

    // ============================================================
    // ETAPA D: PLAYBACK E AÇÕES DO MIXER
    // ============================================================
    this.mixer = new THREE.AnimationMixer(this.model)

    // 1. Registra clips pelo nome original
    gltf.animations.forEach((clip) => {
      const rawKey = clip.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      this.clips[rawKey] = clip
      const action = this.mixer!.clipAction(clip)
      this.actions[rawKey] = action
    })

    // 2. Mapeia aliases esperados pelo sistema do jogo
    for (const [standardName, aliases] of Object.entries(CLIP_ALIASES)) {
      if (this.actions[standardName]) continue
      for (const alias of aliases) {
        const found = Object.keys(this.actions).find((k) => k === alias || k.includes(alias))
        if (found) {
          this.clips[standardName] = this.clips[found]
          this.actions[standardName] = this.actions[found]
          break
        }
      }
    }

    // Configuração de loop para cada ação
    Object.entries(this.actions).forEach(([key, action]) => {
      if (['idle', 'standing_relax', 'walk', 'hold_ball', 'walk_monster'].includes(key)) {
        action.setLoop(THREE.LoopRepeat, Infinity)
      } else {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
    })

    // Validação estrita dos 11 clips exigidos
    const foundClips = Object.keys(this.clips)
    console.log(`[KongGorak] ${foundClips.length}/11 clips carregados com sucesso:`, foundClips)
    const missing = EXPECTED_CLIPS.filter((name) => !foundClips.includes(name))
    if (missing.length > 0) {
      console.warn('[KongGorak] ATENÇÃO: Clipes ausentes no GLB:', missing)
    }

    // Cache da duração real do butt_slam
    if (this.actions['butt_slam']) {
      this._slamDuration = this.actions['butt_slam'].getClip().duration || 2.416
    }

    // Inicia caminhada
    this._playAction('walk', true)

    this.rootGroup.add(this.model)
  }

  private _findBones(root: THREE.Object3D): BoneMap {
    const all: THREE.Bone[] = []
    root.traverse((object) => {
      if ((object as THREE.Bone).isBone) all.push(object as THREE.Bone)
    })

    const findExact = (...terms: string[]): THREE.Bone | undefined => {
      for (const t of terms) {
        const found = all.find((b) => b.name.toLowerCase() === t.toLowerCase() || b.name.toLowerCase() === `mixamorig:${t.toLowerCase()}`)
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

    const pelvis = findExact('Pelvis', 'Hips', 'Waist')
    const leftHand = findExact('L_Hand', 'LeftHand', 'mixamorig:LeftHand')
    const rightHand = findExact('R_Hand', 'RightHand', 'mixamorig:RightHand')
    const leftFoot = findExact('L_Foot', 'LeftFoot', 'mixamorig:LeftFoot')
    const rightFoot = findExact('R_Foot', 'RightFoot', 'mixamorig:RightFoot')

    let hitboxLHand = findExact('Hitbox_L_Hand')
    if (!hitboxLHand && leftHand) {
      hitboxLHand = new THREE.Bone()
      hitboxLHand.name = 'Hitbox_L_Hand'
      hitboxLHand.position.set(-0.08, 0.39, 0.28)
      leftHand.add(hitboxLHand)
      all.push(hitboxLHand)
    }

    let hitboxRHand = findExact('Hitbox_R_Hand')
    if (!hitboxRHand && rightHand) {
      hitboxRHand = new THREE.Bone()
      hitboxRHand.name = 'Hitbox_R_Hand'
      hitboxRHand.position.set(0.03, 0.47, 0.06)
      rightHand.add(hitboxRHand)
      all.push(hitboxRHand)
    }

    let hitboxLFoot = findExact('Hitbox_L_Foot')
    if (!hitboxLFoot && leftFoot) {
      hitboxLFoot = new THREE.Bone()
      hitboxLFoot.name = 'Hitbox_L_Foot'
      hitboxLFoot.position.set(0.17, 0.02, 0.05)
      leftFoot.add(hitboxLFoot)
      all.push(hitboxLFoot)
    }

    let hitboxRFoot = findExact('Hitbox_R_Foot')
    if (!hitboxRFoot && rightFoot) {
      hitboxRFoot = new THREE.Bone()
      hitboxRFoot.name = 'Hitbox_R_Foot'
      hitboxRFoot.position.set(-0.16, 0.02, 0.05)
      rightFoot.add(hitboxRFoot)
      all.push(hitboxRFoot)
    }

    let hitboxPelvis = findExact('Hitbox_Pelvis')
    if (!hitboxPelvis && pelvis) {
      hitboxPelvis = new THREE.Bone()
      hitboxPelvis.name = 'Hitbox_Pelvis'
      hitboxPelvis.position.set(0.30, -0.30, -0.03)
      pelvis.add(hitboxPelvis)
      all.push(hitboxPelvis)
    }

    let ballHoldPoint = findExact('Ball_Hold_Point')
    if (!ballHoldPoint && rightHand) {
      ballHoldPoint = new THREE.Bone()
      ballHoldPoint.name = 'Ball_Hold_Point'
      ballHoldPoint.position.set(0.05, 0.45, 0.15)
      rightHand.add(ballHoldPoint)
      all.push(ballHoldPoint)
    }

    return {
      all,
      root: findExact('Root', 'mixamorig:Hips'),
      hips: findExact('Hips', 'mixamorig:Hips') || pelvis,
      pelvis,
      spine01: findExact('Spine01', 'Spine', 'mixamorig:Spine'),
      spine02: findExact('Spine02', 'mixamorig:Spine1', 'mixamorig:Spine2'),
      neck: findExact('Neck', 'mixamorig:Neck'),
      head: findExact('Head', 'mixamorig:Head'),
      jaw: findExact('Jaw', 'mixamorig:Jaw'),
      leftUpperArm: findExact('L_Upperarm', 'L_UpperArm', 'LeftUpperArm', 'mixamorig:LeftArm'),
      rightUpperArm: findExact('R_Upperarm', 'R_UpperArm', 'RightUpperArm', 'mixamorig:RightArm'),
      leftForearm: findExact('L_Forearm', 'LeftForearm', 'mixamorig:LeftForeArm'),
      rightForearm: findExact('R_Forearm', 'RightForearm', 'mixamorig:RightForeArm'),
      leftHand,
      rightHand,
      leftThigh: findExact('L_Thigh', 'LeftThigh', 'mixamorig:LeftUpLeg'),
      rightThigh: findExact('R_Thigh', 'RightThigh', 'mixamorig:RightUpLeg'),
      leftShin: findExact('L_Calf', 'LeftCalf', 'LeftShin', 'mixamorig:LeftLeg'),
      rightShin: findExact('R_Calf', 'RightCalf', 'RightShin', 'mixamorig:RightLeg'),
      leftFoot,
      rightFoot,
      hitboxLHand,
      hitboxRHand,
      hitboxLFoot,
      hitboxRFoot,
      hitboxPelvis,
      ballHoldPoint
    }
  }

  private _logBoneMapping() {
    const markers = [
      ['hitboxLHand', this._bones.hitboxLHand],
      ['hitboxRHand', this._bones.hitboxRHand],
      ['hitboxLFoot', this._bones.hitboxLFoot],
      ['hitboxRFoot', this._bones.hitboxRFoot],
      ['hitboxPelvis', this._bones.hitboxPelvis],
      ['ballHoldPoint', this._bones.ballHoldPoint]
    ] as const

    for (const [name, bone] of markers) {
      if (bone) {
        console.log(`[KongGorak] Marcador nativo confirmado: ${name} -> "${bone.name}"`)
      } else {
        console.error(`[KongGorak] ERRO: Marcador nativo ausente: ${name}`)
      }
    }
  }

  private _restoreRestPose() {
    for (const [bone, rest] of this._restPose) {
      bone.position.copy(rest.position)
      bone.quaternion.copy(rest.quaternion)
      bone.scale.copy(rest.scale)
    }
  }

  // Executa uma animação de forma limpa sem conflitos
  private _playAction(clipName: string, isLoop = false) {
    if (!this.mixer) return
    const action = this.actions[clipName] || this.actions['walk']
    if (!action) return

    if (this._currentActionName === clipName && action.isRunning()) {
      return
    }

    if (!isLoop) {
      if (this._currentAction) {
        this._currentAction.fadeOut(0.12)
      }
      action.reset()
      action.enabled = true
      action.setEffectiveWeight(1.0)
      action.fadeIn(0.12).play()
    } else {
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

  // ============================================================
  // LOOP PRINCIPAL DE ATUALIZAÇÃO
  // ============================================================
  public update(dt: number) {
    if (!this.model) return

    const safeDt = Math.min(dt, 0.05)
    this.stateTime += safeDt
    this.actionCooldown = Math.max(0, this.actionCooldown - safeDt)
    this.slamTimer = Math.max(0, this.slamTimer - safeDt)

    // 1. Atualização única do AnimationMixer
    if (this.mixer) {
      this.mixer.update(safeDt)
    }

    // Olhar dinâmico para a bola ou carro mais próximo com a cabeça/pescoço
    if (this._bones.neck || this._bones.head) {
      const bPos = this.getBallPosition()
      if (bPos && this.state !== 'BUTT_SLAM') {
        const lookTarget = bPos.clone()
        const bone = this._bones.head || this._bones.neck
        if (bone) {
          const boneWorld = new THREE.Vector3()
          bone.getWorldPosition(boneWorld)
          const dir = lookTarget.sub(boneWorld).normalize()
          if (dir.y < 0) {
            // Inclina para baixo suavemente
            bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, -0.35, safeDt * 4.0)
          }
        }
      }
    }

    // 2. Sincronização limpa das matrizes mundiais (sem rotações procedurais arbitrárias)
    this.model.updateWorldMatrix(true, true)

    // 3. Bola segurada
    if (this._heldBall) {
      this._keepBallInHand()
    }

    // 4. Máquina de Estados
    switch (this.state) {
      case 'PATROL':
        this._patrol(safeDt)
        break
      case 'CHASE_BALL':
      case 'SPRINT_BALL':
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

    // 5. Decisão de combate contínua durante locomoção
    if ((this.state === 'PATROL' || this.state === 'CHASE_BALL') && this.actionCooldown <= 0) {
      this._evaluateCombat()
    }

    // 6. Limites do campo (não sai da arena)
    this.rootGroup.position.x = Math.max(-107, Math.min(107, this.rootGroup.position.x))
    this.rootGroup.position.z = Math.max(-177, Math.min(177, this.rootGroup.position.z))

    // 7. Collider de corpo periódico (não empurra se estiver agarrando a bola)
    this._bodyColliderFrame = (this._bodyColliderFrame + 1) % 2
    if (this._bodyColliderFrame === 0 && this.state !== 'GRAB_BALL' && this.state !== 'HOLD_BALL') {
      const kongBox = new THREE.Box3().setFromObject(this.rootGroup)
      // Expande a caixa ligeiramente para colisão física em toda a massa muscular do Gorak
      kongBox.expandByScalar(0.8)

      // Colisão de impacto brutal contra qualquer carro que encostar no corpo
      const cars = this.getCars().filter(Boolean)
      for (const car of cars) {
        const cPos = this.getCarPosition(car)
        if (!cPos) continue
        if (kongBox.containsPoint(cPos) || kongBox.distanceToPoint(cPos) < 2.8) {
          const pushDir = cPos.clone().sub(this.rootGroup.position)
          pushDir.y = Math.max(pushDir.y, 0.45)
          pushDir.normalize()
          this.physics.applyImpulse?.(car, pushDir.clone().multiplyScalar(68))
          this.physics.applyAngularImpulse?.(car, new THREE.Vector3((Math.random() - 0.5) * 20, 25, (Math.random() - 0.5) * 20))
          this.effects.punch?.(cPos)
        }
      }

      const ballPos = this.getBallPosition()
      if (ballPos && !this.ball?.userData?.kongHeld) {
        const dist = kongBox.distanceToPoint(ballPos)
        if (dist < 3.2) {
          const pushDir = ballPos.clone().sub(this.rootGroup.position)
          pushDir.y = Math.max(pushDir.y, 0.25)
          pushDir.normalize().multiplyScalar(35)
          this.physics.applyImpulse?.(this.ball, pushDir)
        }
      }

      const obstacles = this.getObstacles?.() || []
      for (const obs of obstacles) {
        if (!obs || !obs.pos) continue
        const obsDist = kongBox.distanceToPoint(obs.pos)
        if (obsDist < 3.5) {
          const pushDir = obs.pos.clone().sub(this.rootGroup.position).normalize()
          pushDir.y = 0.40
          obs.vel.copy(pushDir.multiplyScalar(55))
          obs.rotVel.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 22)
          this.effects.hitObstacle?.(obs.pos)

          // Se o obstáculo lançado colidir com algum carro próximo, o carro capota!
          for (const car of cars) {
            const cPos = this.getCarPosition(car)
            if (cPos && obs.pos.distanceTo(cPos) < 4.2) {
              const carDeflect = cPos.clone().sub(obs.pos).normalize()
              carDeflect.y = 0.55
              this.physics.applyImpulse?.(car, carDeflect.multiplyScalar(45))
              this.physics.applyAngularImpulse?.(car, new THREE.Vector3(15, 20, 15))
              this.effects.punch?.(cPos)
            }
          }
        }
      }
    }
  }

  // ============================================================
  // LOCOMOÇÃO
  // ============================================================
  private _patrol(dt: number) {
    const ballPos = this.getBallPosition()
    if (ballPos) {
      this._start('CHASE_BALL')
      return
    }

    this._playAction('walk', true)
    this.rootGroup.position.x += this.walkDirection * this.walkSpeed * dt
    this.rootGroup.rotation.y = this.walkDirection > 0 ? Math.PI / 2 : -Math.PI / 2

    this._footstepTimer += dt
    if (this._footstepTimer >= 0.55) {
      this._footstepTimer = 0
      this.effects.step?.(this.rootGroup.position)
    }

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
    this._playAction('walk', true)

    const toBall = ballPos.clone().sub(this.rootGroup.position)
    toBall.y = 0
    const dist = toBall.length()

    // Se estiver em modo investida (sprint), corre a 2.2x da velocidade
    const currentSpeed = this.state === 'SPRINT_BALL' ? this.walkSpeed * 2.2 : this.walkSpeed

    // Aproxima-se da bola até 8.5 metros
    if (dist > 8.5) {
      toBall.normalize()
      this.rootGroup.position.addScaledVector(toBall, currentSpeed * dt)

      this._footstepTimer += dt
      const stepInterval = this.state === 'SPRINT_BALL' ? 0.32 : 0.55
      if (this._footstepTimer >= stepInterval) {
        this._footstepTimer = 0
        this.effects.step?.(this.rootGroup.position)
      }
    }
  }

  // ============================================================
  // AVALIAÇÃO DE COMBATE
  // ============================================================
  private _evaluateCombat() {
    if (this.actionCooldown > 0 || this.stateTime < 0.25) return

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
      if (d < 18.0) nearbyCarsCount++
      if (d < minCarDist) {
        minCarDist = d
        nearestCar = car
      }
    }

    // 1. BUTT SLAM: Somente se o slamTimer zerou (mínimo 8s) e múltiplos carros ou carro + bola próximos
    if (this.slamTimer <= 0 && (nearbyCarsCount >= 2 || (nearbyCarsCount >= 1 && ballDist < 16.0))) {
      this.slamTimer = 8.0 + Math.random() * 4.0
      return this._start('BUTT_SLAM')
    }

    // 2. AÇÕES PRINCIPAIS NA BOLA (Prioridade Máxima)
    if (ballPos && ballDist < 14.5) {
      this._smoothLookAt(ballPos, 1.0)

      // Se a bola estiver bem perto (< 11.5m), tenta agarrar ou chutar
      if (ballDist < 11.5) {
        if (Math.random() < 0.45) {
          return this._start('GRAB_BALL')
        }
        return this._start('KICK_BALL')
      }
      return this._start('PUNCH_BALL')
    }

    // 3. INVESTIDA RÁPIDA NA BOLA (Sprint se bola estiver solta entre 14.5m e 35m)
    if (ballPos && ballDist >= 14.5 && ballDist < 35.0) {
      if (this.state !== 'SPRINT_BALL') {
        return this._start('SPRINT_BALL')
      }
    }

    // 4. ATAQUE CONTRA CARROS QUE CHEGAREM PERTO (< 12m)
    if (nearestCar && minCarDist < 12.0) {
      const cPos = this.getCarPosition(nearestCar)
      if (cPos) this._smoothLookAt(cPos, 1.0)
      if (minCarDist < 7.5 && Math.random() < 0.5) {
        return this._start('KICK_BALL') // Chuta o carro
      }
      return this._start('PUNCH_CAR') // Esmaga com as mãos
    }

    // 5. Se a bola estiver distante
    if (ballPos && this.state !== 'CHASE_BALL' && this.state !== 'SPRINT_BALL') {
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
        this.effects.rage?.(1.0)
        break
      case 'SPRINT_BALL':
        this._playAction('walk', true)
        break
      case 'PUNCH_CAR':
      case 'PUNCH_BALL':
        this._punchSide = Math.random() < 0.5 ? 'punch_right' : 'punch_left'
        this._playAction(this._punchSide)
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
    this._restoreRestPose()
    this.actionCooldown = 1.0
    this._playAction('walk', true)
  }

  // ============================================================
  // ETAPA F: COLISÕES REAIS POR MARCADORES NATIVOS
  // ============================================================

  private _updatePunch(_dt: number) {
    const action = this.actions[this._punchSide]
    const duration = action?.getClip().duration || 0.95
    const progress = this.stateTime / duration

    // Janela de impacto: entre 35% e 75% da animação
    if (!this._hitDone && progress >= 0.35 && progress <= 0.75) {
      const marker = this._punchSide === 'punch_right' ? this._bones.hitboxRHand : this._bones.hitboxLHand
      const handPos = this._getBoneWorldPosition(marker)

      if (handPos) {
        // Colisão com carros (raio de 6.0m do marcador da mão)
        const cars = this.getCars().filter(Boolean)
        for (const car of cars) {
          const cPos = this.getCarPosition(car)
          if (!cPos) continue
          if (handPos.distanceTo(cPos) <= 6.0) {
            this._hitDone = true
            this._applyCarImpulse(car, 65.0)
            this.effects.punch?.(cPos)
            break
          }
        }

        // Colisão com bola
        if (!this._hitDone) {
          const bPos = this.getBallPosition()
          if (bPos && handPos.distanceTo(bPos) <= 5.8) {
            this._hitDone = true
            this._applyBallImpulse(75.0)
            this.effects.punch?.(bPos)
          }
        }

        // Colisão com obstáculos
        if (!this._hitDone) {
          const obstacles = this.getObstacles?.() || []
          for (const obs of obstacles) {
            if (!obs || !obs.pos) continue
            if (handPos.distanceTo(obs.pos) <= 6.0) {
              this._hitDone = true
              const dir = obs.pos.clone().sub(this.rootGroup.position).normalize()
              dir.y = 0.45
              obs.vel.copy(dir.multiplyScalar(65.0))
              obs.rotVel.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 16)
              this.effects.hitObstacle?.(obs.pos)
              break
            }
          }
        }
      }
    }

    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  private _updateKick(_dt: number) {
    const action = this.actions['kick_ball']
    const duration = action?.getClip().duration || 1.05
    const progress = this.stateTime / duration

    if (!this._hitDone && progress >= 0.35 && progress <= 0.75) {
      const footPos = this._getBoneWorldPosition(this._bones.hitboxRFoot) || this._getBoneWorldPosition(this._bones.hitboxLFoot)

      if (footPos) {
        const bPos = this.getBallPosition()
        if (bPos && footPos.distanceTo(bPos) <= 6.2) {
          this._hitDone = true
          this._applyBallImpulse(90.0)
          this.effects.kick?.(bPos)
        }

        if (!this._hitDone) {
          const obstacles = this.getObstacles?.() || []
          for (const obs of obstacles) {
            if (!obs || !obs.pos) continue
            if (footPos.distanceTo(obs.pos) <= 6.2) {
              this._hitDone = true
              const dir = obs.pos.clone().sub(this.rootGroup.position).normalize()
              dir.y = 0.52
              obs.vel.copy(dir.multiplyScalar(78.0))
              obs.rotVel.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 20)
              this.effects.hitObstacle?.(obs.pos)
              break
            }
          }
        }
      }
    }

    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  private _updateGrab(_dt: number) {
    const action = this.actions['grab_ball']
    const duration = action?.getClip().duration || 0.90
    const progress = this.stateTime / duration

    if (!this._hitDone && progress >= 0.30 && progress <= 0.75) {
      const grabPoint = this._getBoneWorldPosition(this._bones.ballHoldPoint) || this._getBoneWorldPosition(this._bones.hitboxRHand)
      const bPos = this.getBallPosition()

      if (grabPoint && bPos && grabPoint.distanceTo(bPos) <= 5.8) {
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
    const action = this.actions['throw_ball']
    const duration = action?.getClip().duration || 0.95

    if (!this._hitDone && this.stateTime >= 0.35) {
      this._hitDone = true
      this._releaseBallWithArc()
      this.effects.throw?.(this.getBallPosition() || undefined)
    }

    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  // ============================================================
  // ETAPA E: BUTT SLAM SEM DUPLICIDADE DE MOVIMENTO VERTICAL
  // ============================================================
  private _updateSlam(_dt: number) {
    const duration = this._slamDuration
    const progress = this.stateTime / duration

    // O Root bone na animação MoCap já realiza todo o salto vertical e queda.
    // Mantemos rootGroup.position.y fixo no solo (Y = 0) para eliminar o efeito elevador duplo!
    this.rootGroup.position.y = this._slamBaseY

    // Momento visual do impacto da pelve no solo: entre 60% e 70% do clip
    if (!this._slamLanded && progress >= 0.62) {
      this._slamLanded = true
      const impactPos =
        this._getBoneWorldPosition(this._bones.hitboxPelvis) ||
        this._getBoneWorldPosition(this._bones.pelvis) ||
        this.rootGroup.position

      this._radialImpulse(impactPos)
      this.effects.slam?.(impactPos)
    }

    // A transição para locomoção só acontece após a recuperação completa do clip (evita corte e snap)
    if (this.stateTime >= duration) {
      this._finish('CHASE_BALL')
    }
  }

  // ============================================================
  // BOLA ANEXADA E ARREMESSADA
  // ============================================================
  private _attachBallToHand() {
    const anchor = this._bones.ballHoldPoint || this._bones.hitboxRHand || this._bones.rightHand
    if (!this.ball || !anchor || this._heldBall) return

    anchor.updateWorldMatrix(true, false)
    const ballObj = this.ball.mesh || this.ball
    anchor.attach(ballObj)
    ballObj.position.set(0, 0, 0)

    this.ball.userData = this.ball.userData || {}
    this.ball.userData.kongHeld = true
    if (this.ball.mesh) this.ball.mesh.userData.kongHeld = true

    this._heldBall = this.ball
    this.physics.setKinematic?.(this.ball, true)
    this.physics.setSensor?.(this.ball, true)
  }

  private _keepBallInHand() {
    const anchor = this._bones.ballHoldPoint || this._bones.hitboxRHand || this._bones.rightHand
    if (!this._heldBall || !anchor) return

    const ballObj = this._heldBall.mesh || this._heldBall
    ballObj.position.set(0, 0, 0)
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

    // Lança a bola com força em arco
    const direction = new THREE.Vector3()
    this.rootGroup.getWorldDirection(direction)
    direction.y = 0.45
    direction.normalize()
    this.physics.applyImpulse?.(ball, direction.multiplyScalar(85.0))
    this._heldBall = null
  }

  // ============================================================
  // IMPULSOS FÍSICOS NATIVOS
  // ============================================================
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

  private _radialImpulse(center: THREE.Vector3) {
    const objects = [this.ball, ...this.getCars()].filter(Boolean)
    for (const object of objects) {
      const objPos = object === this.ball ? this.getBallPosition() : this.getCarPosition(object)
      if (!objPos) continue
      const direction = objPos.clone().sub(center)
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

    const obstacles = this.getObstacles?.() || []
    for (const obs of obstacles) {
      if (!obs || !obs.pos) continue
      const direction = obs.pos.clone().sub(center)
      const distance = Math.max(0.1, direction.length())
      if (distance < this.impactRadius) {
        const force = 55 * (1 - distance / this.impactRadius)
        direction.normalize()
        direction.y = 0.70
        obs.vel.addScaledVector(direction, force)
        obs.rotVel.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 22)
      }
    }

    this.camera?.shake?.(0.75, 1.0)
  }

  // ============================================================
  // DISPOSE LIMPO
  // ============================================================
  public dispose() {
    if (this._heldBall) {
      try {
        this._releaseBallWithArc()
      } catch {}
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
