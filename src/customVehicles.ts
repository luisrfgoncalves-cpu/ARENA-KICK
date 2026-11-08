// ============================================================
//  customVehicles.ts — Modelos 3D cartoon de alta fidelidade
//  para "Guincho Tody" e "Van Gost", construídos com Three.js,
//  materiais toon, texturas faciais expressivas e acessórios fiéis.
// ============================================================
import * as THREE from 'three'

export interface CustomVehicleResult {
  group: THREE.Group
  wheels: THREE.Group[]
  steerWheels: THREE.Group[]
  underglowColor: number
  roofMarkerY: number
}

// ── Texturas de Expressão Facial Cartoon ─────────────────────
function createCartoonEyesTexture(irisColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!

  // Vidro escuro do para-brisa
  ctx.fillStyle = '#0b1329'
  ctx.fillRect(0, 0, 512, 256)

  // Reflexo diagonal sutil
  const grad = ctx.createLinearGradient(0, 0, 512, 256)
  grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)')
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)')
  grad.addColorStop(1, 'rgba(14, 165, 233, 0.15)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 512, 256)

  const drawEye = (cx: number, cy: number) => {
    ctx.save()
    // Esclera branca grande e arredondada
    ctx.beginPath()
    ctx.ellipse(cx, cy, 78, 92, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = 8
    ctx.strokeStyle = '#0f172a'
    ctx.stroke()

    // Íris colorida
    ctx.beginPath()
    ctx.ellipse(cx, cy + 6, 46, 56, 0, 0, Math.PI * 2)
    ctx.fillStyle = irisColor
    ctx.fill()

    // Gradiente interno na íris
    const ig = ctx.createRadialGradient(cx, cy - 10, 5, cx, cy + 6, 46)
    ig.addColorStop(0, '#ffffff')
    ig.addColorStop(0.3, irisColor)
    ig.addColorStop(1, '#022c22')
    ctx.fillStyle = ig
    ctx.fill()

    // Pupila preta
    ctx.beginPath()
    ctx.ellipse(cx, cy + 8, 26, 32, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#0f172a'
    ctx.fill()

    // Brilhos brancos (catchlights)
    ctx.beginPath()
    ctx.arc(cx - 14, cy - 10, 14, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(cx + 12, cy + 18, 7, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    // Pálpebra superior curva / sobrancelha simpática
    ctx.beginPath()
    ctx.arc(cx, cy - 20, 84, Math.PI * 1.15, Math.PI * 1.85)
    ctx.lineWidth = 14
    ctx.strokeStyle = '#0f172a'
    ctx.lineCap = 'round'
    ctx.stroke()

    ctx.restore()
  }

  drawEye(160, 138)
  drawEye(352, 138)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function createTodyGrilleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!

  // Fundo creme suave
  ctx.fillStyle = '#fef3c7'
  ctx.fillRect(0, 0, 512, 256)

  // Grade superior cinza
  ctx.fillStyle = '#1e293b'
  ctx.beginPath()
  ctx.roundRect(100, 30, 312, 70, 16)
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = '#64748b'
  ctx.stroke()

  // Filetes cromados da grade
  ctx.fillStyle = '#94a3b8'
  for (let y = 48; y <= 82; y += 16) {
    ctx.fillRect(116, y, 280, 6)
  }

  // Sorriso simpático e aberto
  ctx.beginPath()
  ctx.moveTo(110, 130)
  ctx.quadraticCurveTo(256, 235, 402, 130)
  ctx.quadraticCurveTo(256, 155, 110, 130)
  ctx.closePath()
  ctx.fillStyle = '#1e293b'
  ctx.fill()
  ctx.lineWidth = 8
  ctx.strokeStyle = '#0f172a'
  ctx.stroke()

  // Língua rosa
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(110, 130)
  ctx.quadraticCurveTo(256, 235, 402, 130)
  ctx.quadraticCurveTo(256, 155, 110, 130)
  ctx.clip()

  ctx.beginPath()
  ctx.arc(256, 205, 55, 0, Math.PI * 2)
  ctx.fillStyle = '#f43f5e'
  ctx.fill()
  ctx.restore()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function createVanGrilleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!

  // Fundo marfim/branco
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, 512, 256)

  // Grade frontal emoldurada
  ctx.fillStyle = '#0f172a'
  ctx.beginPath()
  ctx.roundRect(70, 35, 372, 185, 24)
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = '#cbd5e1'
  ctx.stroke()

  // Grelhas horizontais
  ctx.fillStyle = '#475569'
  for (let y = 60; y <= 120; y += 22) {
    ctx.fillRect(90, y, 332, 10)
  }

  // Sorriso do radiador
  ctx.beginPath()
  ctx.moveTo(110, 145)
  ctx.quadraticCurveTo(256, 215, 402, 145)
  ctx.quadraticCurveTo(256, 165, 110, 145)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(125, 155)
  ctx.quadraticCurveTo(256, 210, 387, 155)
  ctx.quadraticCurveTo(256, 172, 125, 155)
  ctx.closePath()
  ctx.fillStyle = '#f43f5e'
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function createGhostBadgeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!

  // Fundo transparente
  ctx.clearRect(0, 0, 256, 256)

  // Hexágono vermelho escuro
  const cx = 128
  const cy = 128
  const r = 110
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = '#991b1b'
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = '#fee2e2'
  ctx.stroke()

  // Fundo interno escuro
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    const x = cx + (r - 18) * Math.cos(a)
    const y = cy + (r - 18) * Math.sin(a)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = '#0f172a'
  ctx.fill()

  // Fantasminha cartoon estilizado em espiral (Ghost swirl)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = '#f8fafc'
  ctx.beginPath()
  ctx.arc(0, -20, 36, 0, Math.PI * 2)
  ctx.fill()

  // Cauda em caracol/onda
  ctx.beginPath()
  ctx.moveTo(-32, -15)
  ctx.bezierCurveTo(-40, 25, 10, 45, 18, 55)
  ctx.bezierCurveTo(35, 40, 30, 15, 32, -15)
  ctx.fillStyle = '#f8fafc'
  ctx.fill()

  // Olhos e boca cartoon do fantasma
  ctx.fillStyle = '#0f172a'
  ctx.beginPath()
  ctx.arc(-12, -22, 6, 0, Math.PI * 2)
  ctx.arc(12, -22, 6, 0, Math.PI * 2)
  ctx.fill()

  ctx.beginPath()
  ctx.arc(0, -8, 8, 0, Math.PI)
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 3
  ctx.stroke()

  // Brilhos ectoplasmáticos verdes
  ctx.fillStyle = '#22c55e'
  ctx.beginPath()
  ctx.arc(-42, 10, 6, 0, Math.PI * 2)
  ctx.arc(42, -5, 5, 0, Math.PI * 2)
  ctx.arc(28, 48, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function createHazardStripesTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#facc15'
  ctx.fillRect(0, 0, 128, 128)

  ctx.fillStyle = '#1e293b'
  ctx.beginPath()
  for (let x = -128; x < 256; x += 32) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x + 16, 0)
    ctx.lineTo(x + 16 + 128, 128)
    ctx.lineTo(x + 128, 128)
    ctx.closePath()
  }
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 1)
  return tex
}

// ── Construtor de Rodas Cartoon com Calotas e Pneus ─────────
function createCartoonWheel(
  radius: number,
  width: number,
  rimColor: number,
  hubColor: number,
  name: string
): THREE.Group {
  const wheelGroup = new THREE.Group()
  wheelGroup.name = name

  // Pneu de borracha escura
  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 24)
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.85,
    metalness: 0.1,
  })
  const tireMesh = new THREE.Mesh(tireGeo, tireMat)
  tireMesh.rotation.z = Math.PI / 2
  tireMesh.castShadow = true
  wheelGroup.add(tireMesh)

  // Aro da roda (Rim)
  const rimGeo = new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, width * 1.02, 20)
  const rimMat = new THREE.MeshStandardMaterial({
    color: rimColor,
    roughness: 0.45,
    metalness: 0.25,
  })
  const rimMesh = new THREE.Mesh(rimGeo, rimMat)
  rimMesh.rotation.z = Math.PI / 2
  wheelGroup.add(rimMesh)

  // Calota externa proeminente
  const capGeo = new THREE.CylinderGeometry(radius * 0.38, radius * 0.38, width * 1.08, 16)
  const capMat = new THREE.MeshStandardMaterial({
    color: hubColor,
    roughness: 0.3,
    metalness: 0.5,
  })
  const capMesh = new THREE.Mesh(capGeo, capMat)
  capMesh.rotation.z = Math.PI / 2
  wheelGroup.add(capMesh)

  // Parafusos cromados nas rodas
  const boltMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8, roughness: 0.2 })
  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI * 2) / 5
    const bx = Math.cos(angle) * (radius * 0.52)
    const by = Math.sin(angle) * (radius * 0.52)
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, width * 1.06, 6), boltMat)
    bolt.rotation.z = Math.PI / 2
    bolt.position.set(0, by, bx)
    wheelGroup.add(bolt)
  }

  return wheelGroup
}

