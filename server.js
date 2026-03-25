import express from 'express'
import cors from 'cors'
import { getDashboard, search, getInventory, getCommanderPool } from './src/handlers.js'

const app = express()
app.use(cors())
app.use(express.static('public'))

// Rotas da nossa API
app.get('/api/dashboard', getDashboard)
app.get('/api/search', search)
app.get('/api/inventory', getInventory)
app.get('/api/commander-pool', getCommanderPool) // A mágica acontece aqui

app.listen(3000, () => {
  console.log('🚀 Sistema Mercadia Rodando: http://localhost:3000')
})