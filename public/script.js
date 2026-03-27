const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
Chart.defaults.font.family = "'Inter', sans-serif"
Chart.defaults.color = '#9e978e' // Texto mutado do novo tema
Chart.defaults.borderColor = '#36312d' // Borda do novo tema

let globalData = {}
let fullInventory = []
let mainChartInstance = null
let currentSearchResults = []
let selectedColors = []

function formatManaCost(cost) {
  if (!cost) return ''
  return cost.replace(/{([^}]+)}/g, (match, p1) => {
    let symbol = p1.toUpperCase().replace('/', '')
    return `<img src="https://svgs.scryfall.io/card-symbols/${symbol}.svg" alt="${match}" style="height: 16px; vertical-align: text-bottom; margin: 0 1px; filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.8));">`
  })
}

function showCardImage(imgUri, name) {
  if (!imgUri) {
    alert("Imagem não encontrada para esta carta.")
    return
  }
  document.getElementById('scryfallImage').src = imgUri
  document.getElementById('scryfallName').innerText = name
  new bootstrap.Modal(document.getElementById('imagePreviewModal')).show()
}

async function performSearch(e) {
  e.preventDefault()
  const q = document.getElementById('searchInput').value.trim()
  if (q.length < 2) return
  new bootstrap.Modal(document.getElementById('searchModal')).show()
  const tb = document.getElementById('searchResultsBody')
  tb.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Buscando...</td></tr>'
  document.getElementById('noResults').classList.add('d-none')
  try {
    const req = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
    currentSearchResults = await req.json()
    tb.innerHTML = ''
    if (currentSearchResults.length === 0) {
      document.getElementById('noResults').classList.remove('d-none')
      return
    }
    currentSearchResults.forEach((c, i) => {
      let icnHist = '<i class="bi bi-clock-history"></i>'
      if (c.history && c.history.length > 1) {
        const cr = c.history[0].value, pr = c.history[1].value
        if (cr > pr) icnHist = '<i class="bi bi-graph-up-arrow text-success"></i>'
        else if (cr < pr) icnHist = '<i class="bi bi-graph-down-arrow text-danger"></i>'
      }

      const btnImg = `<button class="btn-action-icon me-1" onclick="showCardImage('${c.imageUri || ''}', '${c.name.replace(/'/g, "\\'")}')" title="Ver Carta"><i class="bi bi-image"></i></button>`
      const btnHist = `<button class="btn-action-icon" onclick="openHistory(${i})" title="Histórico de Preço">${icnHist}</button>`

      tb.innerHTML += `<tr>
        <td class="ps-4">
          <div class="col-card-name fw-bold text-white">${c.name}</div>
          <div class="small text-muted">${c.set} #${c.num} <span class="ms-2">${formatManaCost(c.manaCost)}</span></div>
        </td>
        <td class="text-center text-nowrap">${btnImg}${btnHist}</td>
        <td class="text-center"><span class="badge-tech">${c.set}</span></td>
        <td class="text-center">${c.qty}</td>
        <td class="text-end pe-4 text-white fw-bold">${BRL.format(c.totalPrice)}</td>
      </tr>`
    })
  } catch (e) {
    console.error(e)
  }
}

function openHistory(i) {
  const c = currentSearchResults[i]
  if (!c) return
  new bootstrap.Modal(document.getElementById('historyDetailModal')).show()
  document.getElementById('histTitle').innerText = `${c.name} (${c.set})`
  const tb = document.getElementById('historyTableBody')
  tb.innerHTML = ''
  c.history.forEach((h, x) => {
    let d = ''
    if (x < c.history.length - 1) {
      const p = c.history[x + 1].value
      if (h.value > p) d = '<span class="text-success ms-1">▲</span>'
      else if (h.value < p) d = '<span class="text-danger ms-1">▼</span>'
    }
    const dp = h.date.split('-')
    tb.innerHTML += `<tr><td class="ps-3 text-muted">${dp[2]}/${dp[1]}</td><td class="text-end pe-3 text-white fw-bold">${BRL.format(h.value)}${d}</td></tr>`
  })
}

