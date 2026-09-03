import * as cheerio from 'cheerio'
import { pool } from './db.js'
import { loadTranslations, resolveAndUpsertCard } from './metadataResolver.js'

function limparNomeCarta(nome) {
  return nome.replace(/\s*\(#\d+\)\s*$/, '').trim()
}

export async function syncLigaMagic(html) {
  const client = await pool.connect()

  try {
    const $ = cheerio.load(html)
    const dataHoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).split('/').reverse().join('-')

    let totalColecao = 0
    const inserts = []

    $('table tr').each((i, el) => {
      const cols = $(el).find('td')
      if (cols.length < 11) return

      const edicao = $(cols[0]).text().trim()
      const numColecao = $(cols[1]).text().trim()
      const qtdStr = $(cols[4]).text().trim().toLowerCase().replace('x', '')
      const nomeEn = $(cols[8]).text().trim()
      const extras = $(cols[9]).text().trim()
      const precoStr = $(cols[10]).text().trim()

      if (!precoStr) return

      const nomeCarta = limparNomeCarta(nomeEn)
      const qtd = parseInt(qtdStr, 10) || 0
      const preco = parseFloat(precoStr.replace(/\./g, '').replace(',', '.'))

      if (isNaN(preco) || isNaN(qtd)) return

      const precoTotal = preco * qtd
      inserts.push({ dataHoje, nomeCarta, edicao, numColecao, extras, qtd, preco, precoTotal })
      totalColecao += precoTotal
    })

    if (inserts.length === 0) throw new Error("Nenhuma carta encontrada no HTML colado.")

    await client.query('BEGIN')
    await client.query('DELETE FROM historico_cartas WHERE date = $1', [dataHoje])

    const insertQuery = `
      INSERT INTO historico_cartas (date, name, set_code, num, extras, qty, unit_price, total_price)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `

    for (const item of inserts) {
      await client.query(insertQuery, [
        item.dataHoje, item.nomeCarta, item.edicao, item.numColecao, item.extras, item.qtd, item.preco, item.precoTotal
      ])
    }

    const missingCardsQuery = await client.query(`
      SELECT DISTINCT h.name, h.set_code, h.num, h.extras
      FROM historico_cartas h
      LEFT JOIN metadata_cartas m 
        ON h.name = m.name 
        AND h.set_code = m.set_code 
        AND COALESCE(h.num, '') = m.num 
        AND COALESCE(h.extras, '') = m.extras
      WHERE m.name IS NULL
        OR (
          COALESCE(m.is_manual_override, FALSE) = FALSE
          AND m.rarity = 'UNKNOWN'
        );
    `)

    const missingCards = missingCardsQuery.rows

    if (missingCards.length > 0) {
      const translations = await loadTranslations(client)
      for (const card of missingCards) {
        await resolveAndUpsertCard(client, card, translations)
      }
    }

    await client.query('COMMIT')
    return { success: true, count: inserts.length, total: totalColecao }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
