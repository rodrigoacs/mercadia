import { pool } from './db.js'

let cache = null
let lastFetch = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutos

export const getRawData = async () => {
  const now = Date.now()

  if (cache && (now - lastFetch < CACHE_TTL)) {
    console.log('📦 Usando cache (válido por mais', Math.round((CACHE_TTL - (now - lastFetch)) / 1000), 's)')
    return cache
  }

  console.log('⏳ Carregando dados do banco de dados...')
  const client = await pool.connect()
  try {
    console.log('📇 Criando índices...')
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_historico_data ON historico_cartas (date);
      CREATE INDEX IF NOT EXISTS idx_historico_nome_set ON historico_cartas (name, set_code);
    `)

    console.log('🔍 Consultando histórico e metadata...')
    const [histResult, metaResult] = await Promise.all([
      client.query('SELECT date, name, set_code, num, extras, qty, unit_price, total_price FROM historico_cartas ORDER BY date ASC'),
      client.query('SELECT name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri FROM metadata_cartas')
    ])

    console.log(`📊 Processando ${histResult.rows.length} cartas e ${metaResult.rows.length} metadados...`)

    const metaDict = new Map()
    for (const m of metaResult.rows) {
      metaDict.set(`${m.name}|${m.set_code}|${m.num || ''}|${m.extras || ''}`, {
        colorIdentity: m.color_identity || 'C',
        manaCost: m.mana_cost || '',
        cmc: parseFloat(m.cmc) || 0,
        typeLine: m.type_line || '',
        rarity: m.rarity || '',
        oracleText: m.oracle_text || '',
        legalities: m.legalities || {},
        imageUri: m.image_uri || ''
      })
    }

    const emptyMeta = {
      colorIdentity: 'C', manaCost: '', cmc: 0, typeLine: '', rarity: '', oracleText: '', legalities: {}, imageUri: ''
    }

    cache = histResult.rows.map(row => {
      const metaKey = `${row.name}|${row.set_code}|${row.num || ''}|${row.extras || ''}`
      const meta = metaDict.get(metaKey) || emptyMeta

      return {
        date: row.date.toISOString().split('T')[0],
        name: row.name,
        set: row.set_code,
        num: row.num,
        extras: row.extras || '',
        qty: row.qty,
        unitPrice: parseFloat(row.unit_price),
        totalPrice: parseFloat(row.total_price),
        ...meta
      }
    })

    lastFetch = now
    console.log(`✅ Cache atualizado! ${cache.length} cartas em memória`)

    return cache
  } catch (error) {
    console.error('❌ Erro ao buscar dados:', error.message)
    return cache || []
  } finally {
    client.release()
  }
}