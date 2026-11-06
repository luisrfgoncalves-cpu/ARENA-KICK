// ============================================================
//  main.ts — Orquestrador do Menu, BeatBall (2D) e Turbo Soccer (3D)
//  Com Garagem 3D, Seleção de Carros Reais e Customização de Times
// ============================================================
import { Game } from './game'
import type { TurboSoccerGame, TurboTuning, TurboTheme, TurboMatchFormat, GoalExplosionType, TurboGameMode } from './turbosoccer'
import type { NetworkManager } from './network'
import { publishPublicRoom, updatePublicRoomPlayerCount, removePublicRoom, renderPublicRooms, setupLobbyListener } from './publicLobby'
import { TeamKey, FieldTheme } from './assets'
import { initVirtualJoystick, setTouchControlsVisible } from './input'
import { setAudioMuted, isAudioMuted } from './audio'

initVirtualJoystick()

let currentGame: Game | null = null
let currentTurboGame: TurboSoccerGame | null = null
let netManager: NetworkManager | null = null
let onlineBusy = false
let lastWasOnline = false
let selectedDiff: 'easy' | 'medium' | 'hard' = 'easy'
let gameMode: 'bot' | '2p' = 'bot'

// Customizações ativas
let selectedCar = 'octane-cartoon'
let selectedTurboTheme: TurboTheme = 'classic'
let selectedTurboLevel: 'easy' | 'medium' | 'hard' = 'medium'
let selectedTurboFormat: TurboMatchFormat = '1v1'
let selectedBBFormat: '1v1' | '2v2' = '1v1'
let selectedGoalExplosion: GoalExplosionType = (localStorage.getItem('arena_kick_goal_explosion') as GoalExplosionType) || 'toon'
let selectedTurboMode: TurboGameMode = 'standard'
let garagePreview: { setCar(id: string): void; dispose(): void } | null = null
let selectedTeamP1: TeamKey = 'brazil'
let selectedTheme: FieldTheme = 'classic'
let selectedOnlineGame: 'beatball' | 'turbo' = 'beatball'
let selectedOnlineBBFormat: '1v1' | '2v2' = '1v1'
let selectedOnlineTurboFormat: TurboMatchFormat = '1v1'

const screens = {
  menu: document.getElementById('screen-menu')!,
  select: document.getElementById('screen-game-select')!,
  garage3d: document.getElementById('screen-garage-3d')!,
  online: document.getElementById('screen-online')!,
  game: document.getElementById('screen-game')!,
  turbo3d: document.getElementById('screen-turbo3d')!,
  victory: document.getElementById('screen-victory')!,
}

// HUD Elements
const hudTimer = document.getElementById('hud-timer')!
const hudScoreP1 = document.getElementById('hud-score-p1')!
const hudScoreP2 = document.getElementById('hud-score-p2')!
const hudP1Name = document.getElementById('hud-p1-name')!
const hudP2Name = document.getElementById('hud-p2-name')!

// Overlays
const goalOverlay = document.getElementById('goal-overlay')!
const goalScorer = document.getElementById('goal-scorer')!
const pauseOverlay = document.getElementById('pause-overlay')!
const victoryTitle = document.getElementById('victory-title')!
const victoryWinner = document.getElementById('victory-winner')!
const victoryScore = document.getElementById('victory-score')!
const powerBarWrap = document.getElementById('power-bar-wrap')!
const pbFill = document.getElementById('pb-fill')!

// Áudio BGM Toggle (estado GLOBAL, vale para 2D e 3D)
const btnAudio = document.getElementById('btn-audio-toggle')
let isMuted = isAudioMuted()
function applyMuteUI() {
  if (btnAudio) btnAudio.textContent = isMuted ? '🔇' : '🔊'
}
applyMuteUI()
if (btnAudio) {
  btnAudio.addEventListener('click', () => {
    isMuted = !isMuted
    setAudioMuted(isMuted)
    applyMuteUI()
  })
}

function refreshLobby() {
  const container = document.getElementById('online-rooms-container')
  if (container) {
    renderPublicRooms(container, (code) => {
      const input = document.getElementById('online-join-code') as HTMLInputElement
      if (input) input.value = code
      document.getElementById('btn-online-join')?.click()
    })
  }
}

