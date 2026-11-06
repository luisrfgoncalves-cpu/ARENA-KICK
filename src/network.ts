// ============================================================
//  network.ts — Multiplayer Online P2P WebRTC (PeerJS)
//  Zero Custo de Servidor: Troca de pacotes direta via UDP DataChannels
// ============================================================
import { Peer, DataConnection } from 'peerjs'

export interface NetSyncPayload {
  t: number
  p1: { x: number; y: number; vx: number; vy: number; dash: boolean }
  p2?: { x: number; y: number; vx: number; vy: number; dash: boolean }
  ball?: { x: number; y: number; vx: number; vy: number }
  scores?: { p1: number; p2: number }
  event?: 'goal' | 'rematch'
  whoScored?: 'p1' | 'p2'
}

export class NetworkManager {
  private peer: Peer | null = null
  private conn: DataConnection | null = null
  private isHostPlayer = false
  public myId = ''

  public onConnected?: (isHost: boolean) => void
  public onDataReceived?: (data: NetSyncPayload) => void
  public onDisconnected?: () => void
  public onError?: (err: string) => void

  init(customId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Usando o servidor público STUN/TURN gratuito do PeerJS
      this.peer = customId ? new Peer(customId) : new Peer()

      this.peer.on('open', (id) => {
        this.myId = id
        resolve(id)
      })

      this.peer.on('connection', (connection) => {
        // Alguém conectou na nossa sala (nós somos o HOST)
        this.isHostPlayer = true
        this.setupConnection(connection)
      })

      this.peer.on('error', (err) => {
        console.error('PeerJS error:', err)
        if (this.onError) this.onError(err.message || 'Erro de conexão P2P')
        reject(err)
      })
    })
  }

  joinRoom(hostRoomId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) {
        reject(new Error('Peer not initialized'))
        return
      }

      this.isHostPlayer = false
      const connection = this.peer.connect(hostRoomId, {
        reliable: false // modo UDP para máxima velocidade em jogos de ação!
      })

      // Evita ficar preso em "Conectando..." com um código inválido
      const timeout = setTimeout(() => {
        reject(new Error('Tempo esgotado ao conectar na sala.'))
      }, 12000)

      connection.on('open', () => {
        clearTimeout(timeout)
        this.setupConnection(connection)
        resolve()
      })

      connection.on('error', (err) => {
        clearTimeout(timeout)
        if (this.onError) this.onError('Falha ao conectar na sala do host.')
        reject(err)
      })
    })
  }

  private setupConnection(connection: DataConnection) {
    this.conn = connection

    this.conn.on('data', (data) => {
      if (this.onDataReceived) {
        this.onDataReceived(data as NetSyncPayload)
      }
    })

    this.conn.on('close', () => {
      if (this.onDisconnected) this.onDisconnected()
    })

    if (this.onConnected) {
      this.onConnected(this.isHostPlayer)
    }
  }

  send(payload: NetSyncPayload) {
    if (this.conn && this.conn.open) {
      this.conn.send(payload)
    }
  }

  isHost(): boolean {
    return this.isHostPlayer
  }

  isConnected(): boolean {
    return !!(this.conn && this.conn.open)
  }

  destroy() {
    this.conn?.close()
    this.peer?.destroy()
    this.conn = null
    this.peer = null
  }
}

