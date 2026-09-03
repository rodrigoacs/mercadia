// Módulo único de resolução de metadados via Scryfall.
// Usado tanto pelo job agendado (updateMetadata.js) quanto pela
// sincronização feita pelo dashboard (ligaParser.js), pra evitar
// que as duas lógicas divirjam de novo.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const SCRYFALL_HEADERS = {
  'User-Agent': 'Mercadia/1.0',
  'Accept': 'application/json'
}

export async function loadTranslations(client) {
  const transRes = await client.query('SELECT liga_name, scryfall_code FROM set_translations').catch(() => ({ rows: [] }))
  const translations = new Map()
  transRes.rows.forEach(r => {
    if (r.liga_name && r.scryfall_code) {
      translations.set(r.liga_name.toLowerCase().trim(), r.scryfall_code.toLowerCase().trim())
    }
  })
  return translations
}

function resolveTargetSetCode(rawSetCode, translations) {
  const key = (rawSetCode || '').toLowerCase().trim()
  const parensMatch = (rawSetCode || '').match(/\(([a-zA-Z0-9]+)\)/)
  const codeInParens = parensMatch ? parensMatch[1].toLowerCase() : ''
  return translations.get(key) || codeInParens || key
}

function extractVariantFlags(extras) {
  const safeExtras = (extras || '').toLowerCase()
  return {
    isBorderless: safeExtras.includes('borderless') || safeExtras.includes('sem borda'),
    isShowcase: safeExtras.includes('showcase') || safeExtras.includes('variante'),
    isExtended: safeExtras.includes('extended') || safeExtras.includes('estendida'),
    isRetro: safeExtras.includes('retro') || safeExtras.includes('moldura')
  }
}

const DETERMINISTIC_QUERY = `
  SELECT card_data
  FROM scryfall_cards
  WHERE (name ILIKE $1 OR name ILIKE $2)
    AND card_data->>'layout' NOT IN ('art_series', 'token', 'double_faced_token', 'emblem')
    AND card_data->>'set_type' != 'memorabilia'
  ORDER BY
    -- CAMADA 1: Exatidão Absoluta (Edição correta E Número de colecionador correto) -> Resolve Nazgûl perfeitamente
    CASE WHEN LOWER(set_code) = LOWER($3) AND LOWER(collector_number) = LOWER($4) AND $4 != '' THEN 0 ELSE 1 END ASC,

    -- CAMADA 2: Exatidão de Edição (Edição correta, mesmo que a numeração da Liga difira)
    CASE WHEN LOWER(set_code) = LOWER($3) THEN 0 ELSE 1 END ASC,

    -- CAMADA 2.1: Dentro da edição certa, prefere o tratamento visual solicitado nos extras
    CASE WHEN $5::boolean AND (card_data->>'border_color' = 'borderless' OR card_data->>'promo_types' ILIKE '%borderless%') THEN 0 ELSE 1 END ASC,
    CASE WHEN $6::boolean AND (card_data->>'frame_effects' ILIKE '%showcase%' OR card_data->>'promo_types' ILIKE '%showcase%') THEN 0 ELSE 1 END ASC,
    CASE WHEN $7::boolean AND (card_data->>'frame_effects' ILIKE '%extendedart%' OR card_data->>'promo_types' ILIKE '%extendedart%') THEN 0 ELSE 1 END ASC,
    CASE WHEN $8::boolean AND (card_data->>'frame' = '1997' OR card_data->>'promo_types' ILIKE '%retro%') THEN 0 ELSE 1 END ASC,

    -- CAMADA 3: Se não achou na edição, prefere impressões de sets de expansão/core (foge de promos/lairs)
    CASE WHEN card_data->>'set_type' IN ('expansion', 'core', 'draft_innovation', 'masters', 'commander') THEN 0 ELSE 1 END ASC,

    -- CAMADA 4: Prefere versões com frame padrão caso nenhuma versão alternativa tenha sido pedida
    CASE WHEN NOT ($5::boolean OR $6::boolean OR $7::boolean OR $8::boolean) AND card_data->>'promo_types' IS NULL THEN 0 ELSE 1 END ASC,

    -- Desempate final: Pega a impressão mais recente ou numeração menor
    length(collector_number) ASC, collector_number ASC
  LIMIT 1;
`

