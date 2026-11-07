// Mapa único de veículos: id → arquivo GLB e rótulo.
// `file: null` significa que o veículo é construído proceduralmente (Octane nativo).
export interface CarModelEntry {
  file: string | null
  label: string
}

export const CAR_MODELS: Record<string, CarModelEntry> = {
  'octane-cartoon': { file: '/models/vehicle-truck-red.glb', label: 'Octane Toon Red' },
  'buggy': { file: '/models/buggy.glb', label: 'Dune Buggy 4x4' },
  'ferrari': { file: '/models/ferrari.glb', label: 'Ferrari GT Sport' },
  'toycar': { file: '/models/ToyCar.glb', label: 'ToyCar Super' },
  'cartoon-yellow': { file: '/models/vehicle-truck-yellow.glb', label: 'Cruiser Toon Gold' },
  'cartoon-green': { file: '/models/vehicle-truck-green.glb', label: 'Beast Toon Lime' },
  'cartoon-purple': { file: '/models/vehicle-truck-purple.glb', label: 'Phantom Toon Purple' },
  'cartoon-moto': { file: '/models/vehicle-motorcycle.glb', label: 'Moto Nitro 3D' },
  'sportscar': { file: '/models/sportscar.glb', label: 'Cyber Sportscar' },
  'milktruck': { file: '/models/CesiumMilkTruck.glb', label: 'Milk Truck Heavy' },
  'cartoon-red': { file: '/models/vehicle-truck-red.glb', label: 'Red Racer Toon' }
}
