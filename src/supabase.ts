// ============================================================
//  supabase.ts — Integração Banco de Dados & Leaderboard Gratuito
//  Suporta chaves via env VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
//  com fallback local automático no localStorage para rodar liso sem credenciais!
// ============================================================
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface LeaderboardEntry {
  id?: string
  player_name: string
  wins: number
  goals: number
  rating: number
  created_at?: string
}

class SupabaseService {
  private client: SupabaseClient | null = null

  constructor() {
    const meta = import.meta as any
    const url = meta.env?.VITE_SUPABASE_URL
    const key = meta.env?.VITE_SUPABASE_ANON_KEY

    if (url && key) {
      try {
        this.client = createClient(url, key)
      } catch (e) {
        console.warn('Supabase credentials invalid, using localStorage fallback.')
      }
    }
  }

  async recordMatchResult(playerName: string, isWin: boolean, goalsScored: number): Promise<void> {
    if (this.client) {
      try {
        await this.client.from('match_history').insert({
          player_name: playerName,
          won: isWin,
          goals: goalsScored,
          played_at: new Date().toISOString()
        })
        return
      } catch (err) {
        console.warn('Supabase match recording failed, saving locally:', err)
      }
    }

    // Fallback: LocalStorage Leaderboard
    const local = this.getLocalLeaderboard()
    let user = local.find(u => u.player_name.toLowerCase() === playerName.toLowerCase())
    if (!user) {
      user = { player_name: playerName, wins: 0, goals: 0, rating: 1000 }
      local.push(user)
    }

    user.goals += goalsScored
    if (isWin) {
      user.wins += 1
      user.rating += 25
    } else {
      user.rating = Math.max(500, user.rating - 15)
    }

    localStorage.setItem('arena_kick_leaderboard', JSON.stringify(local))
  }

  async getTopPlayers(): Promise<LeaderboardEntry[]> {
    if (this.client) {
      try {
        // Lê a MESMA tabela em que recordMatchResult grava (match_history)
        // e agrega o ranking no cliente para manter consistência.
        const { data, error } = await this.client
          .from('match_history')
          .select('player_name, won, goals')

        if (!error && data && data.length > 0) {
          const map = new Map<string, LeaderboardEntry>()
          for (const row of data as Array<{ player_name: string; won: boolean; goals: number }>) {
            const name = row.player_name
            const entry = map.get(name) ?? { player_name: name, wins: 0, goals: 0, rating: 1000 }
            entry.goals += row.goals ?? 0
            if (row.won) {
              entry.wins += 1
              entry.rating += 25
            } else {
              entry.rating = Math.max(500, entry.rating - 15)
            }
            map.set(name, entry)
          }
          return [...map.values()].sort((a, b) => b.rating - a.rating).slice(0, 10)
        }
      } catch (e) {
        // fallback
      }
    }

    return this.getLocalLeaderboard().sort((a, b) => b.rating - a.rating).slice(0, 10)
  }

  private getLocalLeaderboard(): LeaderboardEntry[] {
    try {
      const raw = localStorage.getItem('arena_kick_leaderboard')
      if (raw) return JSON.parse(raw)
    } catch {}

    // Mock inicial para já dar sensação de comunidade
    return [
      { player_name: 'StrikerPRO', wins: 24, goals: 68, rating: 1450 },
      { player_name: 'SpeedyGoal', wins: 18, goals: 52, rating: 1320 },
      { player_name: 'TurboBeast', wins: 15, goals: 41, rating: 1210 },
      { player_name: 'RocketKid', wins: 11, goals: 30, rating: 1150 }
    ]
  }
}

export const dbService = new SupabaseService()
