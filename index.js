const fs = require('fs')
const cheerio = require('cheerio')
const path = require('path')

const URL_COLECAO = 'https://www.ligamagic.com.br/colecao/print.php?id=350393&tcg=1'

const DATA_DIR = path.join(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR)
}

const ARQ_CSV = path.join(DATA_DIR, 'historico_cartas.csv')
const ARQ_MEMORIA = path.join(DATA_DIR, 'ultimo_estado.json')

async function monitorarIndividualmente() {
  console.log(`[${new Date().toLocaleString()}] 🔍 Iniciando análise rigorosa...`)

  try {
    const response = await fetch(URL_COLECAO, { headers: { 'User-Agent': 'Node.js Monitor' } })
    if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`)

    const html = await response.text()
    const $ = cheerio.load(html)

    let memoriaPrecos = {}
    if (fs.existsSync(ARQ_MEMORIA)) {
      memoriaPrecos = JSON.parse(fs.readFileSync(ARQ_MEMORIA, 'utf8'))
    }

    const dataHoje = new Date().toISOString().split('T')[0]
    let bufferCSV = ''
    let novaMemoria = {}
    let mudancas = []
    let totalColecao = 0

    $('table tr').each((i, el) => {
      const cols = $(el).find('td')
      if (cols.length < 11) return

      const edicao = $(cols[0]).text().trim()
      const numColecao = $(cols[1]).text().trim()
      const qtdStr = $(cols[4]).text().trim().toLowerCase().replace('x', '')
      const nomePt = $(cols[7]).text().trim()
      const nomeEn = $(cols[8]).text().trim()
      const extras = $(cols[9]).text().trim()
      const precoStr = $(cols[10]).text().trim()

      if (!precoStr) return

      const nomeCarta = nomeEn
      const qtd = parseInt(qtdStr) || 0
      const preco = parseFloat(precoStr.replace(/\./g, '').replace(',', '.'))

      if (isNaN(preco) || isNaN(qtd)) return

      const idCarta = `${nomeCarta}|${edicao}|${numColecao}|${extras}`

      bufferCSV += `${dataHoje},"${nomeCarta}","${edicao}","${numColecao}","${extras}",${qtd},${preco.toFixed(2)},${(preco * qtd).toFixed(2)}\n`

      const precoAntigo = memoriaPrecos[idCarta] || preco
      const diferenca = preco - precoAntigo

      if (Math.abs(diferenca) >= 0.01) {
        mudancas.push({
          nome: nomeCarta,
          detalhes: `${edicao} ${numColecao} ${extras}`,
          diff: diferenca,
          atual: preco,
          antigo: precoAntigo
        })
      }

      novaMemoria[idCarta] = preco
      totalColecao += (preco * qtd)
    })

    if (!fs.existsSync(ARQ_CSV)) {
      fs.writeFileSync(ARQ_CSV, 'Data,Nome,Edicao,Num,Extras,Qtd,Preco_Unit,Preco_Total\n', 'utf8')
    }

    fs.appendFileSync(ARQ_CSV, bufferCSV, 'utf8')
    fs.writeFileSync(ARQ_MEMORIA, JSON.stringify(novaMemoria, null, 2), 'utf8')

    console.log(`✅ Sucesso! Total Coleção: R$ ${totalColecao.toFixed(2)}`)
    console.log(`📝 Dados salvos em CSV formato internacional.`)

    if (mudancas.length > 0) {
      console.log(`📊 ${mudancas.length} cartas tiveram alteração de preço.`)
    }

  } catch (erro) {
    console.error('❌ Erro:', erro.message)
  }
}

monitorarIndividualmente()
