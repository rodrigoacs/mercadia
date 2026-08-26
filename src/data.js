import { pool } from './db.js'

export const fetchRawDataFromDB = async () => {
  console.log(`⏳ Carregando dados massivos do banco de dados... (${new Date().toLocaleTimeString()})`)
  const client = await pool.connect()
  try {
    await client.query(`ALTER TABLE metadata_cartas ADD COLUMN IF NOT EXISTS scryfall_set VARCHAR(50);`).catch(() => { })

    const [histResult, metaResult, transResult] = await Promise.all([
      client.query(`
        SELECT 
          TO_CHAR(date, 'YYYY-MM-DD') as date_str, 
          name, set_code, num, extras, qty, unit_price, total_price 
        FROM historico_cartas 
        ORDER BY date ASC
      `),
      client.query('SELECT name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri, scryfall_set FROM metadata_cartas'),
      client.query('SELECT liga_name, scryfall_code FROM set_translations').catch(() => ({ rows: [] }))
    ])

    const transMap = new Map()
    if (transResult && transResult.rows) {
      transResult.rows.forEach(r => {
        if (r.liga_name && r.scryfall_code) {
          transMap.set(r.liga_name.toLowerCase().trim(), r.scryfall_code.toLowerCase().trim())
        }
      })
    }

    const metaDict = new Map()
    for (const m of metaResult.rows) {
      const scryCode = m.scryfall_set || transMap.get((m.set_code || '').toLowerCase().trim()) || ''
      metaDict.set(`${m.name}|${m.set_code}|${m.num || ''}|${m.extras || ''}`, {
        colorIdentity: m.color_identity || 'C',
        manaCost: m.mana_cost || '',
        cmc: parseFloat(m.cmc) || 0,
        typeLine: m.type_line || '',
        rarity: m.rarity || '',
        oracleText: m.oracle_text || '',
        legalities: m.legalities || {},
        imageUri: m.image_uri || '',
        scryfallSet: scryCode
      })
    }

    const emptyMeta = { colorIdentity: 'C', manaCost: '', cmc: 0, typeLine: '', rarity: '', oracleText: '', legalities: {}, imageUri: '', scryfallSet: '' }

    const lastRow = histResult.rows[histResult.rows.length - 1]
    const lastDate = lastRow ? lastRow.date_str : null

    const data = histResult.rows.map(row => {
      const parensMatch = (row.set_code || '').match(/\(([a-zA-Z0-9]+)\)/)
      const codeInParens = parensMatch ? parensMatch[1].toLowerCase() : ''
      const mappedScryCode = transMap.get((row.set_code || '').toLowerCase().trim()) || codeInParens || (row.set_code || '').toLowerCase().trim()

      const baseObj = {
        date: row.date_str,
        name: row.name,
        set: row.set_code,
        scryfallSet: mappedScryCode,
        num: row.num,
        extras: row.extras || '',
        qty: row.qty,
        unitPrice: parseFloat(row.unit_price),
        totalPrice: parseFloat(row.total_price)
      }

      if (row.date_str === lastDate) {
        const metaKey = `${row.name}|${row.set_code}|${row.num || ''}|${row.extras || ''}`
        const metaObj = metaDict.get(metaKey) || emptyMeta
        Object.assign(baseObj, metaObj)
        if (!baseObj.scryfallSet && metaObj.scryfallSet) {
          baseObj.scryfallSet = metaObj.scryfallSet
        }
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