function updateRankDisplay() {
  const el = document.getElementById('player-rank-display')
  if (!el) return
  try {
    const lbRaw = localStorage.getItem('arena_kick_leaderboard')
    const lb: Array<{ player_name: string; rating: number }> = lbRaw ? JSON.parse(lbRaw) : []
    const myEntry = lb.find((e) => e.player_name === 'Jogador 1')
    const myMMR = myEntry?.rating ?? 1000
    let label = 'BRONZE'
    let emoji = '🥉'
    let color = '#cd7f32'
    if (myMMR >= 1600) { label = 'CAMPEÃO'; emoji = '🏆'; color = '#a855f7' }
    else if (myMMR >= 1400) { label = 'PLATINA'; emoji = '💎'; color = '#38bdf8' }
    else if (myMMR >= 1250) { label = 'OURO'; emoji = '🥇'; color = '#ffd23f' }
    else if (myMMR >= 1100) { label = 'PRATA'; emoji = '🥈'; color = '#94a3b8' }

    el.innerHTML = `${emoji} <span style="color:${color};font-weight:900;">${label}</span> · ${myMMR} MMR`
  } catch {
    el.innerHTML = '🥉 BRONZE · 1000 MMR'
  }
}

function showScreen(id: keyof typeof screens) {
  if (id === 'menu') {
    if (currentGame) {
      currentGame.destroy()
      currentGame = null
    }
    if (currentTurboGame) {
      currentTurboGame.destroy()
      currentTurboGame = null
    }
  }
  if (id === 'online') {
    refreshLobby()
  }
  updateRankDisplay()
  Object.values(screens).forEach((s) => s.classList.add('hidden'))
  screens[id].classList.remove('hidden')
  // Joystick de toque só aparece na tela do BeatBall 2D
  setTouchControlsVisible(id === 'game')
}

// ── NOTIFICAÇÃO DE GAMEPAD XBOX ──────────────────────────────
window.addEventListener('gamepadconnected', (e) => {
  showToast(`🎮 Controle Conectado: ${e.gamepad.id.substring(0, 24)}...`)
})

// ── MENU PRINCIPAL ───────────────────────────────────────────
document.getElementById('btn-vs-bot')!.addEventListener('click', () => {
  gameMode = 'bot'
  document.getElementById('select-mode-title')!.textContent = 'BEATBALL VS BOT IA'
  const diffRow = document.querySelector('.diff-row') as HTMLElement
  diffRow.style.display = 'flex'
  showScreen('select')
})

document.getElementById('btn-local-2p')!.addEventListener('click', () => {
  gameMode = '2p'
  document.getElementById('select-mode-title')!.textContent = 'BEATBALL 2 JOGADORES'
  const diffRow = document.querySelector('.diff-row') as HTMLElement
  diffRow.style.display = 'none'
  showScreen('select')
})

// MODO TURBO SOCCER 3D (Abre Garagem para escolher o carro!)
document.getElementById('btn-turbo-3d')!.addEventListener('click', () => {
  void openGarage()
})

let garagePreviewLoading = false
async function openGarage() {
  showScreen('garage3d')
  const host = document.getElementById('garage-preview-canvas')
  if (host && !garagePreview && !garagePreviewLoading) {
    garagePreviewLoading = true
    try {
      const { GaragePreview } = await import('./garagePreview')
      if (screens.garage3d.classList.contains('hidden')) return
      garagePreview = new GaragePreview(host)
    } catch (err) {
      console.error('[Garagem] Prévia 3D indisponível:', err)
    } finally {
      garagePreviewLoading = false
    }
  }
  garagePreview?.setCar(selectedCar)
  updatePreviewLabel()
}

function closeGaragePreview() {
  garagePreview?.dispose()
  garagePreview = null
}

function updatePreviewLabel() {
  const labelEl = document.getElementById('garage-preview-label')
  if (!labelEl) return
  const name = document.querySelector('.car-card.active .mode-name') as HTMLElement | null
  labelEl.textContent = (name?.textContent || 'Octane Turbo').toUpperCase()
}

