import { getRawData } from './data.js'

const buildTimeline = (data) => {
  const timeline = {}
  data.forEach(d => {
    if (!timeline[d.date]) timeline[d.date] = 0
    timeline[d.date] += d.totalPrice
  })
  const dates = Object.keys(timeline).sort()
  return { timeline, dates }
}

const calculateKPIs = (timeline, dates, todayData, lastDate) => {
  const currentValue = timeline[lastDate]
  const yesterdayValue = dates.length > 1 ? timeline[dates[dates.length - 2]] : currentValue
  const index30d = dates.length > 30 ? dates.length - 31 : 0
  const value30d = timeline[dates[index30d]]
  const totalCards = todayData.reduce((acc, c) => acc + c.qty, 0)
  const avgTicket = totalCards > 0 ? currentValue / totalCards : 0

  return {
    totalValue: currentValue, totalCards: totalCards, avgTicket: avgTicket,
    dayVar: currentValue - yesterdayValue, monthVar: currentValue - value30d, lastUpdate: lastDate
  }
}

const calculateSetDistribution = (todayData) => {
  const setDistribution = {}
  todayData.forEach(c => {
    if (!setDistribution[c.set]) setDistribution[c.set] = 0
    setDistribution[c.set] += c.totalPrice
  })
  const sortedSets = Object.entries(setDistribution).sort((a, b) => b[1] - a[1])
  const topSets = sortedSets.slice(0, 5)
  const otherSetsValue = sortedSets.slice(5).reduce((acc, curr) => acc + curr[1], 0)
  return { labels: [...topSets.map(s => s[0]), 'Outros'], values: [...topSets.map(s => s[1]), otherSetsValue] }
}

const calculateTiers = (todayData) => {
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
  return tiers
}

const calculateVariations = (data, timeline, dates, todayData) => {
  let topGainers = [], topLosers = [], dailyChartData = { labels: [], values: [] }
  if (dates.length <= 1) return { topGainers, topLosers, dailyChartData }

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
        variations.push({ name: h.name, set: h.set, diff: diff, extras: h.extras, imageUri: h.imageUri, manaCost: h.manaCost })
      }
    }
  })

  topGainers = [...variations].filter(v => v.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5)
  topLosers = [...variations].filter(v => v.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5)

  return { topGainers, topLosers, dailyChartData }
}

// === NOVAS FUNÇÕES: DISTRIBUIÇÃO E RARIDADE ===
const calculateColorDistribution = (todayData) => {
  const dist = { W: 0, U: 0, B: 0, R: 0, G: 0, M: 0, C: 0 }
  todayData.forEach(c => {
    if (c.colorIdentity === 'C' || !c.colorIdentity) dist.C += c.qty
    else {
      const colors = c.colorIdentity.split(',')
      if (colors.length > 1) dist.M += c.qty
      else dist[colors[0]] += c.qty
    }
  })
  return dist
}

const calculateRarityDistribution = (todayData) => {
  const dist = { common: 0, uncommon: 0, rare: 0, mythic: 0 }
  todayData.forEach(c => {
    const r = c.rarity ? c.rarity.toLowerCase() : ''
    if (dist[r] !== undefined) dist[r] += c.qty
  })
  return dist
}

export const getDashboardData = async () => {
  const data = await getRawData()
  if (data.length === 0) return { empty: true }

  const { timeline, dates } = buildTimeline(data)
  const lastDate = dates[dates.length - 1]
  const todayData = data.filter(d => d.date === lastDate)

  const kpis = calculateKPIs(timeline, dates, todayData, lastDate)
  const setChart = calculateSetDistribution(todayData)
  const tiers = calculateTiers(todayData)
  const variations = calculateVariations(data, timeline, dates, todayData)

  return {
    empty: false, kpis, chart: { labels: dates, values: dates.map(d => timeline[d]) },
    dailyChart: variations.dailyChartData, setChart, tiers, topGainers: variations.topGainers, topLosers: variations.topLosers,
    // Enviando os novos dados pro Frontend
    colorDist: calculateColorDistribution(todayData),
    rarityDist: calculateRarityDistribution(todayData)
  }
}

export const searchCardData = async (query) => {
  const data = await getRawData()
  if (data.length === 0) return []
  const uniqueDates = [...new Set(data.map(d => d.date))].sort()
  const lastDate = uniqueDates[uniqueDates.length - 1]

  // === BUSCA PROFUNDA (ORACLE TEXT) ===
  // Agora a busca pega o Nome OU qualquer coisa escrita nas regras da carta
  let results = data.filter(d => 
    d.date === lastDate && 
    (d.name.toLowerCase().includes(query) || (d.oracleText && d.oracleText.toLowerCase().includes(query)))
  )

  return results.map(card => {
    const history = data
      .filter(d => d.name === card.name && d.set === card.set && d.num === card.num && d.extras === card.extras)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(h => ({ date: h.date, value: h.unitPrice }))
    return { ...card, history }
  }).sort((a, b) => b.totalPrice - a.totalPrice)
}

export const getInventoryData = async () => {
  const data = await getRawData()
  if (data.length === 0) return []
  const uniqueDates = [...new Set(data.map(d => d.date))].sort()
  const lastDate = uniqueDates[uniqueDates.length - 1]
  return data.filter(d => d.date === lastDate)
}

export const getCommanderPoolData = async (commanderColors) => {
  const data = await getRawData()
  if (data.length === 0) return []

  const uniqueDates = [...new Set(data.map(d => d.date))].sort()
  const lastDate = uniqueDates[uniqueDates.length - 1]
  const inventory = data.filter(d => d.date === lastDate)

  const allowedColors = commanderColors === 'C' || !commanderColors ? [] : commanderColors.split(',')

  return inventory.filter(card => {
    const isLegal = card.legalities && card.legalities.commander === 'legal'
    if (!isLegal) return false
    if (card.colorIdentity === 'C') return true
    const cardColors = card.colorIdentity.split(',')
    return cardColors.every(c => allowedColors.includes(c))
  }).sort((a, b) => b.totalPrice - a.totalPrice)
}