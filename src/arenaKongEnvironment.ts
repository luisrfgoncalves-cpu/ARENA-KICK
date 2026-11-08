// ============================================================
//  arenaKongEnvironment.ts — Cenário Floresta Tropical & Ruínas
//  Kit do estádio, vegetação selvagem, penhascos e backdrop 360°
//  Proporções oficiais do Arena Kick (220 x 360, teto 58)
// ============================================================
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const BASE = '/assets/arena-kong/environment/'
export const ARENA_KONG_FIELD_W = 220
export const ARENA_KONG_FIELD_L = 360
export const ARENA_KONG_PLAYABLE_X = ARENA_KONG_FIELD_W / 2 - 2.8 // 107.2
export const ARENA_KONG_PLAYABLE_Z = ARENA_KONG_FIELD_L / 2 - 2.8 // 177.2

export interface ArenaKongEnvironmentResult {
  staticLayer: THREE.Group
  backdrop: THREE.Mesh | null
  dispose: () => void
}

export async function loadArenaKongEnvironment(
  scene: THREE.Scene,
  { mode = 'day' }: { mode?: 'day' | 'night' } = {}
): Promise<ArenaKongEnvironmentResult> {
  const loader = new GLTFLoader()
  const staticLayer = new THREE.Group()
  staticLayer.name = 'ArenaKongStaticEnvironment'
  staticLayer.userData.physics = 'none'
  scene.add(staticLayer)

  const loadGLB = async (
    file: string,
    name: string,
    position: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1]
  ): Promise<THREE.Object3D | null> => {
    try {
      const gltf = await loader.loadAsync(BASE + file)
      const object = gltf.scene
      object.name = name
      object.position.set(...position)
      object.scale.set(...scale)
      object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.userData.physics = 'none'
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            mats.forEach((m: any) => {
              if (m.map) m.map.colorSpace = THREE.SRGBColorSpace
            })
          }
        }
      })
      staticLayer.add(object)
      return object
    } catch (err) {
      console.warn(`[ArenaKong] Aviso: não foi possível carregar ${file}:`, err)
      return null
    }
  }

  // Carrega kits modulares do cenário fora da área jogável
  await Promise.allSettled([
    loadGLB('arena-kong-stadium-kit.glb', 'ArenaKongStadiumKit'),
    loadGLB('arena-kong-jungle-kit.glb', 'ArenaKongJungleKit'),
    loadGLB('arena-kong-cliffs-ruins.glb', 'ArenaKongCliffsRuins', [0, 0, -215], [1.2, 1.2, 1.2]),
  ])

  // Backdrop esférico 360° com floresta tropical e penhascos
  let backdropMesh: THREE.Mesh | null = null
  try {
    const backdropFile = mode === 'night' ? 'arena-kong-backdrop-night.webp' : 'arena-kong-backdrop-day.webp'
    const texture = await new THREE.TextureLoader().loadAsync(BASE + backdropFile)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.repeat.set(3, 1)

    backdropMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false })
    )
    backdropMesh.name = 'ArenaKongBackdrop'
    backdropMesh.scale.set(320, 320, 200)
    backdropMesh.position.set(0, 50, 0)
    backdropMesh.renderOrder = -10
    scene.add(backdropMesh)
  } catch (err) {
    console.warn('[ArenaKong] Backdrop fallback:', err)
  }

  const dispose = () => {
    scene.remove(staticLayer)
    staticLayer.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach((m) => m?.dispose())
      }
    })
    if (backdropMesh) {
      scene.remove(backdropMesh)
      backdropMesh.geometry.dispose()
      ;(backdropMesh.material as THREE.Material)?.dispose()
      backdropMesh = null
    }
  }

  return { staticLayer, backdrop: backdropMesh, dispose }
}

export function isInsideArenaKongPlayableArea(position: THREE.Vector3): boolean {
  return Math.abs(position.x) <= ARENA_KONG_PLAYABLE_X && Math.abs(position.z) <= ARENA_KONG_PLAYABLE_Z
}