async function findLocalCardData(client, cleanName, targetSetCode, safeNum, flags) {
  const result = await client.query(DETERMINISTIC_QUERY, [
    cleanName, `${cleanName} // %`, targetSetCode, safeNum,
    flags.isBorderless, flags.isShowcase, flags.isExtended, flags.isRetro
  ])
  return result.rows.length > 0 ? result.rows[0].card_data : null
}

async function fetchFallbackCardData(cleanName) {
  try {
    const fallbackUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}`
    const response = await fetch(fallbackUrl, { headers: SCRYFALL_HEADERS })
    if (!response.ok) return null
    const apiData = await response.json()
    if (apiData.layout === 'art_series' || apiData.layout === 'token') return null
    await delay(75)
    return apiData
  } catch {
    return null
  }
}

function buildMetadataRow(cardData, targetSetCode) {
  const colorIdentity = cardData.color_identity && cardData.color_identity.length > 0 ? cardData.color_identity.join(',') : 'C'
  const manaCost = cardData.mana_cost || (cardData.card_faces && cardData.card_faces[0].mana_cost ? cardData.card_faces[0].mana_cost : '')
  const cmc = cardData.cmc || 0
  const typeLine = cardData.type_line || ''
  const rarity = cardData.rarity || ''
  const oracleText = cardData.oracle_text || (cardData.card_faces && cardData.card_faces[0].oracle_text ? cardData.card_faces[0].oracle_text : '')
  const legalities = JSON.stringify(cardData.legalities || {})
  const imageUri = cardData.image_uris ? cardData.image_uris.normal : (cardData.card_faces && cardData.card_faces[0].image_uris ? cardData.card_faces[0].image_uris.normal : '')
  const scryfallSet = cardData.set || targetSetCode

  return { colorIdentity, manaCost, cmc, typeLine, rarity, oracleText, legalities, imageUri, scryfallSet }
}

const UPSERT_FOUND_QUERY = `
  INSERT INTO metadata_cartas (name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri, scryfall_set)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT (name, set_code, num, extras) DO UPDATE SET
    color_identity = EXCLUDED.color_identity,
    mana_cost = EXCLUDED.mana_cost,
    cmc = EXCLUDED.cmc,
    type_line = EXCLUDED.type_line,
    rarity = EXCLUDED.rarity,
    oracle_text = EXCLUDED.oracle_text,
    legalities = EXCLUDED.legalities,
    image_uri = EXCLUDED.image_uri,
    scryfall_set = EXCLUDED.scryfall_set
  WHERE metadata_cartas.rarity = 'UNKNOWN'
    AND COALESCE(metadata_cartas.is_manual_override, FALSE) = FALSE
`

const UPSERT_UNKNOWN_QUERY = `
  INSERT INTO metadata_cartas (name, set_code, num, extras, color_identity, mana_cost, cmc, type_line, rarity, oracle_text, legalities, image_uri, scryfall_set)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT (name, set_code, num, extras) DO UPDATE SET
    scryfall_set = EXCLUDED.scryfall_set
  WHERE metadata_cartas.rarity = 'UNKNOWN'
    AND COALESCE(metadata_cartas.is_manual_override, FALSE) = FALSE
`

// Resolve uma carta (name/set_code/num/extras) contra o cache local do
// Scryfall (com fallback pra API ao vivo) e grava em metadata_cartas.
// Retorna true se achou dados reais, false se caiu em UNKNOWN.
export async function resolveAndUpsertCard(client, card, translations) {
  const cleanName = card.name.split('//')[0].trim().replace(/"/g, '')
  const safeNum = card.num ? card.num.toString().trim().toLowerCase() : ''
  const targetSetCode = resolveTargetSetCode(card.set_code, translations)
  const flags = extractVariantFlags(card.extras)

  let cardData = await findLocalCardData(client, cleanName, targetSetCode, safeNum, flags)
  if (!cardData) {
    cardData = await fetchFallbackCardData(cleanName)
  }

  if (cardData) {
    const row = buildMetadataRow(cardData, targetSetCode)
    await client.query(UPSERT_FOUND_QUERY, [
      card.name, card.set_code, card.num || '', card.extras || '',
      row.colorIdentity, row.manaCost, row.cmc, row.typeLine, row.rarity,
      row.oracleText, row.legalities, row.imageUri, row.scryfallSet
    ])
    return true
  } else {
    await client.query(UPSERT_UNKNOWN_QUERY, [
      card.name, card.set_code, card.num || '', card.extras || '',
      'UNKNOWN', '', 0, 'UNKNOWN', 'UNKNOWN', '', '{}', '', targetSetCode
    ])
    return false
  }
}
