import pg from 'pg'
import path from 'path'
import { fileURLToPath } from 'url'

const { Pool } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
})

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function updateScryfallData() {
  console.log('🚀 Iniciando o Algoritmo de Scoring Definitivo do Scryfall...')
  const client = await pool.connect()

  try {
    await client.query(`DROP TABLE IF EXISTS metadata_cartas;`)

    await client.query(`
      CREATE TABLE IF NOT EXISTS metadata_cartas (
        name VARCHAR(255) NOT NULL,
        set_code VARCHAR(100) NOT NULL,
        num VARCHAR(50) NOT NULL,
        extras VARCHAR(100) NOT NULL,
        color_identity VARCHAR(50),
        mana_cost VARCHAR(50),
        cmc DECIMAL(10, 2),
        type_line VARCHAR(255),
        rarity VARCHAR(50),
        oracle_text TEXT,
        legalities JSONB,
        image_uri TEXT,
        PRIMARY KEY (name, set_code, num, extras)
      );
    `)

    const missingCardsQuery = await client.query(`
      SELECT DISTINCT h.name, h.set_code, h.num, h.extras
      FROM historico_cartas h
      LEFT JOIN metadata_cartas m 
        ON h.name = m.name 
        AND h.set_code = m.set_code 
        AND COALESCE(h.num, '') = m.num 
        AND COALESCE(h.extras, '') = m.extras
      WHERE m.name IS NULL;
    `)

    const missingCards = missingCardsQuery.rows
    console.log(`🔍 Encontradas ${missingCards.length} variantes. A calcular scores...`)

    if (missingCards.length === 0) return

    let processadas = 0
    let erros = 0

    for (const card of missingCards) {
      try {
        const cleanName = card.name.split('//')[0].trim()
        const dbNum = card.num ? card.num.toString().trim().toLowerCase() : ''
        const dbTags = (card.set_code + ' ' + (card.extras || '')).toLowerCase()
        const safeNum = card.num || ''
        const safeExtras = card.extras || ''

        // Pede TODAS AS IMPRESSÕES ÚNICAS dessa carta no Scryfall
        const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent('!"' + cleanName + '" unique:prints')}`
        let response = await fetch(url)
        let data = response.ok ? await response.json() : null

        // Fallback: se o nome deu ruim, usa o fuzzy e pega a única que vier
        if (!data || !data.data || data.data.length === 0) {
          const fallbackUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}`
          response = await fetch(fallbackUrl)
          if (response.ok) {
            let singleData = await response.json()
            data = { data: [singleData] }
          }
        }

        if (data && data.data && data.data.length > 0) {
          // ALGORITMO DE SCORING: Vamos eleger a melhor impressão!
          let bestPrint = data.data[0]
          let maxScore = -1

          for (const p of data.data) {
            let score = 0
            const pNum = p.collector_number ? p.collector_number.toLowerCase() : ''

            // 1. O Número Bate? (Ganha o jogo)
            if (dbNum && pNum === dbNum) score += 1000

            // 2. É Promo?
            if (p.promo && dbTags.includes('promo')) score += 100
            if (p.promo_types) {
              if (p.promo_types.includes('prerelease') && dbTags.includes('lançamento')) score += 100
              if (p.promo_types.includes('bundle') && dbTags.includes('bundle')) score += 100
              if (p.promo_types.includes('promopack') && dbTags.includes('promo pack')) score += 100
            }

            // 3. Tratamentos e Bordas
            if (p.frame_effects && p.frame_effects.includes('showcase') && dbTags.includes('showcase')) score += 100
            if (p.border_color === 'borderless' && (dbTags.includes('borderless') || dbTags.includes('sem borda'))) score += 100
            if (p.frame === '1997' && (dbTags.includes('retro') || dbTags.includes('moldura'))) score += 100
            if (p.frame_effects && p.frame_effects.includes('extendedart') && (dbTags.includes('estendida') || dbTags.includes('extended'))) score += 100

            if (score > maxScore) {
              maxScore = score
              bestPrint = p
            }
          }

          const cardData = bestPrint
          const colorIdentity = cardData.color_identity && cardData.color_identity.length > 0 ? cardData.color_identity.join(',') : 'C'
          const manaCost = cardData.mana_cost || (cardData.card_faces && cardData.card_faces[0].mana_cost ? cardData.card_faces[0].mana_cost : '')
          const cmc = cardData.cmc || 0
          const typeLine = cardData.type_line || ''
          const rarity = cardData.rarity || ''
          const oracleText = cardData.oracle_text || (cardData.card_faces && cardData.card_faces[0].oracle_text ? cardData.card_faces[0].oracle_text : '')
          const legalities = JSON.stringify(cardData.legalities || {})
          const imageUri = cardData.image_uris ? cardData.image_uris.normal : (cardData.card_faces && cardData.card_faces[0].image_uris ? cardData.card_faces[0].image_uris.normal : '')

          await client.query(`
            INSERT INTO metadata_cartas (name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (name, set_code, num, extras) DO NOTHING
          `, [card.name, card.set_code, safeNum, safeExtras, colorIdentity, manaCost, cmc, typeLine, rarity, oracleText, legalities, imageUri])

          processadas++
        } else {
          await client.query(`
            INSERT INTO metadata_cartas (name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (name, set_code, num, extras) DO NOTHING
          `, [card.name, card.set_code, safeNum, safeExtras, 'UNKNOWN', '', 0, 'UNKNOWN', 'UNKNOWN', '', '{}', ''])
          erros++
        }
      } catch (err) {
        erros++
      }

      await delay(100)
      if ((processadas + erros) % 50 === 0) console.log(`⏳ Progresso: ${processadas + erros} de ${missingCards.length}...`)
    }
    console.log(`✅ Concluído! ${processadas} cartas marcadas com o Scoring Perfeito.`)
  } catch (error) {
    console.error('❌ Erro fatal:', error)
  } finally {
    client.release()
    pool.end()
  }
}

updateScryfallData()