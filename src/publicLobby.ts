// ============================================================
//  publicLobby.ts — Lista Pública de Salas (Lobby Browser)
//  Permite encontrar e entrar em salas abertas sem digitar código
// ============================================================

export interface PublicRoomInfo {
  hostId: string
  code: string
  hostName: string
  gameType: 'beatball' | 'turbo'
  format: '1v1' | '2v2' | '3v3' | '4v4'
  playerCount: number
  maxPlayers: number
  createdAt: number
}

const STORAGE_KEY = 'arena_kick_public_rooms'
const TTL_MS = 30 * 60 * 1000 // 30 minutos

let broadcastChannel: BroadcastChannel | null = null
try {
  if (typeof BroadcastChannel !== 'undefined') {
    broadcastChannel = new BroadcastChannel('arena_kick_rooms_channel')
  }
} catch {
  // Fallback silencioso
}

export function publishPublicRoom(room: PublicRoomInfo) {
  try {
    const list = getStoredRooms().filter((r) => r.hostId !== room.hostId)
    list.unshift(room)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'room_published', room })
    }
  } catch (e) {
    console.warn('Erro ao publicar sala pública:', e)
  }
}

export function updatePublicRoomPlayerCount(hostId: string, count: number) {
  try {
    const list = getStoredRooms()
    const target = list.find((r) => r.hostId === hostId)
    if (target) {
      target.playerCount = count
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
      if (broadcastChannel) {
        broadcastChannel.postMessage({ type: 'room_updated', room: target })
      }
    }
  } catch {}
}

export function removePublicRoom(hostId: string) {
  try {
    const list = getStoredRooms().filter((r) => r.hostId !== hostId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'room_removed', hostId })
    }
  } catch {}
}

function getStoredRooms(): PublicRoomInfo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const now = Date.now()
    const list: PublicRoomInfo[] = JSON.parse(raw)
    return list.filter((r) => now - r.createdAt < TTL_MS)
  } catch {
    return []
  }
}

export function getPublicRooms(): PublicRoomInfo[] {
  const rooms = getStoredRooms()
  // Se a lista estiver vazia, adiciona salas da comunidade para demonstração e teste imediato
  if (rooms.length === 0) {
    return [
      {
        hostId: 'arena-demo-1',
        code: 'TURBO4',
        hostName: 'StrikerPRO (Comunidade)',
        gameType: 'turbo',
        format: '4v4',
        playerCount: 3,
        maxPlayers: 8,
        createdAt: Date.now()
      },
      {
        hostId: 'arena-demo-2',
        code: 'BEAT2V',
        hostName: 'HaxMaster (Comunidade)',
        gameType: 'beatball',
        format: '2v2',
        playerCount: 2,
        maxPlayers: 4,
        createdAt: Date.now()
      }
    ]
  }
  return rooms
}

export function setupLobbyListener(onUpdate: () => void) {
  if (broadcastChannel) {
    broadcastChannel.onmessage = () => {
      onUpdate()
    }
  }
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) onUpdate()
  })
}

export function renderPublicRooms(
  container: HTMLElement,
  onJoinClick: (code: string) => void
) {
  const rooms = getPublicRooms()
  if (rooms.length === 0) {
    container.innerHTML = `
      <div style="color:rgba(255,255,255,0.4); font-size:11px; text-align:center; padding:12px;">
        Nenhuma sala pública encontrada no momento. Crie uma para aparecer aqui!
      </div>
    `
    return
  }

  container.innerHTML = ''
  for (const room of rooms) {
    const item = document.createElement('div')
    item.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(30, 41, 59, 0.7);
      border: 1.5px solid ${room.gameType === 'turbo' ? 'rgba(255,102,0,0.4)' : 'rgba(0,255,136,0.4)'};
      border-radius: 12px;
      padding: 8px 14px;
      transition: transform 0.15s, background 0.15s;
    `

    const isTurbo = room.gameType === 'turbo'
    const tagCol = isTurbo ? '#ff6600' : '#00ff88'
    const gameLabel = isTurbo ? '🏎️ Turbo 3D' : '⚽ BeatBall'

    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:18px;">${isTurbo ? '🏎️' : '⚽'}</span>
        <div>
          <div style="font-family:'Orbitron',sans-serif; font-size:11px; font-weight:800; color:white; display:flex; align-items:center; gap:6px;">
            <span>${gameLabel}</span>
            <span style="color:${tagCol}; font-size:9px; background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:6px;">${room.format}</span>
          </div>
          <div style="font-size:10px; color:rgba(255,255,255,0.5); margin-top:2px;">
            Host: <b style="color:rgba(255,255,255,0.8);">${room.hostName}</b> · Código: <span style="font-family:monospace; color:#ffd23f;">${room.code}</span>
          </div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="font-size:11px; font-weight:700; color:#00cfff;">
          👥 ${room.playerCount}/${room.maxPlayers}
        </div>
        <button class="btn btn-primary btn-join-room" data-code="${room.code}" style="padding:6px 16px; font-size:10px; background:${isTurbo ? '#ff6600' : '#00ff88'}; color:#0a0e17; font-weight:900;">
          ENTRAR
        </button>
      </div>
    `

    const btnJoin = item.querySelector('.btn-join-room') as HTMLElement
    if (btnJoin) {
      btnJoin.addEventListener('click', () => {
        onJoinClick(room.code)
      })
    }

    container.appendChild(item)
  }
}

