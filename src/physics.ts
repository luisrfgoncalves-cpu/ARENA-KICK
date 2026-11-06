// ============================================================
//  physics.ts â€” Motor baseado em Matter.js (open-source)
//  github.com/liabru/matter-js  |  MIT License
//  + Wrapper próprio para CCD, traves e lógica de gol
// ============================================================
import Matter from 'matter-js'

export { Matter }

export interface Vec2 { x: number; y: number }
export function vlen(a: Vec2) { return Math.sqrt(a.x * a.x + a.y * a.y) }
export function vsub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y } }
export function vadd(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y } }
export function vscale(a: Vec2, s: number): Vec2 { return { x: a.x * s, y: a.y * s } }
export function vnorm(a: Vec2): Vec2 {
  const l = vlen(a); return l < 0.0001 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}
export function vdot(a: Vec2, b: Vec2) { return a.x * b.x + a.y * b.y }

export interface ArenaDimensions {
  x: number; y: number; w: number; h: number
  goalTop: number; goalBot: number
  goalDepth: number
}


export const LABEL = {
  BALL:        'ball',
  PLAYER1:     'player1',
  PLAYER2:     'player2',
  WALL:        'wall',
  GOAL_SENSOR: 'goal_sensor',
  POST:        'post',
  OBSTACLE:   'obstacle',
} as const


export function createWorld(arena: ArenaDimensions) {
  const engine = Matter.Engine.create({
    gravity: { x: 0, y: 0 },   // sem gravidade (visão de cima)
    positionIterations: 10,
    velocityIterations: 8,
  })

  const world = engine.world

  const walls = buildArenaWalls(arena)
  Matter.Composite.add(world, walls)

  return engine
}


export function buildArenaWalls(a: ArenaDimensions): Matter.Body[] {
  const { x, y, w, h, goalTop, goalBot, goalDepth } = a
  const T = 20       // espessura da parede
  const goalW = goalBot - goalTop
  const postR = 8    // raio dos postes

  const opts = { isStatic: true, friction: 0, restitution: 0.6, label: LABEL.WALL }
  const postOpts = { isStatic: true, friction: 0, restitution: 0.5, label: LABEL.POST }

  return [
    // Parede superior
    Matter.Bodies.rectangle(x + w/2, y - T/2, w + T*2, T, opts),
    // Parede inferior
    Matter.Bodies.rectangle(x + w/2, y + h + T/2, w + T*2, T, opts),

    // Parede esquerda ACIMA do gol
    Matter.Bodies.rectangle(x - T/2, y + (goalTop - y)/2, T, goalTop - y, opts),
    // Parede esquerda ABAIXO do gol
    Matter.Bodies.rectangle(x - T/2, goalBot + (y + h - goalBot)/2, T, y + h - goalBot, opts),

    // Parede direita ACIMA do gol
    Matter.Bodies.rectangle(x + w + T/2, y + (goalTop - y)/2, T, goalTop - y, opts),
    // Parede direita ABAIXO do gol
    Matter.Bodies.rectangle(x + w + T/2, goalBot + (y + h - goalBot)/2, T, y + h - goalBot, opts),

    // â”€â”€ FUNDO das balizas (parede traseira) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Fundo gol esquerdo
    Matter.Bodies.rectangle(x - goalDepth, (goalTop + goalBot)/2, T, goalW, opts),
    // Fundo gol direito
    Matter.Bodies.rectangle(x + w + goalDepth, (goalTop + goalBot)/2, T, goalW, opts),


    // Gol esquerdo â€” poste superior
    Matter.Bodies.circle(x, goalTop, postR, postOpts),
    // Gol esquerdo â€” poste inferior
    Matter.Bodies.circle(x, goalBot, postR, postOpts),
    // Gol direito â€” poste superior
    Matter.Bodies.circle(x + w, goalTop, postR, postOpts),
    // Gol direito â€” poste inferior
    Matter.Bodies.circle(x + w, goalBot, postR, postOpts),
  ]
}

// â”€â”€â”€ Sensor de Gol (trigger zone) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Field obstacles (Barrels, Cones, Rocks) - cartoon style
  export function createObstacles(a: ArenaDimensions): Matter.Body[] {
    const { x, y, w, h } = a
    const cx = x + w / 2
    const cy = y + h / 2
    const mk = (px: number, py: number, r: number, label: string) => Matter.Bodies.circle(px, py, r, { isStatic: true, friction: 0, restitution: 0.7, label })
    return [
      mk(cx - 58, cy, 20, 'ob_barrel'),
      mk(cx + 58, cy, 20, 'ob_barrel'),
      mk(cx - 24, cy - 58, 16, 'ob_cone'),
      mk(cx - 24, cy + 58, 16, 'ob_cone'),
      mk(cx + 24, cy - 58, 14, 'ob_rock'),
      mk(cx + 24, cy + 58, 14, 'ob_rock'),
    ]
  }

export function createGoalSensors(a: ArenaDimensions) {
  const { x, y, w, h, goalTop, goalBot, goalDepth } = a
  const goalW = goalBot - goalTop

  const opts = {
    isStatic: true, isSensor: true,
    friction: 0, restitution: 0, collisionFilter: { mask: 0 }
  }

  const leftSensor = Matter.Bodies.rectangle(
    x - goalDepth/2, (goalTop + goalBot)/2,
    goalDepth, goalW,
    { ...opts, label: 'goal_left' }
  )

  const rightSensor = Matter.Bodies.rectangle(
    x + w + goalDepth/2, (goalTop + goalBot)/2,
    goalDepth, goalW,
    { ...opts, label: 'goal_right' }
  )

  return { leftSensor, rightSensor }
}

// â”€â”€â”€ Corpo da Bola â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function createBall(x: number, y: number, r: number): Matter.Body {
  return Matter.Bodies.circle(x, y, r, {
    label: LABEL.BALL,
    frictionAir: 0.008,
    friction: 0.001,
    restitution: 0.85,
    mass: 1,
    collisionFilter: { category: 0x0001, mask: 0xFFFF },
  })
}

// â”€â”€â”€ Corpo do Jogador â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function createPlayer(x: number, y: number, r: number, label: string): Matter.Body {
  return Matter.Bodies.circle(x, y, r, {
    label,
    frictionAir: 0.14,
    friction: 0.05,
    restitution: 0.4,
    mass: 2.8,
    inertia: Infinity,  // sem rotação de corpo rígido
    collisionFilter: { category: 0x0002, mask: 0xFFFF },
  })
}

// â”€â”€â”€ Clamp de velocidade â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function clampBodySpeed(body: Matter.Body, maxSpeed: number) {
  const spd = vlen(body.velocity as Vec2)
  if (spd > maxSpeed) {
    Matter.Body.setVelocity(body, {
      x: (body.velocity.x / spd) * maxSpeed,
      y: (body.velocity.y / spd) * maxSpeed,
    })
  }
}


export function isInsideSensor(ball: Matter.Body, sensor: Matter.Body): boolean {
  const b = ball.position
  const s = sensor.bounds
  return b.x >= s.min.x && b.x <= s.max.x &&
         b.y >= s.min.y && b.y <= s.max.y
}
