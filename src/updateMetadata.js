import { pool, initDB } from './db.js'
import { loadTranslations, resolveAndUpsertCard } from './metadataResolver.js'

async function updateScryfallData() {
  console.log('🚀 Iniciando Resolução Determinística de Metadados (Pipeline em Cascata)...')

  await initDB()
  const client = await pool.connect()

  try {
    const translations = await loadTranslations(client)

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
    console.log(`🔍 Resolvendo ${missingCards.length} cartas pendentes no banco...`)

    if (missingCards.length === 0) return

    let processadas = 0
    let erros = 0

    for (const card of missingCards) {
      try {
        const found = await resolveAndUpsertCard(client, card, translations)
        if (found) processadas++
        else erros++
      } catch (err) {
        erros++
      }

      if ((processadas + erros) % 100 === 0) {
        process.stdout.write(`\r⏳ Resolvidas: ${processadas + erros} de ${missingCards.length}...`)
      }
    }

    console.log(`\n✅ Concluído com Sucesso! ${processadas} cartas mapeadas deterministicamente.`)
  } catch (error) {
    console.error('\n❌ Erro fatal durante a resolução de metadados:', error)
  } finally {
    client.release()
    pool.end()
  }
}

updateScryfallData()
