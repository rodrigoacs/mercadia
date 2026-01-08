class DashboardController {
  constructor(service) {
    this.service = service
  }

  async getDashboard(req, res) {
    try {
      const data = await this.service.getDashboardData()
      res.json(data)
    } catch (error) {
      console.error(error)
      res.status(500).send('Erro interno')
    }
  }

  async search(req, res) {
    try {
      const query = req.query.q ? req.query.q.toLowerCase() : ''
      if (query.length < 2) return res.json([])
      const results = await this.service.searchCard(query)
      res.json(results)
    } catch (error) {
      console.error(error)
      res.status(500).json([])
    }
  }

  async getInventory(req, res) {
    try {
      const results = await this.service.getInventory()
      res.json(results)
    } catch (error) {
      console.error(error)
      res.status(500).json([])
    }
  }
}
module.exports = DashboardController