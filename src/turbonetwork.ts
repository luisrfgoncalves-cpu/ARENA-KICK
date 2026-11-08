// ============================================================
//  turbonetwork.ts — Gerenciador de Rede do Turbo Soccer 3D (1v1 Host-Authoritative)
//  Protocolo: Inputs numerados (Client) + Snapshots autoritativos (Host 30Hz)
//  Com Client-Side Prediction, Server Reconciliation e Interpolação Suave
// ============================================================
import type { NetworkManager } from './network'

export const TURBO_PROTOCOL_VERSION = 1

export interface TurboInputPacket {
  type: 'turbo_input'
  protocolVersion: number
  inputSeq: number
  clientTime: number
  steer: number     // -1 (esq) a +1 (dir)
  throttle: number  // -1 (ré/freio) a +1 (aceleração)
  pitch: number     // -1 (frente/down) a +1 (trás/up)
  roll: number      // -1 a +1
  jump: boolean
  boost: boolean
  drift: boolean
  debugPos?: { x: number; y: number; z: number }
}

export interface TurboCarSnapshot {
  slot: number
  x: number; y: number; z: number
  yaw: number; pitch: number; rollAngle: number
  vx: number; vy: number; vz: number
  boost: number
  isBoosting: boolean
  isDemoed: boolean
}

export interface TurboWorldSnapshot {
  type: 'turbo_snapshot'
  protocolVersion: number
  snapshotSeq: number
  serverTick: number
  lastProcessedInputSeq: number
  timeRemainingSec: number
  scores: { orange: number; blue: number }
  ball: {
    x: number; y: number; z: number
    vx: number; vy: number; vz: number
  }
  cars: TurboCarSnapshot[]
}

export interface TurboReliableEvent {
  type: 'turbo_event'
  protocolVersion: number
  event: 'goal' | 'countdown' | 'reset' | 'match_end' | 'ping' | 'pong' | 'car_hit'
  data?: any
}

interface StoredSnapshot {
  snapshot: TurboWorldSnapshot
  receivedAt: number
}

export class TurboNetworkController {
  private network: NetworkManager
  public isHost = false

  // Sequenciamento de ticks e pacotes
  private inputSeq = 0
  private snapshotSeq = 0
  private serverTick = 0
  private lastProcessedInputSeq = 0

  // Host: Fila de inputs recebidos do cliente remoto
  private remoteClientInputs: TurboInputPacket[] = []
  public latestClientInput: TurboInputPacket | null = null

  // Cliente: Buffer de predição local para reconciliação
  private pendingInputs: Array<{
    seq: number
    input: TurboInputPacket
  }> = []

  // Cliente: Buffer de snapshots do Host para interpolação do carro remoto
  private snapshotBuffer: StoredSnapshot[] = []
  private readonly INTERPOLATION_DELAY_MS = 60 // Buffer de jitter de 60ms

  // Telemetria de Ping / RTT
  public currentPing = 0
  private pingTimer = 0
  private lastPingSentTime = 0

  // Callbacks de eventos confiáveis
  public onGoalEvent?: (scorer: 'orange' | 'blue', scores: { orange: number; blue: number }, ballPos: { x: number; y: number; z: number }) => void
  public onCountdownEvent?: (count: number) => void
  public onResetEvent?: () => void
  public onMatchEndEvent?: (winner: 'orange' | 'blue' | 'draw', scores: { orange: number; blue: number }) => void
  public onCarHitEvent?: (targetSlot: number, effect: 'freeze' | 'spin' | 'shock') => void
  public onPeerDisconnected?: () => void

  constructor(network: NetworkManager) {
    this.network = network
    this.isHost = network.isHost()

    this.setupListeners()
  }

