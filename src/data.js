import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
})

// Variáveis de cache
let cache = null
let lastFetch = 0
const CACHE_TTL = 5 * 60 * 1000 // Tempo de vida do cache: 5 minutos

export const getRawData = async () => {
  const now = Date.now()

  // Se o cache existe e ainda não expirou, devolve na hora
  if (cache && (now - lastFetch < CACHE_TTL)) {
    return cache
  }

  console.log('⏳ Carregando os dados do banco de dados (Modo Otimizado)...')
  const client = await pool.connect()
  try {
    // 1. Garante que os índices existam no banco para a busca não gargalar
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_historico_data ON historico_cartas (date);
      CREATE INDEX IF NOT EXISTS idx_historico_nome_set ON historico_cartas (name, set_code);
    `)

    // 2. Dispara as duas consultas simultaneamente (Promise.all) para não repetir trafego de metadados
    const [histResult, metaResult] = await Promise.all([
      client.query('SELECT date, name, set_code, num, extras, qty, unit_price, total_price FROM historico_cartas ORDER BY date ASC'),
      client.query('SELECT name, set_code, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri FROM metadata_cartas')
    ])

    console.log(`📦 Dados recebidos: ${histResult.rowCount} registros no histórico e ${metaResult.rowCount} metadados. Montando dicionário em RAM...`)

    // 3. Monta um Dicionário O(1) com os metadados para não fazer loops duplos
    const metaDict = new Map()
    for (const m of metaResult.rows) {
      metaDict.set(`${m.name}|${m.set_code}`, {
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

    // Metadado em branco caso a carta ainda não tenha sido processada no Scryfall
    const emptyMeta = {
      colorIdentity: 'C', manaCost: '', cmc: 0, typeLine: '', rarity: '', oracleText: '', legalities: {}, imageUri: ''
    }

    // 4. Mapeia o resultado final juntando o histórico magro com o dicionário
    cache = histResult.rows.map(row => {
      const meta = metaDict.get(`${row.name}|${row.set_code}`) || emptyMeta

      return {
        date: row.date.toISOString().split('T')[0],
        name: row.name,
        set: row.set_code,
        num: row.num,
        extras: row.extras || '',
        qty: row.qty,
        unitPrice: parseFloat(row.unit_price),
        totalPrice: parseFloat(row.total_price),
        ...meta // Espalha as propriedades do dicionário aqui dentro
      }
    })

    lastFetch = now
    console.log('✅ Estrutura de dados montada e cacheada com sucesso.')
    
    return cache
  } catch (error) {
    console.error('Erro ao buscar dados no banco de dados:', error)
    return cache || []
  } finally {
    client.release()
  }
}