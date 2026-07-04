import { fetchRawDataFromDB } from './data.js'
import { pool } from './db.js'

let dashboardCache = null
let inventoryCache = null
let searchDataCache = null
let lastFetch = 0
let cacheBuildPromise = null
const CACHE_TTL = 5 * 60 * 1000

const buildTimeline = (data) => {
  const timeline = {}
  data.forEach(d => {
    if (!timeline[d.date]) timeline[d.date] = 0
    timeline[d.date] += d.totalPrice
  })
  const dates = Object.keys(timeline).sort()
  return { timeline, dates }
}

const calculateKPIs = (timeline, dates, todayData, lastDate, trueVars) => {
  const currentValue = timeline[lastDate] || 0
  const totalCards = todayData.reduce((acc, c) => acc + c.qty, 0)
  const avgTicket = totalCards > 0 ? currentValue / totalCards : 0

  const dailyVals = trueVars.dailyChartData.values
  const dayVar = dailyVals.length > 0 ? dailyVals[dailyVals.length - 1] : 0
  const monthVals = dailyVals.slice(-30)
  const monthVar = monthVals.reduce((a, b) => a + b, 0)

  return {
    totalValue: currentValue, totalCards: totalCards, avgTicket: avgTicket,
    dayVar: dayVar, monthVar: monthVar, lastUpdate: lastDate
  }
}

const consolidateCards = (cardsArray) => {
  const consolidated = new Map()
  cardsArray.forEach(c => {
    const key = `${c.name}|${c.set}|${c.num}|${c.extras}`
    if (consolidated.has(key)) {
      const ext = consolidated.get(key)
      const newQty = ext.qty + c.qty
      const newUnitPrice = newQty > 0 ? ((ext.unitPrice * ext.qty) + (c.unitPrice * c.qty)) / newQty : 0
      consolidated.set(key, { ...ext, unitPrice: newUnitPrice, qty: newQty, totalPrice: ext.totalPrice + c.totalPrice })
    } else {
      consolidated.set(key, { ...c })
    }
  })
  return consolidated
}

const calculateTrueVariations = (data, dates, todayData) => {
  let topGainers = [], topLosers = []
  const dailyChartData = { labels: [], values: [] }
  const organicLineData = { labels: dates, values: [0] }

  if (dates.length <= 1) return { topGainers, topLosers, dailyChartData, organicLineData }

  const dataByDate = {}
  data.forEach(d => {
    if (!dataByDate[d.date]) dataByDate[d.date] = []
    dataByDate[d.date].push(d)
  })

  let cumulativeOrganic = 0

  for (let i = 1; i < dates.length; i++) {
    const prevDate = dates[i - 1]
    const currDate = dates[i]

    const prevMap = consolidateCards(dataByDate[prevDate] || [])
    const currMap = consolidateCards(dataByDate[currDate] || [])

    let dailyDiff = 0
    prevMap.forEach((prev, key) => {
      const curr = currMap.get(key)
      if (curr) {
        const heldQty = Math.min(prev.qty, curr.qty)
        if (heldQty > 0) dailyDiff += (curr.unitPrice - prev.unitPrice) * heldQty
      }
    })

    dailyChartData.labels.push(currDate)
    dailyChartData.values.push(dailyDiff)
    cumulativeOrganic += dailyDiff
    organicLineData.values.push(cumulativeOrganic)
  }

  const prevDateForTop = dates[dates.length - 2]
  const prevMapForTop = consolidateCards(dataByDate[prevDateForTop] || [])
  const todayMap = consolidateCards(todayData)

  const variations = []
  todayMap.forEach((h, key) => {
    const oldCard = prevMapForTop.get(key)
    if (oldCard && oldCard.unitPrice > 0) {
      const diff = h.unitPrice - oldCard.unitPrice
      if (Math.abs(diff) >= 0.01) variations.push({ ...h, diff: diff })
    }
  })

  topGainers = [...variations].filter(v => v.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5)
  topLosers = [...variations].filter(v => v.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5)

  return { topGainers, topLosers, dailyChartData, organicLineData }
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
  const tiers = { bulk: { qty: 0, value: 0 }, low: { qty: 0, value: 0 }, mid: { qty: 0, value: 0 }, high: { qty: 0, value: 0 } }
  todayData.forEach(c => {
    if (c.unitPrice < 2) { tiers.bulk.qty += c.qty; tiers.bulk.value += c.totalPrice }
    else if (c.unitPrice < 10) { tiers.low.qty += c.qty; tiers.low.value += c.totalPrice }
    else if (c.unitPrice < 50) { tiers.mid.qty += c.qty; tiers.mid.value += c.totalPrice }
    else { tiers.high.qty += c.qty; tiers.high.value += c.totalPrice }
  })
  return tiers
}

