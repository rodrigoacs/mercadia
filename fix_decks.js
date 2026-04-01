import { pool } from './src/db.js'

async function fixDecksNames() {
  const client = await pool.connect()
  try {
    console.log('Iniciando limpeza de nomes (Art Series) nos decks...')

    // Puxa apenas os nomes que contêm a barra dupla
    const res = await client.query("SELECT DISTINCT name FROM deck_cards WHERE name LIKE '%//%'")
    const cardsToFix = res.rows

    let fixedCount = 0

    for (const card of cardsToFix) {
      const originalName = card.name
      // Extrai a face frontal
      const cleanName = originalName.split('//')[0].trim().toLowerCase()

      // Busca o nome real e limpo da carta válida no Scryfall
      const localRes = await client.query(
        `SELECT name FROM scryfall_cards 
         WHERE (name ILIKE $1 OR name ILIKE $2)
           AND card_data->>'layout' != 'art_series'
           AND card_data->>'layout' NOT LIKE '%token%'
           AND card_data->>'set_type' != 'memorabilia'
         LIMIT 1`,
        [cleanName, `${cleanName} // %`]
      )

      if (localRes.rows.length > 0) {
        const correctName = localRes.rows[0].name

        // Se o nome verdadeiro for diferente do cadastrado, ele corrige em todos os decks
        if (correctName !== originalName) {
          await client.query(
            `UPDATE deck_cards SET name = $1 WHERE name = $2`,
            [correctName, originalName]
          )
          fixedCount++
          console.log(`Corrigido: "${originalName}" -> "${correctName}"`)
        }
      }
    }

    console.log(`\nLimpeza concluída! ${fixedCount} nomes de cartas foram corrigidos.`)
  } catch (error) {
    console.error('Erro na correção:', error)
  } finally {
    client.release()
    process.exit(0)
  }
}

fixDecksNames()