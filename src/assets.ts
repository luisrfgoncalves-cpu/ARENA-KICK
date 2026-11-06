// ============================================================
//  assets.ts — Gerador Procedural de Assets de Alta Definição (HD)
//  Gera texturas PBR, bandeiras metálicas 3D, couro de bola e estádio
//  100% Autônomo, offline, instantâneo e com resolução nítida
// ============================================================

export type TeamKey = 'brazil' | 'usa' | 'france' | 'argentina' | 'barcelona' | 'cyber'
export type FieldTheme = 'classic' | 'cyber' | 'futsal'

export class AssetFactory {
  private static grassTexture: HTMLCanvasElement | null = null
  private static ballTexture: HTMLCanvasElement | null = null
  private static badgeCache: Map<string, HTMLCanvasElement> = new Map()
  private static turfCache: Map<string, HTMLCanvasElement> = new Map()

  // ── GRAMADO REALISTA DE ESTÁDIO COM TEMAS ───────────────────
  static getStadiumTurf(width = 1024, height = 576, theme: FieldTheme = 'classic'): HTMLCanvasElement {
    const key = `${theme}_${width}x${height}`
    if (this.turfCache.has(key)) return this.turfCache.get(key)!

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!

    if (theme === 'cyber') {
      // Arena noturna chapada (sem gradiente)
      ctx.fillStyle = '#161335'
      ctx.fillRect(0, 0, width, height)

      const stripes = 12
      const sw = width / stripes
      for (let i = 0; i < stripes; i++) {
        if (i % 2 === 0) continue
        ctx.fillStyle = '#1e1a47'
        ctx.fillRect(i * sw, 0, sw, height)
      }
    } else if (theme === 'futsal') {
      // Quadra de madeira chapada com tábuas
      ctx.fillStyle = '#c07a35'
      ctx.fillRect(0, 0, width, height)

      const plankH = 28
      for (let y = 0; y < height; y += plankH) {
        ctx.fillStyle = (y / plankH) % 2 === 0 ? '#b06a2a' : '#cb8a45'
        ctx.fillRect(0, y, width, plankH)
        ctx.strokeStyle = '#8a4f1c'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
      }
    } else {
      // Gramado cartoon chapado em faixas
      ctx.fillStyle = '#3fbf4f'
      ctx.fillRect(0, 0, width, height)

      const numStripes = 12
      const sw = width / numStripes
      for (let i = 0; i < numStripes; i++) {
        if (i % 2 === 0) continue
        ctx.fillStyle = '#35a944'
        ctx.fillRect(i * sw, 0, sw, height)
      }
    }

    this.turfCache.set(key, canvas)
    return canvas
  }

  // ── TEXTURA DA BOLA OFICIAL (Padrão Telstar Hexágonos/Pentágonos) ───
  static getSoccerBallCanvas(size = 256): HTMLCanvasElement {
    if (this.ballTexture) return this.ballTexture

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    const cx = size / 2
    const cy = size / 2
    const r = size * 0.45
    const ink = '#141426'

    ctx.clearRect(0, 0, size, size)

    // Base branca chapada
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.clip()

    drawPolygon(ctx, cx, cy, 5, r * 0.34, '#20242e', ink, Math.max(2, size * 0.02))

    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2
      const px = cx + Math.cos(angle) * r * 0.7
      const py = cy + Math.sin(angle) * r * 0.7

      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(angle) * r * 0.34, cy + Math.sin(angle) * r * 0.34)
      ctx.lineTo(px, py)
      ctx.strokeStyle = ink
      ctx.lineWidth = Math.max(2, size * 0.018)
      ctx.stroke()

