const express = require('express')
const fs = require('fs')
const csv = require('csv-parser')
const cors = require('cors')
const path = require('path')

const app = express()
app.use(cors())
app.use(express.static('public'))

const DATA_DIR = path.join(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR)
}

const CSV_FILE = path.join(DATA_DIR, 'historico_cartas.csv')

function lerCSV() {
  return new Promise((resolve, reject) => {
    const results = []
    if (!fs.existsSync(CSV_FILE)) return resolve([])

    fs.createReadStream(CSV_FILE)
      .pipe(csv())
      .on('data', (data) => {
        const total = parseFloat(data.Preco_Total)
        const qtd = parseInt(data.Qtd)
        if (!isNaN(total)) {
          results.push({
            data: data.Data,
            nome: data.Nome,
            edicao: data.Edicao,
            num: data.Num,
            extras: data.Extras || '',
            qtd: qtd,
            unitario: parseFloat(data.Preco_Unit),
            total: total
          })
        }
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err))
  })
}

app.get('/api/dashboard', async (req, res) => {
  try {
    const dados = await lerCSV()
    if (dados.length === 0) return res.json({ vazio: true })

    const timeline = {}
    dados.forEach(d => {
      if (!timeline[d.data]) timeline[d.data] = 0
      timeline[d.data] += d.total
    })

    const datas = Object.keys(timeline).sort()
    const ultimaData = datas[datas.length - 1]
    const valorAtual = timeline[ultimaData]
    const valorOntem = datas.length > 1 ? timeline[datas[datas.length - 2]] : valorAtual

    const hoje = dados.filter(d => d.data === ultimaData)

    const topValiosas = [...hoje].sort((a, b) => b.total - a.total).slice(0, 10)

    let maioresMovimentacoes = []
    if (datas.length > 1) {
      const dataOntem = datas[datas.length - 2]
      const ontem = dados.filter(d => d.data === dataOntem)
      const mapOntem = new Map(ontem.map(c => [`${c.nome}|${c.edicao}|${c.num}|${c.extras}`, c.unitario]))

      const variacoes = []
      hoje.forEach(h => {
        const old = mapOntem.get(`${h.nome}|${h.edicao}|${h.num}|${h.extras}`)
        if (old !== undefined && old > 0) {
          const diff = h.unitario - old
          if (Math.abs(diff) >= 0.01) {
            variacoes.push({
              nome: h.nome,
              edicao: h.edicao,
              num: h.num,
              extras: h.extras,
              diff: diff,
              atual: h.unitario
            })
          }
        }
      })
      maioresMovimentacoes = variacoes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 10)
    }

    res.json({
      vazio: false,
      kpis: {
        totalValor: valorAtual,
        totalCartas: hoje.reduce((acc, c) => acc + c.qtd, 0),
        variacaoDia: valorAtual - valorOntem,
        dataAtualizacao: ultimaData
      },
      grafico: { labels: datas, valores: datas.map(d => timeline[d]) },
      topValiosas,
      maioresMovimentacoes
    })

  } catch (e) {
    console.error(e)
    res.status(500).send('Erro no servidor')
  }
})

app.get('/api/busca', async (req, res) => {
  try {
    const termo = req.query.q ? req.query.q.toLowerCase() : ''
    if (termo.length < 2) return res.json([])

    const dados = await lerCSV()
    if (dados.length === 0) return res.json([])

    const datas = [...new Set(dados.map(d => d.data))].sort()
    const ultimaData = datas[datas.length - 1]

    const resultados = dados.filter(d =>
      d.data === ultimaData &&
      d.nome.toLowerCase().includes(termo)
    )

    resultados.sort((a, b) => b.total - a.total)

    res.json(resultados)

  } catch (e) {
    console.error(e)
    res.status(500).json([])
  }
})

app.listen(3000, () => {
  console.log('🚀 Dashboard Rodando: http://localhost:3000')
})