function updateTimeRange(range, btn) {
  if (!globalData.chart) return
  document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  const allL = globalData.chart.labels, allV = globalData.chart.values
  let cut = range === '7d' ? -7 : range === '30d' ? -30 : 0
  mainChartInstance.data.labels = cut === 0 ? allL : allL.slice(cut)
  mainChartInstance.data.datasets[0].data = cut === 0 ? allV : allV.slice(cut)
  mainChartInstance.update()
}

function toggleCommanderMode() {
  const active = document.getElementById('commanderModeToggle').checked
  const colorBox = document.getElementById('colorFilters')
  if (active) {
    colorBox.style.opacity = '1'
    colorBox.style.pointerEvents = 'auto'
    fetchCommanderPool()
  } else {
    colorBox.style.opacity = '0.4'
    colorBox.style.pointerEvents = 'none'
    loadInventory()
  }
}

function toggleColor(color) {
  const btn = document.querySelector(`.c-${color.toLowerCase()}`)
  if (selectedColors.includes(color)) {
    selectedColors = selectedColors.filter(c => c !== color)
    btn.classList.remove('active')
  } else {
    selectedColors.push(color)
    btn.classList.add('active')
  }

  if (color === 'C' && selectedColors.includes('C')) {
    selectedColors = ['C']
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
  } else if (color !== 'C') {
    selectedColors = selectedColors.filter(c => c !== 'C')
    document.querySelector('.c-c')?.classList.remove('active')
  }

  if (document.getElementById('commanderModeToggle').checked) {
    fetchCommanderPool()
  }
}

async function fetchCommanderPool() {
  try {
    const colorString = selectedColors.length > 0 ? selectedColors.join(',') : 'C'
    const req = await fetch(`/api/commander-pool?colors=${colorString}`)
    fullInventory = await req.json()
    applyInventoryFilters()
  } catch (e) { console.error(e) }
}

async function loadInventory() {
  try {
    const req = await fetch('/api/inventory')
    fullInventory = await req.json()

    const sets = [...new Set(fullInventory.map(c => c.set))].sort()
    const setSelect = document.getElementById('filterSet')
    setSelect.innerHTML = '<option value="all">Todas Edições</option>'
    sets.forEach(s => {
      const opt = document.createElement('option')
      opt.value = s
      opt.innerText = s
      setSelect.appendChild(opt)
    })

    applyInventoryFilters()
  } catch (e) {
    console.error(e)
  }
}

function applyInventoryFilters() {
  const setF = document.getElementById('filterSet').value
  const extraF = document.getElementById('filterExtra').value
  const sortF = document.getElementById('sortOrder').value

  let filtered = fullInventory.filter(c => {
    if (setF !== 'all' && c.set !== setF) return false
    if (extraF === 'foil' && (!c.extras || c.extras.trim() === '')) return false
    if (extraF === 'normal' && c.extras && c.extras.trim() !== '') return false
    return true
  })

  filtered.sort((a, b) => {
    if (sortF === 'totalDesc') return b.totalPrice - a.totalPrice
    if (sortF === 'unitDesc') return b.unitPrice - a.unitPrice
    if (sortF === 'qtyDesc') return b.qty - a.qty
    if (sortF === 'nameAsc') return a.name.localeCompare(b.name)
    if (sortF === 'cmcDesc') return (b.cmc || 0) - (a.cmc || 0)
    return 0
  })

  const tbody = document.getElementById('tableInventory')
  tbody.innerHTML = ''
  const displayList = filtered.slice(0, 150)

  displayList.forEach((c, i) => {
    const badge = c.extras ? `<span class="badge-extra ms-1">${c.extras}</span>` : ''
    const imgBtn = c.imageUri ? `<button class="btn btn-sm btn-link p-0 text-muted" onclick="showCardImage('${c.imageUri}', '${c.name.replace(/'/g, "\\'")}')"><i class="bi bi-image"></i></button>` : ''

    tbody.innerHTML += `<tr>
      <td class="text-center ps-4">${imgBtn}</td>
      <td>
        <div class="col-card-name fw-bold text-white">${c.name}</div>
        ${badge}
      </td>
      <td class="text-center small text-muted">
        ${c.typeLine ? c.typeLine.split('—')[0].trim() : ''} <br/> 
        <span class="fs-6">${formatManaCost(c.manaCost)}</span>
      </td>
      <td class="text-center"><span class="badge-tech">${c.set}</span></td>
      <td class="text-center text-muted">${c.qty}</td>
      <td class="text-end text-muted small">${BRL.format(c.unitPrice)}</td>
      <td class="text-end fw-bold text-white pe-4">${BRL.format(c.totalPrice)}</td>
    </tr>`
  })
  document.getElementById('inventoryCount').innerText = `Mostrando ${displayList.length} de ${filtered.length} cartas.`
}

