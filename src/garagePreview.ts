// ============================================================
//  garagePreview.ts — Prévia 3D ao vivo do veículo na garagem
//  Turntable leve com plataforma neon; carregado só ao abrir a garagem.
// ============================================================
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CAR_MODELS } from './carModels'

export class GaragePreview {
  private host: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private pivot = new THREE.Group()
  private raf = 0
  private ro: ResizeObserver | null = null
  private loader = new GLTFLoader()
  private loadToken = 0
  private carRoot: THREE.Object3D | null = null
  private clock = new THREE.Clock()
  private disposed = false

  constructor(host: HTMLElement) {
    this.host = host

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x000000, 0)
    const canvas = this.renderer.domElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    host.appendChild(canvas)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    this.camera.position.set(7.5, 4.6, 9.5)
    this.camera.lookAt(0, 1.1, 0)

    const hemi = new THREE.HemisphereLight(0x9fe6ff, 0x0b1220, 1.15)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(6, 10, 7)
    this.scene.add(key)

    const rim = new THREE.PointLight(0x00cfff, 60, 30, 2)
    rim.position.set(-6, 4, -6)
    this.scene.add(rim)

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.6, 0.35, 48),
      new THREE.MeshStandardMaterial({ color: 0x0b1220, metalness: 0.3, roughness: 0.6 })
    )
    platform.position.y = -0.18
    this.scene.add(platform)

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5.3, 0.08, 12, 64),
      new THREE.MeshStandardMaterial({ color: 0x00cfff, emissive: 0x00cfff, emissiveIntensity: 1.4 })
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.02
    this.scene.add(ring)

    this.scene.add(this.pivot)

    this.resize()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.animate()
  }

  private resize() {
    const w = this.host.clientWidth || 640
    const h = this.host.clientHeight || 230
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  setCar(carId: string) {
    const entry = CAR_MODELS[carId]
    const token = ++this.loadToken
    const file = (entry && entry.file) ? entry.file : '/models/vehicle-truck-red.glb'

    this.loader.load(
      file,
      (gltf) => {
        if (this.disposed || token !== this.loadToken) return
        this.mount(gltf.scene)
      },
      undefined,
      () => {
        if (this.disposed || token !== this.loadToken) return
        // Fallback para modelo 3D Kenney padrão em caso de erro de rede
        this.loader.load('/models/vehicle-truck-red.glb', (fallbackGltf) => {
          if (this.disposed || token !== this.loadToken) return
          this.mount(fallbackGltf.scene)
        })
      }
    )
  }

  private clearCar() {
    if (!this.carRoot) return
    this.pivot.remove(this.carRoot)
    this.carRoot.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      }
    })
    this.carRoot = null
  }

  private mount(model: THREE.Object3D) {
    this.clearCar()

    model.updateMatrixWorld(true)
    let bbox = new THREE.Box3().setFromObject(model)
    const size = bbox.getSize(new THREE.Vector3())

    if (size.x > size.z) model.rotation.y = -Math.PI / 2

    const longLen = Math.max(size.x, size.z)
    if (longLen > 0.0001) model.scale.setScalar(5.2 / longLen)

    model.updateMatrixWorld(true)
    bbox = new THREE.Box3().setFromObject(model)
    const center = bbox.getCenter(new THREE.Vector3())
    model.position.x -= center.x
    model.position.z -= center.z
    model.position.y -= bbox.min.y

    model.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const origMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as any
      if (origMat) {
        const origColor = origMat.color ? origMat.color.clone() : new THREE.Color(0xff4500)
        const origMap = origMat.map || null
        mesh.material = new THREE.MeshToonMaterial({
          color: origColor,
          map: origMap
        })
      }
    })

    this.carRoot = model
    this.pivot.add(model)
  }

  private showProcedural() {
    this.clearCar()

    const g = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2f6bff, metalness: 0.25, roughness: 0.45 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.3, roughness: 0.6 })
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x9fe6ff,
      metalness: 0.1,
      roughness: 0.1,
      transparent: true,
      opacity: 0.75
    })
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.8 })

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.75, 4.7), bodyMat)
    body.position.y = 0.75
    g.add(body)

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 2.1), glassMat)
    cabin.position.set(0, 1.35, -0.15)
    g.add(cabin)

    const nose = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.4, 1.2), bodyMat)
    nose.position.set(0, 0.6, 2.2)
    g.add(nose)

    const spoilerBar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.5), accentMat)
    spoilerBar.position.set(0, 1.35, -2.1)
    g.add(spoilerBar)

    const stalkGeo = new THREE.BoxGeometry(0.12, 0.45, 0.12)
    for (const sx of [-0.9, 0.9]) {
      const stalk = new THREE.Mesh(stalkGeo, darkMat)
      stalk.position.set(sx, 1.12, -2.1)
      g.add(stalk)
    }

    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.42, 20)
    for (const [x, z] of [[-1.25, 1.5], [1.25, 1.5], [-1.25, -1.5], [1.25, -1.5]]) {
      const wheel = new THREE.Mesh(wheelGeo, darkMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.55, z)
      g.add(wheel)
    }

    this.carRoot = g
    this.pivot.add(g)
  }

  private animate = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.animate)
    const dt = Math.min(0.05, this.clock.getDelta())
    this.pivot.rotation.y += dt * 0.5
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    this.ro = null
    this.clearCar()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement)
    }
  }
}
