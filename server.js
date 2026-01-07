const express = require('express')
const cors = require('cors')
const path = require('path')

// Importações (MVC)
const CsvRepository = require('./src/repositories/CsvRepository')
const AnalyticsService = require('./src/services/AnalyticsService')
const DashboardController = require('./src/controllers/DashboardController')

const app = express()
app.use(cors())
app.use(express.static('public'))

// Configuração (Wiring)
const csvFile = path.join(__dirname, 'data', 'historico_cartas.csv')
const repository = new CsvRepository(csvFile)
const service = new AnalyticsService(repository)
const controller = new DashboardController(service)

// Rotas
app.get('/api/dashboard', (req, res) => controller.getDashboard(req, res))
app.get('/api/search', (req, res) => controller.search(req, res))
app.get('/api/inventory', (req, res) => controller.getInventory(req, res)) // Nova rota

app.listen(3000, () => {
  console.log('🚀 Sistema Mercadia Rodando: http://localhost:3000')
})