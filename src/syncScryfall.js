import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import readline from 'readline'
import { pipeline } from 'stream/promises'
import { fileURLToPath } from 'url'
import { pool } from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BULK_DATA_URL = 'https://api.scryfall.com/bulk-data'
const TEMP_FILE = path.join(__dirname, '../data/default_cards_temp.jsonl.gz')
const SCRYFALL_HEADERS = {
  'User-Agent': 'Mercadia/1.0',
  'Accept': 'application/json'
}

async function downloadBulkData() {
  console.log('🔍 Consultando a API do Scryfall...')
  const res = await fetch(BULK_DATA_URL, { headers: SCRYFALL_HEADERS })

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '(sem corpo)')
    throw new Error(`Scryfall recusou a consulta ao bulk-data (HTTP ${res.status}): ${errorBody.slice(0, 300)}`)
  }

  const data = await res.json()

  if (!data.data || !Array.isArray(data.data)) {
    throw new Error(`Resposta da Scryfall veio sem a lista 'data': ${JSON.stringify(data).slice(0, 300)}`)
  }

  const defaultCards = data.data.find(d => d.type === 'default_cards')

  if (!defaultCards) throw new Error('Não achou o endpoint default_cards')
  if (!defaultCards.jsonl_download_uri) throw new Error('Campo jsonl_download_uri ausente na resposta da Scryfall — API pode ter mudado de novo.')

  const sizeSource = defaultCards.compressed_size ?? defaultCards.size
  const sizeLabel = sizeSource ? `${Math.round(sizeSource / 1024 / 1024)} MB comprimidos` : 'tamanho desconhecido'
  console.log(`📥 Baixando ${defaultCards.name} (${sizeLabel})...`)

  const response = await fetch(defaultCards.jsonl_download_uri, { headers: SCRYFALL_HEADERS })
  if (!response.ok) throw new Error(`Erro ao baixar: ${response.statusText}`)

  const dataDir = path.dirname(TEMP_FILE)
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

  const fileStream = fs.createWriteStream(TEMP_FILE)
  await pipeline(response.body, fileStream)
  console.log('✅ Arquivo .jsonl.gz salvo no disco.')
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
    let malformedLines = 0

    const gunzip = zlib.createGunzip()
    const fileStream = fs.createReadStream(TEMP_FILE)
    fileStream.pipe(gunzip)

    const rl = readline.createInterface({ input: gunzip, crlfDelay: Infinity })

    for await (const rawLine of rl) {
      const line = rawLine.trim().replace(/,$/, '')
      if (!line || line === '[' || line === ']') continue

      let card
      try {
        card = JSON.parse(line)
      } catch {
        malformedLines++
        continue
      }

      totalProcessed++
      if (card.lang !== 'en' || card.digital) continue

      if (
        card.layout === 'art_series' ||
        card.layout === 'token' ||
        card.layout === 'double_faced_token' ||
        card.layout === 'emblem' ||
        card.set_type === 'memorabilia'
      ) {
        continue
      }

      const imageNormal = card.image_uris ? card.image_uris.normal : (card.card_faces && card.card_faces[0].image_uris ? card.card_faces[0].image_uris.normal : null)
      const imageArtCrop = card.image_uris ? card.image_uris.art_crop : (card.card_faces && card.card_faces[0].image_uris ? card.card_faces[0].image_uris.art_crop : null)
      const colors = card.color_identity ? card.color_identity.join(',') : 'C'

      batch.push([
        card.id, card.name, card.lang, card.set, card.collector_number,
        imageNormal, imageArtCrop, card.mana_cost || '', card.type_line || '', colors,
        JSON.stringify(card)
      ])

      if (batch.length >= 1000) {
        await insertBatch(client, batch)
        totalInserted += batch.length
        batch = []
        process.stdout.write(`\r💾 Salvas no banco: ${totalInserted} impressões jogáveis...`)
      }
    }

    if (batch.length > 0) {
      await insertBatch(client, batch)
      totalInserted += batch.length
    }

    if (malformedLines > 0) {
      console.log(`\n⚠️ ${malformedLines} linhas malformadas foram ignoradas.`)
    }
    console.log(`\n🎉 Finalizado! Banco reestruturado sem lixo de Art Series ou Tokens.`)
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