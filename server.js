import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import jwt from 'jsonwebtoken'

import { verifyToken } from './src/auth.js'
import { getDashboardData, searchCardData, getInventoryData, getCommanderPoolData } from './src/analytics.js'
import { createDeck, getDecks, getDeckDetails, deleteDeck, updateDeckCover, setCommander, getCardPrints, updateDeckCardPrint } from './src/deckManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ==========================================
// ROTA PÚBLICA (LOGIN)
// ==========================================
app.post('/api/login', (req, res) => {
  const { password } = req.body

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Erro de servidor: ADMIN_PASSWORD não configurada no .env' })
  }

  if (password === process.env.ADMIN_PASSWORD) {
    // Senha bateu! Gera um token válido por 30 dias.
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '30d' })
    res.json({ success: true, token })
  } else {
    res.status(401).json({ error: 'Senha incorreta.' })
  }
})

// ==========================================
// O LEÃO DE CHÁCARA (Tranca tudo abaixo daqui)
// ==========================================
app.use('/api', verifyToken)

// ==========================================
// ROTAS DO INVENTÁRIO E DASHBOARD (PROTEGIDAS)
// ==========================================
app.get('/api/dashboard', async (req, res) => {
  try { res.json(await getDashboardData()) }
  catch (error) { res.status(500).json({ error: 'Erro ao carregar dashboard.' }) }
})

app.get('/api/search', async (req, res) => {
  try { res.json(await searchCardData((req.query.q || '').toLowerCase())) }
  catch (error) { res.status(500).json({ error: 'Erro ao buscar cartas.' }) }
})

app.get('/api/inventory', async (req, res) => {
  try { res.json(await getInventoryData()) }
  catch (error) { res.status(500).json({ error: 'Erro ao carregar inventário.' }) }
})

app.get('/api/commander-pool', async (req, res) => {
  try { res.json(await getCommanderPoolData(req.query.colors || 'C')) }
  catch (error) { res.status(500).json({ error: 'Erro ao carregar pool de Commander.' }) }
})

// ==========================================
// ROTAS DO GESTOR DE DECKS (PROTEGIDAS)
// ==========================================
app.post('/api/decks', async (req, res) => {
  try {
    const { name, format, deckText } = req.body
    if (!name || !deckText) return res.status(400).json({ error: 'Nome e lista são obrigatórios.' })
    const result = await createDeck(name, format, deckText)
    res.json(result)
  } catch (error) { res.status(500).json({ error: 'Erro interno ao salvar o deck.' }) }
})

app.get('/api/decks', async (req, res) => {
  try { res.json(await getDecks()) } catch (error) { res.status(500).json({ error: 'Erro ao listar decks.' }) }
})

app.get('/api/decks/:id', async (req, res) => {
  try { res.json(await getDeckDetails(req.params.id)) } catch (error) { res.status(500).json({ error: 'Erro ao carregar detalhes do deck.' }) }
})

app.put('/api/decks/:id/cover', async (req, res) => {
  try {
    if (!req.body.imageUri) return res.status(400).json({ error: 'URL da imagem é obrigatória.' })
    await updateDeckCover(req.params.id, req.body.imageUri)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: 'Erro ao atualizar capa do deck.' }) }
})

app.put('/api/decks/:id/commander', async (req, res) => {
  try {
    if (!req.body.cardName) return res.status(400).json({ error: 'Nome da carta obrigatório.' })
    await setCommander(req.params.id, req.body.cardName)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: 'Erro ao definir comandante.' }) }
})

app.get('/api/cards/prints', async (req, res) => {
  try {
    if (!req.query.name) return res.status(400).json({ error: 'Nome da carta obrigatório.' })
    res.json(await getCardPrints(req.query.name))
  } catch (error) { res.status(500).json({ error: 'Erro ao buscar impressões.' }) }
})

app.put('/api/decks/:id/card-print', async (req, res) => {
  try {
    const { cardName, setCode, imageUri } = req.body
    if (!cardName || !imageUri) return res.status(400).json({ error: 'Dados incompletos.' })
    await updateDeckCardPrint(req.params.id, cardName, setCode, imageUri)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: 'Erro ao atualizar a arte da carta.' }) }
})

app.delete('/api/decks/:id', async (req, res) => {
  try {
    await deleteDeck(req.params.id)
    res.json({ success: true })
  } catch (error) { res.status(500).json({ error: 'Erro ao deletar o deck.' }) }
})

app.listen(port, () => {
  console.log(`🚀 Servidor Mercadia rodando com JWT Seguro em http://localhost:${port}`)
})