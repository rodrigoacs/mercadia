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
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
})

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function updateScryfallData() {
  console.log('🚀 Iniciando Resolução Determinística de Metadados (Pipeline em Cascata)...')
  const client = await pool.connect()

  try {
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
        scryfall_set VARCHAR(50),
        is_manual_override BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (name, set_code, num, extras)
      );
      ALTER TABLE metadata_cartas ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN DEFAULT FALSE;
      ALTER TABLE metadata_cartas ADD COLUMN IF NOT EXISTS scryfall_set VARCHAR(50);
    `)

    const transRes = await client.query('SELECT liga_name, scryfall_code FROM set_translations').catch(() => ({ rows: [] }))
    const translations = new Map()
    transRes.rows.forEach(r => {
      if (r.liga_name && r.scryfall_code) {
        translations.set(r.liga_name.toLowerCase().trim(), r.scryfall_code.toLowerCase().trim())
      }
    })

    const missingCardsQuery = await client.query(`
      SELECT DISTINCT h.name, h.set_code, h.num, h.extras
      FROM historico_cartas h
      LEFT JOIN metadata_cartas m 
        ON h.name = m.name 
        AND h.set_code = m.set_code 
        AND COALESCE(h.num, '') = m.num 
        AND COALESCE(h.extras, '') = m.extras
      WHERE m.name IS NULL OR COALESCE(m.is_manual_override, FALSE) = FALSE;
    `)

    const missingCards = missingCardsQuery.rows
    console.log(`🔍 Resolvendo ${missingCards.length} cartas únicas no banco...`)

    if (missingCards.length === 0) return

    let processadas = 0
    let erros = 0

    for (const card of missingCards) {
      try {
        const cleanName = card.name.split('//')[0].trim().replace(/"/g, '')
        const safeNum = card.num ? card.num.toString().trim().toLowerCase() : ''
        const safeExtras = (card.extras || '').toLowerCase()

        const parensMatch = (card.set_code || '').match(/\(([a-zA-Z0-9]+)\)/)
        const codeInParens = parensMatch ? parensMatch[1].toLowerCase() : ''
        const targetSetCode = translations.get((card.set_code || '').toLowerCase().trim()) || codeInParens || (card.set_code || '').toLowerCase().trim()

        const isBorderless = safeExtras.includes('borderless') || safeExtras.includes('sem borda')
        const isShowcase = safeExtras.includes('showcase') || safeExtras.includes('variante')
        const isExtended = safeExtras.includes('extended') || safeExtras.includes('estendida')
        const isRetro = safeExtras.includes('retro') || safeExtras.includes('moldura')

        const deterministicQuery = `
          SELECT card_data
          FROM scryfall_cards
          WHERE (name ILIKE $1 OR name ILIKE $2)
            AND card_data->>'layout' NOT IN ('art_series', 'token', 'double_faced_token', 'emblem')
            AND card_data->>'set_type' != 'memorabilia'
          ORDER BY
            -- CAMADA 1: Exatidão Absoluta (Edição correta E Número de colecionador correto) -> Resolve Nazgûl perfeitamente
            CASE WHEN LOWER(set_code) = LOWER($3) AND LOWER(collector_number) = LOWER($4) AND $4 != '' THEN 0 ELSE 1 END ASC,
            
            -- CAMADA 2: Exatidão de Edição (Edição correta, mesmo que a numeração da Liga difira)
            CASE WHEN LOWER(set_code) = LOWER($3) THEN 0 ELSE 1 END ASC,
            
            -- CAMADA 2.1: Dentro da edição certa, prefere o tratamento visual solicitado nos extras
            CASE WHEN $5::boolean AND (card_data->>'border_color' = 'borderless' OR card_data->>'promo_types' ILIKE '%borderless%') THEN 0 ELSE 1 END ASC,
            CASE WHEN $6::boolean AND (card_data->>'frame_effects' ILIKE '%showcase%' OR card_data->>'promo_types' ILIKE '%showcase%') THEN 0 ELSE 1 END ASC,
            CASE WHEN $7::boolean AND (card_data->>'frame_effects' ILIKE '%extendedart%' OR card_data->>'promo_types' ILIKE '%extendedart%') THEN 0 ELSE 1 END ASC,
            CASE WHEN $8::boolean AND (card_data->>'frame' = '1997' OR card_data->>'promo_types' ILIKE '%retro%') THEN 0 ELSE 1 END ASC,
            
            -- CAMADA 3: Se não achou na edição, prefere impressões de sets de expansão/core (foge de promos/lairs)
            CASE WHEN card_data->>'set_type' IN ('expansion', 'core', 'draft_innovation', 'masters', 'commander') THEN 0 ELSE 1 END ASC,
            
            -- CAMADA 4: Prefere versões com frame padrão caso nenhuma versão alternativa tenha sido pedida
            CASE WHEN NOT ($5::boolean OR $6::boolean OR $7::boolean OR $8::boolean) AND card_data->>'promo_types' IS NULL THEN 0 ELSE 1 END ASC,
            
            -- Desempate final: Pega a impressão mais recente ou numeração menor
            length(collector_number) ASC, collector_number ASC
          LIMIT 1;
        `

        let localSearch = await client.query(deterministicQuery, [
          cleanName, `${cleanName} // %`, targetSetCode, safeNum, isBorderless, isShowcase, isExtended, isRetro
        ])

        let cardData = null

        if (localSearch.rows.length > 0) {
          cardData = localSearch.rows[0].card_data
        } else {
          const fallbackUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}`
          const response = await fetch(fallbackUrl)
          if (response.ok) {
            const apiData = await response.json()
            if (apiData.layout !== 'art_series' && apiData.layout !== 'token') {
              cardData = apiData
              await delay(75)
            }
          }
        }

        if (cardData) {
          const colorIdentity = cardData.color_identity && cardData.color_identity.length > 0 ? cardData.color_identity.join(',') : 'C'
          const manaCost = cardData.mana_cost || (cardData.card_faces && cardData.card_faces[0].mana_cost ? cardData.card_faces[0].mana_cost : '')
          const cmc = cardData.cmc || 0
          const typeLine = cardData.type_line || ''
          const rarity = cardData.rarity || ''
          const oracleText = cardData.oracle_text || (cardData.card_faces && cardData.card_faces[0].oracle_text ? cardData.card_faces[0].oracle_text : '')
          const legalities = JSON.stringify(cardData.legalities || {})
          const imageUri = cardData.image_uris ? cardData.image_uris.normal : (cardData.card_faces && cardData.card_faces[0].image_uris ? cardData.card_faces[0].image_uris.normal : '')
          const scryfallSet = cardData.set || targetSetCode

          await client.query(`
            INSERT INTO metadata_cartas (name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri, scryfall_set)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (name, set_code, num, extras) DO NOTHING
          `, [card.name, card.set_code, card.num || '', card.extras || '', colorIdentity, manaCost, cmc, typeLine, rarity, oracleText, legalities, imageUri, scryfallSet])

          processadas++
        } else {
          await client.query(`
            INSERT INTO metadata_cartas (name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri, scryfall_set)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (name, set_code, num, extras) DO NOTHING
          `, [card.name, card.set_code, card.num || '', card.extras || '', 'UNKNOWN', '', 0, 'UNKNOWN', 'UNKNOWN', '', '{}', '', targetSetCode])
          erros++
        }
      } catch (err) {
        erros++
      }

      if ((processadas + erros) % 100 === 0) {
        process.stdout.write(`\r⏳ Resolvidas: ${processadas + erros} de ${missingCards.length}...`)
      }
    }

    console.log(`\n✅ Concluído com Sucesso! ${processadas} cartas mapeadas deterministicamente.`)
  } catch (error) {
    console.error('\n❌ Erro fatal durante a resolução de metadados:', error)
  } finally {
    client.release()
    pool.end()
  }
}

updateScryfallData()