function filterFromChart(setName) {
  const select = document.getElementById('filterSet')
  if (setName === 'Outros') select.value = 'all'
  else {
    const exists = [...select.options].some(o => o.value === setName)
    if (exists) select.value = setName
  }
  applyInventoryFilters()
  document.getElementById('tableInventory').scrollIntoView({ behavior: 'smooth' })
}

async function initDashboard() {
  try {
    const req = await fetch('/api/dashboard')
    globalData = await req.json()
    const data = globalData
    if (!data || data.empty) return

    document.getElementById('kpiTotal').innerText = BRL.format(data.kpis.totalValue)
    document.getElementById('kpiQty').innerText = data.kpis.totalCards
    document.getElementById('kpiTicket').innerText = BRL.format(data.kpis.avgTicket)
    document.getElementById('lastUpdate').innerText = data.kpis.lastUpdate.split('-').reverse().slice(0, 2).join('/')

    const setKpi = (id, val) => {
      const el = document.getElementById(id)
      el.innerText = (val > 0 ? '+' : '') + BRL.format(val)
      el.className = 'big-number mt-2 ' + (val >= 0 ? 'var-up' : 'var-down')
    }
    setKpi('kpiVar', data.kpis.dayVar)
    setKpi('kpiMonth', data.kpis.monthVar)

    const ctxMain = document.getElementById('mainChart').getContext('2d')
    const grad = ctxMain.createLinearGradient(0, 0, 0, 300)
    // Gradiente Dourado (Rare Spark)
    grad.addColorStop(0, 'rgba(212, 175, 55, 0.3)')
    grad.addColorStop(1, 'rgba(212, 175, 55, 0)')

    mainChartInstance = new Chart(ctxMain, {
      type: 'line',
      data: {
        labels: data.chart.labels,
        datasets: [{
          label: 'Total',
          data: data.chart.values,
          borderColor: '#d4af37', // Linha Dourada
          borderWidth: 2,
          backgroundColor: grad,
          fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 20
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: {
          x: { display: true, grid: { display: false }, ticks: { maxTicksLimit: 7, callback: function (v) { return this.getLabelForValue(v).split('-').slice(1).reverse().join('/') } } },
          y: { display: true, position: 'right', grid: { color: '#36312d', borderDash: [5, 5] }, ticks: { callback: v => new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL' }).format(v) } }
        }
      }
    })

    if (data.dailyChart.labels.length)
      new Chart(document.getElementById('dailyChart'), {
        type: 'bar',
        data: {
          labels: data.dailyChart.labels,
          datasets: [{
            data: data.dailyChart.values,
            backgroundColor: data.dailyChart.values.map(v => v >= 0 ? '#10b981' : '#ef4444'), // Verde Esmeralda e Vermelho Vivo
            borderRadius: 4
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: '#36312d' } } } }
      })

    if (data.setChart)
      new Chart(document.getElementById('setChart'), {
        type: 'doughnut',
        data: {
          labels: data.setChart.labels,
          datasets: [{
            data: data.setChart.values,
            // Paleta Dourado/Bronze/Couro
            backgroundColor: ['#D4AF37', '#B8860B', '#CD7F32', '#A0522D', '#8B4513', '#4A3C31'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '70%',
          onClick: (evt, activeElements) => {
            if (activeElements.length > 0) filterFromChart(data.setChart.labels[activeElements[0].index])
          },
          plugins: {
            legend: { position: 'right', labels: { color: '#9e978e', boxWidth: 10, font: { size: 10 } } },
            tooltip: { callbacks: { label: c => ` ${c.label}: ${BRL.format(c.raw)}` } }
          }
        }
      })

    // Cores de Mana MUITO MAIS VIBRANTES
    if (data.colorDist) {
      new Chart(document.getElementById('colorChart'), {
        type: 'doughnut',
        data: {
          labels: ['Branco', 'Azul', 'Preto', 'Vermelho', 'Verde', 'Multicolor', 'Incolor'],
          datasets: [{
            data: [data.colorDist.W, data.colorDist.U, data.colorDist.B, data.colorDist.R, data.colorDist.G, data.colorDist.M, data.colorDist.C],
            // Branco Brilhante, Azul Vivo, Chumbo, Vermelho Sangue, Verde Esmeralda, Âmbar/Ouro, Cinza Metálico
            backgroundColor: ['#FFFDE7', '#3B82F6', '#52525B', '#EF4444', '#10B981', '#F59E0B', '#A8A29E'],
            borderWidth: 1, borderColor: '#1a1816'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '70%',
          plugins: { legend: { position: 'right', labels: { color: '#9e978e', boxWidth: 10, font: { size: 10 } } } }
        }
      })
    }

    // Curva de Mana (Dourada)
    if (data.manaCurve) {
      new Chart(document.getElementById('manaCurveChart'), {
        type: 'bar',
        data: {
          labels: ['0', '1', '2', '3', '4', '5', '6+'],
          datasets: [{
            data: [data.manaCurve['0'], data.manaCurve['1'], data.manaCurve['2'], data.manaCurve['3'], data.manaCurve['4'], data.manaCurve['5'], data.manaCurve['6+']],
            backgroundColor: '#d4af37', // Dourado
            borderRadius: 4
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { display: false } } }
      })
    }

    // Gráfico de Raridade com cores MTG (Preto, Prata, Ouro, Laranja-Mítico)
    if (data.rarityDist) {
      new Chart(document.getElementById('rarityChart'), {
        type: 'doughnut',
        data: {
          labels: ['Comum', 'Incomum', 'Rara', 'Mítica'],
          datasets: [{
            data: [data.rarityDist.common, data.rarityDist.uncommon, data.rarityDist.rare, data.rarityDist.mythic],
            backgroundColor: ['#52525B', '#9CA3AF', '#D4AF37', '#EA580C'],
            borderWidth: 1, borderColor: '#1a1816'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '70%',
          plugins: { legend: { position: 'right', labels: { color: '#9e978e', boxWidth: 10, font: { size: 10 } } } }
        }
      })
    }

    // Tier Chart acompanhando as cores de Raridade
    if (data.tiers)
      new Chart(document.getElementById('tierChart'), {
        type: 'bar',
        data: {
          labels: ['Bulk (< R$ 2)', 'Low (R$ 2-10)', 'Mid (R$ 10-50)', 'High (> R$ 50)'],
          datasets: [{
            data: [data.tiers.bulk.qty, data.tiers.low.qty, data.tiers.mid.qty, data.tiers.high.qty],
            backgroundColor: ['#52525B', '#9CA3AF', '#D4AF37', '#EA580C'],
            borderRadius: 4
          }]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { display: false } } } }
      })

    const fillTable = (id, list, colorCheck = false) => {
      const tb = document.getElementById(id)
      if (!list.length) { tb.innerHTML = '<tr><td class="text-center text-muted">Vazio</td></tr>'; return }
      list.forEach(x => {
        let val = BRL.format(x.diff), cls = colorCheck ? (x.diff > 0 ? 'var-up' : 'var-down') : 'text-white', prefix = colorCheck ? (x.diff > 0 ? '+' : '') : ''
        const imgBtn = x.imageUri ? `<button class="btn btn-sm btn-link p-0 text-muted me-2" onclick="showCardImage('${x.imageUri}', '${x.name.replace(/'/g, "\\'")}')"><i class="bi bi-image"></i></button>` : ''

        tb.innerHTML += `<tr>
          <td class="ps-3 d-flex align-items-center">
            ${imgBtn}
            <div>
              <div class="col-card-name fw-bold text-white">${x.name} <span class="ms-2 fs-6">${formatManaCost(x.manaCost)}</span></div>
              ${x.set ? '<div class="small text-muted">' + x.set + '</div>' : ''}
            </div>
          </td>
          <td class="text-end pe-3 fw-bold ${cls} align-middle">${prefix}${val}</td>
        </tr>`
      })
    }

    fillTable('tableTopGainers', data.topGainers, true)
    fillTable('tableTopLosers', data.topLosers, true)

    loadInventory()
  } catch (e) { console.error(e) }
}
initDashboard()