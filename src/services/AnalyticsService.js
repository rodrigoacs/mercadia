class AnalyticsService {
  constructor(repository) {
    this.repository = repository
  }

  async _getRawData() {
    return await this.repository.getAll()
  }

  async getDashboardData() {
    const data = await this._getRawData()
    if (data.length === 0) return { empty: true }

    const timeline = {}
    const setDistribution = {}

    data.forEach(d => {
      if (!timeline[d.date]) timeline[d.date] = 0
      timeline[d.date] += d.totalPrice
    })

    const dates = Object.keys(timeline).sort()
    const lastDate = dates[dates.length - 1]
    const currentValue = timeline[lastDate]
    const yesterdayValue = dates.length > 1 ? timeline[dates[dates.length - 2]] : currentValue

    const index30d = dates.length > 30 ? dates.length - 31 : 0
    const value30d = timeline[dates[index30d]]

    const todayData = data.filter(d => d.date === lastDate)
    const totalCards = todayData.reduce((acc, c) => acc + c.qty, 0)
    const avgTicket = totalCards > 0 ? currentValue / totalCards : 0

    todayData.forEach(c => {
      if (!setDistribution[c.set]) setDistribution[c.set] = 0
      setDistribution[c.set] += c.totalPrice
    })

    const sortedSets = Object.entries(setDistribution).sort((a, b) => b[1] - a[1])
    const topSets = sortedSets.slice(0, 5)
    const otherSetsValue = sortedSets.slice(5).reduce((acc, curr) => acc + curr[1], 0)

    const setChartData = {
      labels: [...topSets.map(s => s[0]), 'Outros'],
      values: [...topSets.map(s => s[1]), otherSetsValue]
    }

    const tiers = {
      bulk: { qty: 0, value: 0, label: 'Bulk (< R$ 2)' },
      low: { qty: 0, value: 0, label: 'Low (R$ 2-10)' },
      mid: { qty: 0, value: 0, label: 'Mid (R$ 10-50)' },
      high: { qty: 0, value: 0, label: 'High (> R$ 50)' }
    }

    todayData.forEach(c => {
      if (c.unitPrice < 2) { tiers.bulk.qty += c.qty; tiers.bulk.value += c.totalPrice }
      else if (c.unitPrice < 10) { tiers.low.qty += c.qty; tiers.low.value += c.totalPrice }
      else if (c.unitPrice < 50) { tiers.mid.qty += c.qty; tiers.mid.value += c.totalPrice }
      else { tiers.high.qty += c.qty; tiers.high.value += c.totalPrice }
    })

    let topGainers = [], topLosers = [], dailyChartData = { labels: [], values: [] }

    if (dates.length > 1) {
      for (let i = 1; i < dates.length; i++) {
        dailyChartData.labels.push(dates[i])
        dailyChartData.values.push(timeline[dates[i]] - timeline[dates[i - 1]])
      }

      const prevDate = dates[dates.length - 2]
      const prevData = data.filter(d => d.date === prevDate)
      const prevMap = new Map(prevData.map(c => [`${c.name}|${c.set}|${c.num}|${c.extras}`, c.unitPrice]))

      const variations = []
      todayData.forEach(h => {
        const oldPrice = prevMap.get(`${h.name}|${h.set}|${h.num}|${h.extras}`)
        if (oldPrice !== undefined && oldPrice > 0) {
          const diff = h.unitPrice - oldPrice
          if (Math.abs(diff) >= 0.01) {
            variations.push({ name: h.name, set: h.set, diff: diff, extras: h.extras })
          }
        }
      })

      topGainers = [...variations].filter(v => v.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5)
      topLosers = [...variations].filter(v => v.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5)
    }

    return {
      empty: false,
      kpis: {
        totalValue: currentValue,
        totalCards: totalCards,
        avgTicket: avgTicket,
        dayVar: currentValue - yesterdayValue,
        monthVar: currentValue - value30d,
        lastUpdate: lastDate
      },
      chart: { labels: dates, values: dates.map(d => timeline[d]) },
      dailyChart: dailyChartData,
      setChart: setChartData,
      tiers,
      topGainers,
      topLosers
    }
  }

  async searchCard(query) {
    const data = await this._getRawData()
    if (data.length === 0) return []
    const uniqueDates = [...new Set(data.map(d => d.date))].sort()
    const lastDate = uniqueDates[uniqueDates.length - 1]

    let results = data.filter(d => d.date === lastDate && d.name.toLowerCase().includes(query))

    return results.map(card => {
      const history = data
        .filter(d => d.name === card.name && d.set === card.set && d.num === card.num && d.extras === card.extras)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(h => ({ date: h.date, value: h.unitPrice }))
      return { ...card, history }
    }).sort((a, b) => b.totalPrice - a.totalPrice)
  }

  async getInventory() {
    const data = await this._getRawData()
    if (data.length === 0) return []
    const uniqueDates = [...new Set(data.map(d => d.date))].sort()
    const lastDate = uniqueDates[uniqueDates.length - 1]

    return data.filter(d => d.date === lastDate)
  }
}
module.exports = AnalyticsService