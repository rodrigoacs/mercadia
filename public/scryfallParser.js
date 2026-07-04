const COLOR_MAP = {
  w: 'W', u: 'U', b: 'B', r: 'R', g: 'G', c: 'C',
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C'
}

const GUILDS_AND_SHARDS = {
  azorius: ['W', 'U'], dimir: ['U', 'B'], rakdos: ['B', 'R'], gruul: ['R', 'G'], selesnya: ['R', 'G'],
  orzhov: ['W', 'B'], izzet: ['U', 'R'], golgari: ['R', 'G'], boros: ['R', 'W'], simic: ['G', 'U'],
  bant: ['G', 'W', 'U'], esper: ['W', 'U', 'B'], grixis: ['U', 'B', 'R'], jund: ['B', 'R', 'G'], naya: ['B', 'R', 'G'],
  abzan: ['W', 'B', 'G'], jeskai: ['U', 'R', 'W'], sultai: ['B', 'G', 'U'], mardu: ['R', 'W', 'B'], temur: ['G', 'U', 'R'],
  chaos: ['U', 'B', 'R', 'G'], aggression: ['B', 'R', 'G', 'W'], altruism: ['R', 'G', 'W', 'U'], growth: ['G', 'W', 'U', 'B'], artifice: ['W', 'U', 'B', 'R']
}

function tokenize(query) {
  const tokens = []
  let i = 0
  const len = query.length

  while (i < len) {
    const char = query[i]

    if (/\s/.test(char)) {
      i++
      continue
    }

    if (char === '(') {
      tokens.push({ type: 'PAREN_OPEN' })
      i++
      continue
    }

    if (char === ')') {
      tokens.push({ type: 'PAREN_CLOSE' })
      i++
      continue
    }

    let negated = false
    let exact = false
    if (char === '-' && i + 1 < len && !/\s/.test(query[i + 1])) {
      negated = true
      i++
    } else if (char === '!' && i + 1 < len && !/\s/.test(query[i + 1])) {
      exact = true
      i++
    }

    let str = ''
    if (query[i] === '"') {
      i++
      while (i < len && query[i] !== '"') {
        str += query[i]
        i++
      }
      i++
      tokens.push({ type: 'EXPR', negated, exact, raw: str, isQuote: true })
      continue
    }

    while (i < len && !/\s/.test(query[i]) && query[i] !== '(' && query[i] !== ')') {
      str += query[i]
      i++
    }

    if (str.toLowerCase() === 'or') {
      tokens.push({ type: 'OR' })
    } else {
      tokens.push({ type: 'EXPR', negated, exact, raw: str })
    }
  }

  return tokens
}

function parseTokens(tokens) {
  let pos = 0

  function parseExpression() {
    let left = parseTerm()
    while (pos < tokens.length && tokens[pos].type === 'OR') {
      pos++
      const right = parseTerm()
      left = { type: 'OR_NODE', left, right }
    }
    return left
  }

  function parseTerm() {
    const factors = []
    while (pos < tokens.length && tokens[pos].type !== 'OR' && tokens[pos].type !== 'PAREN_CLOSE') {
      factors.push(parseFactor())
    }
    if (factors.length === 0) return { type: 'TRUE_NODE' }
    if (factors.length === 1) return factors[0]
    return { type: 'AND_NODE', factors }
  }

  function parseFactor() {
    const token = tokens[pos]
    if (token.type === 'PAREN_OPEN') {
      pos++
      const node = parseExpression()
      if (pos < tokens.length && tokens[pos].type === 'PAREN_CLOSE') {
        pos++
      }
      return node
    }
    pos++
    return parseLeaf(token)
  }

  return parseExpression()
}

function parseLeaf(token) {
  let raw = token.raw || ''
  let negated = token.negated || false
  const exact = token.exact || false

  if (raw.toLowerCase().startsWith('not:')) {
    negated = !negated
    raw = raw.slice(4)
  }

  const match = raw.match(/^([a-zA-Z]+)(>=|<=|!=|>|<|=|:)(.+)$/)
  if (match) {
    return {
      type: 'CONDITION',
      negated,
      keyword: match[1].toLowerCase(),
      operator: match[2] === ':' ? '=' : match[2],
      value: match[3]
    }
  }

  return {
    type: 'TEXT',
    negated,
    exact,
    value: raw
  }
}

export function matchScryfallQuery(card, query) {
  if (!query || query.trim() === '') return true
  try {
    const tokens = tokenize(query)
    const ast = parseTokens(tokens)
    return evaluateNode(ast, card)
  } catch (e) {
    return true
  }
}

function evaluateNode(node, card) {
  if (!node) return true
  switch (node.type) {
    case 'TRUE_NODE': return true
    case 'AND_NODE': return node.factors.every(f => evaluateNode(f, card))
    case 'OR_NODE': return evaluateNode(node.left, card) || evaluateNode(node.right, card)
    case 'TEXT': {
      const res = evaluateText(card, node.value, node.exact)
      return node.negated ? !res : res
    }
    case 'CONDITION': {
      const res = evaluateCondition(card, node.keyword, node.operator, node.value)
      return node.negated ? !res : res
    }
    default: return true
  }
}

