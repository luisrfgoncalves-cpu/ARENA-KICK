// ============================================================
//  network.ts — Multiplayer Online P2P WebRTC Multi-Player (PeerJS)
//  Com Handshake Bilateral Estrito, Heartbeat Bidirecional e Servidores ICE Seguros
// ============================================================
import { Peer, DataConnection } from 'peerjs'
import type { TeamKey } from './assets'

export type NetworkState =
  | 'IDLE'
  | 'CONNECTING'
  | 'DATA_CHANNEL_OPEN'
  | 'HANDSHAKING'
  | 'CLIENT_READY'
  | 'HOST_READY'
  | 'MATCH_READY'
  | 'MATCH_RUNNING'
  | 'CONNECTION_LOST'
  | 'FAILED'

export interface NetPlayerState {
  slot: number
  x: number
  y: number
  z?: number
  yaw?: number
  pitch?: number
  roll?: number
  vx: number
  vy: number
  vz?: number
  dash?: boolean
  boost?: number
}

export interface NetSyncPayload {
  t: number
  slot?: number
  players?: NetPlayerState[]
  p1?: { x: number; y: number; vx: number; vy: number; dash: boolean }
  p2?: { x: number; y: number; vx: number; vy: number; dash: boolean }
  p3?: { x: number; y: number; vx: number; vy: number; dash: boolean }
  p4?: { x: number; y: number; vx: number; vy: number; dash: boolean }
  ball?: { x: number; y: number; z?: number; vx: number; vy: number; vz?: number }
  scores?: { p1: number; p2: number }
  event?: 'goal' | 'countdown' | 'rematch' | 'slot_assign' | 'start_game' | 'room_full' | 'handshake' | 'heartbeat'
  message?: string
  assignedSlot?: number
  totalPlayers?: number
  gameType?: 'beatball' | 'turbo'
  format?: '1v1' | '2v2' | '3v3' | '4v4'
  whoScored?: 'p1' | 'p2'
  isSpectator?: boolean
  hostTeam?: TeamKey
  countdown?: number
  // Handshake & Heartbeat
  handshakePhase?: 'CLIENT_HELLO' | 'HOST_ACK' | 'CLIENT_READY' | 'HOST_READY' | 'MATCH_READY' | 'MATCH_CONFIRM'
  seq?: number
  clientTime?: number
  hostTime?: number
  rtt?: number
  heartbeatId?: number
  isHeartbeatAck?: boolean
}

// STUNs globais padrão para tentativa direta sem expor nenhuma chave
const DEFAULT_FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

/**
 * Consulta a rota serverless segura da Vercel para obter servidores TURN/STUN com credenciais temporárias.
 * Se a rota falhar ou não estiver configurada, faz fallback seguro para STUNs globais.
 */
async function fetchSafeIceServers(): Promise<RTCIceServer[]> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3500)
    const res = await fetch('/api/turn-credentials', { signal: controller.signal })
    clearTimeout(timeout)

    if (res.ok) {
      const data = await res.json()
      if (data.configured && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        return data.iceServers
      }
    }
  } catch {
    // Falha silenciosa de fetch serverless — usa STUNs de fallback
  }
  return DEFAULT_FALLBACK_ICE_SERVERS
}

export class NetworkManager {
  private peer: Peer | null = null
  private conns: Map<string, DataConnection> = new Map() // Múltiplas conexões para o Host
  private hostConn: DataConnection | null = null         // Conexão do Cliente com o Host
  private isHostPlayer = false
  public myId = ''
  public mySlot = 0
  public isSpectator = false
  public maxPlayers = 2

  // Máquina de estados da rede
  private state: NetworkState = 'IDLE'
  public currentRtt = 0

  // Timers de Handshake e Heartbeat
  private handshakeTimeoutTimer: any = null
  private heartbeatIntervalTimer: any = null
  private heartbeatCheckTimer: any = null
  private lastHeartbeatReceived = 0
  private heartbeatSeq = 0

  // Callbacks de eventos
  public onStateChange?: (state: NetworkState, rtt?: number) => void
  public onConnected?: (isHost: boolean) => void
  public onHostReady?: (rtt: number, clientPeerId: string) => void
  public onMatchStart?: (payload: NetSyncPayload) => void
  public onDataReceived?: (data: NetSyncPayload) => void
  public onDisconnected?: () => void
  public onConnectionLost?: (reason: string) => void
  public onError?: (err: string) => void
  public onPlayerCountChange?: (count: number) => void

