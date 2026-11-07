// ============================================================
//  input.ts — Gerenciador de Teclado, Xbox Gamepad e Touch (nipplejs)
// ============================================================
import { GamepadManager } from './gamepad'

// Variáveis globais para joystick virtual touch (nipplejs)
let touchJoyX = 0
let touchJoyY = 0
let touchDash = false
let touchPower = false
let touchInitialized = false

export function initVirtualJoystick(container: HTMLElement = document.body) {
  if (touchInitialized) return
  if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) return
  touchInitialized = true

  import('nipplejs').then((m) => {
    const create = (m as any).default?.create || (m as any).create
    if (!create) return

    const zone = document.createElement('div')
    zone.id = 'virtual-joystick-zone'
    zone.style.position = 'fixed'
    zone.style.bottom = '24px'
    zone.style.left = '24px'
    zone.style.width = '140px'
    zone.style.height = '140px'
    zone.style.zIndex = '400'
    zone.style.pointerEvents = 'all'
    zone.style.display = 'none'
    container.appendChild(zone)

    // Botões de toque para Dash e Power
    const btnWrap = document.createElement('div')
    btnWrap.id = 'virtual-touch-buttons'
    btnWrap.style.position = 'fixed'
    btnWrap.style.bottom = '24px'
    btnWrap.style.right = '24px'
    btnWrap.style.display = 'none'
    btnWrap.style.gap = '12px'
    btnWrap.style.zIndex = '400'
    btnWrap.style.pointerEvents = 'all'

    btnWrap.innerHTML = `
      <button id="touch-btn-power" style="width:60px;height:60px;border-radius:50%;background:rgba(255,107,0,0.8);
        border:2px solid #ff6600;color:white;font-weight:900;font-size:12px;">CHUTE</button>
      <button id="touch-btn-dash" style="width:60px;height:60px;border-radius:50%;background:rgba(0,255,136,0.8);
        border:2px solid #00ff88;color:#000;font-weight:900;font-size:12px;">DASH</button>
    `
    container.appendChild(btnWrap)

    const btnP = document.getElementById('touch-btn-power')
    const btnD = document.getElementById('touch-btn-dash')
    btnP?.addEventListener('touchstart', (e) => { e.preventDefault(); touchPower = true }, { passive: false })
    btnP?.addEventListener('touchend', (e) => { e.preventDefault(); touchPower = false }, { passive: false })
    btnP?.addEventListener('touchcancel', () => { touchPower = false })
    btnD?.addEventListener('touchstart', (e) => { e.preventDefault(); touchDash = true }, { passive: false })
    btnD?.addEventListener('touchend', (e) => { e.preventDefault(); touchDash = false }, { passive: false })
    btnD?.addEventListener('touchcancel', () => { touchDash = false })

    const manager = create({
      zone,
      mode: 'static',
      position: { left: '70px', top: '70px' },
      color: '#00ff88',
      size: 90
    })

    manager.on('move', (_: any, data: any) => {
      if (data?.vector) {
        touchJoyX = data.vector.x || 0
        touchJoyY = -(data.vector.y || 0)
      }
    })

    manager.on('end', () => {
      touchJoyX = 0
      touchJoyY = 0
    })
  }).catch(() => {})
}

// Mostra/esconde os controles de toque do 2D (evita sobrepor menu e 3D)
export function setTouchControlsVisible(visible: boolean) {
  const zone = document.getElementById('virtual-joystick-zone')
  const buttons = document.getElementById('virtual-touch-buttons')
  const display = visible ? 'block' : 'none'
  if (zone) zone.style.display = display
  if (buttons) buttons.style.display = visible ? 'flex' : 'none'
}

export class InputManager {
  private keys = new Set<string>()
  private listeners: Array<[string, EventListener]> = []
  private gamepad = new GamepadManager()

  constructor(private mode: 'bot' | '2p' | 'online' = 'bot') {
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

  // ── P1: Teclado (WASD/Setas) + Controle Xbox ──────────────
  get p1(): PlayerInput {
    const gp = this.gamepad.getState()

    // No modo 2P as SETAS pertencem ao Jogador 2; no solo também controlam o P1
    const solo = this.mode !== '2p'
    const kbUp    = this.isDown('KeyW') || (solo && this.isDown('ArrowUp'))
    const kbDown  = this.isDown('KeyS') || (solo && this.isDown('ArrowDown'))
    const kbLeft  = this.isDown('KeyA') || (solo && this.isDown('ArrowLeft'))
    const kbRight = this.isDown('KeyD') || (solo && this.isDown('ArrowRight'))
    const kbDash  = this.isDown('Space') || this.isDown('ShiftLeft')
    const kbPower = this.isDown('KeyX')
    const kbShoot = this.isDown('KeyC') || this.isDown('KeyV') || (solo && this.isDown('KeyB'))

    // Suporte a Touch Joystick (nipplejs)
    const joyUp    = touchJoyY < -0.3
    const joyDown  = touchJoyY > 0.3
    const joyLeft  = touchJoyX < -0.3
    const joyRight = touchJoyX > 0.3

    if (gp.connected) {
      const gpUp    = gp.stickY < -0.3 || gp.dpadUp
      const gpDown  = gp.stickY > 0.3 || gp.dpadDown
      const gpLeft  = gp.steerX < -0.3 || gp.dpadLeft
      const gpRight = gp.steerX > 0.3 || gp.dpadRight
      const gpDash  = gp.jump || gp.rtThrottle > 0.4
      const gpPower = gp.handbrake || gp.ltBrake > 0.4 // LB ou LT para carregar chute forte
      const gpShoot = gp.boost || gp.roll // B ou X para chute direto e imediato para o gol!

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

