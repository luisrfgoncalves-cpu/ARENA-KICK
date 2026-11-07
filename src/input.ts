// ============================================================
//  input.ts — Gerenciador de Teclado, Xbox Gamepad e Touch Nativo (Pointer Events)
//  Suporte completo a Multitouch sem dependências externas (Android e iOS Safari)
// ============================================================
import { GamepadManager } from './gamepad'

// Variáveis globais para joystick virtual touch nativo
let touchJoyX = 0
let touchJoyY = 0
let touchDash = false
let touchPower = false
let touchInitialized = false

// Direção persistente do último movimento válido (para Dash/Chute não darem solavanco reto)
let lastValidDirection = { x: 1, y: 0 }

export function getLastValidDirection(): { x: number; y: number } {
  return { ...lastValidDirection }
}

export function setLastValidDirection(dir: { x: number; y: number }) {
  const len = Math.hypot(dir.x, dir.y)
  if (len > 0.05) {
    lastValidDirection = { x: dir.x / len, y: dir.y / len }
  }
}

let activeJoystickPointerId: number | null = null

export function initVirtualJoystick(container: HTMLElement = document.body) {
  if (touchInitialized) return
  if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) return
  touchInitialized = true

  // 1. Container da Zona do Analógico
  const zone = document.createElement('div')
  zone.id = 'virtual-joystick-zone'
  zone.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 24px;
    width: 130px;
    height: 130px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(0, 255, 136, 0.08) 0%, rgba(0, 0, 0, 0.35) 70%);
    border: 2px solid rgba(0, 255, 136, 0.3);
    box-shadow: 0 4px 16px rgba(0,0,0,0.5), inset 0 0 12px rgba(0,255,136,0.15);
    z-index: 400;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    display: none;
    align-items: center;
    justify-content: center;
    pointer-events: all;
  `

  // Knob (pino central que se move com o polegar)
  const knob = document.createElement('div')
  knob.id = 'virtual-joystick-knob'
  knob.style.cssText = `
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #00ff88, #008855);
    border: 2px solid #ffffff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.6);
    pointer-events: none;
    transition: transform 0.04s ease-out;
  `
  zone.appendChild(knob)
  container.appendChild(zone)

  // 2. Container dos Botões Virtuais de Ação
  const btnWrap = document.createElement('div')
  btnWrap.id = 'virtual-touch-buttons'
  btnWrap.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: none;
    gap: 14px;
    z-index: 400;
    pointer-events: all;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  `

  btnWrap.innerHTML = `
    <button id="touch-btn-power" style="
      width: 64px; height: 64px; border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #ff8800, #cc4400);
      border: 2px solid #ffffff; color: white; font-weight: 900; font-size: 11px;
      letter-spacing: 1px; box-shadow: 0 4px 10px rgba(0,0,0,0.6);
      touch-action: none; user-select: none; -webkit-user-select: none; outline: none;">
      CHUTE
    </button>
    <button id="touch-btn-dash" style="
      width: 64px; height: 64px; border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #00ff88, #009955);
      border: 2px solid #ffffff; color: #000; font-weight: 900; font-size: 11px;
      letter-spacing: 1px; box-shadow: 0 4px 10px rgba(0,0,0,0.6);
      touch-action: none; user-select: none; -webkit-user-select: none; outline: none;">
      DASH
    </button>
  `
  container.appendChild(btnWrap)

  // ── LÓGICA DO JOYSTICK (POINTER EVENTS NATIVOS) ─────────────
  const maxRadius = 42

  const updateJoystick = (clientX: number, clientY: number) => {
    const rect = zone.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    const dx = clientX - centerX
    const dy = clientY - centerY
    const dist = Math.hypot(dx, dy)

    const clampedDist = Math.min(dist, maxRadius)
    const angle = Math.atan2(dy, dx)

    const posX = Math.cos(angle) * clampedDist
    const posY = Math.sin(angle) * clampedDist

    knob.style.transform = `translate(${posX}px, ${posY}px)`

    if (dist > 6) {
      touchJoyX = posX / maxRadius
      touchJoyY = posY / maxRadius
      // Atualiza direção para Dash/Chute
      lastValidDirection = {
        x: Math.cos(angle),
        y: Math.sin(angle)
      }
    } else {
      touchJoyX = 0
      touchJoyY = 0
    }
  }

  const resetJoystick = () => {
    activeJoystickPointerId = null
    touchJoyX = 0
    touchJoyY = 0
    knob.style.transform = 'translate(0px, 0px)'
  }

  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    zone.setPointerCapture(e.pointerId)
    activeJoystickPointerId = e.pointerId
    updateJoystick(e.clientX, e.clientY)
  })

  zone.addEventListener('pointermove', (e) => {
    if (activeJoystickPointerId === e.pointerId) {
      e.preventDefault()
      updateJoystick(e.clientX, e.clientY)
    }
  })

  zone.addEventListener('pointerup', (e) => {
    if (activeJoystickPointerId === e.pointerId) {
      e.preventDefault()
      try { zone.releasePointerCapture(e.pointerId) } catch {}
      resetJoystick()
    }
  })

  zone.addEventListener('pointercancel', () => resetJoystick())

  // ── LÓGICA DOS BOTÕES MULTITOUCH (POINTER INDEPENDENTE) ─────
  const btnP = document.getElementById('touch-btn-power')
  const btnD = document.getElementById('touch-btn-dash')

  const bindButton = (el: HTMLElement | null, onPress: () => void, onRelease: () => void) => {
    if (!el) return
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      onPress()
      el.style.transform = 'scale(0.92)'
    })
    const release = (e: PointerEvent) => {
      e.preventDefault()
      try { el.releasePointerCapture(e.pointerId) } catch {}
      onRelease()
      el.style.transform = 'scale(1.0)'
    }
    el.addEventListener('pointerup', release)
    el.addEventListener('pointercancel', release)
  }

  bindButton(btnP, () => { touchPower = true }, () => { touchPower = false })
  bindButton(btnD, () => { touchDash = true }, () => { touchDash = false })
}

