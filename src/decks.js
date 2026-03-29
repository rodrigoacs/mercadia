import { getRawData } from './data.js'

// Delay maroto pra respeitar o rate limit do Scryfall (10 requests por segundo)
const delay = (ms) => new Promise(res => setTimeout(res, ms))

// Cache em memória pra não traduzir "Ilha" e "Pântano" 30 vezes e atrasar o processo
const translationCache = new Map()

const getEnglishName = async (ptName) => {
  if (translationCache.has(ptName)) return translationCache.get(ptName)

  try {
    // Tenta busca exata (o Scryfall entende nomes em PT-BR na query normal se usarmos aspas)
    const res = await fetch(`https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(ptName)}"`)
    if (res.ok) {
      const data = await res.json()
      const enName = data.data[0].name // O Scryfall sempre devolve o 'name' oficial em inglês
      translationCache.set(ptName, enName)
      return enName
    }
  } catch (e) {
    console.error(`Erro ao traduzir busca exata para: ${ptName}`)
  }

  try {
    // Fallback: Busca difusa caso tenha algum erro de digitação da LigaMagic
    const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(ptName)}`)
    if (res.ok) {
      const data = await res.json()
      translationCache.set(ptName, data.name)
      return data.name
    }
  } catch (e) {
    console.error(`Erro ao traduzir busca fuzzy para: ${ptName}`)
  }

  // Se der merda em tudo, devolve o original pra não travar o fluxo
  translationCache.set(ptName, ptName)
  return ptName
}

export const processDecklist = async (rawText) => {
  console.log('🚀 Iniciando processamento do deck...')

  // 1. Quebra o texto em linhas e filtra as vazias
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  // RegEx: (Quantidade) (Nome da Carta) [Opcional: Set Code]
  // Ex: 1 Caminho da Ascendência [BCMM] -> qty: 1, name: Caminho da Ascendência, set: bcmm
  const regex = /^(\d+)\s+(.+?)(?:\s+\[([a-zA-Z0-9_]+)\])?$/

  const parsedCards = []
  const invalidLines = []

  for (const line of lines) {
    const match = line.match(regex)
    if (match) {
      parsedCards.push({
        qty: parseInt(match[1], 10),
        originalName: match[2].trim(),
        requestedSet: match[3] ? match[3].trim().toLowerCase() : null
      })
    } else {
      invalidLines.push(line)
    }
  }

  console.log(`🔍 ${parsedCards.length} cartas lidas. Traduzindo nomes para Inglês...`)

  // 2. Traduz os nomes para cruzar com o Banco de Dados
  const deckCards = []
  for (const card of parsedCards) {
    const enName = await getEnglishName(card.originalName)
    deckCards.push({ ...card, name: enName })
    await delay(75) // Suave pro Scryfall não bloquear seu IP
  }

  // 3. Puxa a sua coleção atual do banco
  const inventory = await getRawData()
  const uniqueDates = [...new Set(inventory.map(d => d.date))].sort()
  const lastDate = uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null
  const currentInventory = lastDate ? inventory.filter(d => d.date === lastDate) : []

  // 4. O Algoritmo de Cruzamento (Match)
  const ownedList = []
  const missingList = []

  let totalDeckValue = 0
  let totalOwnedValue = 0
  let totalMissingValue = 0

  deckCards.forEach(deckCard => {
    // Procura todas as impressões dessa carta que você tem na coleção
    const userCards = currentInventory.filter(c => c.name.toLowerCase() === deckCard.name.toLowerCase())

    // Soma quantas cópias você tem no total (independente da edição)
    const totalOwnedQty = userCards.reduce((acc, c) => acc + c.qty, 0)

    // Pega o preço unitário médio que você tem (ou o de mercado se quisermos evoluir depois)
    const avgPrice = userCards.length > 0 ? userCards[0].unitPrice : 0

    if (totalOwnedQty >= deckCard.qty) {
      // Tem tudo
      const value = deckCard.qty * avgPrice
      ownedList.push({ ...deckCard, ownedQty: deckCard.qty, missingQty: 0, unitPrice: avgPrice, totalPrice: value, prints: userCards })
      totalOwnedValue += value
      totalDeckValue += value
    } else if (totalOwnedQty > 0 && totalOwnedQty < deckCard.qty) {
      // Tem algumas, faltam outras
      const missingQty = deckCard.qty - totalOwnedQty
      const ownedValue = totalOwnedQty * avgPrice
      const missingValue = missingQty * avgPrice

      ownedList.push({ ...deckCard, ownedQty: totalOwnedQty, missingQty: 0, unitPrice: avgPrice, totalPrice: ownedValue, prints: userCards })
      missingList.push({ ...deckCard, ownedQty: 0, missingQty: missingQty, unitPrice: avgPrice, totalPrice: missingValue })

      totalOwnedValue += ownedValue
      totalMissingValue += missingValue
      totalDeckValue += (ownedValue + missingValue)
    } else {
      // Não tem porra nenhuma
      missingList.push({ ...deckCard, ownedQty: 0, missingQty: deckCard.qty, unitPrice: 0, totalPrice: 0 })
    }
  })

  console.log('✅ Cruzamento de deck finalizado!')

  return {
    summary: {
      totalCardsRequested: deckCards.reduce((acc, c) => acc + c.qty, 0),
      totalCardsOwned: ownedList.reduce((acc, c) => acc + c.ownedQty, 0),
      totalCardsMissing: missingList.reduce((acc, c) => acc + c.missingQty, 0),
      estimatedDeckValue: totalDeckValue,
      ownedValue: totalOwnedValue,
      missingValue: totalMissingValue
    },
    owned: ownedList.sort((a, b) => b.totalPrice - a.totalPrice),
    missing: missingList.sort((a, b) => a.name.localeCompare(b.name)),
    invalidLines
  }
}