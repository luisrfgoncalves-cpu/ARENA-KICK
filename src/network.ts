// ============================================================
//  network.ts — Multiplayer Online P2P WebRTC Multi-Player (PeerJS)
//  Zero Custo de Servidor: Topologia Estrela (Host Autoridativo + até 8 Clientes)
// ============================================================
import { Peer, DataConnection } from 'peerjs'

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
  event?: 'goal' | 'rematch' | 'slot_assign' | 'start_game' | 'room_full'
  message?: string
  assignedSlot?: number
  totalPlayers?: number
  gameType?: 'beatball' | 'turbo'
  format?: '1v1' | '2v2' | '3v3' | '4v4'
  whoScored?: 'p1' | 'p2'
  isSpectator?: boolean
}

// Configuração de NAT Traversal de Alta Conectividade (OpenRelay STUN + TURN público gratuito)
// Permite que jogadores em redes 4G/5G, celulares e roteadores com NAT Restrito joguem juntos sem bloqueio
const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:openrelay.metered.ca:80' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelay',
        credential: 'openrelay'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelay',
        credential: 'openrelay'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelay',
        credential: 'openrelay'
      }
    ]
  }
}

export class NetworkManager {
  private peer: Peer | null = null
  private conns: Map<string, DataConnection> = new Map() // Múltiplas conexões para o Host
  private hostConn: DataConnection | null = null         // Conexão do Cliente com o Host
  private isHostPlayer = false
  public myId = ''
  public mySlot = 0 // 0 = Host (P1), 1 = P2, 2 = P3, ..., 7 = P8
  public isSpectator = false
  public maxPlayers = 2

  public onConnected?: (isHost: boolean) => void
  public onDataReceived?: (data: NetSyncPayload) => void
  public onDisconnected?: () => void
  public onError?: (err: string) => void
  public onPlayerCountChange?: (count: number) => void

  init(customId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.peer = customId ? new Peer(customId, PEER_OPTIONS) : new Peer(PEER_OPTIONS)

      this.peer.on('open', (id) => {
        this.myId = id
        resolve(id)
      })

      this.peer.on('connection', (connection) => {
        // Alguém conectou na nossa sala (nós somos o HOST)
        this.isHostPlayer = true
        this.setupHostConnection(connection)
      })

      this.peer.on('error', (err) => {
        console.error('PeerJS error:', err)
        if (this.onError) this.onError(err.message || 'Erro de conexão P2P')
        reject(err)
      })
    })
  }

  joinRoom(hostRoomId: string, asSpectator = false): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) {
        reject(new Error('Peer not initialized'))
        return
      }

      this.isHostPlayer = false
      this.isSpectator = asSpectator
      const connection = this.peer.connect(hostRoomId, {
        reliable: false // modo UDP ultra-rápido para gameplay em tempo real
      })

      const timeout = setTimeout(() => {
        reject(new Error('Tempo esgotado ao conectar na sala.'))
      }, 12000)

      connection.on('open', () => {
        clearTimeout(timeout)
        this.hostConn = connection
        this.setupClientConnection(connection)
        if (asSpectator) {
          connection.send({
            t: performance.now(),
            event: 'slot_assign',
            isSpectator: true,
            assignedSlot: -1
          } as NetSyncPayload)
        }
        resolve()
      })

      connection.on('error', (err) => {
        clearTimeout(timeout)
        if (this.onError) this.onError('Falha ao conectar na sala do host.')
        reject(err)
      })
    })
  }

  private setupHostConnection(conn: DataConnection) {
    const slot = this.conns.size + 1
    this.conns.set(conn.peer, conn)

    conn.on('open', () => {
      // Se a sala exceder maxPlayers e o cliente não for espectador, rejeita com evento room_full
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

      // Atribui slot ao novo cliente
      conn.send({
        t: performance.now(),
        event: 'slot_assign',
        assignedSlot: slot,
        totalPlayers: this.conns.size + 1
      } as NetSyncPayload)

      this.notifyPlayerCount()
      if (this.onConnected) this.onConnected(true)
    })

    conn.on('data', (data) => {
      const payload = data as NetSyncPayload
      if (payload.event === 'slot_assign' && payload.isSpectator) {
        ;(conn as any).isSpectator = true
      }
      if (this.onDataReceived) {
        this.onDataReceived(payload)
      }
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
    })

    conn.on('error', () => {
      this.conns.delete(conn.peer)
      this.notifyPlayerCount()
    })
  }

  private setupClientConnection(conn: DataConnection) {
    conn.on('data', (data) => {
      const payload = data as NetSyncPayload
      if (payload.event === 'room_full') {
        if (this.onError) this.onError(payload.message || 'Sala cheia! Limite de jogadores atingido.')
        conn.close()
        return
      }
      if (payload.event === 'slot_assign' && payload.assignedSlot !== undefined) {
        this.mySlot = payload.assignedSlot
        if (payload.totalPlayers && this.onPlayerCountChange) {
          this.onPlayerCountChange(payload.totalPlayers)
        }
      }
      if (this.onDataReceived) {
        this.onDataReceived(payload)
      }
    })

    conn.on('close', () => {
      if (this.onDisconnected) this.onDisconnected()
    })

    if (this.onConnected) {
      this.onConnected(false)
    }
  }

  private notifyPlayerCount() {
    const count = this.conns.size + 1
    if (this.onPlayerCountChange) {
      this.onPlayerCountChange(count)
    }
    // Informa todos os clientes sobre a contagem atualizada
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
    return this.isHostPlayer ? this.conns.size > 0 : !!(this.hostConn && this.hostConn.open)
  }

  getPlayerCount(): number {
    return this.isHostPlayer ? this.conns.size + 1 : 2
  }

  destroy() {
    for (const conn of this.conns.values()) {
      conn.close()
    }
    this.conns.clear()
    this.hostConn?.close()
    this.hostConn = null
    this.peer?.destroy()
    this.peer = null
  }
}