  private setState(newState: NetworkState, rtt?: number) {
    this.state = newState
    if (rtt !== undefined) this.currentRtt = rtt
    this.onStateChange?.(newState, this.currentRtt)
  }

  public getState(): NetworkState {
    return this.state
  }

  async init(customId?: string): Promise<string> {
    this.setState('CONNECTING')
    const iceServers = await fetchSafeIceServers()

    const peerOptions = {
      config: {
        iceServers
      }
    }

    return new Promise((resolve, reject) => {
      this.peer = customId ? new Peer(customId, peerOptions) : new Peer(peerOptions)

      this.peer.on('open', (id) => {
        this.myId = id
        this.setState('IDLE')
        resolve(id)
      })

      this.peer.on('connection', (connection) => {
        this.isHostPlayer = true
        this.setupHostConnection(connection)
      })

      this.peer.on('error', (err) => {
        console.error('PeerJS error:', err)
        this.setState('FAILED')
        const msg = err.message || 'Erro de conexão P2P'
        this.onError?.(msg)
        reject(err)
      })
    })
  }

  joinRoom(hostRoomId: string, asSpectator = false): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) {
        reject(new Error('Peer não inicializado.'))
        return
      }

      this.isHostPlayer = false
      this.isSpectator = asSpectator
      this.setState('CONNECTING')

      const connection = this.peer.connect(hostRoomId, {
        reliable: true // Canal ordenado e confiável para Handshake seguro
      })

      // Timeout inicial de conexão WebRTC (8 segundos)
      const timeout = setTimeout(() => {
        this.setState('FAILED')
        const msg = 'Tempo limite de conexão esgotado ao buscar a sala do host.'
        this.onError?.(msg)
        reject(new Error(msg))
      }, 8000)

      connection.on('open', () => {
        clearTimeout(timeout)
        this.hostConn = connection
        this.setState('DATA_CHANNEL_OPEN')
        this.setupClientConnection(connection)
        resolve()
      })

      connection.on('error', (err) => {
        clearTimeout(timeout)
        this.setState('FAILED')
        const msg = 'Falha ao conectar na sala do host.'
        this.onError?.(msg)
        reject(err)
      })
    })
  }

  // ============================================================
  //  FLUXO DO HOST: Recepção de Cliente e Handshake Bilateral
  // ============================================================
  private setupHostConnection(conn: DataConnection) {
    const slot = this.conns.size + 1
    this.conns.set(conn.peer, conn)

    conn.on('open', () => {
      this.setState('DATA_CHANNEL_OPEN')

      // Se a sala exceder maxPlayers, rejeita com evento room_full
      const activePlayers = Array.from(this.conns.values()).filter((c: any) => !c.isSpectator).length + 1
      if (activePlayers > this.maxPlayers) {
        conn.send({
          t: performance.now(),
          event: 'room_full',
          message: `A sala atingiu o limite de ${this.maxPlayers} jogadores.`
        } as NetSyncPayload)
        setTimeout(() => {
          this.conns.delete(conn.peer)
          conn.close()
        }, 300)
        return
      }

      // Inicia timer de proteção de Handshake (8 segundos para concluir todo o ciclo)
      this.startHandshakeTimeout()
      this.setState('HANDSHAKING')
    })

    conn.on('data', (data) => {
      const payload = data as NetSyncPayload

      // Handshake Bilateral
      if (payload.event === 'handshake') {
        this.handleHostHandshake(conn, payload)
        return
      }

      // Heartbeat Bidirecional (ACK recebido do Cliente)
      if (payload.event === 'heartbeat' && payload.isHeartbeatAck) {
        this.lastHeartbeatReceived = performance.now()
        if (payload.clientTime) {
          const rtt = Math.max(1, Math.round(performance.now() - payload.clientTime))
          this.currentRtt = rtt
        }
        return
      }

      if (payload.event === 'slot_assign' && payload.isSpectator) {
        ;(conn as any).isSpectator = true
      }

      this.onDataReceived?.(payload)

      // Re-transmite para os outros clientes (Star Topology relay)
      for (const [peerId, otherConn] of this.conns) {
        if (peerId !== conn.peer && otherConn.open) {
          otherConn.send(payload)
        }
      }
    })

    conn.on('close', () => {
      this.conns.delete(conn.peer)
      this.notifyPlayerCount()
      if (this.state === 'MATCH_RUNNING') {
        this.handleConnectionDrop('O adversário desconectou da partida.')
      }
    })

    conn.on('error', (err) => {
      console.error('[Host DataConn Error]', err)
      this.conns.delete(conn.peer)
      this.notifyPlayerCount()
    })
  }

  // ============================================================
  //  FLUXO DO CLIENTE: Envio de Hello e Confirmação de Ready
  // ============================================================
  private setupClientConnection(conn: DataConnection) {
    this.startHandshakeTimeout()
    this.setState('HANDSHAKING')

    // Passo 1: Cliente dispara CLIENT_HELLO com timestamp de origem
    conn.send({
      t: performance.now(),
      event: 'handshake',
      handshakePhase: 'CLIENT_HELLO',
      seq: 1,
      clientTime: performance.now()
    } as NetSyncPayload)

    conn.on('data', (data) => {
      const payload = data as NetSyncPayload

      // Handshake Bilateral
      if (payload.event === 'handshake') {
        this.handleClientHandshake(conn, payload)
        return
      }

      // Heartbeat Bidirecional (Ping recebido do Host)
      if (payload.event === 'heartbeat' && !payload.isHeartbeatAck) {
        this.lastHeartbeatReceived = performance.now()
        // Responde ACK imediatamente para o Host calcular RTT
        conn.send({
          t: performance.now(),
          event: 'heartbeat',
          isHeartbeatAck: true,
          heartbeatId: payload.heartbeatId,
          clientTime: payload.clientTime
        } as NetSyncPayload)
        return
      }

      if (payload.event === 'room_full') {
        this.setState('FAILED')
        this.onError?.(payload.message || 'Sala cheia! Limite de jogadores atingido.')
        conn.close()
        return
      }

      if (payload.event === 'slot_assign' && payload.assignedSlot !== undefined) {
        this.mySlot = payload.assignedSlot
        if (payload.totalPlayers && this.onPlayerCountChange) {
          this.onPlayerCountChange(payload.totalPlayers)
        }
      }

      this.onDataReceived?.(payload)
    })

    conn.on('close', () => {
      if (this.state === 'MATCH_RUNNING') {
        this.handleConnectionDrop('O host encerrou ou desconectou da partida.')
      } else {
        this.onDisconnected?.()
      }
    })
  }

  // ============================================================
  //  MÁQUINA DE ESTADOS DO HANDSHAKE BILATERAL
  // ============================================================
  private handleHostHandshake(conn: DataConnection, payload: NetSyncPayload) {
    if (payload.handshakePhase === 'CLIENT_HELLO') {
      // Passo 2: Host responde HOST_ACK com eco do tempo do cliente
      conn.send({
        t: performance.now(),
        event: 'handshake',
        handshakePhase: 'HOST_ACK',
        seq: 2,
        clientTime: payload.clientTime,
        hostTime: performance.now()
      } as NetSyncPayload)
      return
    }

    if (payload.handshakePhase === 'CLIENT_READY') {
      // Passo 4: Cliente comprovou RTT e confirmou que está pronto
      this.clearHandshakeTimeout()
      const rtt = payload.rtt || 0
      this.currentRtt = rtt
      this.setState('HOST_READY', rtt)

      // Atribui slot e notifica contagem
      conn.send({
        t: performance.now(),
        event: 'slot_assign',
        assignedSlot: 1,
        totalPlayers: this.conns.size + 1
      } as NetSyncPayload)

      this.notifyPlayerCount()
      this.onConnected?.(true)
      this.onHostReady?.(rtt, conn.peer)
      return
    }

    if (payload.handshakePhase === 'MATCH_CONFIRM') {
      // Passo 6: Cliente confirmou MATCH_READY — Inicia a partida em ambos!
      this.setState('MATCH_RUNNING')
      this.startHeartbeat(true)
      this.onMatchStart?.(payload)
      return
    }
  }

  private handleClientHandshake(conn: DataConnection, payload: NetSyncPayload) {
    if (payload.handshakePhase === 'HOST_ACK') {
      // Passo 3: Cliente recebe HOST_ACK, calcula RTT e envia CLIENT_READY
      const rtt = Math.max(1, Math.round(performance.now() - (payload.clientTime || performance.now())))
      this.currentRtt = rtt
      this.setState('CLIENT_READY', rtt)

      conn.send({
        t: performance.now(),
        event: 'handshake',
        handshakePhase: 'CLIENT_READY',
        seq: 3,
        rtt
      } as NetSyncPayload)

      this.onConnected?.(false)
      return
    }

    if (payload.handshakePhase === 'MATCH_READY') {
      // Passo 5: Host ordenou início com MATCH_READY. Cliente responde MATCH_CONFIRM!
      this.clearHandshakeTimeout()
      this.setState('MATCH_RUNNING')
      this.startHeartbeat(false)

      conn.send({
        t: performance.now(),
        event: 'handshake',
        handshakePhase: 'MATCH_CONFIRM',
        seq: 5,
        gameType: payload.gameType,
        format: payload.format,
        hostTeam: payload.hostTeam
      } as NetSyncPayload)

      this.onMatchStart?.(payload)
      return
    }
  }

  /**
   * Chamado pelo Host quando clica em "INICIAR PARTIDA" (apenas permitido se state === 'HOST_READY')
   */
  public launchMatch(gameType: 'beatball' | 'turbo', format: string, hostTeam?: TeamKey): boolean {
    if (!this.isHostPlayer || (this.state !== 'HOST_READY' && this.state !== 'MATCH_READY')) {
      return false
    }

    this.setState('MATCH_READY')
    this.send({
      t: performance.now(),
      event: 'handshake',
      handshakePhase: 'MATCH_READY',
      seq: 4,
      gameType,
      format,
      hostTeam
    })
    return true
  }

  // ============================================================
  //  HEARTBEAT BIDIRECIONAL E WATCHDOG DE TIMEOUT (3.0s)
  // ============================================================
  private startHeartbeat(isHost: boolean) {
    this.stopHeartbeat()
    this.lastHeartbeatReceived = performance.now()

    if (isHost) {
      // Host envia heartbeat a cada 1.0s
      this.heartbeatIntervalTimer = setInterval(() => {
        if (this.state !== 'MATCH_RUNNING') return
        this.heartbeatSeq++
        this.send({
          t: performance.now(),
          event: 'heartbeat',
          heartbeatId: this.heartbeatSeq,
          clientTime: performance.now()
        })
      }, 1000)
    }

    // Ambos os lados monitoram inatividade a cada 500ms
    this.heartbeatCheckTimer = setInterval(() => {
      if (this.state !== 'MATCH_RUNNING') return
      const elapsed = performance.now() - this.lastHeartbeatReceived
      if (elapsed > 3000) {
        this.handleConnectionDrop('Conexão perdida por inatividade (timeout de heartbeat > 3.0s).')
      }
    }, 500)
  }

  private stopHeartbeat() {
    if (this.heartbeatIntervalTimer) clearInterval(this.heartbeatIntervalTimer)
    if (this.heartbeatCheckTimer) clearInterval(this.heartbeatCheckTimer)
    this.heartbeatIntervalTimer = null
    this.heartbeatCheckTimer = null
  }

  private startHandshakeTimeout() {
    this.clearHandshakeTimeout()
    this.handshakeTimeoutTimer = setTimeout(() => {
      if (this.state === 'HANDSHAKING' || this.state === 'CONNECTING') {
        this.setState('FAILED')
        const msg = 'Tempo limite de handshake esgotado. A conexão de dados entre os jogadores não pôde ser validada.'
        this.onError?.(msg)
        this.destroy()
      }
    }, 8000)
  }

  private clearHandshakeTimeout() {
    if (this.handshakeTimeoutTimer) {
      clearTimeout(this.handshakeTimeoutTimer)
      this.handshakeTimeoutTimer = null
    }
  }

  private handleConnectionDrop(reason: string) {
    this.stopHeartbeat()
    this.setState('CONNECTION_LOST')
    this.onConnectionLost?.(reason)
    this.destroy()
  }

  private notifyPlayerCount() {
    const count = this.conns.size + 1
    this.onPlayerCountChange?.(count)
    this.send({
      t: performance.now(),
      event: 'slot_assign',
      totalPlayers: count
    })
  }

  send(payload: NetSyncPayload | Record<string, any>) {
    payload.slot = this.mySlot
    if (this.isHostPlayer) {
      for (const conn of this.conns.values()) {
        if (conn.open) conn.send(payload)
      }
    } else if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(payload)
    }
  }

  isHost(): boolean {
    return this.isHostPlayer
  }

  isConnected(): boolean {
    return this.state === 'MATCH_RUNNING' || this.state === 'HOST_READY' || this.state === 'CLIENT_READY'
  }

  getPlayerCount(): number {
    return this.isHostPlayer ? this.conns.size + 1 : 2
  }

  destroy() {
    this.clearHandshakeTimeout()
    this.stopHeartbeat()
    for (const conn of this.conns.values()) {
      conn.close()
    }
    this.conns.clear()
    this.hostConn?.close()
    this.hostConn = null
    this.peer?.destroy()
    this.peer = null
    this.setState('IDLE')
  }
}
