import { getDashboardData, searchCardData, getInventoryData, getCommanderPoolData } from './analytics.js'

export const getDashboard = async (req, res) => {
  try {
    const data = await getDashboardData()
    res.json(data)
  } catch (error) {
    console.error('Erro ao processar os dados do dashboard:', error)
    res.status(500).send('Erro interno no servidor')
  }
}

export const search = async (req, res) => {
  try {
    const query = req.query.q ? req.query.q.toLowerCase() : ''
    if (query.length < 2) return res.json([])
    const results = await searchCardData(query)
    res.json(results)
  } catch (error) {
    console.error('Erro ao realizar a busca de cartas:', error)
    res.status(500).json([])
  }
}

export const getInventory = async (req, res) => {
  try {
    const results = await getInventoryData()
    res.json(results)
  } catch (error) {
    console.error('Erro ao buscar o inventário completo:', error)
    res.status(500).json([])
  }
}

export const getCommanderPool = async (req, res) => {
  try {
    const colors = req.query.colors ? req.query.colors.toUpperCase() : 'C'
    const results = await getCommanderPoolData(colors)
    res.json(results)
  } catch (error) {
    console.error('Erro ao buscar o pool de Commander:', error)
    res.status(500).json([])
  }
}