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
  console.log('🚀 Iniciando a sincronização com o Scryfall (Corrigindo Artes e Variantes)...')
  const client = await pool.connect()

  try {
    // Apaga tudo pra forçar a busca das artes corretas com o número do colecionador
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
      SELECT DISTINCT h.name, h.set_code, h.num
      FROM historico_cartas h
      LEFT JOIN metadata_cartas m ON h.name = m.name AND h.set_code = m.set_code
      WHERE m.name IS NULL;
    `)

    const missingCards = missingCardsQuery.rows
    console.log(`🔍 Encontradas ${missingCards.length} cartas. A iniciar a extração...`)

    if (missingCards.length === 0) {
      console.log('✅ Tudo já está atualizado. Nada a fazer!')
      return
    }

    let processadas = 0
    let erros = 0

    for (const card of missingCards) {
      try {
        // Limpa o nome (remove o que vem depois de // em cartas duplas para não foder a busca)
        const cleanName = card.name.split('//')[0].trim()

        // Tentativa 1: Busca pelo nome limpo em inglês + número do colecionador
        let query = `"${cleanName}"`
        if (card.num && card.num !== '') {
          // Limpa o número pra evitar sujeira da LigaMagic
          const cleanNum = card.num.trim()
          query += ` cn:"${cleanNum}"`
        }

        let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}`
        let response = await fetch(url)
        let data = response.ok ? await response.json() : null

        // Tentativa 2: Fallback se a tentativa com o número do colecionador falhou
        if (!data || !data.data || data.data.length === 0) {
          url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent('"' + cleanName + '"')}`
          response = await fetch(url)
          data = response.ok ? await response.json() : null
        }

        // Tentativa 3: Se der merda total com a busca estruturada, usa o Fuzzy do Scryfall
        if (!data || !data.data || data.data.length === 0) {
          url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}`
          response = await fetch(url)
          if (response.ok) {
            const singleData = await response.json()
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

          // Tratamento para puxar a imagem certa (se a carta for dupla face, a imagem fica num lugar diferente no JSON)
          const imageUri = cardData.image_uris ? cardData.image_uris.normal : (cardData.card_faces && cardData.card_faces[0].image_uris ? cardData.card_faces[0].image_uris.normal : '')

          await client.query(`
            INSERT INTO metadata_cartas (name, set_code, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (name, set_code) DO NOTHING
          `, [card.name, card.set_code, colorIdentity, manaCost, cmc, typeLine, rarity, oracleText, legalities, imageUri])

          processadas++
        } else {
          // Grava como UNKNOWN pra não travar no próximo loop
          await client.query(`
            INSERT INTO metadata_cartas (name, set_code, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (name, set_code) DO NOTHING
          `, [card.name, card.set_code, 'UNKNOWN', '', 0, 'UNKNOWN', 'UNKNOWN', '', '{}', ''])

          erros++
          console.warn(`⚠️ Não achou nada pra: ${card.name} (${card.num})`)
        }
      } catch (err) {
        erros++
        console.error(`❌ Erro no catch: ${card.name}`, err.message)
      }

      await delay(100) // Rate limit do Scryfall
      if ((processadas + erros) % 50 === 0) console.log(`⏳ Progresso: ${processadas + erros} de ${missingCards.length}...`)
    }
    console.log(`✅ Sincronização concluída! ${processadas} cartas adicionadas.`)
  } catch (error) {
    console.error('❌ Erro fatal:', error)
  } finally {
    client.release()
    pool.end()
  }
}

updateScryfallData()