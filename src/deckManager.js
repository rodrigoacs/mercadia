import { pool } from './db.js'
import { getRawData } from './data.js'

const translationCache = new Map()

const delay = (ms) => new Promise(res => setTimeout(res, ms))

const fetchScryfallData = async (cardName) => {
  try {
    let localRes = await pool.query(
      `SELECT * FROM scryfall_cards 
       WHERE (name ILIKE $1 OR name ILIKE $2)
         AND card_data->>'layout' != 'art_series'
         AND card_data->>'layout' NOT LIKE '%token%'
         AND card_data->>'set_type' != 'memorabilia'
       LIMIT 1`,
      [cardName, `${cardName} // %`]
    )

    if (localRes.rows.length > 0) {
      const card = localRes.rows[0]
      return {
        name: card.name,
        image_uri: card.image_normal,
        art_crop_uri: card.image_art_crop,
        mana_cost: card.mana_cost || '',
        type_line: card.type_line || '',
        color_identity: card.color_identity || 'C'
      }
    }

    let enName = cardName
    if (translationCache.has(cardName)) {
      enName = translationCache.get(cardName)
    } else {
      await delay(75)
      const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`)
      if (res.ok) {
        const data = await res.json()
        enName = data.name
        translationCache.set(cardName, enName)
      }
    }

    localRes = await pool.query(
      `SELECT * FROM scryfall_cards 
       WHERE (name ILIKE $1 OR name ILIKE $2)
         AND card_data->>'layout' != 'art_series'
         AND card_data->>'layout' NOT LIKE '%token%'
         AND card_data->>'set_type' != 'memorabilia'
       LIMIT 1`,
      [enName, `${enName} // %`]
    )

    if (localRes.rows.length > 0) {
      const card = localRes.rows[0]
      return {
        name: card.name,
        image_uri: card.image_normal,
        art_crop_uri: card.image_art_crop,
        mana_cost: card.mana_cost || '',
        type_line: card.type_line || '',
        color_identity: card.color_identity || 'C'
      }
    }

  } catch (e) {
    console.error(`Erro ao processar dados da carta: ${cardName}`)
  }

  return null
}

