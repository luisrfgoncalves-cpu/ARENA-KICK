// ============================================================

// ============================================================
import { ArenaDimensions } from './physics'
import { ParticleSystem } from './particles'
import { AssetFactory, FieldTheme, TeamKey } from './assets'
import Matter from 'matter-js'

interface TrailPoint { x: number; y: number; speed: number; t: number }

export class Renderer {
  private ctx: CanvasRenderingContext2D
  W = 0
  H = 0

  private ballTrail: TrailPoint[] = []
  private ballAngle = 0
  private trailTimer = 0

  private shakeDur = 0
  private shakeMag = 0
  private flashAlpha = 0
  private flashColor = '#ffffff'

  private theme: FieldTheme = 'classic'
  private teamP1: TeamKey = 'brazil'
  private teamP2: TeamKey = 'usa'

  // Texturas HD em cache
  private turfCanvas: HTMLCanvasElement | null = null
  private ballCanvas: HTMLCanvasElement | null = null
  private p1Badge: HTMLCanvasElement | null = null
  private p2Badge: HTMLCanvasElement | null = null
  private obstacleBodies: any[] = []
  private obstacleImages: Record<string, HTMLImageElement> = {}

  private onResizeBound = () => this.resize()

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!
    this.resize()
    window.addEventListener('resize', this.onResizeBound)
  }

    drawObstacles(bodies: any[]) {
    for (const b of bodies) {
      const label = String(b.label || 'ob_barrel')
      const px = typeof b.x === 'number' ? b.x : (b.position ? b.position.x : 0)
      const py = typeof b.y === 'number' ? b.y : (b.position ? b.position.y : 0)
      const rad = typeof b.radius === 'number' ? b.radius : 16
      const ang = typeof b.angle === 'number' ? b.angle : 0

      this.ctx.save()
      this.ctx.translate(px, py)
      this.ctx.rotate(ang)

      const img = this.loadObstacleImage(label)
      if (img && img.complete && img.naturalWidth > 0) {
        this.ctx.drawImage(img, -rad, -rad, rad * 2, rad * 2)
      } else {
        // Renderização Cartoon Autêntica de Fallback
        if (label.includes('cone')) {
          // Cone de Trânsito Cartoon
          this.ctx.fillStyle = '#ff6600'
          this.ctx.beginPath()
          this.ctx.arc(0, 0, rad, 0, Math.PI * 2)
          this.ctx.fill()
          this.ctx.strokeStyle = '#141426'
          this.ctx.lineWidth = 3
          this.ctx.stroke()
          // Anel Branco Reflexivo
          this.ctx.fillStyle = '#ffffff'
          this.ctx.beginPath()
          this.ctx.arc(0, 0, rad * 0.55, 0, Math.PI * 2)
          this.ctx.fill()
          this.ctx.fillStyle = '#ff6600'
          this.ctx.beginPath()
          this.ctx.arc(0, 0, rad * 0.28, 0, Math.PI * 2)
          this.ctx.fill()
        } else if (label.includes('rock')) {
          // Pedra Cartoon
          this.ctx.fillStyle = '#64748b'
          this.ctx.beginPath()
          this.ctx.arc(0, 0, rad, 0, Math.PI * 2)
          this.ctx.fill()
          this.ctx.strokeStyle = '#1e293b'
          this.ctx.lineWidth = 3
          this.ctx.stroke()
          // Brilho superior
          this.ctx.fillStyle = '#94a3b8'
          this.ctx.beginPath()
          this.ctx.arc(-rad * 0.25, -rad * 0.25, rad * 0.45, 0, Math.PI * 2)
          this.ctx.fill()
        } else {
          // Barril de Aço Cartoon
          this.ctx.fillStyle = '#eab308'
          this.ctx.beginPath()
          this.ctx.arc(0, 0, rad, 0, Math.PI * 2)
          this.ctx.fill()
          this.ctx.strokeStyle = '#141426'
          this.ctx.lineWidth = 3.5
          this.ctx.stroke()
          // Aro metálico interno
          this.ctx.strokeStyle = '#ca8a04'
          this.ctx.lineWidth = 2.5
          this.ctx.beginPath()
          this.ctx.arc(0, 0, rad * 0.65, 0, Math.PI * 2)
          this.ctx.stroke()
          // Símbolo de Alerta Preto Cartoon
          this.ctx.fillStyle = '#141426'
          this.ctx.beginPath()
          this.ctx.arc(0, 0, rad * 0.25, 0, Math.PI * 2)
          this.ctx.fill()
        }
      }

      this.ctx.restore()
    }
  }

  destroy() {
    window.removeEventListener('resize', this.onResizeBound)
  }

  setObstacles(bodies: any[]) {
    this.obstacleBodies = bodies
  }

  private loadObstacleImage(key: string): HTMLImageElement {
    let img = this.obstacleImages[key]
    if (!img) {
      img = new Image()
      img.src = '/assets/obstacles/' + key + '.png'
      this.obstacleImages[key] = img
    }
    return img
  }


  setCustomization(theme: FieldTheme, p1: TeamKey, p2: TeamKey) {
    this.theme = theme
    this.teamP1 = p1
    this.teamP2 = p2
    this.turfCanvas = AssetFactory.getStadiumTurf(this.W, this.H, this.theme)
    this.p1Badge = AssetFactory.getPlayerBadge(this.teamP1, 128)
    this.p2Badge = AssetFactory.getPlayerBadge(this.teamP2, 128)
  }

  resize() {
    const maxW = Math.min(window.innerWidth, 960)
    const maxH = window.innerHeight - 70
    const ratio = 16 / 9
    let w = maxW
    let h = w / ratio
    if (h > maxH) { h = maxH; w = h * ratio }
    this.canvas.width = Math.floor(w)
    this.canvas.height = Math.floor(h)
    this.W = this.canvas.width
    this.H = this.canvas.height


    this.turfCanvas = AssetFactory.getStadiumTurf(this.W, this.H, this.theme)
    this.ballCanvas = AssetFactory.getSoccerBallCanvas(128)
    this.p1Badge = AssetFactory.getPlayerBadge(this.teamP1, 128)
    this.p2Badge = AssetFactory.getPlayerBadge(this.teamP2, 128)
  }

  triggerShake(mag: number, dur: number) {
    this.shakeMag = mag
    this.shakeDur = dur
  }

  triggerFlash(color: string, alpha = 0.45) {
    this.flashAlpha = alpha
    this.flashColor = color
  }

  beginFrame(dt: number) {
    const ctx = this.ctx
    let sx = 0
    let sy = 0

    if (this.shakeDur > 0) {
      sx = (Math.random() - 0.5) * this.shakeMag * 2
      sy = (Math.random() - 0.5) * this.shakeMag * 2
      this.shakeDur -= dt
      this.shakeMag *= Math.pow(0.88, dt * 60)
    }

    ctx.save()
    ctx.translate(sx, sy)


    ctx.fillStyle = '#060b14'
    ctx.fillRect(-20, -20, this.W + 40, this.H + 40)
  }

  endFrame(dt: number) {
    const ctx = this.ctx

    // Flash de gol emocionante
    if (this.flashAlpha > 0) {
      ctx.fillStyle = this.flashColor
      ctx.globalAlpha = this.flashAlpha
      ctx.fillRect(0, 0, this.W, this.H)
      ctx.globalAlpha = 1
      this.flashAlpha *= Math.pow(0.84, dt * 60)
      if (this.flashAlpha < 0.01) this.flashAlpha = 0
    }

    ctx.restore()
  }

  drawArena(a: ArenaDimensions) {
    const ctx = this.ctx
    const { x, y, w, h, goalTop, goalBot, goalDepth } = a
    const goalW = goalBot - goalTop


    if (this.turfCanvas) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
      ctx.drawImage(this.turfCanvas, x, y, w, h)
      ctx.restore()
    }


    ctx.strokeStyle = '#141426'
    ctx.lineWidth = 8
    ctx.strokeRect(x - 3, y - 3, w + 6, h + 6)


    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 4

    // Linha Lateral e de Fundo
    ctx.strokeRect(x, y, w, h)

    // Linha do Meio de Campo
    ctx.beginPath()
    ctx.moveTo(x + w / 2, y)
    ctx.lineTo(x + w / 2, y + h)
    ctx.stroke()


    const cr = Math.min(w, h) * 0.13
    ctx.beginPath()
    ctx.arc(x + w / 2, y + h / 2, cr, 0, Math.PI * 2)
    ctx.stroke()

    // Ponto da Marca da Cal Central
    ctx.beginPath()
    ctx.arc(x + w / 2, y + h / 2, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()


    const areaH = goalW * 1.6
    const areaW = w * 0.12
    const areaY = y + h / 2 - areaH / 2
    ctx.strokeRect(x, areaY, areaW, areaH)
    ctx.strokeRect(x + w - areaW, areaY, areaW, areaH)


    ctx.beginPath()
    ctx.arc(x + areaW, y + h / 2, cr * 0.7, -Math.PI / 3, Math.PI / 3)
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(x + w - areaW, y + h / 2, cr * 0.7, (Math.PI * 2) / 3, (Math.PI * 4) / 3)
    ctx.stroke()


    this.drawDetailedGoalNet(ctx, x - goalDepth, goalTop, goalDepth, goalW, '#00ff88', 'left')
    this.drawDetailedGoalNet(ctx, x + w, goalTop, goalDepth, goalW, '#ff2d78', 'right')


    const postR = 7
    const posts = [
      { px: x, py: goalTop },
      { px: x, py: goalBot },
      { px: x + w, py: goalTop },
      { px: x + w, py: goalBot },
    ]

    for (const p of posts) {
      // Sombra chapada
      ctx.beginPath()
      ctx.arc(p.px, p.py + 3, postR + 1, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(20,20,38,0.35)'
      ctx.fill()

      // Trave branca chapada com contorno grosso
      ctx.beginPath()
      ctx.arc(p.px, p.py, postR, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#141426'
      ctx.lineWidth = 3.5
      ctx.stroke()
    }
  }

  private drawDetailedGoalNet(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    gw: number,
    gh: number,
    glowColor: string,
    side: 'left' | 'right'
  ) {
    // Sombra interna da rede
    ctx.fillStyle = 'rgba(5, 10, 18, 0.7)'
    ctx.fillRect(gx, gy, gw, gh)


    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    ctx.lineWidth = 1.2

    const stepsX = 6
    const stepsY = 8

    for (let i = 0; i <= stepsX; i++) {
      const lx = gx + (gw / stepsX) * i
      ctx.beginPath()
      ctx.moveTo(lx, gy)
      ctx.lineTo(lx, gy + gh)
      ctx.stroke()
    }
    for (let j = 0; j <= stepsY; j++) {
      const ly = gy + (gh / stepsY) * j
      ctx.beginPath()
      ctx.moveTo(gx, ly)
      ctx.lineTo(gx + gw, ly)
      ctx.stroke()
    }

    // Moldura externa da trave chapada com contorno
    ctx.strokeStyle = glowColor
    ctx.lineWidth = 4

    ctx.beginPath()
    if (side === 'left') {
      ctx.moveTo(gx + gw, gy)
      ctx.lineTo(gx, gy)
      ctx.lineTo(gx, gy + gh)
      ctx.lineTo(gx + gw, gy + gh)
    } else {
      ctx.moveTo(gx, gy)
      ctx.lineTo(gx + gw, gy)
      ctx.lineTo(gx + gw, gy + gh)
      ctx.lineTo(gx, gy + gh)
    }
    ctx.stroke()
  }

  updateBallTrail(ball: Matter.Body, dt = 1 / 60) {
    const spd = Math.hypot(ball.velocity.x, ball.velocity.y)
    this.ballAngle += spd * 3 * dt
    this.trailTimer += dt
    if (this.trailTimer >= 1 / 30 && spd > 0.4) {
      this.trailTimer = 0
      this.ballTrail.push({ x: ball.position.x, y: ball.position.y, speed: spd, t: 1 })
    }
    this.ballTrail = this.ballTrail.map(p => ({ ...p, t: p.t - 7.2 * dt })).filter(p => p.t > 0)
    if (this.ballTrail.length > 14) this.ballTrail.shift()
  }

  // ── RASTRO DE FITA VIBRANTE CARTOON (RIBBON TRAIL) ──
  drawBallTrail(ballSpeed: number) {
    if (ballSpeed < 2) return
    const ctx = this.ctx
    const pts = this.ballTrail
    if (pts.length < 2) return

    // Fita contínua conectada
    ctx.save()
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const width = Math.max(3, 14 * p1.t)
      const alpha = p1.t * 0.65

      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.strokeStyle = p1.t > 0.6 ? `rgba(255, 220, 40, ${alpha})` : `rgba(255, 100, 0, ${alpha})`
      ctx.lineWidth = width
      ctx.lineCap = 'round'
      ctx.stroke()

      // Partículas de faíscas cartoon ao longo do rastro
      if (i % 2 === 0 && p1.t > 0.3) {
        ctx.beginPath()
        ctx.arc(p1.x + (Math.sin(i) * 5), p1.y + (Math.cos(i) * 5), 3.5 * p1.t, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${p1.t * 0.8})`
        ctx.fill()
      }
    }
    ctx.restore()
  }

  // ── SQUASH & STRETCH CARTOON NA BOLA 2D ──
  drawBall(ball: Matter.Body, r: number) {
    const ctx = this.ctx
    const { x, y } = ball.position
    const vx = ball.velocity.x || 0
    const vy = ball.velocity.y || 0
    const speed = Math.hypot(vx, vy)
    const moveAngle = Math.atan2(vy, vx)

    // Deformação dinâmica elástica: estica na direção do vetor e afina lateralmente
    const stretch = 1.0 + Math.min(0.55, (speed / 26) * 0.55)
    const squash = 1.0 / Math.sqrt(stretch)

    // Sombra oval deformada acompanhando a projeção no gramado
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(x, y + r * 0.68, r * 0.95 * stretch, r * 0.42 * squash, moveAngle * 0.35, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(20,20,38,0.38)'
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.translate(x, y)

    // Aplica Squash & Stretch orientado pelo movimento
    if (speed > 1.2) {
      ctx.rotate(moveAngle)
      ctx.scale(stretch, squash)
      ctx.rotate(-moveAngle)
    }

    ctx.rotate(this.ballAngle)

    if (this.ballCanvas) {
      ctx.drawImage(this.ballCanvas, -r, -r, r * 2, r * 2)
    }

    // Contorno comic book espesso e expressivo
    ctx.strokeStyle = '#141426'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.stroke()

    ctx.restore()
  }


  drawPlayer(
    body: Matter.Body,
    r: number,
    color: string,
    num: number,
    dashReady: boolean,
    powerPct: number,
    carrying = false
  ) {
    const ctx = this.ctx
    const { x, y } = body.position

    // Sombra chapada sob o personagem
    ctx.beginPath()
    ctx.ellipse(x, y + r * 0.85, r * 0.95, r * 0.34, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(20,20,38,0.28)'
    ctx.fill()

    // Halo de posse / condução de bola (BeatBall)
    if (carrying) {
      ctx.beginPath()
      ctx.arc(x, y, r + 10, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffd23f'
      ctx.lineWidth = 3.5
      ctx.stroke()
    }

    // Indicador de dash (tracejado cartoon)
    if (dashReady) {
      ctx.beginPath()
      ctx.arc(x, y, r + 7, 0, Math.PI * 2)
      ctx.strokeStyle = '#fff6e2'
      ctx.lineWidth = 4
      ctx.setLineDash([7, 5])
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Anel de carga do chute (chapado)
    if (powerPct > 0) {
      ctx.beginPath()
      ctx.arc(x, y, r + 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * powerPct)
      ctx.strokeStyle = '#ffd23f'
      ctx.lineWidth = 5
      ctx.stroke()
    }


    const badge = num === 1 ? this.p1Badge : this.p2Badge
    if (badge) {
      ctx.drawImage(badge, x - r, y - r, r * 2, r * 2)
    }
    // Contorno cartoon grosso no personagem
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#141426'
    ctx.lineWidth = 4
    ctx.stroke()
  }

  drawCountdown(text: string) {
    const ctx = this.ctx
    ctx.save()
    ctx.font = `900 ${this.H * 0.3}px 'Orbitron', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const px = this.W / 2
    const py = this.H / 2

    // Sombra dura deslocada + contorno grosso (cartoon)
    ctx.fillStyle = '#141426'
    ctx.fillText(text, px + 7, py + 7)

    ctx.lineWidth = 14
    ctx.strokeStyle = '#141426'
    ctx.strokeText(text, px, py)

    ctx.fillStyle = '#ffd23f'
    ctx.fillText(text, px, py)

    ctx.restore()
  }

  drawParticles(ps: ParticleSystem) {
    ps.draw(this.ctx)
  }
}
