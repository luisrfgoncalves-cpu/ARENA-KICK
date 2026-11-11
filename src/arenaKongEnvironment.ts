// ============================================================
//  arenaKongEnvironment.ts — Cenário Floresta Tropical & Ruínas
//  Kit do estádio, vegetação selvagem, penhascos e backdrop 360°
//  Proporções oficiais do Arena Kick (220 x 360, teto 58)
//  Versão Otimizada: Zero lag / 60 FPS garantidos
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

/** Cria e anexa imediatamente o backdrop cilíndrico 360° tropical à cena (sem delay) */
export function createArenaKongInstantBackdrop(
  scene: THREE.Scene,
  mode: 'day' | 'night' = 'day'
): THREE.Mesh {
  // Evita duplicar se já existir
  const existing = scene.getObjectByName('ArenaKongBackdrop')
  if (existing) return existing as THREE.Mesh

  const backdropFile = mode === 'night' ? 'arena-kong-backdrop-night.webp' : 'arena-kong-backdrop-day.webp'
  const texLoader = new THREE.TextureLoader()
  const texture = texLoader.load(BASE + backdropFile)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.repeat.set(3, 1)

  const backdropMat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    depthWrite: false
  })

  const backdropMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(300, 300, 180, 48, 1, true),
    backdropMat
  )
  backdropMesh.name = 'ArenaKongBackdrop'
  backdropMesh.position.set(0, 60, 0)
  backdropMesh.renderOrder = -10
  scene.add(backdropMesh)
  return backdropMesh
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
          // PERFORMANCE: Elementos estáticos do cenário NÃO projetam sombras dinâmicas!
          // Isso elimina os engasgos da GPU e mantém 60 FPS estáveis.
          mesh.castShadow = false
          mesh.receiveShadow = false
          mesh.userData.physics = 'none'
          mesh.matrixAutoUpdate = false
          mesh.updateMatrix()
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

  // Carrega kits modulares 3D reais do cenário fora da área jogável com escala monumental
  await Promise.allSettled([
    // Ruínas e penhascos colossais ao fundo ao norte e sul
    loadGLB('arena-kong-cliffs-ruins.glb', 'ArenaKongCliffsNorth', [0, 25, -235], [240, 140, 240]),
    loadGLB('arena-kong-cliffs-ruins.glb', 'ArenaKongCliffsSouth', [0, 25,  235], [240, 140, 240]),
    // Floresta tropical e selva dos titãs margeando as laterais
    loadGLB('arena-kong-jungle-kit.glb', 'ArenaKongJungleWest', [-160, 20, 0], [180, 110, 320]),
    loadGLB('arena-kong-jungle-kit.glb', 'ArenaKongJungleEast', [ 160, 20, 0], [180, 110, 320]),
    // Arquitetura e muralhas de pedra do coliseu dos titãs
    loadGLB('arena-kong-stadium-kit.glb', 'ArenaKongStadiumWalls', [0, 16, 0], [260, 80, 400])
  ])

  // Garante que o backdrop esteja presente sem duplicar
  const backdrop = createArenaKongInstantBackdrop(scene, mode)

  const dispose = () => {
    scene.remove(staticLayer)
    staticLayer.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach((m) => m?.dispose?.())
      }
    })

    if (backdrop && backdrop.parent === scene) {
      scene.remove(backdrop)
      backdrop.geometry?.dispose()
      if (backdrop.material) {
        const mat = backdrop.material as THREE.MeshBasicMaterial
        mat.map?.dispose()
        mat.dispose()
      }
    }
  }

  return {
    staticLayer,
    backdrop,
    dispose
  }
}

export function isInsideArenaKongPlayableArea(position: THREE.Vector3): boolean {
  return Math.abs(position.x) <= ARENA_KONG_PLAYABLE_X && Math.abs(position.z) <= ARENA_KONG_PLAYABLE_Z
}
