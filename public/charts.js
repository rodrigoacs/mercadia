import { applyInventoryFilters } from './inventory.js'

export let globalData = {}
let mainChartInstance = null
let organicChartInstance = null

export function updateTimeRange(range, btn, type) {
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

export function filterFromChart(setName) {
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

export async function initDashboard() {
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

        tb.insertAdjacentHTML('beforeend', `<tr>
          <td class="ps-3 d-flex align-items-center">
            ${imgBtn}
            <div>
              <div class="col-card-name fw-bold text-main">${x.name}</div>
              ${x.set ? '<div class="small text-muted">' + x.set + '</div>' : ''}
            </div>
          </td>
          <td class="text-end pe-3 fw-bold ${cls} align-middle">${prefix}${val}</td>
        </tr>`)
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

        tb.insertAdjacentHTML('beforeend', `<tr>
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
        </tr>`)
      })
    }

    fillTable('tableTopGainers', data.topGainers, true)
    fillTable('tableTopLosers', data.topLosers, true)
    fillTopCardsTable('tableTopCards', data.topCards)
  } catch (e) { console.error(e) }
}