      drawPolygon(ctx, px, py, 6, r * 0.32, '#20242e', ink, Math.max(2, size * 0.016))
    }

    ctx.restore()

    // Contorno grosso cartoon
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.lineWidth = Math.max(4, size * 0.04)
    ctx.strokeStyle = ink
    ctx.stroke()

    this.ballTexture = canvas
    return canvas
  }

  // ── DISCOS DE JOGADORES COM BANDEIRAS E BISEL METÁLICO 3D ──────
  static getPlayerBadge(team: TeamKey, size = 128): HTMLCanvasElement {
    if (this.badgeCache.has(team)) return this.badgeCache.get(team)!

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    const ink = '#141426'

    const palettes: Record<TeamKey, { shirt: string; trim: string; pattern: 'solid' | 'stripes' | 'sash'; skin: string; hair: string }> = {
      brazil: { shirt: '#ffd23f', trim: '#0a8f45', pattern: 'solid', skin: '#f2c49b', hair: '#2b1b12' },
      usa: { shirt: '#ffffff', trim: '#2b4c9b', pattern: 'sash', skin: '#8d5524', hair: '#111111' },
      france: { shirt: '#2b4c9b', trim: '#ffffff', pattern: 'solid', skin: '#f1c27d', hair: '#111111' },
      argentina: { shirt: '#7fc4ff', trim: '#ffffff', pattern: 'stripes', skin: '#e0ac69', hair: '#3b2a1a' },
      barcelona: { shirt: '#a50044', trim: '#004d98', pattern: 'stripes', skin: '#f2c49b', hair: '#2b1b12' },
      cyber: { shirt: '#22b7ff', trim: '#ff4d7d', pattern: 'sash', skin: '#c68642', hair: '#0b0b0b' }
    }
    const p = palettes[team]

    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.scale(size / 128, size / 128)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    const rr = (x: number, y: number, w: number, h: number, rad: number) => {
      ctx.beginPath()
      ctx.moveTo(x + rad, y)
      ctx.arcTo(x + w, y, x + w, y + h, rad)
      ctx.arcTo(x + w, y + h, x, y + h, rad)
      ctx.arcTo(x, y + h, x, y, rad)
      ctx.arcTo(x, y, x + w, y, rad)
      ctx.closePath()
    }
    const paint = (draw: () => void, fill: string, lw = 3.5) => {
      draw()
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = lw
      ctx.strokeStyle = ink
      ctx.stroke()
    }

    // Disco/token do time atrás do personagem
    ctx.beginPath()
    ctx.arc(64, 64, 60, 0, Math.PI * 2)
    ctx.fillStyle = p.trim
    ctx.fill()
    ctx.lineWidth = 7
    ctx.strokeStyle = ink
    ctx.stroke()

    // Sombra no chão
    ctx.fillStyle = 'rgba(20,20,38,0.25)'
    ctx.beginPath()
    ctx.ellipse(64, 118, 30, 8, 0, 0, Math.PI * 2)
    ctx.fill()

    // Sapatos
    paint(() => rr(44, 100, 16, 16, 7), '#1b2440')
    paint(() => rr(68, 100, 16, 16, 7), '#1b2440')

    // Shorts
    paint(() => rr(40, 88, 48, 18, 8), p.trim)

    // Braços
    paint(() => rr(28, 62, 12, 30, 6), p.skin)
    paint(() => rr(88, 62, 12, 30, 6), p.skin)

    // Mangas
    paint(() => rr(32, 58, 14, 22, 7), p.trim)
    paint(() => rr(82, 58, 14, 22, 7), p.trim)

    // Camisa com padrão chapado
    rr(40, 56, 48, 40, 14)
    ctx.save()
    ctx.clip()
    ctx.fillStyle = p.shirt
    ctx.fillRect(40, 56, 48, 40)
    if (p.pattern === 'stripes') {
      ctx.fillStyle = p.trim
      for (let i = 0; i < 3; i++) ctx.fillRect(46 + i * 16, 56, 8, 40)
    } else if (p.pattern === 'sash') {
      ctx.save()
      ctx.translate(64, 76)
      ctx.rotate(-0.6)
      ctx.fillStyle = p.trim
      ctx.fillRect(-40, -7, 80, 14)
      ctx.restore()
    }
    if (team === 'cyber') drawStar(ctx, 64, 78, 5, 9, 4, '#ffffff')
    ctx.restore()

    // Contorno da camisa
    rr(40, 56, 48, 40, 14)
    ctx.lineWidth = 3.5
    ctx.strokeStyle = ink
    ctx.stroke()

    // Gola
    paint(() => { ctx.beginPath(); ctx.ellipse(64, 58, 12, 6, 0, 0, Math.PI * 2) }, p.trim, 2.5)

    // Pescoço
    paint(() => rr(58, 50, 12, 10, 4), p.skin, 2.5)

    // Orelhas
    paint(() => { ctx.beginPath(); ctx.arc(39, 42, 6, 0, Math.PI * 2) }, p.skin, 2.5)
    paint(() => { ctx.beginPath(); ctx.arc(89, 42, 6, 0, Math.PI * 2) }, p.skin, 2.5)

    // Cabeça grande
    paint(() => { ctx.beginPath(); ctx.arc(64, 38, 25, 0, Math.PI * 2) }, p.skin)

    // Cabelo
    ctx.fillStyle = p.hair
    ctx.beginPath()
    ctx.arc(64, 36, 26, Math.PI * 1.02, Math.PI * 1.98)
    ctx.fill()
    ctx.fillRect(40, 30, 10, 12)
    ctx.fillRect(78, 30, 10, 12)

    // Olhos
    ctx.fillStyle = ink
    ctx.beginPath(); ctx.arc(55, 40, 3.4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(73, 40, 3.4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(56, 39, 1.1, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(74, 39, 1.1, 0, Math.PI * 2); ctx.fill()

    // Sobrancelhas
    ctx.strokeStyle = ink
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(49, 33); ctx.lineTo(58, 32); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(70, 32); ctx.lineTo(79, 33); ctx.stroke()

    // Sorriso
    ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.arc(64, 46, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke()

    // Bochechas
    ctx.fillStyle = 'rgba(255,90,120,0.35)'
    ctx.beginPath(); ctx.arc(48, 48, 4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(80, 48, 4, 0, Math.PI * 2); ctx.fill()

    ctx.restore()

    this.badgeCache.set(team, canvas)
    return canvas
  }
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sides: number,
  radius: number,
  fillColor: string,
  strokeColor: string,
  lineWidth: number
) {
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
    const px = x + Math.cos(angle) * radius
    const py = y + Math.sin(angle) * radius
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()
  if (lineWidth > 0) {
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }
  ctx.restore()
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spikes: number,
  outerRadius: number,
  innerRadius: number,
  color: string
) {
  let rot = (Math.PI / 2) * 3
  let x = cx
  let y = cy
  const step = Math.PI / spikes

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(cx, cy - outerRadius)
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius
    y = cy + Math.sin(rot) * outerRadius
    ctx.lineTo(x, y)
    rot += step

    x = cx + Math.cos(rot) * innerRadius
    y = cy + Math.sin(rot) * innerRadius
    ctx.lineTo(x, y)
    rot += step
  }
  ctx.lineTo(cx, cy - outerRadius)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}