// SELEÇÃO DE CARRO NA GARAGEM 3D
document.querySelectorAll('.car-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.car-card').forEach((c) => {
      c.classList.remove('active')
      ;(c as HTMLElement).style.borderColor = 'rgba(255,255,255,0.18)'
    })
    card.classList.add('active')
    ;(card as HTMLElement).style.borderColor = 'var(--neon-orange)'
    selectedCar = (card as HTMLElement).dataset.car || 'ferrari'
    garagePreview?.setCar(selectedCar)
    updatePreviewLabel()
    showToast(`🏎️ Veículo Selecionado: ${(card.querySelector('.mode-name') as HTMLElement)?.textContent}`)
  })
})

// SELEÇÃO DE DIFICULDADE DO BOT 3D
document.querySelectorAll('.turbo-diff-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.turbo-diff-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedTurboLevel = ((btn as HTMLElement).dataset.turboLevel as 'easy' | 'medium' | 'hard') || 'medium'
    showToast(`🤖 Bot: ${btn.textContent?.trim()}`)
  })
})

// SELEÇÃO DE CENÁRIO DO ESTÁDIO 3D
document.querySelectorAll('.turbo-theme-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.turbo-theme-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedTurboTheme = ((btn as HTMLElement).dataset.turboTheme as TurboTheme) || 'classic'
    showToast(`🏟️ Cenário: ${btn.textContent?.trim()}`)
  })
})

// SELEÇÃO DE FORMATO DO TURBO SOCCER (1v1, 2v2, 3v3, 4v4)
document.querySelectorAll('.turbo-format-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.turbo-format-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedTurboFormat = ((btn as HTMLElement).dataset.turboFormat as TurboMatchFormat) || '1v1'
    showToast(`🏎️ Formato: ${btn.textContent?.trim()}`)
  })
})

// SELEÇÃO DE FORMATO DO BEATBALL (1v1 ou 2v2)
document.querySelectorAll('.bb-format-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bb-format-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedBBFormat = ((btn as HTMLElement).dataset.format as '1v1' | '2v2') || '1v1'
    showToast(`⚽ Formato: ${btn.textContent?.trim()}`)
  })
})

// SELEÇÃO DE MODO DE JOGO (CLÁSSICO, RUMBLE, HOCKEY NO GELO)
document.querySelectorAll('.turbo-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.turbo-mode-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedTurboMode = ((btn as HTMLElement).dataset.turboMode as TurboGameMode) || 'standard'
    showToast(`🎲 Modo: ${btn.textContent?.trim()}`)
  })
})

