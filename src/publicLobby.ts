// ============================================================
//  publicLobby.ts — Lista Pública de Salas (Lobby Browser Realtime)
//  Sincronização entre navegadores via Supabase + fallback LocalStorage
// ============================================================
import { dbService, RemoteRoom } from './supabase'

export interface PublicRoomInfo {
  hostId: string
  code: string
  hostName: string
  gameType: 'beatball' | 'turbo'
  format: '1v1' | '2v2' | '3v3' | '4v4'
  playerCount: number
  maxPlayers: number
  createdAt: number
  updatedAt?: number
  status?: 'waiting' | 'in_game' | 'closed'
}

const STORAGE_KEY = 'arena_kick_public_rooms'
const ROOM_TTL_MS = 3 * 60 * 1000 // 3 minutos sem atualização = sala expirada

let broadcastChannel: BroadcastChannel | null = null
try {
  if (typeof BroadcastChannel !== 'undefined') {
    broadcastChannel = new BroadcastChannel('arena_kick_rooms_channel')
  }
} catch {}

let activeHeartbeatTimer: number | null = null
let currentHostedCode: string | null = null

// Remove a sala do host caso a aba/janela seja fechada
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (currentHostedCode) {
      removePublicRoom(currentHostedCode)
    }
  })
}

function startHeartbeat(code: string) {
  stopHeartbeat()
  currentHostedCode = code
  activeHeartbeatTimer = window.setInterval(async () => {
    try {
      updateStoredRoomTouch(code)
      await dbService.heartbeatRoom(code)
    } catch {}
  }, 20000)
}

function stopHeartbeat() {
  if (activeHeartbeatTimer !== null) {
    clearInterval(activeHeartbeatTimer)
    activeHeartbeatTimer = null
  }
  currentHostedCode = null
}

export async function publishPublicRoom(room: PublicRoomInfo) {
  try {
    currentHostedCode = room.code
    startHeartbeat(room.code)

    // 1. Armazena localmente para resposta instantânea
    const now = Date.now()
    const localRoom: PublicRoomInfo = { ...room, createdAt: now, updatedAt: now, status: 'waiting' }
    const list = getStoredRooms().filter((r) => r.code !== room.code)
    list.unshift(localRoom)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))

    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'room_published', room: localRoom })
    }

    // 2. Publica no Supabase para jogadores em outros computadores
    await dbService.publishRoom({
      code: room.code,
      hostId: room.hostId,
      hostName: room.hostName,
      gameType: room.gameType,
      format: room.format,
      playerCount: room.playerCount,
      maxPlayers: room.maxPlayers,
      status: 'waiting',
      createdAt: now,
      updatedAt: now
    })
  } catch (e) {
    console.warn('Erro ao publicar sala:', e)
  }
}

export async function updatePublicRoomPlayerCount(code: string, count: number, status: 'waiting' | 'in_game' | 'closed' = 'waiting') {
  try {
    const list = getStoredRooms()
    const target = list.find((r) => r.code === code)
    if (target) {
      target.playerCount = count
      target.status = status
      target.updatedAt = Date.now()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
      if (broadcastChannel) {
        broadcastChannel.postMessage({ type: 'room_updated', room: target })
      }
    }

    await dbService.updateRoom(code, { playerCount: count, status })
  } catch {}
}

export async function removePublicRoom(code: string) {
  try {
    stopHeartbeat()

    const list = getStoredRooms().filter((r) => r.code !== code)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))

    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'room_removed', code })
    }

    await dbService.removeRoom(code)
  } catch {}
}

function updateStoredRoomTouch(code: string) {
  try {
    const list = getStoredRooms()
    const target = list.find((r) => r.code === code)
    if (target) {
      target.updatedAt = Date.now()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    }
  } catch {}
}

function getStoredRooms(): PublicRoomInfo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const now = Date.now()
    const list: PublicRoomInfo[] = JSON.parse(raw)
    // Filtra salas expiradas (sem heartbeat ou fechadas)
    return list.filter((r) => {
      const timeRef = r.updatedAt || r.createdAt
      return now - timeRef < ROOM_TTL_MS && r.status !== 'closed'
    })
  } catch {
    return []
  }
}

export async function fetchPublicRooms(): Promise<PublicRoomInfo[]> {
  const localRooms = getStoredRooms()
  const map = new Map<string, PublicRoomInfo>()

  // 1. Tenta buscar salas remotas no Supabase (jogadores em outros PCs)
  try {
    const remoteRooms: RemoteRoom[] | null = await dbService.fetchRooms()
    if (remoteRooms && remoteRooms.length > 0) {
      for (const r of remoteRooms) {
        map.set(r.code, {
          hostId: r.hostId,
          code: r.code,
          hostName: r.hostName,
          gameType: r.gameType,
          format: r.format,
          playerCount: r.playerCount,
          maxPlayers: r.maxPlayers,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          status: r.status
        })
      }
    }
  } catch {}

  // 2. Une com as salas locais da máquina atual
  for (const r of localRooms) {
    if (!map.has(r.code)) {
      map.set(r.code, r)
    }
  }

  // 3. NUNCA adiciona salas falsas/fictícias — lista 100% real
  return Array.from(map.values()).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
}

