// Mapa único de veículos: id → arquivo GLB e rótulo.
// `file: null` significa que o veículo é construído proceduralmente (Octane nativo).
export interface CarModelEntry {
  file: string | null
  label: string
}

export const CAR_MODELS: Record<string, CarModelEntry> = {
  'octane-cartoon': { file: '/models/vehicle-truck-red.glb', label: 'Octane Toon Red' },
  'cartoon-red': { file: '/models/vehicle-truck-red.glb', label: 'Cartoon Red' },
  'cartoon-yellow': { file: '/models/vehicle-truck-yellow.glb', label: 'Cartoon Yellow' },
  'cartoon-green': { file: '/models/vehicle-truck-green.glb', label: 'Cartoon Green' },
  'cartoon-purple': { file: '/models/vehicle-truck-purple.glb', label: 'Cartoon Purple' },
  'toycar': { file: '/models/ToyCar.glb', label: 'ToyCar 3D' },
  'ferrari': { file: '/models/ferrari.glb', label: 'Ferrari GT' },
  'milktruck': { file: '/models/CesiumMilkTruck.glb', label: 'Milk Truck' },
  'cartoon-moto': { file: '/models/vehicle-motorcycle.glb', label: 'Moto Nitro' }
}