// ============================================================
//  GUINCHO TODY — 3D CARTOON
//  Baseado no personagem simpático da arte original:
//  - Cabine e caçamba Teal Blue com detalhes creme e laranja
//  - Rosto amigável no para-brisa e sorriso no para-choque
//  - Torre de guincho com lancha, roldana, cabo e gancho listrado
//  - Giroflex âmbar no teto e rodas offroad com calotas teal
// ============================================================
export function buildGuinchoTodyVehicle(): CustomVehicleResult {
  const root = new THREE.Group()
  root.name = 'guincho-tody-model'

  const tealMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7, // Teal blue vibrante
    roughness: 0.35,
    metalness: 0.2,
  })
  const orangeMat = new THREE.MeshStandardMaterial({
    color: 0xf97316, // Laranja industrial
    roughness: 0.4,
    metalness: 0.2,
  })
  const creamMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7, // Creme/marfim
    roughness: 0.4,
    metalness: 0.1,
  })
  const darkChassisMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.8,
    metalness: 0.3,
  })
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    metalness: 0.9,
    roughness: 0.15,
  })

  // 1. Chassi principal
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.45, 4.9), darkChassisMat)
  chassis.position.set(0, 0.45, 0)
  chassis.castShadow = true
  root.add(chassis)

  // 2. Cabine Teal
  const cabGeo = new THREE.BoxGeometry(2.05, 1.25, 2.1)
  const cab = new THREE.Mesh(cabGeo, tealMat)
  cab.position.set(0, 1.3, 0.4)
  cab.castShadow = true
  root.add(cab)

  // Teto arredondado creme
  const roofCap = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 1.95), creamMat)
  roofCap.position.set(0, 1.98, 0.35)
  root.add(roofCap)

  // Viseira do teto (Sun visor) com luzes âmbar
  const visor = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.15, 0.4), creamMat)
  visor.position.set(0, 1.92, 1.35)
  visor.rotation.x = 0.2
  root.add(visor)

  for (let x = -0.55; x <= 0.55; x += 0.55) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b })
    )
    marker.position.set(x, 1.98, 1.48)
    root.add(marker)
  }

  // Capô e frente
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.65, 1.35), tealMat)
  hood.position.set(0, 0.92, 1.95)
  hood.castShadow = true
  root.add(hood)

  // Faixa creme no capô
  const hoodStripe = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 1.32), creamMat)
  hoodStripe.position.set(0, 1.26, 1.95)
  root.add(hoodStripe)

  // Painéis de porta com listras laranjas nas laterais
  const doorStripeL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 1.4), orangeMat)
  doorStripeL.position.set(-1.05, 1.15, 0.35)
  root.add(doorStripeL)

  const doorStripeR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 1.4), orangeMat)
  doorStripeR.position.set(1.05, 1.15, 0.35)
  root.add(doorStripeR)

  // 3. Rosto: Para-brisa com olhos expressivos
  const eyesTex = createCartoonEyesTexture('#0284c7')
  const windshieldMat = new THREE.MeshBasicMaterial({ map: eyesTex })
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 0.85), windshieldMat)
  windshield.position.set(0, 1.5, 1.46)
  windshield.rotation.x = -0.16
  root.add(windshield)

  // Grade / Para-choque com boca sorridente
  const grilleTex = createTodyGrilleTexture()
  const grilleMat = new THREE.MeshBasicMaterial({ map: grilleTex })
  const grilleMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.65), grilleMat)
  grilleMesh.position.set(0, 0.78, 2.64)
  root.add(grilleMesh)

  const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 0.3), creamMat)
  bumperFront.position.set(0, 0.52, 2.58)
  root.add(bumperFront)

  // Faróis grandes arredondados amarelos com aro cromado
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a })
  const hlRingMat = chromeMat
  for (const sign of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 20), hlRingMat)
    ring.position.set(sign * 0.78, 0.95, 2.62)
    root.add(ring)

    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), headlightMat)
    lens.position.set(sign * 0.78, 0.95, 2.6)
    root.add(lens)

    // Faróis de milha inferiores
    const fog = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
    )
    fog.position.set(sign * 0.62, 0.48, 2.73)
    root.add(fog)

    // Retrovisores arredondados simpáticos
    const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 6), chromeMat)
    mirrorStem.rotation.z = sign * 0.6
    mirrorStem.position.set(sign * 1.15, 1.4, 1.1)
    root.add(mirrorStem)

    const mirrorPod = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), tealMat)
    mirrorPod.scale.set(0.6, 1.1, 0.8)
    mirrorPod.position.set(sign * 1.32, 1.48, 1.1)
    root.add(mirrorPod)
  }

  // 4. Caçamba traseira e para-lamas largos
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.65, 2.3), tealMat)
  bed.position.set(0, 0.8, -1.35)
  bed.castShadow = true
  root.add(bed)

  const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.08, 2.15), darkChassisMat)
  bedFloor.position.set(0, 1.14, -1.35)
  root.add(bedFloor)

  // Para-lamas arredondados sobre as rodas traseiras
  for (const sign of [-1, 1]) {
    const fender = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.4, 1.6), orangeMat)
    fender.position.set(sign * 1.05, 0.85, -1.35)
    root.add(fender)
  }

  // 5. Torre do Guincho (Crane Tower articulada e detalhada)
  const craneGroup = new THREE.Group()

  // Base reforçada da lança
  const craneBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.6), orangeMat)
  craneBase.position.set(0, 1.25, -1.0)
  craneGroup.add(craneBase)

  // Hastes da lança principal (A-frame diagonal)
  const boomArmGeo = new THREE.BoxGeometry(0.16, 0.22, 2.1)
  const boomLeft = new THREE.Mesh(boomArmGeo, orangeMat)
  boomLeft.position.set(-0.45, 1.95, -1.65)
  boomLeft.rotation.x = 0.55
  boomLeft.rotation.y = 0.12
  craneGroup.add(boomLeft)

  const boomRight = new THREE.Mesh(boomArmGeo, orangeMat)
  boomRight.position.set(0.45, 1.95, -1.65)
  boomRight.rotation.x = 0.55
  boomRight.rotation.y = -0.12
  craneGroup.add(boomRight)

  // Pistão hidráulico central
  const pistonGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8)
  const piston = new THREE.Mesh(pistonGeo, chromeMat)
  piston.position.set(0, 1.6, -1.45)
  piston.rotation.x = 0.52
  craneGroup.add(piston)

  // Roldana / Carretel de cabo no topo da lança
  const pulleyGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.24, 16)
  const pulley = new THREE.Mesh(pulleyGeo, darkChassisMat)
  pulley.rotation.z = Math.PI / 2
  pulley.position.set(0, 2.45, -2.35)
  craneGroup.add(pulley)

  // Cabo de aço descendo
  const cableGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6)
  const cable = new THREE.Mesh(cableGeo, chromeMat)
  cable.position.set(0, 1.95, -2.42)
  craneGroup.add(cable)

  // Bloco listrado de alerta
  const hazardTex = createHazardStripesTexture()
  const blockGeo = new THREE.BoxGeometry(0.35, 0.4, 0.28)
  const blockMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.5 })
  const block = new THREE.Mesh(blockGeo, blockMat)
  block.position.set(0, 1.5, -2.42)
  craneGroup.add(block)

  // Gancho de aço cartoon robusto
  const hookGeo = new THREE.TorusGeometry(0.24, 0.07, 8, 20, Math.PI * 1.55)
  const hook = new THREE.Mesh(hookGeo, chromeMat)
  hook.position.set(0, 1.25, -2.42)
  hook.rotation.z = Math.PI * 0.9
  craneGroup.add(hook)

  root.add(craneGroup)

  // 6. Giroflex Âmbar no Teto
  const beaconGroup = new THREE.Group()
  const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.12, 12), darkChassisMat)
  beaconBase.position.set(0, 2.06, 0.35)
  beaconGroup.add(beaconBase)

  const beaconDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.7),
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.9,
    })
  )
  beaconDome.position.set(0, 2.12, 0.35)
  beaconGroup.add(beaconDome)
  root.add(beaconGroup)

  // 7. Rodas Offroad Cartoon (4 rodas)
  const wheels: THREE.Group[] = []
  const steerWheels: THREE.Group[] = []

  const wheelConfigs = [
    { name: 'wheel_front_left',  x: -1.08, z:  1.55, isFront: true },
    { name: 'wheel_front_right', x:  1.08, z:  1.55, isFront: true },
    { name: 'wheel_rear_left',   x: -1.08, z: -1.45, isFront: false },
    { name: 'wheel_rear_right',  x:  1.08, z: -1.45, isFront: false },
  ]

  for (const c of wheelConfigs) {
    const w = createCartoonWheel(0.46, 0.38, 0xfef3c7, 0x0284c7, c.name)
    w.position.set(c.x, 0.46, c.z)
    root.add(w)
    wheels.push(w)
    if (c.isFront) steerWheels.push(w)
  }

  // Normalização do porte para ~5.2 m
  root.scale.setScalar(1.02)

  return {
    group: root,
    wheels,
    steerWheels,
    underglowColor: 0xf97316, // Laranja neon
    roofMarkerY: 2.45,
  }
}

