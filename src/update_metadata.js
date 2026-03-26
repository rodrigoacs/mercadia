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
  console.log('🚀 A iniciar a sincronização Blindada com o Scryfall...')
  const client = await pool.connect()

  try {
    // Apaga tudo para forçar a busca com a nova inteligência de 4 passos
    await client.query(`DROP TABLE IF EXISTS metadata_cartas;`)

    await client.query(`
      CREATE TABLE IF NOT EXISTS metadata_cartas (
        name VARCHAR(255) NOT NULL,
        set_code VARCHAR(100) NOT NULL,
        color_identity VARCHAR(50),
        mana_cost VARCHAR(50),
        cmc DECIMAL(10, 2),
        type_line VARCHAR(255),
        rarity VARCHAR(50),
        oracle_text TEXT,
        legalities JSONB,
        image_uri TEXT,
        PRIMARY KEY (name, set_code)
      );
    `)

    const missingCardsQuery = await client.query(`
      SELECT DISTINCT h.name, h.set_code, h.num, h.extras
      FROM historico_cartas h
      LEFT JOIN metadata_cartas m ON h.name = m.name AND h.set_code = m.set_code
      WHERE m.name IS NULL;
    `)

    const missingCards = missingCardsQuery.rows
    console.log(`🔍 Encontradas ${missingCards.length} cartas. A extrair...`)

    if (missingCards.length === 0) return

    let processadas = 0
    let erros = 0

    for (const card of missingCards) {
      try {
        // Limpa o nome para evitar bronca com cartas de dupla face
        const cleanName = card.name.split('//')[0].trim()
        const cleanNum = card.num ? card.num.trim() : ''
        const ext = card.extras ? card.extras.toLowerCase() : ''

        let url
        let data = null

        // TENTATIVA 1: Nome + Número do Colecionador (O mais exato possível)
        if (cleanNum) {
          url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`name:"${cleanName}" number:"${cleanNum}"`)}`
          let res = await fetch(url)
          if (res.ok) data = await res.json()
        }

        // TENTATIVA 2: Nome + Variante nos Extras da LigaMagic
        if ((!data || !data.data || data.data.length === 0) && ext) {
          let isQuery = ''
          if (ext.includes('showcase')) isQuery = 'is:showcase'
          else if (ext.includes('borderless') || ext.includes('sem borda')) isQuery = 'is:borderless'
          else if (ext.includes('retro') || ext.includes('moldura')) isQuery = 'is:retro'

          if (isQuery) {
            url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`name:"${cleanName}" ${isQuery}`)}`
            let res = await fetch(url)
            if (res.ok) data = await res.json()
          }
        }

        // TENTATIVA 3: Só o nome (Pega a versão normal)
        if (!data || !data.data || data.data.length === 0) {
          url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`name:"${cleanName}"`)}`
          let res = await fetch(url)
          if (res.ok) data = await res.json()
        }

        // TENTATIVA 4: Fuzzy (Mata erros de digitação)
        if (!data || !data.data || data.data.length === 0) {
          url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}`
          let res = await fetch(url)
          if (res.ok) {
            let singleData = await res.json()
            data = { data: [singleData] }
          }
        }

        if (data && data.data && data.data.length > 0) {
          const cardData = data.data[0]
          const colorIdentity = cardData.color_identity && cardData.color_identity.length > 0 ? cardData.color_identity.join(',') : 'C'
          const manaCost = cardData.mana_cost || (cardData.card_faces && cardData.card_faces[0].mana_cost ? cardData.card_faces[0].mana_cost : '')
          const cmc = cardData.cmc || 0
          const typeLine = cardData.type_line || ''
          const rarity = cardData.rarity || ''
          const oracleText = cardData.oracle_text || (cardData.card_faces && cardData.card_faces[0].oracle_text ? cardData.card_faces[0].oracle_text : '')
          const legalities = JSON.stringify(cardData.legalities || {})
          const imageUri = cardData.image_uris ? cardData.image_uris.normal : (cardData.card_faces && cardData.card_faces[0].image_uris ? cardData.card_faces[0].image_uris.normal : '')

          await client.query(`
            INSERT INTO metadata_cartas (name, set_code, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (name, set_code) DO NOTHING
          `, [card.name, card.set_code, colorIdentity, manaCost, cmc, typeLine, rarity, oracleText, legalities, imageUri])

          processadas++
        } else {
          await client.query(`
            INSERT INTO metadata_cartas (name, set_code, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (name, set_code) DO NOTHING
          `, [card.name, card.set_code, 'UNKNOWN', '', 0, 'UNKNOWN', 'UNKNOWN', '', '{}', ''])
          erros++
        }
      } catch (err) {
        erros++
      }

      await delay(100)
      if ((processadas + erros) % 50 === 0) console.log(`⏳ Progresso: ${processadas + erros} de ${missingCards.length}...`)
    }
    console.log(`✅ Concluído! ${processadas} cartas processadas com sucesso.`)
  } catch (error) {
    console.error('❌ Erro fatal:', error)
  } finally {
    client.release()
    pool.end()
  }
}

updateScryfallData()