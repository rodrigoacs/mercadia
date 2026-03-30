let globalData = {}
let fullInventory = []
let mainChartInstance = null
let organicChartInstance = null
let currentSearchResults = []

function showCardDetails(encStr) {
  try {
    const c = JSON.parse(decodeURIComponent(atob(encStr)))
    if (!c.imageUri) { alert("Imagem não encontrada para esta carta."); return }

    const imgEl = document.getElementById('detailImage')
    if (imgEl) imgEl.src = c.imageUri

    safeSetText('detailName', c.name)
    safeSetHTML('detailMana', formatManaCost(c.manaCost))
    safeSetText('detailType', c.typeLine || 'Desconhecido')

    let oracle = c.oracleText || 'Sem texto de regras.'
    safeSetHTML('detailOracle', formatManaCost(oracle))

    safeSetText('detailSet', `${c.set.toUpperCase()} #${c.num || ''} ${c.extras ? '(' + c.extras + ')' : ''}`)

    const rarities = { common: 'Comum', uncommon: 'Incomum', rare: 'Rara', mythic: 'Mítica' }
    safeSetText('detailRarity', rarities[c.rarity?.toLowerCase()] || c.rarity || '-')

    safeSetText('detailQty', `${c.qty}x`)
    safeSetText('detailUnit', BRL.format(c.unitPrice || 0))
    safeSetText('detailTotal', BRL.format((c.unitPrice || 0) * (c.qty || 1)))

    const legDiv = document.getElementById('detailLegalities')
    if (legDiv) {
      legDiv.innerHTML = ''
      if (c.legalities) {
        const formats = ['standard', 'pioneer', 'modern', 'legacy', 'commander', 'pauper']
        formats.forEach(f => {
          if (c.legalities[f]) {
            const isLegal = c.legalities[f] === 'legal'
            const badgeClass = isLegal ? 'bg-success' : 'bg-danger'
            legDiv.innerHTML += `<span class="badge ${badgeClass} text-uppercase text-white" style="font-size: 0.65rem; padding: 0.4em 0.6em;">${f}</span>`
          }
        })
      }
    }
    const modalEl = document.getElementById('imagePreviewModal')
    if (modalEl) new bootstrap.Modal(modalEl).show()
  } catch (e) { console.error('Erro ao abrir detalhes', e) }
}