// SELEÇÃO DE EXPLOSÃO DE GOL (GOAL EXPLOSION)
document.querySelectorAll('.turbo-explosion-btn').forEach((btn) => {
  const exp = (btn as HTMLElement).dataset.explosion as GoalExplosionType
  if (exp === selectedGoalExplosion) {
    document.querySelectorAll('.turbo-explosion-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
  }
  btn.addEventListener('click', () => {
    document.querySelectorAll('.turbo-explosion-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedGoalExplosion = exp || 'toon'
    localStorage.setItem('arena_kick_goal_explosion', selectedGoalExplosion)
    showToast(`💥 Explosão: ${btn.textContent?.trim()}`)
  })
})

function readTurboTuning(): TurboTuning {
  const val = (id: string, fallback: number) => {
    const el = document.getElementById(id) as HTMLInputElement | null
    return el ? Number(el.value) : fallback
  }
  return {
    playerSpeedMult: val('tune-speed', 1),
    turnRate: 2.8 * val('tune-turn', 1),
    jumpForce: val('tune-jump', 14),
    ballBounce: val('tune-bounce', 0.68),
    theme: selectedTurboTheme,
    botLevel: selectedTurboLevel,
    matchFormat: selectedTurboFormat,
    goalExplosion: selectedGoalExplosion,
    gameMode: selectedTurboMode
  }
}

const bindTune = (id: string, fmt: (v: number) => string) => {
  const el = document.getElementById(id) as HTMLInputElement | null
  const out = document.getElementById(`${id}-val`)
  if (!el || !out) return
  const update = () => { out.textContent = fmt(Number(el.value)) }
  el.addEventListener('input', update)
  update()
}
bindTune('tune-speed', (v) => `${v.toFixed(1)}x`)
bindTune('tune-turn', (v) => `${v.toFixed(1)}x`)
bindTune('tune-jump', (v) => `${Math.round(v)}`)
bindTune('tune-bounce', (v) => v.toFixed(2))

document.getElementById('btn-start-turbo-match')!.addEventListener('click', () => {
  closeGaragePreview()
  startTurboSoccer3D(selectedCar, readTurboTuning())
})

document.getElementById('btn-training-turbo')?.addEventListener('click', () => {
  closeGaragePreview()
  const tuning = readTurboTuning()
  tuning.matchFormat = '1v1'
  startTurboSoccer3D(selectedCar, tuning)
  setTimeout(() => {
    currentTurboGame?.setTrainingMode(true)
  }, 300)
  showToast('🎯 Treino Livre Ativado: Arena livre e Nitro Infinito!')
})

document.getElementById('btn-back-garage-menu')!.addEventListener('click', () => {
  closeGaragePreview()
  showScreen('menu')
})

document.getElementById('btn-exit-turbo')?.addEventListener('click', () => {
  if (currentTurboGame) {
    currentTurboGame.destroy()
    currentTurboGame = null
  }
  showScreen('menu')
})

async function startTurboSoccer3D(carId = 'ferrari', tuning?: TurboTuning) {
  closeGaragePreview()
  if (currentGame) {
    currentGame.destroy()
    currentGame = null
  }
  if (currentTurboGame) {
    currentTurboGame.destroy()
    currentTurboGame = null
  }

  showScreen('turbo3d')
  const container = document.getElementById('turbo3d-container')!
  container.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#00cfff;font-family:Orbitron,sans-serif;font-weight:800;letter-spacing:2px;">CARREGANDO ARENA 3D…</div>'

  try {
    // Import dinâmico: Three.js só é baixado quando o modo 3D é aberto
    const { TurboSoccerGame } = await import('./turbosoccer')

    // Usuário pode ter saído enquanto o chunk carregava
    if (screens.turbo3d.classList.contains('hidden')) return

    container.innerHTML = ''
    const game = new TurboSoccerGame(container, carId, tuning)
    currentTurboGame = game
    game.onExit = () => {
      currentTurboGame = null
      showScreen('menu')
    }
  } catch (err) {
    console.error('[Turbo 3D] Falha ao carregar:', err)
    container.innerHTML = ''
    showToast('Falha ao carregar o modo 3D')
    showScreen('menu')
  }
}

// ── ONLINE 1V1 (P2P PeerJS) ──────────────────────────────────
function setOnlineStatus(which: 'host' | 'join' | 'global', msg: string, color = 'rgba(255,255,255,0.6)') {
  const el = document.getElementById(`online-${which}-status`)
  if (el) {
    el.textContent = msg
    el.style.color = color
  }
}

function resetOnlineUI() {
  if (netManager) {
    if (netManager.isHost() && netManager.myId) {
      removePublicRoom(netManager.myId)
    }
    netManager.onConnected = undefined
    netManager.onDisconnected = undefined
    netManager.onError = undefined
    netManager.destroy()
    netManager = null
  }
  onlineBusy = false
  const wrap = document.getElementById('online-host-code-wrap')
  if (wrap) wrap.style.display = 'none'
  const codeEl = document.getElementById('online-host-code')
  if (codeEl) codeEl.textContent = '------'
  setOnlineStatus('host', '')
  setOnlineStatus('join', '')
  setOnlineStatus('global', '')
  const joinInput = document.getElementById('online-join-code') as HTMLInputElement | null
  if (joinInput) joinInput.value = ''
  refreshLobby()
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `ARENA-${s}`
}

function handleOnlineDisconnect() {
  const net = netManager
  netManager = null
  if (net) {
    net.onConnected = undefined
    net.onDisconnected = undefined
    net.onError = undefined
    net.destroy()
  }
  if (currentGame) {
    currentGame.destroy()
    currentGame = null
  }
  resetOnlineUI()
  showScreen('online')
  setOnlineStatus('global', 'Conexão encerrada. Crie ou entre em outra sala.', '#ff2d78')
  showToast('Adversário desconectou da partida.')
}

function createOnlineNetwork() {
  return import('./network').then(({ NetworkManager }) => {
    const net = new NetworkManager()
    net.onError = (msg) => setOnlineStatus('global', msg, '#ff2d78')
    net.onDisconnected = handleOnlineDisconnect
    return net
  })
}

document.getElementById('btn-online-1v1')!.addEventListener('click', () => {
  resetOnlineUI()
  showScreen('online')
})

document.getElementById('btn-online-back')!.addEventListener('click', () => {
  resetOnlineUI()
  showScreen('menu')
})

// ── SELEÇÃO DE JOGO ONLINE (BEATBALL OU TURBO SOCCER) ────────
document.querySelectorAll('.online-game-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.online-game-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedOnlineGame = ((btn as HTMLElement).dataset.game as 'beatball' | 'turbo') || 'beatball'
    const bbRow = document.getElementById('online-format-bb')
    const turboRow = document.getElementById('online-format-turbo')
    if (bbRow && turboRow) {
      bbRow.style.display = selectedOnlineGame === 'beatball' ? 'flex' : 'none'
      turboRow.style.display = selectedOnlineGame === 'turbo' ? 'flex' : 'none'
    }
    showToast(`Jogo online: ${selectedOnlineGame === 'beatball' ? '⚽ BeatBall 2D' : '🏎️ Turbo Soccer 3D'}`)
  })
})

