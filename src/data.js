import { pool } from './db.js'

export const fetchRawDataFromDB = async () => {
  console.log(`⏳ Carregando dados massivos do banco de dados... (${new Date().toLocaleTimeString()})`)
  const client = await pool.connect()
  try {
    const [histResult, metaResult] = await Promise.all([
      client.query(`
        SELECT 
          TO_CHAR(date, 'YYYY-MM-DD') as date_str, 
          name, set_code, num, extras, qty, unit_price, total_price 
        FROM historico_cartas 
        ORDER BY date ASC
      `),
      client.query('SELECT name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri FROM metadata_cartas')
    ])

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

    const emptyMeta = { colorIdentity: 'C', manaCost: '', cmc: 0, typeLine: '', rarity: '', oracleText: '', legalities: {}, imageUri: '' }

    // Descobre a última data pegando o último registro ordenado
    const lastRow = histResult.rows[histResult.rows.length - 1]
    const lastDate = lastRow ? lastRow.date_str : null

    const data = histResult.rows.map(row => {
      const baseObj = {
        date: row.date_str,
        name: row.name,
        set: row.set_code,
        num: row.num,
        extras: row.extras || '',
        qty: row.qty,
        unitPrice: parseFloat(row.unit_price),
        totalPrice: parseFloat(row.total_price)
      }

      // Anexa metadados pesados APENAS nas cartas de hoje para evitar memory bloat
      if (row.date_str === lastDate) {
        const metaKey = `${row.name}|${row.set_code}|${row.num || ''}|${row.extras || ''}`
        Object.assign(baseObj, metaDict.get(metaKey) || emptyMeta)
      }

      return baseObj
    })

    return data
  } catch (error) {
    console.error('❌ Erro ao buscar dados:', error.message)
    return []
  } finally {
    client.release()
  }
}