  private setupListeners() {
    this.network.onDataReceived = (payload: any) => {
      if (!payload || payload.protocolVersion !== TURBO_PROTOCOL_VERSION) return

      if (payload.type === 'turbo_input' && this.isHost) {
        this.handleClientInputOnHost(payload as TurboInputPacket)
      } else if (payload.type === 'turbo_snapshot' && !this.isHost) {
        this.handleSnapshotOnClient(payload as TurboWorldSnapshot)
      } else if (payload.type === 'turbo_event') {
        this.handleReliableEvent(payload as TurboReliableEvent)
      }
    }

    const prevDisconnect = this.network.onDisconnected
    this.network.onDisconnected = () => {
      prevDisconnect?.()
      this.onPeerDisconnected?.()
    }

    const prevConnLost = this.network.onConnectionLost
    this.network.onConnectionLost = (reason) => {
      prevConnLost?.(reason)
      this.onPeerDisconnected?.()
    }
  }

  // ============================================================
  //  FLUXO DO CLIENTE: Envio de Inputs Numerados e Predição
  // ============================================================
  public sendClientInput(
    steer: number,
    throttle: number,
    pitch: number,
    roll: number,
    jump: boolean,
    boost: boolean,
    drift: boolean,
    debugPos?: { x: number; y: number; z: number }
  ): number {
    if (this.isHost) return 0

    this.inputSeq++
    const packet: TurboInputPacket = {
      type: 'turbo_input',
      protocolVersion: TURBO_PROTOCOL_VERSION,
      inputSeq: this.inputSeq,
      clientTime: performance.now(),
      steer,
      throttle,
      pitch,
      roll,
      jump,
      boost,
      drift,
      debugPos
    }

    // Armazena no buffer de predição para reconciliação
    this.pendingInputs.push({ seq: this.inputSeq, input: packet })
    if (this.pendingInputs.length > 120) this.pendingInputs.shift() // Evita estouro de memória

    // Envia ao Host via DataChannel rápido
    this.network.send(packet)
    return this.inputSeq
  }

  // ============================================================
  //  FLUXO DO HOST: Recepção de Inputs e Broadcast de Snapshots
  // ============================================================
  private handleClientInputOnHost(packet: TurboInputPacket) {
    // Descarta pacotes atrasados ou fora de ordem
    if (packet.inputSeq <= this.lastProcessedInputSeq) return
    this.remoteClientInputs.push(packet)
    this.latestClientInput = packet
  }

  /**
   * Host: Consome os inputs do cliente em ordem sequencial (FIFO).
   * Evita descarte de pacotes intermediários quando chegam em burst/rajada.
   * Se houver backlog excessivo (> 10 pacotes), retém os 10 mais recentes (política controlada).
   * Retorna até maxBatch pacotes (padrão 4) para processamento sequencial no frame atual.
   */
  public consumePendingClientInputsOnHost(maxBatch = 4): TurboInputPacket[] {
    if (!this.isHost) return []

    // Controle de backlog em picos de latência (mantém até 10 mais recentes)
    if (this.remoteClientInputs.length > 10) {
      this.remoteClientInputs = this.remoteClientInputs.slice(-10)
    }

    if (this.remoteClientInputs.length === 0) {
      // Se não há pacotes novos no buffer, retorna o último conhecido para manter continuidade
      return this.latestClientInput ? [this.latestClientInput] : []
    }

    // Retira da fila em ordem estrita de chegada
    const batch = this.remoteClientInputs.splice(0, maxBatch)
    const last = batch[batch.length - 1]
    if (last) {
      this.lastProcessedInputSeq = last.inputSeq
      this.latestClientInput = last
    }
    return batch
  }

  public consumeLatestClientInputOnHost(): TurboInputPacket | null {
    const list = this.consumePendingClientInputsOnHost(1)
    return list.length > 0 ? list[0] : null
  }

  public broadcastSnapshot(
    timeRemainingSec: number,
    scores: { orange: number; blue: number },
    ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
    cars: TurboCarSnapshot[]
  ) {
    if (!this.isHost) return

    this.serverTick++
    this.snapshotSeq++

    const snapshot: TurboWorldSnapshot = {
      type: 'turbo_snapshot',
      protocolVersion: TURBO_PROTOCOL_VERSION,
      snapshotSeq: this.snapshotSeq,
      serverTick: this.serverTick,
      lastProcessedInputSeq: this.lastProcessedInputSeq,
      timeRemainingSec,
      scores,
      ball,
      cars
    }

    this.network.send(snapshot)
  }