const calculateColorDistribution = (todayData) => {
  const dist = { W: 0, U: 0, B: 0, R: 0, G: 0, M: 0, C: 0 }
  todayData.forEach(c => {
    if (c.colorIdentity === 'C' || !c.colorIdentity) dist.C += c.qty
    else {
      const colors = c.colorIdentity.split(',')
      if (colors.length > 1) dist.M += c.qty; else dist[colors[0]] += c.qty
    }
  })
  return dist
}

const calculateRarityDistribution = (todayData) => {
  const dist = { common: 0, uncommon: 0, rare: 0, mythic: 0 }
  todayData.forEach(c => { const r = c.rarity ? c.rarity.toLowerCase() : ''; if (dist[r] !== undefined) dist[r] += c.qty })
  return dist
}

const calculateTypeDistribution = (todayData) => {
  const dist = { creature: 0, land: 0, artifact: 0, enchantment: 0, planeswalker: 0, instant: 0, sorcery: 0 }
  todayData.forEach(c => {
    if (!c.typeLine) return
    const t = c.typeLine.toLowerCase()
    if (t.includes('creature')) dist.creature += c.qty
    else if (t.includes('land')) dist.land += c.qty
    else if (t.includes('artifact')) dist.artifact += c.qty
    else if (t.includes('enchantment')) dist.enchantment += c.qty
    else if (t.includes('planeswalker')) dist.planeswalker += c.qty
    else if (t.includes('instant')) dist.instant += c.qty
    else if (t.includes('sorcery')) dist.sorcery += c.qty
  })
  return dist
}

const calculateTopCards = (todayData) => [...todayData].sort((a, b) => b.unitPrice - a.unitPrice).slice(0, 5)

const calculatePareto = (todayData, totalValue, totalCards) => {
  if (totalValue === 0 || totalCards === 0) return null
  const sorted = [...todayData].sort((a, b) => b.unitPrice - a.unitPrice)

  let accWealth = 0
  let accCards = 0
  const targetWealth = totalValue * 0.8

  for (const c of sorted) {
    if (accWealth >= targetWealth) break
    for (let i = 0; i < c.qty; i++) {
      if (accWealth >= targetWealth) break
      accWealth += c.unitPrice
      accCards += 1
    }
  }

  return {
    percentCards: ((accCards / totalCards) * 100).toFixed(1),
    accWealth: accWealth,
    totalCardsIncluded: accCards
  }
}