// ── SELEÇÃO DE FORMATO ONLINE (VAGAS TOTAIS) ─────────────────
document.querySelectorAll('#online-format-bb .online-format-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#online-format-bb .online-format-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedOnlineBBFormat = ((btn as HTMLElement).dataset.format as '1v1' | '2v2') || '1v1'
    showToast(`Vagas BeatBall: ${btn.textContent?.trim()}`)
  })
})

document.querySelectorAll('#online-format-turbo .online-format-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#online-format-turbo .online-format-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedOnlineTurboFormat = ((btn as HTMLElement).dataset.format as TurboMatchFormat) || '1v1'
    showToast(`Vagas Turbo Soccer: ${btn.textContent?.trim()}`)
  })
})

document.getElementById('btn-online-host')!.addEventListener('click', async () => {
  if (onlineBusy || netManager) return
  onlineBusy = true
  setOnlineStatus('host', 'Criando sala...', '#00cfff')
  try {
    netManager = await createOnlineNetwork()
    const code = generateRoomCode()

    const countBadge = document.getElementById('online-player-count-badge')
    const launchBtn = document.getElementById('btn-online-launch')

    netManager.onPlayerCountChange = (count) => {
      if (countBadge) countBadge.textContent = `👥 ${count} Jogadores Conectados`
      setOnlineStatus('host', `✅ ${count} jogador(es) na sala. Pode aguardar mais amigos ou iniciar!`, '#00ff88')
      updatePublicRoomPlayerCount(code, count)
      refreshLobby()
    }

    launchBtn?.addEventListener('click', () => {
      if (!netManager || !netManager.isHost()) return
      removePublicRoom(code)
      refreshLobby()
      const count = netManager.getPlayerCount()
      const chosenFormat = selectedOnlineGame === 'turbo' ? selectedOnlineTurboFormat : selectedOnlineBBFormat
      netManager.send({
        t: performance.now(),
        event: 'start_game',
        gameType: selectedOnlineGame,
        format: chosenFormat,
        totalPlayers: count
      })
      showToast(`Iniciando ${chosenFormat} (${count} pessoas)!`)
      if (selectedOnlineGame === 'turbo') {
        const tuning = readTurboTuning()
        tuning.matchFormat = selectedOnlineTurboFormat
        showScreen('turbo3d')
        startTurboSoccer3D(selectedCar, tuning)
      } else {
        selectedBBFormat = selectedOnlineBBFormat
        startOnlineMatch()
      }
    })

    await netManager.init(code)

    const codeEl = document.getElementById('online-host-code')!
    codeEl.textContent = code
    const wrap = document.getElementById('online-host-code-wrap') as HTMLElement
    wrap.style.display = 'flex'
    setOnlineStatus('host', 'Aguardando amigos entrarem com o link ou código...', '#00cfff')

    // Publica no Lobby Público em tempo real
    const chosenFormat = selectedOnlineGame === 'turbo' ? selectedOnlineTurboFormat : selectedOnlineBBFormat
    const maxP = selectedOnlineGame === 'turbo' ? (chosenFormat === '4v4' ? 8 : chosenFormat === '3v3' ? 6 : chosenFormat === '2v2' ? 4 : 2) : (chosenFormat === '2v2' ? 4 : 2)
    publishPublicRoom({
      hostId: code,
      code,
      hostName: 'Jogador 1',
      gameType: selectedOnlineGame,
      format: chosenFormat,
      playerCount: 1,
      maxPlayers: maxP,
      createdAt: Date.now()
    })
    refreshLobby()
  } catch (err) {
    console.error('[Online] Falha ao criar sala:', err)
    setOnlineStatus('host', 'Falha ao criar sala. Tente novamente.', '#ff2d78')
    if (netManager) {
      netManager.onConnected = undefined
      netManager.onDisconnected = undefined
      netManager.onError = undefined
      netManager.destroy()
      netManager = null
    }
  } finally {
    onlineBusy = false
  }
})