  // ============================================================
  //  FLUXO DO CLIENTE: Recepção de Snapshot e Reconciliação
  // ============================================================
  private handleSnapshotOnClient(snapshot: TurboWorldSnapshot) {
    // Descarta snapshots fora de ordem
    if (this.snapshotBuffer.length > 0) {
      const last = this.snapshotBuffer[this.snapshotBuffer.length - 1]
      if (snapshot.snapshotSeq <= last.snapshot.snapshotSeq) return
    }

    const now = performance.now()
    this.snapshotBuffer.push({ snapshot, receivedAt: now })

    // Mantém no máximo 10 snapshots recentes no buffer (~300ms)
    while (this.snapshotBuffer.length > 10) {
      this.snapshotBuffer.shift()
    }

    // Reconciliação dos inputs do cliente já processados pelo Host
    if (snapshot.lastProcessedInputSeq > 0) {
      this.pendingInputs = this.pendingInputs.filter((p) => p.seq > snapshot.lastProcessedInputSeq)
    }
  }

  // Retorna o snapshot mais recente confirmado pelo Host
  public getLatestServerSnapshot(): TurboWorldSnapshot | null {
    if (this.snapshotBuffer.length === 0) return null
    return this.snapshotBuffer[this.snapshotBuffer.length - 1].snapshot
  }

  // Interpolação suave do carro remoto (Host visto pelo Cliente)
  public getInterpolatedRemoteCar(slot: number): {
    pos: { x: number; y: number; z: number }
    yaw: number
    pitch: number
    rollAngle: number
    isBoosting: boolean
  } | null {
    if (this.snapshotBuffer.length === 0) return null

    const renderTime = performance.now() - this.INTERPOLATION_DELAY_MS

    // Se temos apenas 1 snapshot, retorna ele diretamente
    if (this.snapshotBuffer.length === 1) {
      const car = this.snapshotBuffer[0].snapshot.cars.find((c) => c.slot === slot)
      if (!car) return null
      return {
        pos: { x: car.x, y: car.y, z: car.z },
        yaw: car.yaw,
        pitch: car.pitch,
        rollAngle: car.rollAngle,
        isBoosting: car.isBoosting
      }
    }

    // Encontra os dois snapshots que cercam o renderTime
    let p0 = this.snapshotBuffer[0]
    let p1 = this.snapshotBuffer[this.snapshotBuffer.length - 1]

    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      if (this.snapshotBuffer[i].receivedAt <= renderTime && this.snapshotBuffer[i + 1].receivedAt >= renderTime) {
        p0 = this.snapshotBuffer[i]
        p1 = this.snapshotBuffer[i + 1]
        break
      }
    }

    const car0 = p0.snapshot.cars.find((c) => c.slot === slot)
    const car1 = p1.snapshot.cars.find((c) => c.slot === slot)
    if (!car0 || !car1) return null

    const span = Math.max(1, p1.receivedAt - p0.receivedAt)
    const alpha = Math.max(0, Math.min(1, (renderTime - p0.receivedAt) / span))

    // Lerp linear de posição
    const x = car0.x + (car1.x - car0.x) * alpha
    const y = car0.y + (car1.y - car0.y) * alpha
    const z = car0.z + (car1.z - car0.z) * alpha

    // Lerp angular cíclico (-PI a +PI)
    const lerpAngle = (a: number, b: number, t: number) => {
      let diff = (b - a) % (Math.PI * 2)
      if (diff > Math.PI) diff -= Math.PI * 2
      if (diff < -Math.PI) diff += Math.PI * 2
      return a + diff * t
    }

