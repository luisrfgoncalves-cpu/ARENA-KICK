// Mapa único de veículos: id → arquivo GLB e rótulo.
export interface CarModelEntry {
  file: string | null
  label: string
  /** Atributos especiais do veículo (optional) */
  attrs?: {
    nitroBonus?: number    // multiplicador de velocidade de nitro (padrão 1.0)
    pushBonus?: number     // multiplicador de força de empurrão (padrão 1.0)
    shieldBonus?: number   // bônus de duração de escudo em segundos (padrão 0)
    jumpBonus?: number     // bônus de força de pulo (padrão 0)
  }
}

export const CAR_MODELS: Record<string, CarModelEntry> = {
  'octane-cartoon': { file: '/models/vehicle-truck-red.glb', label: 'Octane Toon Red' },
  'kart-oobi': { file: '/models/kart-oobi.glb', label: 'Oobi Kart' },
  'kart-oodi': { file: '/models/kart-oodi.glb', label: 'Oodi Kart' },
  'kart-ooli': { file: '/models/kart-ooli.glb', label: 'Ooli Kart' },
  'race-future': { file: '/models/race-future.glb', label: 'Future Racer' },
  'race': { file: '/models/race.glb', label: 'Arena Racer' },
  'buggy': { file: '/models/buggy.glb', label: 'Dune Buggy 4x4' },
  'ferrari': { file: '/models/ferrari.glb', label: 'Ferrari GT Sport' },
  'toycar': { file: '/models/ToyCar.glb', label: 'ToyCar Super' },
  'cartoon-yellow': { file: '/models/vehicle-truck-yellow.glb', label: 'Cruiser Toon Gold' },
  'cartoon-green': { file: '/models/vehicle-truck-green.glb', label: 'Beast Toon Lime' },
  'cartoon-purple': { file: '/models/vehicle-truck-purple.glb', label: 'Phantom Toon Purple' },
  'cartoon-moto': { file: '/models/vehicle-motorcycle.glb', label: 'Moto Nitro 3D' },
  'sportscar': { file: '/models/sportscar.glb', label: 'Cyber Sportscar' },
  'milktruck': { file: '/models/CesiumMilkTruck.glb', label: 'Milk Truck Heavy' },
  'cartoon-red': { file: '/models/vehicle-truck-red.glb', label: 'Red Racer Toon' },

  // ─── POWERKICK EXCLUSIVE CARS ────────────────────────────────────────────────
  // Carros exclusivos da Arena Power-Kick: escala, sombra e colisão idênticas
  // aos carros padrão (comprimento normalizado para 5.2 m pelo loadModel()).
  'volt-striker': {
    file: '/assets/models/powerkick-cars/volt-striker.glb',
    label: 'Volt Striker',
    attrs: { nitroBonus: 1.28 }   // +28% velocidade de nitro
  },
  'titan-shift': {
    file: '/assets/models/powerkick-cars/titan-shift.glb',
    label: 'Titan Shift',
    attrs: { pushBonus: 1.35 }    // +35% força de empurrão em colisões
  },
  'nova-forge': {
    file: '/assets/models/powerkick-cars/nova-forge.glb',
    label: 'Nova Forge',
    attrs: { shieldBonus: 2.0, jumpBonus: 6 }  // +2s de escudo, +6 de altura de pulo
  },
  'guincho-tody': {
    file: '/models/guincho-tody.glb',
    label: 'Guincho Tody',
    attrs: { pushBonus: 1.40, nitroBonus: 1.10 }  // +40% de força de reboque e empurrão
  },
  'van-gost': {
    file: '/models/van-gost.glb',
    label: 'Van Gost',
    attrs: { shieldBonus: 2.5, pushBonus: 1.20 }  // Blindagem fantasma: +2.5s escudo
  },
}
