const fs = require('fs')
const csv = require('csv-parser')
const Card = require('../models/Card')

class CsvRepository {
  constructor(filePath) {
    this.filePath = filePath
  }

  async getAll() {
    const results = []
    if (!fs.existsSync(this.filePath)) return []

    return new Promise((resolve, reject) => {
      fs.createReadStream(this.filePath)
        .pipe(csv())
        .on('data', (row) => {
          const total = parseFloat(row.Preco_Total)
          const qty = parseInt(row.Qtd)

          if (!isNaN(total)) {
            results.push(new Card(
              row.Data,
              row.Nome,
              row.Edicao,
              row.Num,
              row.Extras || '',
              qty,
              parseFloat(row.Preco_Unit),
              total
            ))
          }
        })
        .on('end', () => resolve(results))
        .on('error', (err) => reject(err))
    })
  }
}
module.exports = CsvRepository