export function setupLobbyListener(onUpdate: () => void): () => void {
  if (broadcastChannel) {
    broadcastChannel.onmessage = () => onUpdate()
  }

  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onUpdate()
  }
  window.addEventListener('storage', storageHandler)

  // Supabase Realtime Listener (se configurado)
  const unsubscribeDb = dbService.subscribeRooms(() => onUpdate())

  return () => {
    window.removeEventListener('storage', storageHandler)
    if (unsubscribeDb) unsubscribeDb()
  }
}

export async function renderPublicRooms(
  container: HTMLElement,
  onJoinClick: (code: string) => void,
  onSpectateClick?: (code: string) => void
) {
  // Estado 1: Carregando salas
  container.innerHTML = `
    <div style="color:rgba(255,255,255,0.6); font-size:11px; text-align:center; padding:16px; display:flex; align-items:center; justify-content:center; gap:8px;">
      <span style="display:inline-block; animation:spin 1s linear infinite;">🔄</span> Atualizando lista de salas disponíveis...
    </div>
  `

  const rooms = await fetchPublicRooms()

  // Estado 2: Nenhuma sala aberta
  if (rooms.length === 0) {
    container.innerHTML = `
      <div style="color:rgba(255,255,255,0.45); font-size:11px; text-align:center; padding:18px 12px; line-height:1.6;">
        <div>Nenhuma sala pública encontrada no momento.</div>
        <div style="color:#00ff88; font-weight:700; margin-top:2px;">Crie uma sala acima ou compartilhe seu código/link de convite!</div>
      </div>
    `
    return
  }

  container.innerHTML = ''
  for (const room of rooms) {
    const item = document.createElement('div')
    const isFull = room.playerCount >= room.maxPlayers
    const isTurbo = room.gameType === 'turbo'
    const tagCol = isTurbo ? '#ff6600' : '#00ff88'
    const gameLabel = isTurbo ? '🏎️ Turbo 3D' : '⚽ BeatBall'

    item.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(30, 41, 59, 0.7);
      border: 1.5px solid ${isFull ? 'rgba(255,255,255,0.1)' : isTurbo ? 'rgba(255,102,0,0.4)' : 'rgba(0,255,136,0.4)'};
      border-radius: 12px;
      padding: 8px 14px;
      opacity: ${isFull ? '0.75' : '1'};
      transition: transform 0.15s, background 0.15s;
    `

    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:18px;">${isTurbo ? '🏎️' : '⚽'}</span>
        <div>
          <div style="font-family:'Orbitron',sans-serif; font-size:11px; font-weight:800; color:white; display:flex; align-items:center; gap:6px;">
            <span>${gameLabel}</span>
            <span style="color:${tagCol}; font-size:9px; background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:6px;">${room.format}</span>
            ${isFull ? '<span style="color:#ff2d78; font-size:9px; background:rgba(255,45,120,0.15); padding:2px 6px; border-radius:6px; font-weight:800;">CHEIA</span>' : ''}
          </div>
          <div style="font-size:10px; color:rgba(255,255,255,0.5); margin-top:2px;">
            Host: <b style="color:rgba(255,255,255,0.8);">${room.hostName}</b> · Código: <span style="font-family:monospace; color:#ffd23f;">${room.code}</span>
          </div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="font-size:11px; font-weight:700; color:${isFull ? '#ff4d7d' : '#00cfff'};">
          👥 ${room.playerCount}/${room.maxPlayers}
        </div>
        ${
          isFull
            ? `<button class="btn btn-secondary btn-spec-room" data-code="${room.code}" style="padding:6px 12px; font-size:10px; border-color:#a855f7 !important; color:#c084fc !important;">
                👁️ ESPIAR
              </button>`
            : `<button class="btn btn-primary btn-join-room" data-code="${room.code}" style="padding:6px 16px; font-size:10px; background:${isTurbo ? '#ff6600' : '#00ff88'}; color:#0a0e17; font-weight:900;">
                ENTRAR
              </button>`
        }
      </div>
    `

    const btnJoin = item.querySelector('.btn-join-room') as HTMLElement | null
    if (btnJoin) {
      btnJoin.addEventListener('click', () => onJoinClick(room.code))
    }

    const btnSpec = item.querySelector('.btn-spec-room') as HTMLElement | null
    if (btnSpec) {
      btnSpec.addEventListener('click', () => {
        if (onSpectateClick) onSpectateClick(room.code)
        else onJoinClick(room.code)
      })
    }

    container.appendChild(item)
  }
}