    return {
      pos: { x, y, z },
      yaw: lerpAngle(car0.yaw, car1.yaw, alpha),
      pitch: lerpAngle(car0.pitch, car1.pitch, alpha),
      rollAngle: lerpAngle(car0.rollAngle, car1.rollAngle, alpha),
      isBoosting: car1.isBoosting
    }
  }

  // ============================================================
  //  EVENTOS CONFIÁVEIS (GOLS, PLACAR, RESET, PING-PONG)
  // ============================================================
  public sendGoalEvent(scorer: 'orange' | 'blue', scores: { orange: number; blue: number }, ballPos: { x: number; y: number; z: number }) {
    if (!this.isHost) return
    const packet: TurboReliableEvent = {
      type: 'turbo_event',
      protocolVersion: TURBO_PROTOCOL_VERSION,
      event: 'goal',
      data: { scorer, scores, ballPos }
    }
    this.network.send(packet)
  }

  public sendResetEvent() {
    if (!this.isHost) return
    const packet: TurboReliableEvent = {
      type: 'turbo_event',
      protocolVersion: TURBO_PROTOCOL_VERSION,
      event: 'reset'
    }
    this.network.send(packet)
  }

  public sendCountdownEvent(count: number) {
    if (!this.isHost) return
    const packet: TurboReliableEvent = {
      type: 'turbo_event',
      protocolVersion: TURBO_PROTOCOL_VERSION,
      event: 'countdown',
      data: { count }
    }
    this.network.send(packet)
  }

  public sendMatchEndEvent(winner: 'orange' | 'blue' | 'draw', scores: { orange: number; blue: number }) {
    if (!this.isHost) return
    const packet: TurboReliableEvent = {
      type: 'turbo_event',
      protocolVersion: TURBO_PROTOCOL_VERSION,
      event: 'match_end',
      data: { winner, scores }
    }
    this.network.send(packet)
  }

  public broadcastCarHit(targetSlot: number, effect: 'freeze' | 'spin' | 'shock') {
    const packet: TurboReliableEvent = {
      type: 'turbo_event',
      protocolVersion: TURBO_PROTOCOL_VERSION,
      event: 'car_hit',
      data: { targetSlot, effect }
    }
    this.network.send(packet)
  }

  private handleReliableEvent(packet: TurboReliableEvent) {
    switch (packet.event) {
      case 'goal':
        if (!this.isHost && packet.data) {
          this.onGoalEvent?.(packet.data.scorer, packet.data.scores, packet.data.ballPos)
        }
        break
      case 'countdown':
        if (!this.isHost && packet.data) {
          this.onCountdownEvent?.(packet.data.count)
        }
        break
      case 'reset':
        if (!this.isHost) {
          this.onResetEvent?.()
        }
        break
      case 'match_end':
        if (!this.isHost && packet.data) {
          this.onMatchEndEvent?.(packet.data.winner, packet.data.scores)
        }
        break
      case 'car_hit':
        if (packet.data) {
          this.onCarHitEvent?.(packet.data.targetSlot, packet.data.effect)
        }
        break
      case 'ping':
        // Responde com Pong imediatamente
        this.network.send({
          type: 'turbo_event',
          protocolVersion: TURBO_PROTOCOL_VERSION,
          event: 'pong',
          data: { t: packet.data?.t }
        } as TurboReliableEvent)
        break
      case 'pong':
        if (packet.data?.t) {
          const rtt = performance.now() - packet.data.t
          this.currentPing = Math.max(1, Math.round(rtt / 2))
        }
        break
    }
  }

  public updatePing(dt: number) {
    this.pingTimer += dt
    if (this.pingTimer >= 2.0) { // Envia ping a cada 2 segundos
      this.pingTimer = 0
      this.lastPingSentTime = performance.now()
      this.network.send({
        type: 'turbo_event',
        protocolVersion: TURBO_PROTOCOL_VERSION,
        event: 'ping',
        data: { t: this.lastPingSentTime }
      } as TurboReliableEvent)
    }
  }
}