// Mostra/esconde os controles de toque do 2D (evita sobrepor menu e 3D)
export function setTouchControlsVisible(visible: boolean) {
  const zone = document.getElementById('virtual-joystick-zone')
  const buttons = document.getElementById('virtual-touch-buttons')
  const display = visible ? 'flex' : 'none'
  if (zone) zone.style.display = display
  if (buttons) buttons.style.display = display
}

export class InputManager {
  private keys = new Set<string>()
  private listeners: Array<[string, EventListener]> = []
  private gamepad = new GamepadManager()

  constructor(private mode: 'bot' | '2p' | 'online' | 'practice' = 'bot') {
    const down: EventListener = (e) => {
      this.keys.add((e as KeyboardEvent).code)
    }
    const up: EventListener = (e) => {
      this.keys.delete((e as KeyboardEvent).code)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    this.listeners = [['keydown', down], ['keyup', up]]
  }

  vibrate(duration = 150) {
    this.gamepad.vibrate(duration)
  }

  isDown(code: string) { return this.keys.has(code) }

  // ── P1: Teclado (WASD/Setas) + Controle Xbox + Touch Nativo ──
  get p1(): PlayerInput {
    const gp = this.gamepad.getState()

    // No modo 2P as SETAS pertencem ao Jogador 2; no solo/online também controlam o P1
    const solo = this.mode !== '2p'
    const kbUp    = this.isDown('KeyW') || (solo && this.isDown('ArrowUp'))
    const kbDown  = this.isDown('KeyS') || (solo && this.isDown('ArrowDown'))
    const kbLeft  = this.isDown('KeyA') || (solo && this.isDown('ArrowLeft'))
    const kbRight = this.isDown('KeyD') || (solo && this.isDown('ArrowRight'))
    const kbDash  = this.isDown('Space') || this.isDown('ShiftLeft')
    const kbPower = this.isDown('KeyX')
    const kbShoot = this.isDown('KeyC') || this.isDown('KeyV') || (solo && this.isDown('KeyB'))

    // Suporte a Touch Joystick Nativo (limite de zona morta 0.20)
    const joyUp    = touchJoyY < -0.20
    const joyDown  = touchJoyY > 0.20
    const joyLeft  = touchJoyX < -0.20
    const joyRight = touchJoyX > 0.20

    if (gp.connected) {
      const gpUp    = gp.stickY < -0.3 || gp.dpadUp
      const gpDown  = gp.stickY > 0.3 || gp.dpadDown
      const gpLeft  = gp.steerX < -0.3 || gp.dpadLeft
      const gpRight = gp.steerX > 0.3 || gp.dpadRight
      const gpDash  = gp.jump || gp.rtThrottle > 0.4
      const gpPower = gp.handbrake || gp.ltBrake > 0.4
      const gpShoot = gp.boost || gp.roll

      return {
        up:    kbUp    || gpUp    || joyUp,
        down:  kbDown  || gpDown  || joyDown,
        left:  kbLeft  || gpLeft  || joyLeft,
        right: kbRight || gpRight || joyRight,
        dash:  kbDash  || gpDash  || touchDash,
        power: kbPower || gpPower || touchPower,
        shoot: kbShoot || gpShoot
      }
    }

    return {
      up: kbUp || joyUp, down: kbDown || joyDown, left: kbLeft || joyLeft, right: kbRight || joyRight,
      dash: kbDash || touchDash, power: kbPower || touchPower, shoot: kbShoot
    }
  }

  // ── P2: Setas (ou Numpad) + Enter/Shift direito + N ─────
  get p2(): PlayerInput {
    return {
      up:    this.isDown('ArrowUp')    || this.isDown('Numpad8'),
      down:  this.isDown('ArrowDown')  || this.isDown('Numpad5'),
      left:  this.isDown('ArrowLeft')  || this.isDown('Numpad4'),
      right: this.isDown('ArrowRight') || this.isDown('Numpad6'),
      dash:  this.isDown('Enter') || this.isDown('NumpadEnter') || this.isDown('ShiftRight'),
      power: this.isDown('KeyN') || this.isDown('Slash') || this.isDown('ControlRight'),
      shoot: this.isDown('KeyM') || this.isDown('Numpad0') || this.isDown('Period')
    }
  }

  destroy() {
    for (const [evt, fn] of this.listeners) {
      window.removeEventListener(evt, fn)
    }
    this.keys.clear()
  }
}

export interface PlayerInput {
  up: boolean; down: boolean; left: boolean; right: boolean
  dash: boolean; power: boolean; shoot: boolean
}