async function performSearch(e) {
  e.preventDefault()
  const searchEl = document.getElementById('searchInput')
  if (!searchEl) return
  const q = searchEl.value.trim()
  if (q.length < 2) return

  const modalEl = document.getElementById('searchModal')
  if (modalEl) new bootstrap.Modal(modalEl).show()

  const tb = document.getElementById('searchResultsBody')
  if (!tb) return

  tb.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Buscando...</td></tr>'
  const noResEl = document.getElementById('noResults')
  if (noResEl) noResEl.classList.add('d-none')

  try {
    const req = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`)
    currentSearchResults = await req.json()
    tb.innerHTML = ''
    if (currentSearchResults.length === 0) {
      if (noResEl) noResEl.classList.remove('d-none')
      return
    }
    currentSearchResults.forEach((c, i) => {
      let icnHist = '<i class="bi bi-clock-history"></i>'
      if (c.history && c.history.length > 1) {
        const cr = c.history[0].value, pr = c.history[1].value
        if (cr > pr) icnHist = '<i class="bi bi-graph-up-arrow text-success"></i>'
        else if (cr < pr) icnHist = '<i class="bi bi-graph-down-arrow text-danger"></i>'
      }
      const enc = btoa(encodeURIComponent(JSON.stringify(c)))
      const btnImg = `<button class="btn-action-icon me-1" onclick="showCardDetails('${enc}')" title="Inspecionar Carta"><i class="bi bi-image"></i></button>`
      const btnHist = `<button class="btn-action-icon" onclick="openHistory(${i})" title="Histórico de Preço">${icnHist}</button>`

      tb.innerHTML += `<tr>
        <td class="ps-4"><div class="col-card-name fw-bold text-main">${c.name}</div><div class="small text-muted">${c.set} #${c.num} <span class="ms-2">${formatManaCost(c.manaCost)}</span></div></td>
        <td class="text-center text-nowrap">${btnImg}${btnHist}</td>
        <td class="text-center"><span class="badge-tech">${c.set}</span></td>
        <td class="text-center">${c.qty}</td>
        <td class="text-end pe-4 text-main fw-bold">${BRL.format(c.totalPrice)}</td>
      </tr>`
    })
  } catch (e) { console.error(e) }
}

function openHistory(i) {
  const c = currentSearchResults[i]
  if (!c) return
  const modalEl = document.getElementById('historyDetailModal')
  if (modalEl) new bootstrap.Modal(modalEl).show()
  safeSetText('histTitle', `${c.name} (${c.set})`)
  const tb = document.getElementById('historyTableBody')
  if (!tb) return
  tb.innerHTML = ''
  c.history.forEach((h, x) => {
    let d = ''
    if (x < c.history.length - 1) {
      const p = c.history[x + 1].value
      if (h.value > p) d = '<span class="text-success ms-1">▲</span>'
      else if (h.value < p) d = '<span class="text-danger ms-1">▼</span>'
    }
    const dp = h.date.split('-')
    tb.innerHTML += `<tr><td class="ps-3 text-muted">${dp[2]}/${dp[1]}</td><td class="text-end pe-3 text-main fw-bold">${BRL.format(h.value)}${d}</td></tr>`
  })
}

function updateTimeRange(range, btn, type) {
  if (!globalData.chart) return
  document.querySelectorAll(`.btn-filter-${type}`).forEach(b => b.classList.remove('active'))
  btn.classList.add('active')

  const instance = type === 'main' ? mainChartInstance : organicChartInstance
  if (!instance) return

  const allL = type === 'main' ? globalData.chart.labels : globalData.organicChart.labels
  const allV = type === 'main' ? globalData.chart.values : globalData.organicChart.values

  let cut = range === '7d' ? -7 : range === '30d' ? -30 : 0
  instance.data.labels = cut === 0 ? allL : allL.slice(cut)
  instance.data.datasets[0].data = cut === 0 ? allV : allV.slice(cut)
  instance.update()
}

async function loadInventory() {
  try {
    const req = await apiFetch('/api/inventory')
    fullInventory = await req.json()
    const sets = [...new Set(fullInventory.map(c => c.set))].sort()
    const setSelect = document.getElementById('filterSet')
    if (setSelect) {
      setSelect.innerHTML = '<option value="all">Todas Edições</option>'
      sets.forEach(s => {
        const opt = document.createElement('option'); opt.value = s; opt.innerText = s; setSelect.appendChild(opt)
      })
    }
    applyInventoryFilters()
  } catch (e) { console.error(e) }
}

function applyInventoryFilters() {
  const getVal = id => { const el = document.getElementById(id); return el ? el.value : 'all' }
  const setF = getVal('filterSet'), extraF = getVal('filterExtra'), typeF = getVal('filterType')
  const rarityF = getVal('filterRarity'), tierF = getVal('filterTier'), sortF = getVal('sortOrder')

  let filtered = fullInventory.filter(c => {
    if (setF !== 'all' && c.set !== setF) return false
    if (extraF === 'foil' && (!c.extras || c.extras.trim() === '')) return false
    if (extraF === 'normal' && c.extras && c.extras.trim() !== '') return false
    if (rarityF !== 'all' && (!c.rarity || c.rarity.toLowerCase() !== rarityF)) return false
    if (typeF !== 'all') { if (!c.typeLine) return false; if (!c.typeLine.toLowerCase().includes(typeF)) return false }
    if (tierF !== 'all') {
      if (tierF === 'bulk' && c.unitPrice >= 2) return false
      if (tierF === 'low' && (c.unitPrice < 2 || c.unitPrice >= 10)) return false
      if (tierF === 'mid' && (c.unitPrice < 10 || c.unitPrice >= 50)) return false
      if (tierF === 'high' && c.unitPrice < 50) return false
    }
    return true
  })

  const rarityWeight = { 'mythic': 4, 'rare': 3, 'uncommon': 2, 'common': 1 }
  filtered.sort((a, b) => {
    if (sortF === 'totalDesc') return b.totalPrice - a.totalPrice
    if (sortF === 'unitDesc') return b.unitPrice - a.unitPrice
    if (sortF === 'unitAsc') return a.unitPrice - b.unitPrice
    if (sortF === 'qtyDesc') return b.qty - a.qty
    if (sortF === 'nameAsc') return a.name.localeCompare(b.name)
    if (sortF === 'rarityDesc') {
      const rA = rarityWeight[a.rarity?.toLowerCase()] || 0, rB = rarityWeight[b.rarity?.toLowerCase()] || 0
      return rB - rA || b.totalPrice - a.totalPrice
    }
    return 0
  })

  const tbody = document.getElementById('tableInventory')
  if (tbody) {
    tbody.innerHTML = ''
    const displayList = filtered.slice(0, 150)
    displayList.forEach((c, i) => {
      const badge = c.extras ? `<span class="badge-extra ms-1">${c.extras}</span>` : ''
      const enc = btoa(encodeURIComponent(JSON.stringify(c)))
      const imgBtn = c.imageUri ? `<button class="btn btn-sm btn-link p-0 text-muted" onclick="showCardDetails('${enc}')"><i class="bi bi-image"></i></button>` : ''

      tbody.innerHTML += `<tr>
        <td class="text-center ps-4">${imgBtn}</td>
        <td>
          <div class="col-card-name fw-bold text-main d-flex align-items-center flex-wrap gap-2">
            ${c.name} <span class="fs-6 d-inline-flex align-items-center">${formatManaCost(c.manaCost)}</span>
          </div>
          ${badge}
        </td>
        <td class="text-center small text-muted">${c.typeLine ? c.typeLine.split('—')[0].trim() : ''}</td>
        <td class="text-center"><span class="badge-tech">${c.set}</span></td>
        <td class="text-center text-muted">${c.qty}</td>
        <td class="text-end text-muted small">${BRL.format(c.unitPrice)}</td>
        <td class="text-end fw-bold text-main pe-4">${BRL.format(c.totalPrice)}</td>
      </tr>`
    })
    safeSetText('inventoryCount', `Mostrando ${displayList.length} de ${filtered.length} cartas.`)
  }
}

function filterFromChart(setName) {
  const select = document.getElementById('filterSet')
  if (!select) return
  if (setName === 'Outros') select.value = 'all'; else {
    const exists = [...select.options].some(o => o.value === setName)
    if (exists) select.value = setName
  }
  applyInventoryFilters()
  const invTable = document.getElementById('tableInventory')
  if (invTable) invTable.scrollIntoView({ behavior: 'smooth' })
}

async function initDashboard() {
  try {
    const req = await apiFetch('/api/dashboard')
    globalData = await req.json()
    const data = globalData
    if (!data || data.empty) return

    safeSetText('kpiTotal', BRL.format(data.kpis.totalValue))
    safeSetText('kpiQty', data.kpis.totalCards)
    safeSetText('kpiTicket', BRL.format(data.kpis.avgTicket))

    if (data.kpis.lastUpdate) safeSetText('lastUpdate', data.kpis.lastUpdate.split('-').reverse().slice(0, 2).join('/'))

    if (data.pareto) {
      const row = document.getElementById('paretoRow')
      if (row) row.style.display = 'flex'
      safeSetHTML('paretoText', `<strong>Princípio de Pareto</strong>: apenas <strong class="text-main">${data.pareto.percentCards}%</strong> das suas cartas físicas (${data.pareto.totalCardsIncluded} un.) correspondem a <strong>80%</strong> de todo o seu patrimônio.`)
      safeSetText('paretoValue', BRL.format(data.pareto.accWealth))
    }

    const setKpi = (id, val) => {
      const el = document.getElementById(id)
      if (el) {
        el.innerText = (val > 0 ? '+' : '') + BRL.format(val)
        el.className = 'big-number mt-2 ' + (val >= 0 ? 'var-up' : 'var-down')
      }
    }
    setKpi('kpiVar', data.kpis.dayVar)
    setKpi('kpiMonth', data.kpis.monthVar)

    const mainCtxEl = document.getElementById('mainChart')
    if (mainCtxEl) {
      const ctxMain = mainCtxEl.getContext('2d')
      const gradMain = ctxMain.createLinearGradient(0, 0, 0, 300)
      gradMain.addColorStop(0, 'rgba(0, 122, 255, 0.3)'); gradMain.addColorStop(1, 'rgba(0, 122, 255, 0)')
      mainChartInstance = new Chart(ctxMain, {
        type: 'line',
        data: { labels: data.chart.labels, datasets: [{ label: 'Total', data: data.chart.values, borderColor: '#007AFF', borderWidth: 2, backgroundColor: gradMain, fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 20 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: true, grid: { display: false }, ticks: { maxTicksLimit: 7, callback: function (v) { return this.getLabelForValue(v).split('-').slice(1).reverse().join('/') } } }, y: { display: true, position: 'right', grid: { color: 'rgba(60, 60, 67, 0.18)', borderDash: [5, 5] }, ticks: { callback: v => new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL' }).format(v) } } } }
      })
    }

    const orgCtxEl = document.getElementById('organicChart')
    if (orgCtxEl) {
      const ctxOrg = orgCtxEl.getContext('2d')
      const gradOrg = ctxOrg.createLinearGradient(0, 0, 0, 300)
      gradOrg.addColorStop(0, 'rgba(52, 199, 89, 0.3)'); gradOrg.addColorStop(1, 'rgba(52, 199, 89, 0)')
      organicChartInstance = new Chart(ctxOrg, {
        type: 'line',
        data: { labels: data.organicChart.labels, datasets: [{ label: 'Lucro de Mercado Acumulado', data: data.organicChart.values, borderColor: '#34C759', borderWidth: 2, backgroundColor: gradOrg, fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 20 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: true, grid: { display: false }, ticks: { maxTicksLimit: 7, callback: function (v) { return this.getLabelForValue(v).split('-').slice(1).reverse().join('/') } } }, y: { display: true, position: 'right', grid: { color: 'rgba(60, 60, 67, 0.18)', borderDash: [5, 5] }, ticks: { callback: v => new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL' }).format(v) } } } }
      })
    }

    const dailyEl = document.getElementById('dailyChart')
    if (dailyEl && data.dailyChart.labels.length) {
      new Chart(dailyEl, { type: 'bar', data: { labels: data.dailyChart.labels, datasets: [{ data: data.dailyChart.values, backgroundColor: data.dailyChart.values.map(v => v >= 0 ? '#34C759' : '#FF3B30'), borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(60, 60, 67, 0.18)' } } } } })
    }

    const setEl = document.getElementById('setChart')
    if (setEl && data.setChart) {
      new Chart(setEl, { type: 'doughnut', data: { labels: data.setChart.labels, datasets: [{ data: data.setChart.values, backgroundColor: ['#007AFF', '#5AC8FA', '#34C759', '#FFCC00', '#FF9500', '#FF3B30'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%', onClick: (evt, activeElements) => { if (activeElements.length > 0) filterFromChart(data.setChart.labels[activeElements[0].index]) }, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${BRL.format(c.raw)}` } } } } })
    }

    const colorEl = document.getElementById('colorChart')
    if (colorEl && data.colorDist) {
      new Chart(colorEl, { type: 'doughnut', data: { labels: ['Branco', 'Azul', 'Preto', 'Vermelho', 'Verde', 'Multicolor', 'Incolor'], datasets: [{ data: [data.colorDist.W, data.colorDist.U, data.colorDist.B, data.colorDist.R, data.colorDist.G, data.colorDist.M, data.colorDist.C], backgroundColor: ['#F0E6D2', '#4A90E2', '#2C2C2E', '#FF3B30', '#34C759', '#FFCC00', '#8E8E93'], borderWidth: 1, borderColor: 'rgba(60, 60, 67, 0.18)' }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } } })
    }

    const typeEl = document.getElementById('typeChart')
    if (typeEl && data.typeDist) {
      new Chart(typeEl, { type: 'bar', data: { labels: ['Criaturas', 'Mágicas', 'Terrenos', 'Artefatos', 'Encantamentos', 'Planeswalkers'], datasets: [{ data: [data.typeDist.creature, data.typeDist.instant + data.typeDist.sorcery, data.typeDist.land, data.typeDist.artifact, data.typeDist.enchantment, data.typeDist.planeswalker], backgroundColor: '#007AFF', borderRadius: 4 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { display: false } } } } })
    }

    const rarityEl = document.getElementById('rarityChart')
    if (rarityEl && data.rarityDist) {
      new Chart(rarityEl, { type: 'doughnut', data: { labels: ['Comum', 'Incomum', 'Rara', 'Mítica'], datasets: [{ data: [data.rarityDist.common, data.rarityDist.uncommon, data.rarityDist.rare, data.rarityDist.mythic], backgroundColor: ['#8E8E93', '#5AC8FA', '#007AFF', '#FF9500'], borderWidth: 1, borderColor: 'rgba(60, 60, 67, 0.18)' }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } } })
    }

    const tierEl = document.getElementById('tierChart')
    if (tierEl && data.tiers) {
      new Chart(tierEl, { type: 'bar', data: { labels: ['Bulk (< R$ 2)', 'Low (R$ 2-10)', 'Mid (R$ 10-50)', 'High (> R$ 50)'], datasets: [{ data: [data.tiers.bulk.qty, data.tiers.low.qty, data.tiers.mid.qty, data.tiers.high.qty], backgroundColor: ['#8E8E93', '#5AC8FA', '#007AFF', '#FF9500'], borderRadius: 4 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { display: false } } } } })
    }

    const fillTable = (id, list, colorCheck = false) => {
      const tb = document.getElementById(id)
      if (!tb) return
      if (!list.length) { tb.innerHTML = '<tr><td class="text-center text-muted">Vazio</td></tr>'; return }
      list.forEach(x => {
        let val = BRL.format(x.diff), cls = colorCheck ? (x.diff > 0 ? 'var-up' : 'var-down') : 'text-main', prefix = colorCheck ? (x.diff > 0 ? '+' : '') : ''
        const enc = btoa(encodeURIComponent(JSON.stringify(x)))
        const imgBtn = x.imageUri ? `<button class="btn btn-sm btn-link p-0 text-muted me-2" onclick="showCardDetails('${enc}')"><i class="bi bi-image"></i></button>` : ''

        tb.innerHTML += `<tr>
          <td class="ps-3 d-flex align-items-center">
            ${imgBtn}
            <div>
              <div class="col-card-name fw-bold text-main">${x.name}</div>
              ${x.set ? '<div class="small text-muted">' + x.set + '</div>' : ''}
            </div>
          </td>
          <td class="text-end pe-3 fw-bold ${cls} align-middle">${prefix}${val}</td>
        </tr>`
      })
    }

    const fillTopCardsTable = (id, list) => {
      const tb = document.getElementById(id)
      if (!tb) return
      if (!list.length) { tb.innerHTML = '<tr><td class="text-center text-muted">Vazio</td></tr>'; return }
      list.forEach((x, i) => {
        const enc = btoa(encodeURIComponent(JSON.stringify(x)))
        const imgBtn = x.imageUri ? `<button class="btn btn-sm btn-link p-0 text-muted me-2" onclick="showCardDetails('${enc}')"><i class="bi bi-image"></i></button>` : ''
        const pos = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`

        tb.innerHTML += `<tr>
          <td class="text-center text-muted fw-bold" style="width: 40px;">${pos}</td>
          <td class="ps-2 d-flex align-items-center">
            ${imgBtn}
            <div>
              <div class="col-card-name fw-bold text-main">${x.name} <span class="ms-2 fs-6">${formatManaCost(x.manaCost)}</span></div>
              ${x.set ? '<div class="small text-muted">' + x.set + '</div>' : ''}
            </div>
          </td>
          <td class="text-center text-muted">${x.qty}x</td>
          <td class="text-end pe-3 fw-bold text-warning align-middle">${BRL.format(x.unitPrice)}</td>
        </tr>`
      })
    }

    fillTable('tableTopGainers', data.topGainers, true)
    fillTable('tableTopLosers', data.topLosers, true)
    fillTopCardsTable('tableTopCards', data.topCards)

    loadInventory()
  } catch (e) { console.error(e) }
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('kpiTotal')) initDashboard()
})

function openSyncModal() {
  document.getElementById('syncHtmlInput').value = ''
  document.getElementById('btnRunSync').classList.remove('d-none')
  document.getElementById('syncLoading').classList.add('d-none')
  new bootstrap.Modal(document.getElementById('syncModal')).show()
}

async function runSync() {
  const htmlContent = document.getElementById('syncHtmlInput').value.trim()
  if (!htmlContent) return alert("Por favor, cole o código fonte primeiro.")

  document.getElementById('btnRunSync').classList.add('d-none')
  document.getElementById('syncLoading').classList.remove('d-none')

  try {
    const res = await apiFetch('/api/sync-liga', {
      method: 'POST',
      body: JSON.stringify({ html: htmlContent })
    })

    if (!res.ok) throw new Error("Erro na sincronização")

    const data = await res.json()
    alert(`Sucesso! ${data.count} cartas sincronizadas no valor de ${BRL.format(data.total)}.`)

    bootstrap.Modal.getInstance(document.getElementById('syncModal')).hide()

    window.location.reload()
  } catch (error) {
    alert("Erro crítico ao ler o HTML. Confirme se colou o código inteiro (Ctrl+U).")
    document.getElementById('btnRunSync').classList.remove('d-none')
    document.getElementById('syncLoading').classList.add('d-none')
  }
}