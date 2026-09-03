import fs from 'fs'
import * as cheerio from 'cheerio'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool, initDB } from './src/db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const URL_COLECAO = process.env.LIGAMAGIC_URL || 'https://www.ligamagic.com.br/colecao/print.php?id=350393&tcg=1'

const DATA_DIR = path.join(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR)
}

const ARQ_MEMORIA = path.join(DATA_DIR, 'ultimo_estado.json')

function limparNomeCarta(nome) {
  return nome.replace(/\s*\(#\d+\)\s*$/, '').trim()
}

async function monitorarIndividualmente() {
  console.log(`[${new Date().toLocaleString()}] 🔍 Iniciando análise rigorosa...`)

  await initDB()
  const client = await pool.connect()

  try {
    const response = await fetch(URL_COLECAO, { headers: { 'User-Agent': 'Node.js Monitor' } })
    if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`)

    const html = await response.text()
    const $ = cheerio.load(html)

    let memoriaPrecos = {}
    if (fs.existsSync(ARQ_MEMORIA)) {
      memoriaPrecos = JSON.parse(fs.readFileSync(ARQ_MEMORIA, 'utf8'))
    }

    const dataHoje = new Date().toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo'
    }).split('/').reverse().join('-')

    let novaMemoria = {}
    let mudancas = []
    let totalColecao = 0
    const inserts = []

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

      const nomeCarta = limparNomeCarta(nomeEn)
      const qtd = parseInt(qtdStr) || 0
      const preco = parseFloat(precoStr.replace(/\./g, '').replace(',', '.'))

      if (isNaN(preco) || isNaN(qtd)) return

      const idCarta = `${nomeCarta}|${edicao}|${numColecao}|${extras}`
      const precoTotal = preco * qtd

      inserts.push({
        dataHoje, nomeCarta, edicao, numColecao, extras, qtd, preco, precoTotal
      })

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
      totalColecao += precoTotal
    })

    if (inserts.length > 0) {
      await client.query('BEGIN')

      console.log(`🧹 Limpando dados antigos do dia ${dataHoje} para evitar duplicação...`)
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

      await client.query('COMMIT')
      console.log(`📝 Dados salvos no PostgreSQL da VPS com sucesso!`)
    }

    fs.writeFileSync(ARQ_MEMORIA, JSON.stringify(novaMemoria, null, 2), 'utf8')

    console.log(`✅ Sucesso! Total Coleção: R$ ${totalColecao.toFixed(2)}`)

    if (mudancas.length > 0) {
      console.log(`📊 ${mudancas.length} cartas tiveram alteração de preço.`)
    }

  } catch (erro) {
    await client.query('ROLLBACK').catch(() => { })
    console.error('❌ Erro durante execução do scraper:', erro.message)
  } finally {
    client.release()
  }
}

monitorarIndividualmente()