export const createDeck = async (name, format, rawText) => {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const regex = /^(\d+)\s+(.+?)(?:\s+\[([a-zA-Z0-9_]+)\])?$/

  const parsedCards = []
  for (const line of lines) {
    let isCmdr = false
    let cleanLine = line
    if (cleanLine.toLowerCase().includes('*cmdr*') || cleanLine.toLowerCase().includes('*commander*')) {
      isCmdr = true
      cleanLine = cleanLine.replace(/\*(CMDR|cmdr|Commander|commander)\*/g, '').trim()
    }

    const match = cleanLine.match(regex)
    if (match) {
      parsedCards.push({
        qty: parseInt(match[1], 10),
        originalName: match[2].trim(),
        set_code: match[3] ? match[3].trim().toLowerCase() : null,
        is_commander: isCmdr
      })
    }
  }

  if (parsedCards.length === 0) throw new Error("Nenhuma carta válida encontrada no texto.")

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let coverImage = null
    const cardsToInsert = []

    for (const card of parsedCards) {
      const scryfallData = await fetchScryfallData(card.originalName)

      if (scryfallData) {
        if (!coverImage && scryfallData.art_crop_uri) coverImage = scryfallData.art_crop_uri

        cardsToInsert.push({
          qty: card.qty,
          name: scryfallData.name,
          set_code: card.set_code,
          image_uri: scryfallData.image_uri,
          mana_cost: scryfallData.mana_cost,
          type_line: scryfallData.type_line,
          color_identity: scryfallData.color_identity,
          is_commander: card.is_commander
        })
      }
    }

    const deckRes = await client.query(
      `INSERT INTO decks (name, format, cover_image_uri) VALUES ($1, $2, $3) RETURNING id`,
      [name, format, coverImage]
    )
    const deckId = deckRes.rows[0].id

    const insertCardQuery = `
      INSERT INTO deck_cards (deck_id, qty, name, set_code, image_uri, mana_cost, type_line, color_identity, is_commander)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `

    for (const c of cardsToInsert) {
      await client.query(insertCardQuery, [
        deckId, c.qty, c.name, c.set_code, c.image_uri, c.mana_cost, c.type_line, c.color_identity, c.is_commander
      ])
    }

    await client.query('COMMIT')
    return { success: true, deckId }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const getDecks = async () => {
  const result = await pool.query(`SELECT * FROM decks ORDER BY created_at DESC`)
  return result.rows
}

export const getDeckDetails = async (deckId) => {
  const deckRes = await pool.query(`SELECT * FROM decks WHERE id = $1`, [deckId])
  if (deckRes.rows.length === 0) throw new Error("Deck não encontrado.")
  const deck = deckRes.rows[0]

  const cardsRes = await pool.query(`SELECT * FROM deck_cards WHERE deck_id = $1`, [deckId])
  const deckCards = cardsRes.rows

  const inventory = await getRawData()
  const uniqueDates = [...new Set(inventory.map(d => d.date))].sort()
  const lastDate = uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null
  const currentInventory = lastDate ? inventory.filter(d => d.date === lastDate) : []

  let totalDeckValue = 0
  let ownedValue = 0
  let missingValue = 0
  let totalCardsCount = 0
  let ownedCardsCount = 0

  const categorized = {
    commander: [], planeswalker: [], creature: [], sorcery: [],
    instant: [], artifact: [], enchantment: [], land: []
  }

  const basicLands = ['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes', 'snow-covered plains', 'snow-covered island', 'snow-covered swamp', 'snow-covered mountain', 'snow-covered forest']

  const getFrontFace = (name) => name.split('//')[0].trim().toLowerCase()

  const processedCards = deckCards.map(deckCard => {
    let totalOwnedQty = 0
    let avgPrice = 0

    const tLine = deckCard.type_line ? deckCard.type_line.toLowerCase() : ''
    const deckCardFront = getFrontFace(deckCard.name)

    const isBasicLand = tLine.includes('basic land') || basicLands.includes(deckCardFront)

    if (isBasicLand) {
      totalOwnedQty = 9999
      avgPrice = 0
    } else {
      const userCards = currentInventory.filter(c => getFrontFace(c.name) === deckCardFront)
      totalOwnedQty = userCards.reduce((acc, c) => acc + c.qty, 0)
      avgPrice = userCards.length > 0 ? userCards[0].unitPrice : 0
    }

    const cardValue = deckCard.qty * avgPrice
    totalDeckValue += cardValue
    totalCardsCount += deckCard.qty

    let status = 'missing'
    let owned = 0

    if (totalOwnedQty >= deckCard.qty) {
      status = 'owned'
      owned = deckCard.qty
      ownedValue += cardValue
      ownedCardsCount += deckCard.qty
    } else if (totalOwnedQty > 0) {
      status = 'partial'
      owned = totalOwnedQty
      ownedValue += (totalOwnedQty * avgPrice)
      missingValue += ((deckCard.qty - totalOwnedQty) * avgPrice)
      ownedCardsCount += totalOwnedQty
    } else {
      missingValue += cardValue
    }

    const finalCard = {
      ...deckCard, status, ownedQty: owned, unitPrice: avgPrice, totalPrice: cardValue
    }

    if (finalCard.is_commander) categorized.commander.push(finalCard)
    else if (tLine.includes('creature')) categorized.creature.push(finalCard)
    else if (tLine.includes('planeswalker')) categorized.planeswalker.push(finalCard)
    else if (tLine.includes('instant')) categorized.instant.push(finalCard)
    else if (tLine.includes('sorcery')) categorized.sorcery.push(finalCard)
    else if (tLine.includes('artifact')) categorized.artifact.push(finalCard)
    else if (tLine.includes('enchantment')) categorized.enchantment.push(finalCard)
    else if (tLine.includes('land')) categorized.land.push(finalCard)
    else categorized.creature.push(finalCard)

    return finalCard
  })

  return {
    deck,
    summary: { totalCards: totalCardsCount, ownedCards: ownedCardsCount, totalValue: totalDeckValue, ownedValue, missingValue },
    categorized
  }
}

export const updateDeckCover = async (deckId, imageUri) => {
  await pool.query(`UPDATE decks SET cover_image_uri = $1 WHERE id = $2`, [imageUri, deckId])
  return true
}

export const setCommander = async (deckId, cardName) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`UPDATE deck_cards SET is_commander = FALSE WHERE deck_id = $1`, [deckId])
    await client.query(`UPDATE deck_cards SET is_commander = TRUE WHERE deck_id = $1 AND name = $2`, [deckId, cardName])
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const getCardPrints = async (cardName) => {
  const cleanName = cardName.split('//')[0].trim()
  try {
    const result = await pool.query(
      `SELECT id, set_code, collector_number, image_normal
       FROM scryfall_cards
       WHERE (name ILIKE $1 OR name ILIKE $2) 
         AND image_normal IS NOT NULL
         AND card_data->>'layout' != 'art_series'
         AND card_data->>'layout' NOT LIKE '%token%'
         AND card_data->>'set_type' != 'memorabilia'
       ORDER BY set_code ASC, collector_number ASC`,
      [cleanName, `${cleanName} // %`]
    )

    return result.rows.map(card => ({
      id: card.id,
      set: card.set_code.toUpperCase(),
      collector_number: card.collector_number,
      image_uri: card.image_normal
    }))
  } catch (error) {
    console.error(`Erro ao buscar prints locais da carta: ${cardName}`)
    return []
  }
}

export const updateDeckCardPrint = async (deckId, cardName, setCode, imageUri) => {
  await pool.query(
    `UPDATE deck_cards SET set_code = $1, image_uri = $2 WHERE deck_id = $3 AND name = $4`,
    [setCode, imageUri, deckId, cardName]
  )
  return true
}

export const deleteDeck = async (deckId) => {
  await pool.query(`DELETE FROM decks WHERE id = $1`, [deckId])
  return { success: true }
}