const buildCaches = async () => {
  const data = await fetchRawDataFromDB()
  if (data.length === 0) {
    dashboardCache = { empty: true }
    inventoryCache = []
    searchDataCache = []
    return
  }

  const { timeline, dates } = buildTimeline(data)
  const lastDate = dates[dates.length - 1]
  const todayData = data.filter(d => d.date === lastDate)

  const trueVars = calculateTrueVariations(data, dates, todayData)
  const totalValue = timeline[lastDate]
  const totalCards = todayData.reduce((acc, c) => acc + c.qty, 0)

  let usageMap = new Map()
  const client = await pool.connect()
  try {
    const usageRes = await client.query('SELECT name, SUM(qty) as used_qty FROM deck_cards GROUP BY name')
    usageRes.rows.forEach(r => {
      const baseName = r.name.split('//')[0].trim()
      const current = usageMap.get(baseName) || 0
      usageMap.set(baseName, current + parseInt(r.used_qty, 10))
    })
  } catch (e) {
    console.error('Tabela deck_cards ainda não existe ou vazia.')
  } finally {
    client.release()
  }

  const wishlist = []
  usageMap.forEach((requiredQty, baseName) => {
    const owned = todayData
      .filter(c => c.name.split('//')[0].trim() === baseName)
      .reduce((acc, c) => acc + c.qty, 0)

    if (requiredQty > owned) {
      wishlist.push({ name: baseName, missingQty: requiredQty - owned })
    }
  })

  dashboardCache = {
    empty: false,
    kpis: calculateKPIs(timeline, dates, todayData, lastDate, trueVars),
    chart: { labels: dates, values: dates.map(d => timeline[d]) },
    organicChart: trueVars.organicLineData,
    dailyChart: trueVars.dailyChartData,
    setChart: calculateSetDistribution(todayData),
    tiers: calculateTiers(todayData),
    topGainers: trueVars.topGainers,
    topLosers: trueVars.topLosers,
    colorDist: calculateColorDistribution(todayData),
    rarityDist: calculateRarityDistribution(todayData),
    typeDist: calculateTypeDistribution(todayData),
    topCards: calculateTopCards(todayData),
    pareto: calculatePareto(todayData, totalValue, totalCards),
    wishlist: wishlist
  }

  inventoryCache = todayData.map(c => {
    const baseName = c.name.split('//')[0].trim()
    let remainingUsed = usageMap.get(baseName) || 0

    let allocated = 0
    if (remainingUsed > 0) {
      allocated = Math.min(c.qty, remainingUsed)
      usageMap.set(baseName, remainingUsed - allocated)
    }

    return { ...c, usedInDecks: allocated }
  })

  const historyDict = new Map()
  data.forEach(d => {
    const key = `${d.name}|${d.set}|${d.num}|${d.extras}`
    if (!historyDict.has(key)) historyDict.set(key, [])
    historyDict.get(key).push({ date: d.date, value: d.unitPrice })
  })

  searchDataCache = todayData.map(card => {
    const key = `${card.name}|${card.set}|${card.num}|${card.extras}`
    const history = historyDict.get(key) || []
    return { ...card, history }
  })
}

const ensureData = async () => {
  if (dashboardCache && (Date.now() - lastFetch < CACHE_TTL)) return

  if (cacheBuildPromise) {
    return cacheBuildPromise
  }

  cacheBuildPromise = (async () => {
    try {
      await buildCaches()
      lastFetch = Date.now()
      console.log('✅ Caches atualizados com sucesso e memória raw libertada!')
    } finally {
      cacheBuildPromise = null
    }
  })()

  return cacheBuildPromise
}

export const getDashboardData = async () => {
  await ensureData()
  return dashboardCache
}

export const searchCardData = async (query) => {
  await ensureData()
  if (!searchDataCache) return []
  return searchDataCache.filter(d =>
    d.name.toLowerCase().includes(query) || (d.oracleText && d.oracleText.toLowerCase().includes(query))
  ).sort((a, b) => b.totalPrice - a.totalPrice)
}

export const getInventoryData = async () => {
  await ensureData()
  return inventoryCache
}

export const getCommanderPoolData = async (commanderColors) => {
  await ensureData()
  if (!inventoryCache) return []
  const allowedColors = commanderColors === 'C' || !commanderColors ? [] : commanderColors.split(',')

  return inventoryCache.filter(card => {
    const isLegal = card.legalities && card.legalities.commander === 'legal'
    if (!isLegal) return false
    if (card.colorIdentity === 'C') return true
    const cardColors = card.colorIdentity.split(',')
    return cardColors.every(c => allowedColors.includes(c))
  }).sort((a, b) => b.totalPrice - a.totalPrice)
}