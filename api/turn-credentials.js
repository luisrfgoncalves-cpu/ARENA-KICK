// api/turn-credentials.js — Vercel Serverless Function para entrega segura de credenciais TURN
// Nunca expõe a API Key permanente no cliente/frontend.
// As credenciais retornadas são efêmeras (temporárias) geradas diretamente pelo Metered.ca.

export default async function handler(req, res) {
  // Configura cabeçalhos de CORS e segurança
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const domain = process.env.METERED_DOMAIN
  const apiKey = process.env.METERED_API_KEY

  if (!domain || !apiKey) {
    return res.status(503).json({
      configured: false,
      error: 'METERED_NOT_CONFIGURED',
      message: 'Variáveis de ambiente METERED_DOMAIN ou METERED_API_KEY não configuradas no servidor Vercel.'
    })
  }

  try {
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    const url = `https://${cleanDomain}/api/v1/turn/credentials?apiKey=${apiKey}`

    const response = await fetch(url)
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return res.status(502).json({
        configured: true,
        error: 'METERED_API_ERROR',
        status: response.status,
        message: `Falha ao consultar servidor Metered: HTTP ${response.status}`,
        details: errText.slice(0, 200)
      })
    }

    const data = await response.json()
    // Normaliza para array de iceServers padrão WebRTC
    const iceServers = Array.isArray(data) ? data : (data.iceServers || [])

    return res.status(200).json({
      configured: true,
      iceServers
    })
  } catch (err) {
    return res.status(500).json({
      configured: true,
      error: 'SERVERLESS_FETCH_FAILED',
      message: err.message || 'Erro inesperado ao consultar a API Metered.'
    })
  }
}

