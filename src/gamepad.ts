// ============================================================
//  gamepad.ts — Suporte Nativo a Controles Xbox / PlayStation
//  Mapeamento Standard W3C para Gamepads USB e Bluetooth
//  Regra de Ouro: Analógico APENAS para direção; Aceleração APENAS via RT/LT
// ============================================================

export interface GamepadState {
  connected: boolean
  id: string
  // Analógico de Direção (Apenas Direção / Steer, sem acelerar)
  steerX: number    // Analógico Esquerdo X ou D-Pad
  stickY: number    // Analógico Esquerdo Y (para 2D e pitching aéreo)
  cameraX: number   // Analógico Direito X
  cameraY: number   // Analógico Direito Y
  // Gatilhos Analógicos
  rtThrottle: number // RT (Acelerar - Gatilho Direito)
  ltBrake: number    // LT (Freio / Ré - Gatilho Esquerdo)
  // Botões
  jump: boolean      // A (Pulo / Flip)
  boost: boolean     // B ou RB (Nitro Boost)
  handbrake: boolean // LB (Drift)
  lb: boolean        // LB (Botão de ombro esquerdo)
  rb: boolean        // RB (Botão de ombro direito)
  roll: boolean      // X (Barrel Roll)
  ballCam: boolean   // Y (Alternar Câmera)
  menu: boolean      // Start / Menu
  // D-Pad para Emotes e Navegação
  dpadUp: boolean
  dpadDown: boolean
  dpadLeft: boolean
  dpadRight: boolean
}

export class GamepadManager {
  private gamepadIndex: number | null = null
  private prevBallCamButton = false
  public onBallCamToggle?: () => void

  constructor() {
    window.addEventListener('gamepadconnected', (e) => {
      console.log('🎮 Controle conectado:', e.gamepad.id)
      this.gamepadIndex = e.gamepad.index
    })

    window.addEventListener('gamepaddisconnected', (e) => {
      console.log('🎮 Controle desconectado:', e.gamepad.id)
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null
      }
    })
  }

  getState(): GamepadState {
    const defaultState: GamepadState = {
      connected: false,
      id: '',
      steerX: 0,
      stickY: 0,
      cameraX: 0,
      cameraY: 0,
      rtThrottle: 0,
      ltBrake: 0,
      jump: false,
      boost: false,
      handbrake: false,
      lb: false,
      rb: false,
      roll: false,
      ballCam: false,
      menu: false,
      dpadUp: false,
      dpadDown: false,
      dpadLeft: false,
      dpadRight: false
    }

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : []
    let gp: Gamepad | null = null

    if (this.gamepadIndex !== null && gamepads[this.gamepadIndex]) {
      gp = gamepads[this.gamepadIndex]
    } else {
      for (const pad of gamepads) {
        if (pad && pad.connected) {
          gp = pad
          this.gamepadIndex = pad.index
          break
        }
      }
    }

    if (!gp) return defaultState

    const deadzone = (val: number, threshold = 0.15) => (Math.abs(val) > threshold ? val : 0)

    const axes = gp.axes
    const buttons = gp.buttons

    const btnA = buttons[0]?.pressed || false
    const btnB = buttons[1]?.pressed || false
    const btnX = buttons[2]?.pressed || false
    const btnY = buttons[3]?.pressed || false
    const btnLB = buttons[4]?.pressed || false
    const btnRB = buttons[5]?.pressed || false
    const btnLT = buttons[6]?.value ?? (buttons[6]?.pressed ? 1 : 0)
    const btnRT = buttons[7]?.value ?? (buttons[7]?.pressed ? 1 : 0)
    const btnStart = buttons[9]?.pressed || false

    const dpadUp = buttons[12]?.pressed || false
    const dpadDown = buttons[13]?.pressed || false
    const dpadLeft = buttons[14]?.pressed || false
    const dpadRight = buttons[15]?.pressed || false

    const rawSteerX = deadzone(axes[0] ?? 0)
    const finalSteerX = dpadLeft ? -1 : dpadRight ? 1 : rawSteerX
    const rawStickY = deadzone(axes[1] ?? 0)
    const finalStickY = dpadUp ? -1 : dpadDown ? 1 : rawStickY

    if (btnY && !this.prevBallCamButton) {
      if (this.onBallCamToggle) this.onBallCamToggle()
    }
    this.prevBallCamButton = btnY

    return {
      connected: true,
      id: gp.id,
      steerX: finalSteerX,
      stickY: finalStickY,
      cameraX: deadzone(axes[2] ?? 0),
      cameraY: deadzone(axes[3] ?? 0),
      rtThrottle: Math.max(0, btnRT),
      ltBrake: Math.max(0, btnLT),
      jump: btnA,
      boost: btnB,
      handbrake: btnLB,
      lb: btnLB,
      rb: btnRB,
      roll: btnX,
      ballCam: btnY,
      menu: btnStart,
      dpadUp,
      dpadDown,
      dpadLeft,
      dpadRight
    }
  }

  isAnyButtonPressed(): boolean {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : []
    const gp = this.gamepadIndex !== null ? gamepads[this.gamepadIndex] : gamepads[0]
    if (!gp) return false
    for (let i = 0; i < gp.buttons.length; i++) {
      if (gp.buttons[i]?.pressed) return true
    }
    return false
  }

  vibrate(duration = 150, strongMagnitude = 0.6, weakMagnitude = 0.4) {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : []
    const gp = this.gamepadIndex !== null ? gamepads[this.gamepadIndex] : null
    if (gp && (gp as any).vibrationActuator) {
      try {
        (gp as any).vibrationActuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration,
          weakMagnitude,
          strongMagnitude
        })
      } catch {}
    }
  }
}