function evaluateText(card, text, exact) {
  const target = text.toLowerCase()
  const name = (card.name || '').toLowerCase()
  const type = (card.typeLine || '').toLowerCase()
  const oracle = (card.oracleText || '').toLowerCase()

  if (exact) return name === target
  if (target.startsWith('/') && target.endsWith('/') && target.length > 2) {
    try {
      const regex = new RegExp(target.slice(1, -1), 'i')
      return regex.test(name) || regex.test(type) || regex.test(oracle)
    } catch (e) { return false }
  }

  return name.includes(target) || type.includes(target) || oracle.includes(target)
}

function evaluateCondition(card, kw, op, val) {
  val = val.toLowerCase().trim()

  if (['name', 'n'].includes(kw)) return compareString(card.name, op, val)
  if (['type', 't'].includes(kw)) return compareString(card.typeLine, op, val)
  if (['oracle', 'o'].includes(kw)) return compareString(card.oracleText, op, val)
  if (['set', 's', 'e', 'edition'].includes(kw)) return compareString(card.set, op, val)
  if (['rarity', 'r'].includes(kw)) return compareRarity(card.rarity, op, val)

  if (['id', 'identity'].includes(kw)) return compareColorIdentity(card.colorIdentity, op, val)
  if (['c', 'color'].includes(kw)) return compareColorIdentity(card.manaCost + ',' + card.colorIdentity, op, val)

  if (['mv', 'manavalue', 'cmc'].includes(kw)) {
    if (val === 'even') return (card.cmc || 0) % 2 === 0
    if (val === 'odd') return (card.cmc || 0) % 2 !== 0
    return compareNumber(card.cmc || 0, op, parseFloat(val))
  }
  if (['m', 'mana'].includes(kw)) return compareString(card.manaCost, op, val.toUpperCase())

  if (['usd', 'price', 'brl'].includes(kw)) return compareNumber(card.unitPrice || 0, op, parseFloat(val))

  if (['is', 'has'].includes(kw)) {
    if (val === 'foil') return Boolean(card.extras && card.extras.trim() !== '')
    if (val === 'nonfoil') return !card.extras || card.extras.trim() === ''
    if (val === 'commander') return (card.typeLine || '').toLowerCase().includes('legendary') && (card.typeLine || '').toLowerCase().includes('creature')
    if (val === 'reserved') return Boolean(card.legalities && card.legalities.reserved === 'legal')
  }

  if (['f', 'format'].includes(kw)) {
    return card.legalities && card.legalities[val] === 'legal'
  }
  if (['banned'].includes(kw)) {
    return card.legalities && card.legalities[val] === 'banned'
  }

  return false
}

function compareNumber(cardVal, op, targetVal) {
  if (isNaN(targetVal)) return false
  switch (op) {
    case '>': return cardVal > targetVal
    case '>=': return cardVal >= targetVal
    case '<': return cardVal < targetVal
    case '<=': return cardVal <= targetVal
    case '!=': return cardVal !== targetVal
    case '=': default: return cardVal === targetVal
  }
}

function compareString(cardStr, op, val) {
  const str = (cardStr || '').toLowerCase()
  if (val.startsWith('/') && val.endsWith('/') && val.length > 2) {
    try { return new RegExp(val.slice(1, -1), 'i').test(str) } catch (e) { return false }
  }
  if (op === '!=') return !str.includes(val)
  return str.includes(val)
}

function compareRarity(cardRarity, op, targetRarity) {
  const weights = { common: 1, uncommon: 2, rare: 3, mythic: 4, special: 5 }
  const cW = weights[(cardRarity || '').toLowerCase()] || 0
  const tW = weights[targetRarity] || 0
  if (tW === 0) return compareString(cardRarity, op, targetRarity)
  return compareNumber(cW, op, tW)
}

function compareColorIdentity(cardColorsStr, op, targetStr) {
  const cardSet = new Set((cardColorsStr || 'C').toUpperCase().match(/[WUBRGC]/g) || ['C'])

  let targetArray = GUILDS_AND_SHARDS[targetStr]
  if (!targetArray) {
    if (targetStr === 'c' || targetStr === 'colorless') targetArray = ['C']
    else if (targetStr === 'm' || targetStr === 'multicolor') return cardSet.size > 1 && !cardSet.has('C')
    else if (!isNaN(targetStr)) return compareNumber(cardSet.has('C') ? 0 : cardSet.size, op, parseInt(targetStr, 10))
    else targetArray = targetStr.toUpperCase().split('')
  }

  const targetSet = new Set(targetArray.map(c => COLOR_MAP[c.toLowerCase()] || c))

  const isCardColorless = cardSet.has('C') || cardSet.size === 0
  const isTargetColorless = targetSet.has('C')

  switch (op) {
    case '=': {
      if (cardSet.size !== targetSet.size) return false
      for (let color of targetSet) if (!cardSet.has(color)) return false
      return true
    }
    case '<=': {
      if (isTargetColorless) return isCardColorless
      if (isCardColorless) return true
      for (let color of cardSet) if (!targetSet.has(color)) return false
      return true
    }
    case '>=': {
      if (isCardColorless && !isTargetColorless) return false
      for (let color of targetSet) if (!cardSet.has(color)) return false
      return true
    }
    case '<': return compareColorIdentity(cardColorsStr, '<=', targetStr) && !compareColorIdentity(cardColorsStr, '=', targetStr)
    case '>': return compareColorIdentity(cardColorsStr, '>=', targetStr) && !compareColorIdentity(cardColorsStr, '=', targetStr)
    case '!=': return !compareColorIdentity(cardColorsStr, '=', targetStr)
    default: return compareColorIdentity(cardColorsStr, '<=', targetStr)
  }
}