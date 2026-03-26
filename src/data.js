import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
})

let cache = null
let lastFetch = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutos

export const getRawData = async () => {
  const now = Date.now()

  if (cache && (now - lastFetch < CACHE_TTL)) {
    return cache
  }

  console.log('⏳ Carregando os dados do banco de dados...')
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_historico_data ON historico_cartas (date);
      CREATE INDEX IF NOT EXISTS idx_historico_nome_set ON historico_cartas (name, set_code);
    `)

    const [histResult, metaResult] = await Promise.all([
      client.query('SELECT date, name, set_code, num, extras, qty, unit_price, total_price FROM historico_cartas ORDER BY date ASC'),
      client.query('SELECT name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri FROM metadata_cartas')
    ])

    // Dicionário com a chave exata (Nome + Edição + Num + Extras)
    const metaDict = new Map()
    for (const m of metaResult.rows) {
      metaDict.set(`${m.name}|${m.set_code}|${m.num}|${m.extras}`, {
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
      // Busca a arte exata baseada na chave completa
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
    console.log('✅ Estrutura cacheada com artes exatas!')

    return cache
  } catch (error) {
    console.error('Erro ao buscar dados:', error)
    return cache || []
  } finally {
    client.release()
  }
}