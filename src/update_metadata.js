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
  console.log('🚀 A iniciar o Algoritmo de Scoring Máximo do Scryfall...')
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
    console.log(`🔍 Encontradas ${missingCards.length} variantes. A calcular scores matemáticos...`)

    if (missingCards.length === 0) return

    let processadas = 0
    let erros = 0

    for (const card of missingCards) {
      try {
        const cleanName = card.name.split('//')[0].trim().replace(/"/g, '')
        const dbNum = card.num ? card.num.toString().trim().toLowerCase() : ''
        const dbTags = (card.set_code + ' ' + (card.extras || '')).toLowerCase()
        const safeNum = card.num || ''
        const safeExtras = card.extras || ''

        let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent('!"' + cleanName + '" unique:prints')}`
        let response = await fetch(url)
        let data = response.ok ? await response.json() : null

        if (!data || !data.data || data.data.length === 0) {
          const fallbackUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}`
          response = await fetch(fallbackUrl)
          if (response.ok) {
            let singleData = await response.json()
            data = { data: [singleData] }
          }
        }

        if (data && data.data && data.data.length > 0) {
          let bestPrint = data.data[0]
          let maxScore = -99999

          for (const p of data.data) {
            let score = 0
            const pNum = p.collector_number ? p.collector_number.toLowerCase() : ''
            const pSetName = p.set_name ? p.set_name.toLowerCase() : ''
            const pSetType = p.set_type ? p.set_type.toLowerCase() : ''
            const finishes = p.finishes || []
            const frameEffects = p.frame_effects || []

            if (dbNum && pNum === dbNum) {
              score += 5000
            } else if (dbNum && pNum.includes(dbNum)) {
              score += 2000
            }

            if (dbTags.includes('commander')) {
              if (pSetName.includes('commander') || pSetType === 'commander') score += 1000
              else score -= 1000
            } else {
              if (pSetName.includes('commander') || pSetType === 'commander') score -= 1000
            }

            const isDbVariant = dbTags.includes('variante') || dbTags.includes('promo') || dbTags.includes('showcase') || dbTags.includes('borda') || dbTags.includes('borderless') || dbTags.includes('estendida') || dbTags.includes('extended') || dbTags.includes('retro') || dbTags.includes('moldura')

            const isPrintVariant = p.promo || p.border_color === 'borderless' || p.full_art || frameEffects.length > 0 || pSetType === 'promo' || pSetType === 'masterpiece'

            if (isDbVariant && isPrintVariant) {
              score += 800

              if (dbTags.includes('showcase') && frameEffects.includes('showcase')) score += 500
              if ((dbTags.includes('borderless') || dbTags.includes('sem borda')) && p.border_color === 'borderless') score += 500
              if ((dbTags.includes('estendida') || dbTags.includes('extended')) && frameEffects.includes('extendedart')) score += 500
              if ((dbTags.includes('retro') || dbTags.includes('moldura')) && p.frame === '1997') score += 500
              if (dbTags.includes('etched') && finishes.includes('etched')) score += 500
              if (dbTags.includes('promo') && (p.promo || pSetType === 'promo')) score += 500

            } else if (!isDbVariant && isPrintVariant) {
              score -= 800
            }

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