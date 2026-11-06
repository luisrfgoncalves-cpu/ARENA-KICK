// ============================================================
//  bot.ts — IA de Elite para Bot (FSM + Antecipação Balística)
// ============================================================
import Matter from 'matter-js'
import { ArenaDimensions, Vec2, vlen, vnorm, vsub } from './physics'

type BotState = 'PATROL' | 'INTERCEPT' | 'ATTACK' | 'DEFEND' | 'POWER_SHOT'

export interface BotConfig {
  difficulty: 'easy' | 'medium' | 'hard'
  speed: number
  arena: ArenaDimensions
}

export class BotAI {
  private state: BotState = 'PATROL'
  private thinkTimer = 0
  private dashCooldown = 0
  private difficulty: 'easy' | 'medium' | 'hard'

  private reactionDelay: number
  private accuracyNoise: number
  private shotAggressiveness: number
  private dashChance: number

  constructor(private cfg: BotConfig) {
    this.difficulty = cfg.difficulty
    switch (cfg.difficulty) {
      case 'easy':
        this.reactionDelay = 0.28
        this.accuracyNoise = 45
        this.shotAggressiveness = 0.35
        this.dashChance = 0.15
        break
      case 'medium':
        this.reactionDelay = 0.12
        this.accuracyNoise = 18
        this.shotAggressiveness = 0.65
        this.dashChance = 0.4
        break
      case 'hard':
        this.reactionDelay = 0.03
        this.accuracyNoise = 4
        this.shotAggressiveness = 0.95
        this.dashChance = 0.75
        break
    }
  }

  update(
    dt: number,
    botBody: Matter.Body,
    ballBody: Matter.Body,
    playerBody: Matter.Body
  ): { move: Vec2; dash: boolean; powerShot: boolean } {
    this.thinkTimer -= dt
    this.dashCooldown = Math.max(0, this.dashCooldown - dt)

    const { x, y, w, h, goalTop, goalBot } = this.cfg.arena
    const botPos = botBody.position as Vec2
    const ballPos = ballBody.position as Vec2
    const ballVel = ballBody.velocity as Vec2

    const myGoalCenter: Vec2 = { x: x + w - 10, y: (goalTop + goalBot) / 2 }
    const enemyGoalCenter: Vec2 = { x: x + 10, y: (goalTop + goalBot) / 2 }

    const distToBall = vlen(vsub(ballPos, botPos))
    const distBallToMyGoal = vlen(vsub(ballPos, myGoalCenter))

    // FSM State transitions
    if (this.thinkTimer <= 0) {
      this.thinkTimer = this.reactionDelay

      if (distBallToMyGoal < w * 0.38 && ballVel.x > -1) {
        this.state = 'DEFEND'
      } else if (distToBall < 180 && ballPos.x < botPos.x + 40) {
        this.state = distToBall < 90 && this.difficulty === 'hard' ? 'POWER_SHOT' : 'ATTACK'
      } else if (distToBall < w * 0.6) {
        this.state = 'INTERCEPT'
      } else {
        this.state = 'PATROL'
      }
    }

    let targetPos: Vec2 = { x: botPos.x, y: botPos.y }
    let dash = false
    let powerShot = false

    const noise = () => (Math.random() - 0.5) * this.accuracyNoise

    switch (this.state) {
      case 'PATROL':
        targetPos = {
          x: x + w * 0.75,
          y: y + h * 0.5 + noise() * 0.5
        }
        break

      case 'DEFEND': {
        // Posicionar-se rigorosamente entre a bola e o centro do gol
        const ratio = 0.35
        targetPos = {
          x: myGoalCenter.x * (1 - ratio) + ballPos.x * ratio + noise(),
          y: Math.max(goalTop - 10, Math.min(goalBot + 10, myGoalCenter.y * (1 - ratio) + ballPos.y * ratio + noise()))
        }
        if (ballVel.x > 8 && this.dashCooldown <= 0 && Math.random() < this.dashChance) {
          dash = true
          this.dashCooldown = 1.2
        }
        break
      }

      case 'INTERCEPT': {
        // Antecipação de trajetória (Lead targeting)
        const predictionTicks = Math.min(25, distToBall / (this.cfg.speed * 0.8))
        targetPos = {
          x: ballPos.x + ballVel.x * predictionTicks + noise(),
          y: ballPos.y + ballVel.y * predictionTicks + noise()
        }
        break
      }

      case 'ATTACK': {
        // Ângulo ótimo para empurrar a bola em direção ao gol inimigo
        const dirToEnemyGoal = vnorm(vsub(enemyGoalCenter, ballPos))
        const strikeOffset = 32
        targetPos = {
          x: ballPos.x - dirToEnemyGoal.x * strikeOffset + noise(),
          y: ballPos.y - dirToEnemyGoal.y * strikeOffset + noise()
        }

        if (distToBall < 75 && this.dashCooldown <= 0 && Math.random() < this.dashChance) {
          dash = true
          this.dashCooldown = 1.4
        }
        break
      }

      case 'POWER_SHOT': {
        const dirToEnemyGoal = vnorm(vsub(enemyGoalCenter, ballPos))
        targetPos = {
          x: ballPos.x - dirToEnemyGoal.x * 25,
          y: ballPos.y - dirToEnemyGoal.y * 25
        }
        powerShot = Math.random() < this.shotAggressiveness
        break
      }
    }

    const diff = vsub(targetPos, botPos)
    const move = vnorm(diff)
    return { move, dash, powerShot }
  }
}