document.getElementById('btn-online-copy')!.addEventListener('click', async () => {
  const code = document.getElementById('online-host-code')?.textContent || ''
  if (!code || code === '------') return
  try {
    await navigator.clipboard.writeText(code)
    showToast(`Código copiado: ${code}`)
  } catch {
    showToast(`Código: ${code}`)
  }
})

document.getElementById('btn-online-copy-link')?.addEventListener('click', async () => {
  const code = document.getElementById('online-host-code')?.textContent || ''
  if (!code || code === '------') return
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${code}`
  try {
    await navigator.clipboard.writeText(inviteUrl)
    showToast('Link de convite copiado!')
  } catch {
    showToast(`Link: ${inviteUrl}`)
  }
})

async function handleJoinRoom(asSpectator = false) {
  if (onlineBusy || netManager) return
  const input = document.getElementById('online-join-code') as HTMLInputElement
  const code = input.value.trim().toUpperCase()
  if (!code) {
    setOnlineStatus('join', 'Digite o código da sala.', '#ff2d78')
    return
  }

  onlineBusy = true
  setOnlineStatus('join', asSpectator ? 'Entrando como espectador...' : 'Conectando à sala...', '#a855f7')
  try {
    netManager = await createOnlineNetwork()
    await netManager.init()

    netManager.onDataReceived = (payload) => {
      if (payload.event === 'start_game') {
        const fmt = payload.format || '1v1'
        showToast(asSpectator ? `👁️ Transmitindo partida ${fmt} ao vivo!` : `Partida ${fmt} iniciada pelo Host!`)
        if (payload.gameType === 'turbo') {
          const tuning = readTurboTuning()
          if (payload.format) tuning.matchFormat = payload.format as TurboMatchFormat
          if (asSpectator) tuning.spectatorMode = true
          showScreen('turbo3d')
          startTurboSoccer3D(selectedCar, tuning)
        } else {
          if (payload.format) selectedBBFormat = payload.format as '1v1' | '2v2'
          startOnlineMatch()
        }
      }
    }

    netManager.onPlayerCountChange = (count) => {
      setOnlineStatus('join', asSpectator ? `👁️ Conectado como Espectador (${count} na sala). Aguardando início...` : `Conectado! ${count} jogadores na sala. Aguardando o host iniciar...`, '#00ff88')
    }

    await netManager.joinRoom(code, asSpectator)
    setOnlineStatus('join', asSpectator ? '👁️ Modo Espectador ativo! A transmissão iniciará assim que o Host começar.' : 'Conectado com sucesso! Aguardando o Host clicar em Iniciar...', '#a855f7')
  } catch (err) {
    console.error('[Online] Falha ao entrar:', err)
    setOnlineStatus('join', 'Não foi possível conectar. Confira o código.', '#ff2d78')
    if (netManager) {
      netManager.onDisconnected = undefined
      netManager.destroy()
      netManager = null
    }
  } finally {
    onlineBusy = false
  }
}

document.getElementById('btn-online-join')!.addEventListener('click', () => handleJoinRoom(false))
document.getElementById('btn-online-spectate')?.addEventListener('click', () => handleJoinRoom(true))

// ── SELEÇÃO DE DIFICULDADE (BEATBALL) ────────────────────────
document.querySelectorAll('.diff-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedDiff = (btn as HTMLElement).dataset.diff as 'easy' | 'medium' | 'hard'
  })
})

// ── SELEÇÃO DE TIME (BEATBALL) ───────────────────────────────
document.querySelectorAll('.team-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.team-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedTeamP1 = ((btn as HTMLElement).dataset.team || 'brazil') as TeamKey
  })
})

// ── SELEÇÃO DE CAMPO / CENÁRIO ──────────────────────────────
document.querySelectorAll('.theme-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedTheme = ((btn as HTMLElement).dataset.theme || 'classic') as FieldTheme
  })
})

document.getElementById('btn-back-to-menu')!.addEventListener('click', () => showScreen('menu'))
document.getElementById('btn-start-game')!.addEventListener('click', () => startBeatBall())
document.getElementById('btn-training-bb')?.addEventListener('click', () => {
  startBeatBall('bot')
  currentGame?.setTrainingMode(true)
  showToast('🎯 Treino Livre Ativado: Pratique condução e curvas!')
})

// ── PAUSE E REVANCHE ─────────────────────────────────────────
document.getElementById('btn-resume')!.addEventListener('click', () => {
  currentGame?.resume()
  pauseOverlay.classList.remove('visible')
})

document.getElementById('btn-pause-menu')!.addEventListener('click', () => {
  currentGame?.destroy()
  currentGame = null
  pauseOverlay.classList.remove('visible')
  if (netManager) resetOnlineUI()
  lastWasOnline = false
  showScreen('menu')
})

document.getElementById('btn-play-again')!.addEventListener('click', () => {
  if (lastWasOnline) {
    lastWasOnline = false
    resetOnlineUI()
    showScreen('online')
  } else {
    startBeatBall()
  }
})
document.getElementById('btn-victory-menu')!.addEventListener('click', () => {
  currentGame?.destroy()
  currentGame = null
  lastWasOnline = false
  showScreen('menu')
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentGame) {
    if (currentGame.isPaused()) {
      currentGame.resume()
      pauseOverlay.classList.remove('visible')
    } else {
      currentGame.pause()
      pauseOverlay.classList.add('visible')
    }
  }
})

// ── START BEATBALL 2D ────────────────────────────────────────
function startBeatBall() {
  launchBeatBall(gameMode)
}

function startOnlineMatch() {
  launchBeatBall('online', netManager ?? undefined)
}

function launchBeatBall(mode: 'bot' | '2p' | 'online', network?: NetworkManager) {
  if (currentGame) {
    currentGame.destroy()
    currentGame = null
  }
  if (currentTurboGame) {
    currentTurboGame.destroy()
    currentTurboGame = null
  }

  const isOnline = mode === 'online'
  lastWasOnline = isOnline
  const teamNameP1 = selectedTeamP1.toUpperCase()

  hudP1Name.textContent = isOnline ? 'VOCÊ' : teamNameP1
  hudP2Name.textContent = isOnline
    ? 'ADVERSÁRIO ONLINE'
    : mode === 'bot' ? `BOT IA (${selectedDiff.toUpperCase()})` : 'JOGADOR 2'
  hudScoreP1.textContent = '0'
  hudScoreP2.textContent = '0'
  hudTimer.textContent = '3:00'
  hudTimer.classList.remove('urgent')
  goalOverlay.classList.remove('show')
  pauseOverlay.classList.remove('visible')

  showScreen('game')

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement
  currentGame = new Game({
    canvas,
    mode,
    format: selectedBBFormat,
    difficulty: selectedDiff,
    theme: selectedTheme,
    teamP1: selectedTeamP1,
    teamP2: selectedTeamP1 === 'usa' ? 'brazil' : 'usa',
    network,
    playerName: isOnline ? 'Jogador Online' : undefined,

    onScoreUpdate(p1, p2) {
      hudScoreP1.textContent = String(p1)
      hudScoreP2.textContent = String(p2)
    },

    onTimerUpdate(sec) {
      const m = Math.floor(sec / 60)
      const s = sec % 60
      hudTimer.textContent = `${m}:${s.toString().padStart(2, '0')}`
      if (sec <= 30) hudTimer.classList.add('urgent')
      else hudTimer.classList.remove('urgent')
    },

    onGoal(scorer) {
      if (isOnline) {
        goalScorer.textContent = scorer === 'p1' ? '⚽ VOCÊ MARCOU GOL!' : '⚽ ADVERSÁRIO MARCOU!'
      } else {
        goalScorer.textContent = scorer === 'p1' ? `⚽ ${teamNameP1} MARCOU GOL!` : '⚽ BOT / ADVERSÁRIO MARCOU!'
      }
      goalOverlay.classList.add('show')
      setTimeout(() => goalOverlay.classList.remove('show'), 2000)
    },

    onPowerChange(pct) {
      if (pct > 0) {
        powerBarWrap.classList.add('visible')
        pbFill.style.width = `${pct * 100}%`
      } else {
        powerBarWrap.classList.remove('visible')
        pbFill.style.width = '0%'
      }
    },

    onGameEnd(winner, p1, p2) {
      currentGame?.destroy()
      currentGame = null

      if (isOnline) {
        const net = netManager
        netManager = null
        if (net) {
          net.onConnected = undefined
          net.onDisconnected = undefined
          net.onError = undefined
          net.destroy()
        }
      }

      if (winner === 'draw') {
        victoryTitle.textContent = 'EMPATE!'
        victoryWinner.textContent = 'DISPUTA EQUILIBRADA!'
      } else {
        victoryTitle.textContent = 'FIM DE JOGO!'
        victoryWinner.textContent = winner === 'p1'
          ? (isOnline ? '🏆 VOCÊ VENCEU A PARTIDA ONLINE!' : `🏆 VITÓRIA DO ${teamNameP1}!`)
          : (isOnline ? '🏆 O ADVERSÁRIO VENCEU A PARTIDA ONLINE!' : '🏆 VITÓRIA DO ADVERSÁRIO!')
      }

      victoryScore.textContent = `${p1} × ${p2}`
      showScreen('victory')
    }
  })
}

// ── EASTER EGG: digite "ARENA" em qualquer tela ─────────────
let eggBuffer = ''
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.key.length !== 1) return
  eggBuffer = (eggBuffer + e.key.toLowerCase()).slice(-5)
  if (eggBuffer !== 'arena') return
  eggBuffer = ''
  showToast('🎉 Segredo encontrado! Bem-vindo à Arena!')
  void import('canvas-confetti')
    .then((mod) => mod.default({ particleCount: 180, spread: 100, origin: { y: 0.6 } }))
    .catch(() => {})
})

// ── TOAST MESSAGE ────────────────────────────────────────────
let toastTimer: number | null = null
export function showToast(msg: string) {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.classList.add('show')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2500)
}

// ── ENTRADA AUTOMÁTICA EM SALA VIA LINK (?room=ARENA-XXXX) ──────
const urlParams = new URLSearchParams(window.location.search)
const roomParam = urlParams.get('room')
if (roomParam) {
  showScreen('online')
  const joinInput = document.getElementById('online-join-code') as HTMLInputElement
  if (joinInput) joinInput.value = roomParam.trim().toUpperCase()
  showToast(`Sala detectada: ${roomParam}. Conectando...`)
  setTimeout(() => {
    document.getElementById('btn-online-join')?.click()
  }, 600)
}

// ── LOBBY PÚBLICO (SALA PÚBLICA LISTADA) ──────────────────────
document.getElementById('btn-refresh-rooms')?.addEventListener('click', () => {
  refreshLobby()
  showToast('🔄 Lista de salas atualizada!')
})

setupLobbyListener(() => {
  refreshLobby()
})
