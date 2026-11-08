// ============================================================
//  arenaKongController.ts — Controlador IA e Animações do Gorila Neutro
//  "Kong Gorak" na Arena Kong
//  - Clipes oficiais: idle, standing_relax, walk (AnimationMixer)
//  - Ações procedurais: PATROL, CHASE_BALL, KICK_BALL, PUNCH_CAR,
//    GRAB_BALL, THROW_BALL, BUTT_SLAM, RAGE
//  - Impulsos físicos nos carros e na bola, efeitos sonoros e partículas
// ============================================================
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type KongState =
  | 'PATROL'
  | 'CHASE_BALL'
  | 'KICK_BALL'
  | 'PUNCH_CAR'
  | 'GRAB_BALL'
  | 'THROW_BALL'
  | 'BUTT_SLAM'
  | 'RAGE'

export interface KongPhysicsAdapter {
  applyImpulse: (target: any, impulse: THREE.Vector3) => void
}

export interface KongCameraAdapter {
  shake?: (duration: number, intensity: number) => void
}

export class KongGorak {
  public rootGroup = new THREE.Group()
  public model: THREE.Object3D | null = null
  public mixer: THREE.AnimationMixer | null = null
  public clips: Record<string, THREE.AnimationClip> = {}
  public currentAction: THREE.AnimationAction | null = null

  public state: KongState = 'PATROL'
  public stateTime = 0
  public actionCooldown = 0
  public walkDirectionX = 1
  public walkDirectionZ = 1
  public baseSpeed = 16.0
  public speed = 16.0
  public rage = 0
  public isRaging = false

  public attackRadius = 12.0
  public impactRadius = 32.0

  private bones: Record<string, THREE.Bone | null> = {}
  private eyeMaterials: THREE.MeshStandardMaterial[] = []
  private hitRegistered = false
  private slamJumpY = 0

  private ball: any = null
  private getCars: () => any[]
  private physics: KongPhysicsAdapter
  private camera: KongCameraAdapter
  private emitParticles?: (pos: THREE.Vector3, type: 'dust' | 'stars' | 'shockwave') => void
  private playSFX?: (type: 'roar' | 'slam' | 'punch' | 'kick') => void

  private patrolBounds = { minX: -65, maxX: 65, minZ: -85, maxZ: 85 }

