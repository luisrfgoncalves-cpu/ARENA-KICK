import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = '/assets/arena-kong/environment/';
const FIELD_W = 220;
const FIELD_L = 360;
const PLAYABLE_X = FIELD_W / 2 - 2.8;
const PLAYABLE_Z = FIELD_L / 2 - 2.8;

export async function loadArenaKongEnvironment(scene, { mode = 'day' } = {}) {
  const loader = new GLTFLoader();
  const staticLayer = new THREE.Group();
  staticLayer.name = 'ArenaKongStaticEnvironment';
  staticLayer.userData.physics = 'none';
  scene.add(staticLayer);

  const loadGLB = async (file, name, position = [0, 0, 0], scale = [1, 1, 1]) => {
    const gltf = await loader.loadAsync(BASE + file);
    const object = gltf.scene;
    object.name = name;
    object.position.set(...position);
    object.scale.set(...scale);
    object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData.physics = 'none';
      }
    });
    staticLayer.add(object);
    return object;
  };

  await loadGLB('arena-kong-stadium-kit.glb', 'ArenaKongStadiumKit');
  await loadGLB('arena-kong-jungle-kit.glb', 'ArenaKongJungleKit');
  await loadGLB('arena-kong-cliffs-ruins.glb', 'ArenaKongCliffsRuins', [0, 0, -215], [1.2, 1.2, 1.2]);

  const texture = await new THREE.TextureLoader().loadAsync(
    BASE + (mode === 'night' ? 'arena-kong-backdrop-night.webp' : 'arena-kong-backdrop-day.webp')
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false })
  );
  backdrop.name = 'ArenaKongBackdrop';
  backdrop.scale.set(280, 280, 160);
  backdrop.position.set(0, 65, 0);
  backdrop.renderOrder = -10;
  scene.add(backdrop);

  return { staticLayer, backdrop, playableBounds: { x: PLAYABLE_X, z: PLAYABLE_Z } };
}

export function isInsideArenaKongPlayableArea(position) {
  return Math.abs(position.x) <= PLAYABLE_X && Math.abs(position.z) <= PLAYABLE_Z;
}
