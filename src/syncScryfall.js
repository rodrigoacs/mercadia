import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { fileURLToPath } from 'url'
import { pool } from './db.js'
import JSONStream from 'JSONStream'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BULK_DATA_URL = 'https://api.scryfall.com/bulk-data'
const TEMP_FILE = path.join(__dirname, '../data/default_cards_temp.json')

async function downloadBulkData() {
  console.log('🔍 Consultando a API do Scryfall...')
  const res = await fetch(BULK_DATA_URL)
  const data = await res.json()
  const defaultCards = data.data.find(d => d.type === 'default_cards')

  if (!defaultCards) throw new Error('Não achou o endpoint default_cards')

  console.log(`📥 Baixando ${defaultCards.name} (${Math.round(defaultCards.size / 1024 / 1024)} MB)...`)
  const response = await fetch(defaultCards.download_uri)
  if (!response.ok) throw new Error(`Erro ao baixar: ${response.statusText}`)

  const dataDir = path.dirname(TEMP_FILE)
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

  const fileStream = fs.createWriteStream(TEMP_FILE)
  await pipeline(response.body, fileStream)
  console.log('✅ Arquivo JSON gigante salvo no disco.')
}

async function processAndUpsertCards() {
  console.log('⚙️ Recriando a tabela para suportar formato JSONB Avançado...')
  const client = await pool.connect()

  try {
    await client.query(`DROP TABLE IF EXISTS scryfall_cards CASCADE;`)
    await client.query(`
      CREATE TABLE scryfall_cards (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        lang VARCHAR(10),
        set_code VARCHAR(20),
        collector_number VARCHAR(50),
        image_normal VARCHAR(500),
        image_art_crop VARCHAR(500),
        mana_cost VARCHAR(100),
        type_line VARCHAR(255),
        color_identity VARCHAR(50),
        card_data JSONB
      );
      CREATE INDEX idx_scryfall_name ON scryfall_cards (name);
    `)

    let batch = []
    let totalProcessed = 0
    let totalInserted = 0

    const parser = JSONStream.parse('*')
    const fileStream = fs.createReadStream(TEMP_FILE)

    fileStream.pipe(parser)

    await new Promise((resolve, reject) => {
      parser.on('data', (card) => {
        totalProcessed++
        if (card.lang !== 'en' || card.digital) return

        const imageNormal = card.image_uris ? card.image_uris.normal : (card.card_faces && card.card_faces[0].image_uris ? card.card_faces[0].image_uris.normal : null)
        const imageArtCrop = card.image_uris ? card.image_uris.art_crop : (card.card_faces && card.card_faces[0].image_uris ? card.card_faces[0].image_uris.art_crop : null)
        const colors = card.color_identity ? card.color_identity.join(',') : 'C'

        batch.push([
          card.id, card.name, card.lang, card.set, card.collector_number,
          imageNormal, imageArtCrop, card.mana_cost || '', card.type_line || '', colors,
          JSON.stringify(card)
        ])

        if (batch.length >= 1000) {
          parser.pause()
          insertBatch(client, batch).then(() => {
            totalInserted += batch.length; batch = []
            process.stdout.write(`\r💾 Salvas no banco: ${totalInserted} impressões...`)
            parser.resume()
          }).catch(reject)
        }
      })

      parser.on('end', async () => {
        if (batch.length > 0) {
          try { await insertBatch(client, batch); totalInserted += batch.length }
          catch (err) { return reject(err) }
        }
        console.log(`\n🎉 Finalizado! Banco reestruturado com JSONB.`)
        resolve()
      })

      parser.on('error', reject); fileStream.on('error', reject)
    })
  } finally {
    client.release()
    if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE)
  }
}

async function insertBatch(client, batch) {
  const values = []
  const placeholders = []
  let paramIndex = 1

  batch.forEach(card => {
    values.push(...card)
    const rowPlaceholders = []
    for (let i = 0; i < 11; i++) rowPlaceholders.push(`$${paramIndex++}`)
    placeholders.push(`(${rowPlaceholders.join(', ')})`)
  })

  await client.query(`
    INSERT INTO scryfall_cards (id, name, lang, set_code, collector_number, image_normal, image_art_crop, mana_cost, type_line, color_identity, card_data)
    VALUES ${placeholders.join(', ')}
  `, values)
}

async function run() {
  try {
    await downloadBulkData()
    await processAndUpsertCards()
    process.exit(0)
  } catch (error) { console.error('❌ Erro:', error); process.exit(1) }
}

run()