  constructor({
    ball,
    getCars,
    physics,
    camera,
    emitParticles,
    playSFX,
  }: {
    ball: any
    getCars: () => any[]
    physics: KongPhysicsAdapter
    camera: KongCameraAdapter
    emitParticles?: (pos: THREE.Vector3, type: 'dust' | 'stars' | 'shockwave') => void
    playSFX?: (type: 'roar' | 'slam' | 'punch' | 'kick') => void
  }) {
    this.ball = ball
    this.getCars = getCars
    this.physics = physics
    this.camera = camera
    this.emitParticles = emitParticles
    this.playSFX = playSFX
    this.rootGroup.name = 'KongGorakEntity'
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader()
    try {
      const gltf = await loader.loadAsync('/assets/arena-kong/arena-kong-gorak-animated.glb')
      this.model = gltf.scene
      this.model.name = 'KongGorakModel'

      // Normaliza a escala para um gorila gigante imponente (~15m de altura)
      const bbox = new THREE.Box3().setFromObject(this.model)
      const size = bbox.getSize(new THREE.Vector3())
      const targetHeight = 15.0
      if (size.y > 0.1) {
        const scale = targetHeight / size.y
        this.model.scale.setScalar(scale)
      }

      this.model.position.set(0, 0, 0)

      // Configura sombras, materiais cel-shaded e captura olhos para efeito RAGE
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
                this.eyeMaterials.push(m)
              }
            })
          }
        }
      })

      // Mapeia os ossos do esqueleto bípede
      this.bones = this._findBones(this.model)

      // Configura animações oficiais
      this.mixer = new THREE.AnimationMixer(this.model)
      gltf.animations.forEach((clip) => {
        this.clips[clip.name.toLowerCase()] = clip
      })

      this.playAnimation('walk', 0.2)
      this.rootGroup.add(this.model)
    } catch (err) {
      console.error('[KongGorak] Erro ao carregar modelo 3D animado:', err)
      this._createProceduralFallback()
    }
  }

  private _createProceduralFallback() {
    // Fallback volumétrico caso o arquivo falhe em carregar na rede
    const fallbackGroup = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.9 })
    const chest = new THREE.Mesh(new THREE.BoxGeometry(6, 8, 5), bodyMat)
    chest.position.y = 8
    fallbackGroup.add(chest)
    const head = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.5, 3.5), bodyMat)
    head.position.set(0, 13.5, 1)
    fallbackGroup.add(head)
    this.model = fallbackGroup
    this.rootGroup.add(fallbackGroup)
  }

  private _findBones(root: THREE.Object3D): Record<string, THREE.Bone | null> {
    const allBones: THREE.Bone[] = []
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) allBones.push(o as THREE.Bone)
    })
    const pick = (...words: string[]): THREE.Bone | null =>
      allBones.find((b) => words.some((w) => b.name.toLowerCase().includes(w))) || null

    return {
      hips: pick('hips', 'pelvis', 'root'),
      spine: pick('spine', 'chest', 'torso'),
      head: pick('head', 'neck'),
      jaw: pick('jaw', 'mouth'),
      leftUpperArm: pick('leftarm', 'lupperarm', 'upperarm_l', 'arm_l'),
      rightUpperArm: pick('rightarm', 'rupperarm', 'upperarm_r', 'arm_r'),
      leftForearm: pick('leftforearm', 'lforearm', 'forearm_l'),
      rightForearm: pick('rightforearm', 'rforearm', 'forearm_r'),
      leftHand: pick('lefthand', 'lhand', 'hand_l'),
      rightHand: pick('righthand', 'rhand', 'hand_r'),
      leftThigh: pick('leftthigh', 'lthigh', 'thigh_l'),
      rightThigh: pick('rightthigh', 'rthigh', 'thigh_r'),
      leftShin: pick('leftshin', 'lshin', 'calf_l'),
      rightShin: pick('rightshin', 'rshin', 'calf_r'),
    }
  }

  playAnimation(name: string, crossfade = 0.3) {
    if (!this.mixer) return
    const key = name.toLowerCase()
    const clip = this.clips[key] || this.clips['walk'] || this.clips['idle']
    if (!clip) return

    const newAction = this.mixer.clipAction(clip)
    if (this.currentAction && this.currentAction !== newAction) {
      this.currentAction.fadeOut(crossfade)
    }
    newAction.reset().fadeIn(crossfade).play()
    this.currentAction = newAction
  }

  update(dt: number) {
    if (!this.model) return

    this.stateTime += dt
    this.actionCooldown = Math.max(0, this.actionCooldown - dt)
    this.speed = this.baseSpeed * (this.isRaging ? 1.4 : 1.0)

    // Atualiza mixer das animações de base
    if (this.mixer) {
      this.mixer.update(dt)
    }

    // Executa a máquina de estados (HFSM)
    switch (this.state) {
      case 'PATROL':
        this._patrol(dt)
        break
      case 'CHASE_BALL':
        this._chaseBall(dt)
        break
      case 'KICK_BALL':
        this._animateKick(dt)
        break
      case 'PUNCH_CAR':
        this._animatePunch(dt)
        break
      case 'GRAB_BALL':
        this._animateGrab(dt)
        break
      case 'THROW_BALL':
        this._animateThrow(dt)
        break
      case 'BUTT_SLAM':
        this._animateButtSlam(dt)
        break
      case 'RAGE':
        this._animateRage(dt)
        break
    }

    this._chooseAction()
    this._enforceFieldBounds()
  }

  private _chooseAction() {
    if (this.actionCooldown > 0 || this.stateTime < 0.9) return

    const ballPos = this.ball?.pos || this.ball?.position
    const kongPos = this.model!.position

    const ballDist = ballPos ? kongPos.distanceTo(ballPos) : 999
    const nearestCar = this._getNearestCar()
    const carDist = nearestCar ? kongPos.distanceTo(nearestCar.pos || nearestCar.position) : 999

    // Se a bola estiver prestes a entrar em qualquer um dos dois gols, Kong corre para bloquear!
    if (ballPos && Math.abs(ballPos.z) > 120 && ballDist < 75) {
      return this._startState('CHASE_BALL')
    }

    // Golpe nos carros próximos
    if (carDist < this.attackRadius && Math.random() < 0.35) {
      return this._startState('PUNCH_CAR')
    }

    // Ações na bola
    if (ballDist < this.attackRadius) {
      const r = Math.random()
      if (r < 0.45) return this._startState('KICK_BALL')
      if (r < 0.70) return this._startState('GRAB_BALL')
      if (r < 0.85) return this._startState('BUTT_SLAM')
    }

    // Salto e terremoto se estiver cercado
    if (carDist < 18 && Math.random() < 0.20) {
      return this._startState('BUTT_SLAM')
    }

    // Modo de fúria espontâneo
    if (!this.isRaging && Math.random() < 0.05) {
      return this._startState('RAGE')
    }
  }

  private _startState(next: KongState) {
    this.state = next
    this.stateTime = 0
    this.actionCooldown = 1.6
    this.hitRegistered = false

    if (next === 'PATROL' || next === 'CHASE_BALL') {
      this.playAnimation('walk', 0.25)
    } else if (next === 'RAGE') {
      this.playAnimation('standing_relax', 0.2)
    } else {
      this.playAnimation('idle', 0.2)
    }
  }

  private _patrol(dt: number) {
    const pos = this.model!.position
    pos.x += this.walkDirectionX * this.speed * dt
    pos.z += this.walkDirectionZ * (this.speed * 0.45) * dt

    if (pos.x > this.patrolBounds.maxX) this.walkDirectionX = -1
    if (pos.x < this.patrolBounds.minX) this.walkDirectionX = 1
    if (pos.z > this.patrolBounds.maxZ) this.walkDirectionZ = -1
    if (pos.z < this.patrolBounds.minZ) this.walkDirectionZ = 1

    // Rotação suave olhando na direção do passo
    const lookAngle = Math.atan2(this.walkDirectionX, this.walkDirectionZ)
    this.model!.rotation.y = THREE.MathUtils.lerp(this.model!.rotation.y, lookAngle, dt * 4)

    // Se a bola estiver dentro do raio de atenção (80m), muda para perseguição
    const ballPos = this.ball?.pos || this.ball?.position
    if (ballPos && pos.distanceTo(ballPos) < 80) {
      this.state = 'CHASE_BALL'
      this.stateTime = 0
    }
  }

  private _chaseBall(dt: number) {
    const ballPos = this.ball?.pos || this.ball?.position
    if (!ballPos) return this._startState('PATROL')

    const pos = this.model!.position
    const dir = new THREE.Vector3().subVectors(ballPos, pos)
    dir.y = 0
    const dist = dir.length()

    if (dist > this.attackRadius * 0.8) {
      dir.normalize()
      pos.addScaledVector(dir, this.speed * 1.25 * dt)
      const targetAngle = Math.atan2(dir.x, dir.z)
      this.model!.rotation.y = THREE.MathUtils.lerp(this.model!.rotation.y, targetAngle, dt * 5)
    } else {
      this._chooseAction()
    }

    if (dist > 110) {
      this._startState('PATROL')
    }
  }

  private _animateKick(dt: number) {
    const t = Math.min(1, this.stateTime / 0.8)
    const k = Math.sin(Math.PI * t)

    if (this.bones.rightThigh) this.bones.rightThigh.rotation.x = -1.2 * k
    if (this.bones.rightShin) this.bones.rightShin.rotation.x = 1.4 * k
    if (this.bones.spine) this.bones.spine.rotation.x = 0.25 * k

    if (this.stateTime > 0.38 && !this.hitRegistered) {
      this.hitRegistered = true
      this._impactBall(50.0)
      this.playSFX?.('kick')
      this.emitParticles?.(this.model!.position.clone().add(new THREE.Vector3(0, 2, 6)), 'stars')
    }

    if (this.stateTime > 0.85) {
      this._resetBones()
      this._startState('PATROL')
    }
  }

  private _animatePunch(dt: number) {
    const t = Math.min(1, this.stateTime / 0.75)
    const k = Math.sin(Math.PI * t)

    if (this.bones.rightUpperArm) {
      this.bones.rightUpperArm.rotation.x = -1.1 * k
      this.bones.rightUpperArm.rotation.z = -0.5 * k
    }
    if (this.bones.rightForearm) this.bones.rightForearm.rotation.x = -0.8 * k

    if (this.stateTime > 0.32 && !this.hitRegistered) {
      this.hitRegistered = true
      this._impactCar(35.0)
      this.playSFX?.('punch')
      this.emitParticles?.(this.model!.position.clone().add(new THREE.Vector3(0, 4, 5)), 'stars')
    }

    if (this.stateTime > 0.8) {
      this._resetBones()
      this._startState('PATROL')
    }
  }

  private _animateGrab(dt: number) {
    const t = Math.min(1, this.stateTime / 0.85)
    const k = Math.sin(Math.PI * t)

    if (this.bones.leftUpperArm) this.bones.leftUpperArm.rotation.x = -0.8 * k
    if (this.bones.rightUpperArm) this.bones.rightUpperArm.rotation.x = -0.8 * k

    // Segura a bola na mão por 0.8s
    if (this.ball) {
      const handPos = this.model!.position.clone().add(new THREE.Vector3(0, 6, 4))
      if (this.ball.pos) this.ball.pos.lerp(handPos, 0.4)
      if (this.ball.vel) this.ball.vel.set(0, 0, 0)
    }

    if (this.stateTime > 0.85) {
      this._resetBones()
      this._startState('THROW_BALL')
    }
  }

  private _animateThrow(dt: number) {
    const t = Math.min(1, this.stateTime / 0.7)
    const k = Math.sin(Math.PI * t)

    if (this.bones.rightUpperArm) {
      this.bones.rightUpperArm.rotation.x = -1.4 * k
      this.bones.rightUpperArm.rotation.z = 0.5 * k
    }

    if (this.stateTime > 0.3 && !this.hitRegistered) {
      this.hitRegistered = true
      // Lança a bola para o campo adversário com arco alto
      const forward = new THREE.Vector3(0, 0.45, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.model!.rotation.y).normalize()
      if (this.ball && this.physics) {
        this.physics.applyImpulse(this.ball, forward.multiplyScalar(44))
      }
      this.playSFX?.('kick')
    }

    if (this.stateTime > 0.75) {
      this._resetBones()
      this._startState('PATROL')
    }
  }

  private _animateButtSlam(dt: number) {
    const t = Math.min(1, this.stateTime / 1.4)

    // Fase 1: Pulo no ar até Y = 16m
    if (t < 0.55) {
      const jumpNorm = t / 0.55
      this.slamJumpY = Math.sin(jumpNorm * Math.PI) * 16.0
      this.model!.position.y = this.slamJumpY
      if (this.bones.spine) this.bones.spine.rotation.x = -0.3
      if (this.bones.leftUpperArm) this.bones.leftUpperArm.rotation.z = 0.8
      if (this.bones.rightUpperArm) this.bones.rightUpperArm.rotation.z = -0.8
    } else {
      // Fase 2: Queda de bunda no solo e impacto radial
      this.model!.position.y = 0
      if (!this.hitRegistered) {
        this.hitRegistered = true
        this._radialImpulse(32.0)
        this.playSFX?.('slam')
        this.camera.shake?.(0.65, 0.4)
        this.emitParticles?.(this.model!.position, 'shockwave')
      }
      if (this.bones.spine) this.bones.spine.rotation.x = 0.6
    }

    if (this.stateTime > 1.45) {
      this.model!.position.y = 0
      this._resetBones()
      this._startState('PATROL')
    }
  }

  private _animateRage(dt: number) {
    this.isRaging = true
    const t = Math.min(1, this.stateTime / 1.6)
    const k = Math.sin(Math.PI * t)

    // Rugido e peito estufado
    if (this.bones.spine) this.bones.spine.rotation.x = -0.2 * k
    if (this.bones.jaw) this.bones.jaw.rotation.x = 0.65 * k
    if (this.bones.leftUpperArm) this.bones.leftUpperArm.rotation.x = -0.7 * k
    if (this.bones.rightUpperArm) this.bones.rightUpperArm.rotation.x = -0.7 * k

    // Olhos cianos incandescentes
    this.eyeMaterials.forEach((m) => {
      m.emissive = new THREE.Color(0x00f0ff)
      m.emissiveIntensity = 2.0 * k
    })

    if (this.stateTime > 0.4 && !this.hitRegistered) {
      this.hitRegistered = true
      this.playSFX?.('roar')
      this.camera.shake?.(0.45, 0.25)
    }

    if (this.stateTime > 1.8) {
      this.eyeMaterials.forEach((m) => {
        m.emissiveIntensity = 0.4
      })
      this._resetBones()
      this._startState('CHASE_BALL')
    }
  }

  private _impactBall(force: number) {
    if (!this.ball || !this.physics) return
    const ballPos = this.ball.pos || this.ball.position
    const d = new THREE.Vector3().subVectors(ballPos, this.model!.position).normalize()
    d.y = 0.35
    d.normalize()
    this.physics.applyImpulse(this.ball, d.multiplyScalar(force))
  }

  private _impactCar(force: number) {
    const car = this._getNearestCar()
    if (!car || !this.physics) return
    const carPos = car.pos || car.position
    const d = new THREE.Vector3().subVectors(carPos, this.model!.position).normalize()
    d.y = 0.25
    d.normalize()
    this.physics.applyImpulse(car, d.multiplyScalar(force))
    if (typeof car.applySpinOut === 'function') {
      car.applySpinOut(1.6)
    }
  }

  private _radialImpulse(radius: number) {
    if (!this.physics) return
    const objects = [this.ball, ...this.getCars()].filter(Boolean)
    const kongPos = this.model!.position

    for (const obj of objects) {
      const objPos = obj.pos || obj.position
      if (!objPos) continue
      const diff = new THREE.Vector3().subVectors(objPos, kongPos)
      const dist = Math.max(0.1, diff.length())
      if (dist < radius) {
        const falloff = 1.0 - dist / radius
        const impulse = diff.normalize()
        impulse.y = 0.45
        impulse.normalize().multiplyScalar(36.0 * falloff)
        this.physics.applyImpulse(obj, impulse)
        if (typeof obj.applySpinOut === 'function') {
          obj.applySpinOut(1.4 * falloff)
        }
      }
    }
  }

  private _getNearestCar() {
    const cars = this.getCars().filter(Boolean)
    if (cars.length === 0) return null
    const kongPos = this.model!.position
    return cars.sort((a, b) => {
      const pa = a.pos || a.position
      const pb = b.pos || b.position
      return kongPos.distanceTo(pa) - kongPos.distanceTo(pb)
    })[0]
  }

  private _resetBones() {
    Object.values(this.bones).forEach((b) => {
      if (b) {
        b.rotation.set(0, 0, 0)
      }
    })
  }

  private _enforceFieldBounds() {
    const p = this.model!.position
    const maxBoundX = 100
    const maxBoundZ = 170

    if (p.x > maxBoundX) { p.x = maxBoundX; this.walkDirectionX = -1; }
    if (p.x < -maxBoundX) { p.x = -maxBoundX; this.walkDirectionX = 1; }
    if (p.z > maxBoundZ) { p.z = maxBoundZ; this.walkDirectionZ = -1; }
    if (p.z < -maxBoundZ) { p.z = -maxBoundZ; this.walkDirectionZ = 1; }
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction()
      this.mixer = null
    }
    this.rootGroup.clear()
    this.model = null
  }
}

