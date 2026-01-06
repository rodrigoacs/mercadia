const express = require('express')
const fs = require('fs')
const csv = require('csv-parser')
const cors = require('cors')
const path = require('path')

const app = express()
app.use(cors())
app.use(express.static('public'))

const DATA_DIR = path.join(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR)
}

const CSV_FILE = path.join(DATA_DIR, 'historico_cartas.csv')

function readCSV() {
  return new Promise((resolve, reject) => {
    const results = []
    if (!fs.existsSync(CSV_FILE)) return resolve([])

    fs.createReadStream(CSV_FILE)
      .pipe(csv())
      .on('data', (row) => {
        const total = parseFloat(row.Preco_Total)
        const qty = parseInt(row.Qtd)
        if (!isNaN(total)) {
          results.push({
            date: row.Data,
            name: row.Nome,
            set: row.Edicao,
            num: row.Num,
            extras: row.Extras || '',
            qty: qty,
            unitPrice: parseFloat(row.Preco_Unit),
            totalPrice: total
          })
        }
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err))
  })
}

app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await readCSV()
    if (data.length === 0) return res.json({ empty: true })

    const timeline = {}
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
    const monthVar = currentValue - value30d

    const todayData = data.filter(d => d.date === lastDate)
    const totalCards = todayData.reduce((acc, c) => acc + c.qty, 0)

    const avgTicket = totalCards > 0 ? currentValue / totalCards : 0

    const tiers = {
      bulk: { qty: 0, value: 0, label: 'Bulk (< R$ 2)' },
      low: { qty: 0, value: 0, label: 'Low (R$ 2-10)' },
      mid: { qty: 0, value: 0, label: 'Mid (R$ 10-50)' },
      high: { qty: 0, value: 0, label: 'High (> R$ 50)' }
    }

    todayData.forEach(c => {
      if (c.unitPrice < 2) {
        tiers.bulk.qty += c.qty; tiers.bulk.value += c.totalPrice
      } else if (c.unitPrice < 10) {
        tiers.low.qty += c.qty; tiers.low.value += c.totalPrice
      } else if (c.unitPrice < 50) {
        tiers.mid.qty += c.qty; tiers.mid.value += c.totalPrice
      } else {
        tiers.high.qty += c.qty; tiers.high.value += c.totalPrice
      }
    })

    const topAssets = [...todayData].sort((a, b) => b.totalPrice - a.totalPrice).slice(0, 10)

    let topGainers = []
    let topLosers = []
    let dailyChartData = { labels: [], values: [] }

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
            variations.push({
              name: h.name,
              set: h.set,
              extras: h.extras,
              diff: diff,
              current: h.unitPrice
            })
          }
        }
      })

      topGainers = [...variations]
        .filter(v => v.diff > 0)
        .sort((a, b) => b.diff - a.diff)
        .slice(0, 5)

      topLosers = [...variations]
        .filter(v => v.diff < 0)
        .sort((a, b) => a.diff - b.diff)
        .slice(0, 5)
    }

    res.json({
      empty: false,
      kpis: {
        totalValue: currentValue,
        totalCards: totalCards,
        avgTicket: avgTicket,
        dayVar: currentValue - yesterdayValue,
        monthVar: monthVar,
        lastUpdate: lastDate
      },
      chart: { labels: dates, values: dates.map(d => timeline[d]) },
      dailyChart: dailyChartData,
      tiers,
      topAssets,
      topGainers,
      topLosers
    })

  } catch (err) {
    console.error(err)
    res.status(500).send('Server Error')
  }
})

app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q ? req.query.q.toLowerCase() : ''
    if (query.length < 2) return res.json([])

    const data = await readCSV()
    if (data.length === 0) return res.json([])

    const uniqueDates = [...new Set(data.map(d => d.date))].sort()
    const lastDate = uniqueDates[uniqueDates.length - 1]

    let results = data.filter(d =>
      d.date === lastDate &&
      d.name.toLowerCase().includes(query)
    )

    results = results.map(card => {
      const history = data
        .filter(d =>
          d.name === card.name &&
          d.set === card.set &&
          d.num === card.num &&
          d.extras === card.extras
        )
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(h => ({ date: h.date, value: h.unitPrice }))

      return { ...card, history }
    })

    results.sort((a, b) => b.totalPrice - a.totalPrice)

    res.json(results)

  } catch (err) {
    console.error(err)
    res.status(500).json([])
  }
})

app.listen(3000, () => {
  console.log('🚀 Dashboard Running: http://localhost:3000')
})