// ============================================================
//  VAN GOST — 3D CARTOON
//  Baseado na arte original da Van Caça-Fantasmas retrô:
//  - Carroceria clássica marfim/branco com saia e para-lamas vermelho profundo
//  - Rostinho simpático no para-brisa e radiador alegre com dentes
//  - Rack de teto completo: Cúpula verde esmeralda, antena parabólica,
//    frasco com cristais ectoplasmáticos e caixa de equipamentos
//  - Emblema paranormal com fantasma em hexágono nas duas portas
//  - Escada lateral metálica e luz de underglow espectral verde
// ============================================================
export function buildVanGostVehicle(): CustomVehicleResult {
  const root = new THREE.Group()
  root.name = 'van-gost-model'

  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc, // Branco marfim
    roughness: 0.35,
    metalness: 0.15,
  })
  const redMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626, // Vermelho rubi vibrante
    roughness: 0.35,
    metalness: 0.25,
  })
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a, // Vidro / chassi escuro
    roughness: 0.6,
    metalness: 0.3,
  })
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    metalness: 0.85,
    roughness: 0.15,
  })
  const greenEctoMat = new THREE.MeshStandardMaterial({
    color: 0x22c55e,
    emissive: 0x22c55e,
    emissiveIntensity: 0.9,
    transparent: true,
    opacity: 0.85,
  })

  // 1. Chassi e saia inferior vermelha
  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.55, 4.8), redMat)
  lowerBody.position.set(0, 0.55, 0)
  lowerBody.castShadow = true
  root.add(lowerBody)

  // 2. Carroceria principal da van (Branco/Marfim)
  const mainBody = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.25, 4.6), whiteMat)
  mainBody.position.set(0, 1.35, -0.05)
  mainBody.castShadow = true
  root.add(mainBody)

  // Teto levemente arqueado
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.22, 4.45), whiteMat)
  roof.position.set(0, 2.05, -0.05)
  root.add(roof)

  // Faixa vermelha lateral que contorna a van
  const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 4.5), redMat)
  stripeL.position.set(-1.06, 1.15, -0.05)
  root.add(stripeL)

  const stripeR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 4.5), redMat)
  stripeR.position.set(1.06, 1.15, -0.05)
  root.add(stripeR)

  // Para-lamas vermelhos curvos sobre as 4 rodas
  for (const sign of [-1, 1]) {
    const fFront = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.38, 1.35), redMat)
    fFront.position.set(sign * 1.1, 0.65, 1.45)
    root.add(fFront)

    const fRear = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.38, 1.35), redMat)
    fRear.position.set(sign * 1.1, 0.65, -1.45)
    root.add(fRear)
  }

  // 3. Vidros laterais fumê
  for (const sign of [-1, 1]) {
    const sideGlass = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.52), darkMat)
    sideGlass.position.set(sign * 1.06, 1.55, -0.4)
    sideGlass.rotation.y = sign * (Math.PI / 2)
    root.add(sideGlass)
  }

  // Emblemas Hexagonais do Fantasminha nas portas laterais
  const badgeTex = createGhostBadgeTexture()
  const badgeMat = new THREE.MeshBasicMaterial({ map: badgeTex, transparent: true })
  for (const sign of [-1, 1]) {
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), badgeMat)
    badge.position.set(sign * 1.07, 1.18, -0.15)
    badge.rotation.y = sign * (Math.PI / 2)
    root.add(badge)
  }

  // 4. Frente: Para-brisa com olhos expressivos da Van Gost
  const vanEyesTex = createCartoonEyesTexture('#10b981')
  const windshield = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 0.78),
    new THREE.MeshBasicMaterial({ map: vanEyesTex })
  )
  windshield.position.set(0, 1.56, 2.26)
  windshield.rotation.x = -0.18
  root.add(windshield)

  // Grade frontal radiador com sorriso alegre
  const grilleTex = createVanGrilleTexture()
  const grille = new THREE.Mesh(
    new THREE.PlaneGeometry(1.75, 0.68),
    new THREE.MeshBasicMaterial({ map: grilleTex })
  )
  grille.position.set(0, 0.82, 2.41)
  root.add(grille)

  // Para-choque frontal vermelho robusto com protetores cromados
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.32, 0.35), redMat)
  bumper.position.set(0, 0.52, 2.38)
  root.add(bumper)

  for (const sign of [-1, 1]) {
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.15), chromeMat)
    guard.position.set(sign * 0.48, 0.58, 2.54)
    root.add(guard)
  }

  // Faróis redondos com aro cromado e luzes verdes
  for (const sign of [-1, 1]) {
    const hlRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 18), chromeMat)
    hlRing.position.set(sign * 0.82, 0.92, 2.4)
    root.add(hlRing)

    const hlLens = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0xfef9c3 })
    )
    hlLens.position.set(sign * 0.82, 0.92, 2.38)
    root.add(hlLens)

    const markerGreen = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x4ade80 })
    )
    markerGreen.position.set(sign * 0.75, 1.25, 2.32)
    root.add(markerGreen)

    // Retrovisores de van retrô
    const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.38, 6), chromeMat)
    mirrorStem.rotation.z = sign * 0.55
    mirrorStem.position.set(sign * 1.18, 1.45, 1.55)
    root.add(mirrorStem)

    const mirrorHead = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12), chromeMat)
    mirrorHead.rotation.x = Math.PI / 2
    mirrorHead.position.set(sign * 1.34, 1.52, 1.55)
    root.add(mirrorHead)
  }

  // 5. Rack de Teto Caça-Fantasmas (Equipamento Paranormal Completo)
  const rackGroup = new THREE.Group()

  // Trilhos principais vermelhos do rack
  const railGeoX = new THREE.BoxGeometry(1.85, 0.08, 0.08)
  const railGeoZ = new THREE.BoxGeometry(0.08, 0.08, 3.6)
  const railL = new THREE.Mesh(railGeoZ, redMat)
  railL.position.set(-0.9, 2.22, -0.2)
  rackGroup.add(railL)

  const railR = new THREE.Mesh(railGeoZ, redMat)
  railR.position.set(0.9, 2.22, -0.2)
  rackGroup.add(railR)

  for (let z = -1.8; z <= 1.5; z += 0.8) {
    const cross = new THREE.Mesh(railGeoX, redMat)
    cross.position.set(0, 2.22, z)
    rackGroup.add(cross)
  }

  // A. Cúpula de Sensor Verde Esmeralda no centro do rack
  const domeBase = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 0.16, 16), redMat)
  domeBase.position.set(0, 2.3, 0.55)
  rackGroup.add(domeBase)

  const greenDome = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.7), greenEctoMat)
  greenDome.position.set(0, 2.38, 0.55)
  rackGroup.add(greenDome)

  // B. Antena Parabólica Branca com Suporte Vermelho
  const dishMount = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.35, 8), redMat)
  dishMount.position.set(0.48, 2.38, -0.35)
  rackGroup.add(dishMount)

  const dishGeo = new THREE.SphereGeometry(0.35, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.45)
  const dish = new THREE.Mesh(dishGeo, whiteMat)
  dish.rotation.x = -Math.PI * 0.65
  dish.position.set(0.48, 2.65, -0.35)
  rackGroup.add(dish)

  const dishSpike = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 6), greenEctoMat)
  dishSpike.rotation.x = -Math.PI * 0.65
  dishSpike.position.set(0.48, 2.75, -0.38)
  rackGroup.add(dishSpike)

  // C. Recipiente de Contenção com Cristais Verdes Ectoplasmáticos
  const jarBase = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 12), redMat)
  jarBase.position.set(0.62, 2.32, -1.35)
  rackGroup.add(jarBase)

  const jarGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.55, 14),
    new THREE.MeshStandardMaterial({
      color: 0x86efac,
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
    })
  )
  jarGlass.position.set(0.62, 2.62, -1.35)
  rackGroup.add(jarGlass)

  // Cristais verdes luminosos dentro do frasco
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), greenEctoMat)
  crystal.position.set(0.62, 2.62, -1.35)
  rackGroup.add(crystal)

  const jarCap = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.08, 12), redMat)
  jarCap.position.set(0.62, 2.92, -1.35)
  rackGroup.add(jarCap)

  // D. Caixa de Equipamento Militar Verde Musgo
  const crateGeo = new THREE.BoxGeometry(0.65, 0.38, 0.9)
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.7 })
  const crate = new THREE.Mesh(crateGeo, crateMat)
  crate.position.set(-0.35, 2.45, -0.55)
  rackGroup.add(crate)

  // E. Antena Whip Alta com Ponta Verde
  const antennaBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.2, 8), darkMat)
  antennaBase.position.set(-0.75, 2.25, 1.25)
  rackGroup.add(antennaBase)

  const antennaRod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.2, 6), chromeMat)
  antennaRod.position.set(-0.75, 2.85, 1.25)
  antennaRod.rotation.z = -0.08
  rackGroup.add(antennaRod)

  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), greenEctoMat)
  antennaTip.position.set(-0.82, 3.48, 1.25)
  rackGroup.add(antennaTip)

  // F. Escada Lateral Traseira Vermelha
  const ladderGroup = new THREE.Group()
  const poleL = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), redMat)
  poleL.position.set(1.12, 1.45, -1.7)
  ladderGroup.add(poleL)

  const poleR = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), redMat)
  poleR.position.set(1.12, 1.45, -1.25)
  ladderGroup.add(poleR)

  for (let y = 0.85; y <= 2.1; y += 0.3) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6), redMat)
    rung.rotation.x = Math.PI / 2
    rung.position.set(1.12, y, -1.48)
    ladderGroup.add(rung)
  }
  root.add(ladderGroup)

  root.add(rackGroup)

  // 6. Rodas Offroad Retrô (4 rodas)
  const wheels: THREE.Group[] = []
  const steerWheels: THREE.Group[] = []

  const wheelConfigs = [
    { name: 'wheel_front_left',  x: -1.08, z:  1.45, isFront: true },
    { name: 'wheel_front_right', x:  1.08, z:  1.45, isFront: true },
    { name: 'wheel_rear_left',   x: -1.08, z: -1.45, isFront: false },
    { name: 'wheel_rear_right',  x:  1.08, z: -1.45, isFront: false },
  ]

  for (const c of wheelConfigs) {
    const w = createCartoonWheel(0.46, 0.38, 0xdc2626, 0xf1f5f9, c.name)
    w.position.set(c.x, 0.46, c.z)
    root.add(w)
    wheels.push(w)
    if (c.isFront) steerWheels.push(w)
  }

  root.scale.setScalar(1.02)

  return {
    group: root,
    wheels,
    steerWheels,
    underglowColor: 0x22c55e, // Verde ectoplasmático neon
    roofMarkerY: 2.5,
  }
}
