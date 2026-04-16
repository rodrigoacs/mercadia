import * as cheerio from 'cheerio'
import { pool } from './db.js'

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

      const nomeCarta = nomeEn
      const qtd = parseInt(qtdStr) || 0
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
      WHERE m.name IS NULL AND h.date = $1;
    `, [dataHoje])

    const missingCards = missingCardsQuery.rows

    if (missingCards.length > 0) {
      const transRes = await client.query('SELECT * FROM set_translations')
      const translations = {}
      transRes.rows.forEach(r => translations[r.liga_name] = r.scryfall_code.toLowerCase())

      for (const card of missingCards) {
        const cleanName = card.name.split('//')[0].trim().replace(/"/g, '')
        const safeNum = card.num || ''
        const safeExtras = card.extras || ''

        const targetSetCode = translations[card.set_code] || card.set_code.toLowerCase()

        // 🧠 Extração Dinâmica do que estiver entre parênteses
        const match = card.set_code.match(/\((.*?)\)/)
        const inParens = match ? match[1].toLowerCase() : ''
        const hints = `${inParens} ${safeExtras}`.toLowerCase()

        // Regras baseadas em categorias comuns
        const isBorderless = hints.includes('borderless') || hints.includes('sem borda') || hints.includes('profile')
        const isShowcase = hints.includes('showcase') || hints.includes('variante') || hints.includes('variant')
        const isExtended = hints.includes('extended') || hints.includes('estendida')
        const isRetro = hints.includes('retro') || hints.includes('antiga') || hints.includes('moldura')

        // 🔮 A Mágica: Extrair uma palavra-chave única (ex: "Viewport", "Dossier", "Schematic", "Double")
        let specialHint = ''
        if (inParens) {
          // Remove as palavras que já usamos ou que não ajudam na busca do json do Scryfall
          let cleaned = inParens.replace(/borderless|sem borda|showcase|variantes|variants|extended|estendida|retro|antiga|moldura|art|frame|lands|cards/g, '').trim()

          // Pega a primeira palavra "forte" que sobrou
          const words = cleaned.split(/[\s\-]+/).filter(w => w.length > 3)
          if (words.length > 0) {
            specialHint = words[0] // Isso vai capturar perfeitamente 'viewport', 'dossier', 'double', 'schematic'
          }
        }

        // Query com pontuação (A Dica Especial $8 tem prioridade absoluta!)
        const searchSql = `
          SELECT card_data 
          FROM scryfall_cards 
          WHERE (name ILIKE $1 OR name ILIKE $2) AND set_code = $3
          ORDER BY 
            CASE WHEN $8::text != '' AND (card_data->>'promo_types' ILIKE '%' || $8::text || '%' OR card_data->>'frame_effects' ILIKE '%' || $8::text || '%') THEN 0 ELSE 1 END ASC,
            CASE WHEN $4::boolean AND (card_data->>'promo_types' ILIKE '%borderless%' OR card_data->>'border_color' = 'borderless' OR card_data->>'full_art' = 'true') THEN 0 ELSE 1 END ASC,
            CASE WHEN $5::boolean AND (card_data->>'frame_effects' ILIKE '%showcase%' OR card_data->>'promo_types' ILIKE '%showcase%') THEN 0 ELSE 1 END ASC,
            CASE WHEN $6::boolean AND (card_data->>'frame_effects' ILIKE '%extendedart%' OR card_data->>'promo_types' ILIKE '%extendedart%') THEN 0 ELSE 1 END ASC,
            CASE WHEN $7::boolean AND (card_data->>'frame' = '1997' OR card_data->>'promo_types' ILIKE '%retro%') THEN 0 ELSE 1 END ASC,
            -- Penaliza variantes caso o usuário queira a versão normal (se nenhuma dica for encontrada)
            CASE WHEN NOT ($4::boolean OR $5::boolean OR $6::boolean OR $7::boolean OR $8::text != '') AND (card_data->>'promo_types' IS NOT NULL OR card_data->>'frame_effects' IS NOT NULL) THEN 1 ELSE 0 END ASC,
            length(collector_number) ASC, collector_number ASC
          LIMIT 1
        `

        let localSearch = await client.query(searchSql, [
          cleanName, `${cleanName} // %`, targetSetCode, isBorderless, isShowcase, isExtended, isRetro, specialHint
        ])

        // Fallback: Se não encontrou no Set específico, tenta achar a variante/promoção em toda a base de dados
        if (localSearch.rows.length === 0) {
          const fallbackSql = `
            SELECT card_data 
            FROM scryfall_cards 
            WHERE name ILIKE $1 OR name ILIKE $2
            ORDER BY 
              CASE WHEN $7::text != '' AND (card_data->>'promo_types' ILIKE '%' || $7::text || '%' OR card_data->>'frame_effects' ILIKE '%' || $7::text || '%') THEN 0 ELSE 1 END ASC,
              CASE WHEN $3::boolean AND (card_data->>'promo_types' ILIKE '%borderless%' OR card_data->>'border_color' = 'borderless' OR card_data->>'full_art' = 'true') THEN 0 ELSE 1 END ASC,
              CASE WHEN $4::boolean AND (card_data->>'frame_effects' ILIKE '%showcase%' OR card_data->>'promo_types' ILIKE '%showcase%') THEN 0 ELSE 1 END ASC,
              CASE WHEN $5::boolean AND (card_data->>'frame_effects' ILIKE '%extendedart%' OR card_data->>'promo_types' ILIKE '%extendedart%') THEN 0 ELSE 1 END ASC,
              CASE WHEN $6::boolean AND (card_data->>'frame' = '1997' OR card_data->>'promo_types' ILIKE '%retro%') THEN 0 ELSE 1 END ASC,
              length(collector_number) ASC, collector_number ASC
            LIMIT 1
          `
          localSearch = await client.query(fallbackSql, [
            cleanName, `${cleanName} // %`, isBorderless, isShowcase, isExtended, isRetro, specialHint
          ])
        }

        if (localSearch.rows.length > 0) {
          const cardData = localSearch.rows[0].card_data
          const colorIdentity = cardData.color_identity && cardData.color_identity.length > 0 ? cardData.color_identity.join(',') : 'C'
          const manaCost = cardData.mana_cost || (cardData.card_faces && cardData.card_faces[0].mana_cost ? cardData.card_faces[0].mana_cost : '')
          const cmc = cardData.cmc || 0
          const typeLine = cardData.type_line || ''
          const rarity = cardData.rarity || ''
          const oracleText = cardData.oracle_text || (cardData.card_faces && cardData.card_faces[0].oracle_text ? cardData.card_faces[0].oracle_text : '')
          const legalities = JSON.stringify(cardData.legalities || {})
          const imageUri = cardData.image_uris ? cardData.image_uris.normal : (cardData.card_faces && cardData.card_faces[0].image_uris ? cardData.card_faces[0].image_uris.normal : '')

          await client.query(`
            INSERT INTO metadata_cartas (name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (name, set_code, num, extras) DO NOTHING
          `, [card.name, card.set_code, safeNum, safeExtras, colorIdentity, manaCost, cmc, typeLine, rarity, oracleText, legalities, imageUri])
        } else {
          await client.query(`
            INSERT INTO metadata_cartas (name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (name, set_code, num, extras) DO NOTHING
          `, [card.name, card.set_code, safeNum, safeExtras, 'UNKNOWN', '', 0, 'UNKNOWN', 'UNKNOWN', '', '{}', ''])
        }
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