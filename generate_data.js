const fs = require('fs')
const path = require('path')

const OUTPUT_FILE = path.join(__dirname, 'data', 'historico_cartas.csv')

const DAYS_HISTORY = 365
const PORTFOLIO_SIZE = 150

const SETS = [
  "Modern Horizons 2", "Commander Masters", "The Lord of the Rings",
  "Ixalan", "Zendikar Rising", "Kaladesh Remastered",
  "Alpha", "Beta", "Unlimited", "Revised", "Fourth Edition",
  "Magic 2010", "Magic 2011", "Magic 2012", "Magic 2013",
  "Theros Beyond Death", "Ikoria: Lair of Behemoths", "Strixhaven",
  "Innistrad: Midnight Hunt", "Adventures in the Forgotten Realms",
  "Streets of New Capenna", "Dominaria United", "The Brothers' War",
  "Phyrexia: All Will Be One", "March of the Machine", "Wilds of Eldraine",
  "The Lost Caverns of Ixalan", "Unfinity", "Future Sight", "Time Spiral"
]

const EXTRAS = ["", "", "", "", "Foil", "Etched", "Prerelease"]

const CARD_NAMES = [
  "Black Lotus", "Sol Ring", "Mana Crypt", "Orcish Bowmasters", "The One Ring",
  "Sheoldred, the Apocalypse", "Ragavan, Nimble Pilferer", "Urza's Saga",
  "Force of Will", "Rhystic Study", "Cyclonic Rift", "Dockside Extortionist",
  "Esper Sentinel", "Teferi's Protection", "Demonic Tutor", "Vampiric Tutor",
  "Ancient Tomb", "Mana Drain", "Sylvan Library", "Doubling Season",
  "Parallel Lives", "Craterhoof Behemoth", "Atraxa, Praetors' Voice",
  "Edgar Markov", "The Ur-Dragon", "Mox Diamond", "Gaea's Cradle",
  "Underground Sea", "Volcanic Island", "Tropical Island", "Tundra",
  "Scalding Tarn", "Misty Rainforest", "Verdant Catacombs", "Arid Mesa",
  "Marsh Flats", "Polluted Delta", "Flooded Strand", "Wooded Foothills",
  "Bloodstained Mire", "Windswept Heath", "Lightning Bolt", "Counterspell",
  "Swords to Plowshares", "Dark Ritual", "Brainstorm", "Ponder",
  "Preordain", "Cultivate", "Kodama's Reach", "Arcane Signet",
  "Fabled Passage", "Field of the Dead", "Nicol Bolas, the Ravager",
  "Ugin, the Spirit Dragon", "Teferi, Hero of Dominaria", "Jace, the Mind Sculptor",
  "Liliana of the Veil", "Chandra, Torch of Defiance", "Gideon, Ally of Zendikar",
  "Ajani Goldmane", "Tamiyo, Field Researcher", "Karn Liberated",
  "Emrakul, the Aeons Torn", "Griselbrand", "Elesh Norn, Grand Cenobite",
  "Avacyn, Angel of Hope", "Brisela, Voice of Nightmares", "Felidar Guardian",
  "Walking Ballista", "Hangarback Walker", "Wurmcoil Engine", "Dark Confidant",
  "Phyrexian Obliterator", "Thoughtseize", "Inquisition of Kozilek",
  "Liliana's Triumph", "Fatal Push", "Path to Exile", "Supreme Verdict",
  "Wrath of God", "Day of Judgment", "Sorin Markov", "Vraska the Unseen",
  "Nissa, Who Shakes the World", "Kiora, Behemoth Beckoner", "Ral Zarek",
  "Saheeli Rai", "Narset, Parter of Veils", "Tezzeret the Seeker",
  "Ulamog, the Infinite Gyre", "Karn, Scion of Urza", "Ob Nixilis Reignited",
  "Garruk Wildspeaker", "Xenagos, the Reveler", "Xenagos, God of Revels",
  "Xenagos, the Reveler", "Xenagos, God of Revels", "Lotus Cobra",
  "Courser of Kruphix", "Noble Hierarch", "Birds of Paradise",
  "Elvish Mystic", "Fyndhorn Elves", "Llanowar Elves", "Sakura-Tribe Elder",
  "Wall of Roots", "Avenger of Zendikar", "Primeval Titan", "Craterhoof Behemoth",
  "Scute Swarm", "Tarmogoyf", "Dark Depths", "Thespian's Stage", "Cabal Coffers",
  "Urborg, Tomb of Yawgmoth", "Sensei's Divining Top", "Aether Vial",
  "Batterskull", "Sword of Fire and Ice", "Sword of Light and Shadow",
  "Sword of War and Peace", "Sword of Body and Mind", "Jitte",
  "Phyrexian Arena", "Smothering Tithe", "Rhystic Study", "Mystic Remora"
]

const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

const formatDate = (date) => {
  return date.toISOString().split('T')[0]
}

function generateBasePortfolio() {
  const portfolio = []
  for (let i = 0; i < PORTFOLIO_SIZE; i++) {
    const name = pick(CARD_NAMES)
    const set = pick(SETS)

    let basePrice = random(1, 20)
    if (["Lotus", "Mox", "Cradle", "Sea", "Island"].some(x => name.includes(x))) basePrice = random(500, 5000)
    else if (["Ring", "Crypt", "Ragavan", "Sheoldred", "Force"].some(x => name.includes(x))) basePrice = random(50, 400)

    const extra = pick(EXTRAS)
    if (extra !== "") basePrice *= 1.5

    portfolio.push({
      name: name,
      set: set,
      num: random(1, 300),
      extras: extra,
      qty: random(1, 4),
      currentPrice: basePrice,
      volatility: random(1, 5) / 100
    })
  }
  return portfolio
}

console.log(`🚀 Gerando dados para ${DAYS_HISTORY} dias e ${PORTFOLIO_SIZE} cartas únicas...`)

const portfolio = generateBasePortfolio()
let csvContent = ""

csvContent += "Data,Nome,Edicao,Num,Extras,Qtd,Preco_Unit,Preco_Total\n"

const startDate = new Date()
startDate.setDate(startDate.getDate() - DAYS_HISTORY)

let totalLines = 0

for (let d = 0; d <= DAYS_HISTORY; d++) {
  const currentDate = new Date(startDate)
  currentDate.setDate(startDate.getDate() + d)
  const dateString = formatDate(currentDate)

  portfolio.forEach(card => {
    const change = 1 + (Math.random() * card.volatility * 2 - card.volatility)
    card.currentPrice = Math.max(0.05, card.currentPrice * change)

    const unitPrice = card.currentPrice.toFixed(2)
    const totalPrice = (card.currentPrice * card.qty).toFixed(2)

    const line = `${dateString},"${card.name}","${card.set}","${card.num}","${card.extras}",${card.qty},${unitPrice},${totalPrice}\n`

    csvContent += line
    totalLines++
  })
}

if (!fs.existsSync(path.dirname(OUTPUT_FILE))) {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true })
}

fs.writeFileSync(OUTPUT_FILE, csvContent, 'utf8')

console.log(`✅ Concluído! Arquivo gerado em: ${OUTPUT_FILE}`)
console.log(`📊 Total de linhas geradas: ${totalLines}`)
console.log(`💡 Agora rode 'node server.js' e atualize seu dashboard.`)
