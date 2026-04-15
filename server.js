import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import jwt from 'jsonwebtoken'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import { verifyToken } from './src/auth.js'
import { getDashboardData, searchCardData, getInventoryData } from './src/analytics.js'
import { createDeck, getDecks, getDeckDetails, deleteDeck, updateDeckCover, setCommander, getCardPrints, updateDeckCardPrint } from './src/deckManager.js'
import { syncLigaMagic } from './src/ligaParser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = process.env.PORT || 3000

app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json({ limit: '50mb' }))
app.use(express.static(path.join(__dirname, 'public')))

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas de login. Por favor, aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
})

app.get('/api/ping', (req, res) => res.json({ status: 'pong' }))

app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'Erro: ADMIN_PASSWORD não configurada' })
  if (password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '30d' })
    res.json({ success: true, token })
  } else {
    res.status(401).json({ error: 'Senha incorreta.' })
  }
})

app.use('/api', verifyToken)

app.post('/api/sync-liga', async (req, res) => {
  try {
    if (!req.body.html) return res.status(400).json({ error: 'O conteúdo HTML é obrigatório.' })
    const result = await syncLigaMagic(req.body.html)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message || 'Erro ao processar o HTML.' })
  }
})

app.get('/api/dashboard', async (req, res) => {
  try { res.json(await getDashboardData()) } catch (error) { res.status(500).json({ error: 'Erro no dashboard.' }) }
})

app.get('/api/search', async (req, res) => {
  try { res.json(await searchCardData((req.query.q || '').toLowerCase())) } catch (error) { res.status(500).json({ error: 'Erro na busca.' }) }
})

app.get('/api/inventory', async (req, res) => {
  try { res.json(await getInventoryData()) } catch (error) { res.status(500).json({ error: 'Erro no inventário.' }) }
})

app.post('/api/decks', async (req, res) => {
  try {
    const { name, format, deckText } = req.body
    if (!name || !deckText) return res.status(400).json({ error: 'Nome e lista são obrigatórios.' })
    res.json(await createDeck(name, format, deckText))
  } catch (error) { res.status(500).json({ error: 'Erro ao salvar o deck.' }) }
})

app.get('/api/decks', async (req, res) => {
  try { res.json(await getDecks()) } catch (error) { res.status(500).json({ error: 'Erro ao listar decks.' }) }
})

app.get('/api/decks/:id', async (req, res) => {
  try { res.json(await getDeckDetails(req.params.id)) } catch (error) { res.status(500).json({ error: 'Erro nos detalhes.' }) }
})

app.put('/api/decks/:id/cover', async (req, res) => {
  try {
    if (!req.body.imageUri) return res.status(400).json({ error: 'URL obrigatória.' })
    await updateDeckCover(req.params.id, req.body.imageUri)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: 'Erro na capa.' }) }
})

app.put('/api/decks/:id/commander', async (req, res) => {
  try {
    if (!req.body.cardName) return res.status(400).json({ error: 'Nome obrigatório.' })
    await setCommander(req.params.id, req.body.cardName)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: 'Erro no comandante.' }) }
})

app.get('/api/cards/prints', async (req, res) => {
  try {
    if (!req.query.name) return res.status(400).json({ error: 'Nome obrigatório.' })
    res.json(await getCardPrints(req.query.name))
  } catch (error) { res.status(500).json({ error: 'Erro nos prints.' }) }
})

app.put('/api/decks/:id/card-print', async (req, res) => {
  try {
    const { cardName, setCode, imageUri } = req.body
    if (!cardName || !imageUri) return res.status(400).json({ error: 'Dados incompletos.' })
    await updateDeckCardPrint(req.params.id, cardName, setCode, imageUri)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: 'Erro na arte.' }) }
})

app.delete('/api/decks/:id', async (req, res) => {
  try { await deleteDeck(req.params.id); res.json({ success: true }) } catch (error) { res.status(500).json({ error: 'Erro ao deletar.' }) }
})

app.listen(port, () => console.log(`Mercadia rodando em http://localhost:${port}`))