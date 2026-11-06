// ============================================================
//  particles.ts — Sistema de partículas para efeitos visuais
// ============================================================
import { Vec2 } from './physics'

export interface Particle {
  x: number; y: number
  vx: number; vy: number
  life: number         // 0–1 (1 = nasceu, 0 = morreu)
  decay: number        // quão rápido morre
  size: number
  color: string
  shape: 'circle' | 'star' | 'spark'
  rotation: number
  rotSpeed: number
  gravity: number
}

export class ParticleSystem {
  particles: Particle[] = []

  emit(x: number, y: number, count: number, options: Partial<Particle> & { colors?: string[] }) {
    const colors = options.colors ?? ['#ffe600','#ff6b00','#ff2d78','#00ff88','#00cfff']
    for (let i = 0; i < count; i++) {
      const angle  = Math.random() * Math.PI * 2
      const speed  = (options.vx !== undefined ? 0 : Math.random() * 300 + 80)
      const color  = colors[Math.floor(Math.random() * colors.length)]
      this.particles.push({
        x, y,
        vx: options.vx !== undefined ? options.vx + (Math.random()-0.5)*60 : Math.cos(angle)*speed,
        vy: options.vy !== undefined ? options.vy + (Math.random()-0.5)*60 : Math.sin(angle)*speed,
        life:     1,
        decay:    options.decay ?? (Math.random() * 1.5 + 1.0),
        size:     options.size  ?? (Math.random() * 6 + 3),
        color,
        shape:    options.shape ?? (Math.random() < 0.5 ? 'circle' : 'spark'),
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random()-0.5) * 8,
        gravity:  options.gravity ?? 200,
      })
    }
  }

  emitGoal(x: number, y: number) {
    this.emit(x, y, 60, {
      colors: ['#ffe600','#ff6b00','#ff2d78','#ffffff','#00ff88'],
      size: 8, decay: 0.7, gravity: 180, shape: 'star'
    })
    this.emit(x, y, 40, {
      colors: ['#ffffff','#ffe600'],
      size: 4, decay: 1.2, gravity: 220, shape: 'spark'
    })
  }

  emitCometFlame(x: number, y: number, vx: number, vy: number) {
    this.emit(x, y, 4, {
      colors: ['#ffe600', '#ff6b00', '#ff2d78'],
      vx: -vx * 0.25 + (Math.random() - 0.5) * 30,
      vy: -vy * 0.25 + (Math.random() - 0.5) * 30,
      size: 7,
      decay: 3.5,
      gravity: 0,
      shape: 'circle'
    })
  }

  emitHit(x: number, y: number, vx: number, vy: number) {
    this.emit(x, y, 14, {
      colors: ['#ffffff','#00cfff','#00ff88'],
      vx: vx*0.3, vy: vy*0.3,
      size: 4, decay: 2.5, gravity: 100, shape: 'spark'
    })
  }

  emitDash(x: number, y: number, vx: number, vy: number) {
    this.emit(x, y, 10, {
      colors: ['#00cfff','#ffffff'],
      vx: -vx*0.4, vy: -vy*0.4,
      size: 5, decay: 3, gravity: 50, shape: 'circle'
    })
  }

  emitPowerShot(x: number, y: number, vx: number, vy: number) {
    this.emit(x, y, 30, {
      colors: ['#ff2d78','#ffe600','#ff6b00'],
      vx: -vx*0.5, vy: -vy*0.5,
      size: 7, decay: 1.5, gravity: 80, shape: 'star'
    })
  }

  update(dt: number) {
    this.particles = this.particles.filter(p => p.life > 0)
    for (const p of this.particles) {
      p.x  += p.vx * dt
      p.y  += p.vy * dt
      p.vy += p.gravity * dt
      p.life -= p.decay * dt
      p.rotation += p.rotSpeed * dt
      p.vx *= 0.97
      p.vy *= 0.97
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      if (p.life <= 0) continue
      const alpha = Math.max(0, p.life)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)

      if (p.shape === 'circle') {
        ctx.beginPath()
        ctx.arc(0, 0, p.size * p.life, 0, Math.PI*2)
        ctx.fillStyle = p.color
        ctx.fill()
      } else if (p.shape === 'spark') {
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(-p.vx * 0.015, -p.vy * 0.015)
        ctx.strokeStyle = p.color
        ctx.lineWidth = p.size * 0.5 * p.life
        ctx.stroke()
      } else {
        // star
        ctx.beginPath()
        const s = p.size * p.life
        for (let i = 0; i < 5; i++) {
          const a = (i/5)*Math.PI*2 - Math.PI/2
          const b = a + Math.PI/5
          ctx.lineTo(Math.cos(a)*s, Math.sin(a)*s)
          ctx.lineTo(Math.cos(b)*(s*0.4), Math.sin(b)*(s*0.4))
        }
        ctx.closePath()
        ctx.fillStyle = p.color
        ctx.fill()
      }
      ctx.restore()
    }
  }
}

