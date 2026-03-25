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

  // Se o cache existe e ainda não expirou, devolve na hora sem bater no banco!
  if (cache && (now - lastFetch < CACHE_TTL)) {
    return cache
  }

  console.log('⏳ Buscando mais de 200k registros do banco de dados... Isso vai levar uns segundos.')
  const client = await pool.connect()
  try {
    const query = `
      SELECT 
        h.date, h.name, h.set_code, h.num, h.extras, h.qty, h.unit_price, h.total_price,
        m.color_identity, m.mana_cost, m.cmc, m.type_line, m.rarity, m.oracle_text, m.legalities, m.image_uri
      FROM historico_cartas h
      LEFT JOIN metadata_cartas m ON h.name = m.name AND h.set_code = m.set_code
      ORDER BY h.date ASC
    `
    const result = await client.query(query)

    // Mapeia os dados e atualiza o cache
    cache = result.rows.map(row => ({
      date: row.date.toISOString().split('T')[0],
      name: row.name,
      set: row.set_code,
      num: row.num,
      extras: row.extras || '',
      qty: row.qty,
      unitPrice: parseFloat(row.unit_price),
      totalPrice: parseFloat(row.total_price),

      // Metadados enriquecidos do Scryfall
      colorIdentity: row.color_identity || 'C',
      manaCost: row.mana_cost || '',
      cmc: parseFloat(row.cmc) || 0,
      typeLine: row.type_line || '',
      rarity: row.rarity || '',
      oracleText: row.oracle_text || '',
      legalities: row.legalities || {},
      imageUri: row.image_uri || ''
    }))

    lastFetch = now
    console.log('✅ Dados cacheados com sucesso! As próximas requisições vão voar.')

    return cache
  } catch (error) {
    console.error('Erro ao buscar dados no banco de dados:', error)
    // Se der merda no banco, tenta devolver o cache antigo para o painel não cair
    return cache || []
  } finally {
    client.release()
  }
}