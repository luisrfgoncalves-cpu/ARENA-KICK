// Catálogo oficial dos 5 Veículos Titãs exclusivos da Arena
export interface CarModelEntry {
  file: string | null
  label: string
  /** Atributos especiais do veículo */
  attrs?: {
    nitroBonus?: number    // multiplicador de velocidade de nitro (padrão 1.0)
    pushBonus?: number     // multiplicador de força de empurrão (padrão 1.0)
    shieldBonus?: number   // bônus de duração de escudo em segundos (padrão 0)
    jumpBonus?: number     // bônus de força de pulo (padrão 0)
  }
}

export const CAR_MODELS: Record<string, CarModelEntry> = {
  // ─── OS 5 VEÍCULOS TITÃS OFICIAIS ───
  'volt-striker': {
    file: '/assets/models/powerkick-cars/volt-striker.glb',
    label: 'Volt Striker',
    attrs: { nitroBonus: 1.28 }   // +28% Nitro
  },
  'titan-shift': {
    file: '/assets/models/powerkick-cars/titan-shift.glb',
    label: 'Titan Shift',
    attrs: { pushBonus: 1.35 }    // +35% Impacto
  },
  'nova-forge': {
    file: '/assets/models/powerkick-cars/nova-forge.glb',
    label: 'Nova Forge',
    attrs: { shieldBonus: 2.0, jumpBonus: 6 }  // Escudo + Pulo
  },
  'guincho-tody': {
    file: '/models/guincho-tody.glb',
    label: 'Guincho Tody',
    attrs: { pushBonus: 1.40, nitroBonus: 1.10 }  // +40% Empurrão
  },
  'van-gost': {
    file: '/models/van-gost.glb',
    label: 'Van Gost',
    attrs: { shieldBonus: 2.5, pushBonus: 1.20 }  // +35% Escudo
  }
}
