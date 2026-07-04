import { showCardDetails, openHistory, openSyncModal, runSync } from './ui.js'
import { initDashboard, updateTimeRange } from './charts.js'
import { loadInventory, applyInventoryFilters, addExcludedSet, removeExcludedSet } from './inventory.js'

window.showCardDetails = showCardDetails
window.openHistory = (i) => openHistory(i, window.currentSearchResults)
window.updateTimeRange = updateTimeRange
window.applyInventoryFilters = applyInventoryFilters
window.addExcludedSet = addExcludedSet
window.removeExcludedSet = removeExcludedSet
window.runSync = runSync
window.openSyncModal = openSyncModal

window.currentSearchResults = []

window.performSearch = async function (e) {
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
    window.currentSearchResults = await req.json()
    tb.innerHTML = ''
    if (window.currentSearchResults.length === 0) {
      if (noResEl) noResEl.classList.remove('d-none')
      return
    }

    let htmlChunk = ''
    window.currentSearchResults.forEach((c, i) => {
      let icnHist = '<i class="bi bi-clock-history"></i>'
      if (c.history && c.history.length > 1) {
        const cr = c.history[0].value, pr = c.history[1].value
        if (cr > pr) icnHist = '<i class="bi bi-graph-up-arrow text-success"></i>'
        else if (cr < pr) icnHist = '<i class="bi bi-graph-down-arrow text-danger"></i>'
      }
      const enc = btoa(encodeURIComponent(JSON.stringify(c)))
      const btnImg = `<button class="btn-action-icon me-1" onclick="showCardDetails('${enc}')" title="Inspecionar Carta"><i class="bi bi-image"></i></button>`
      const btnHist = `<button class="btn-action-icon" onclick="openHistory(${i})" title="Histórico de Preço">${icnHist}</button>`

      htmlChunk += `<tr>
        <td class="ps-4"><div class="col-card-name fw-bold text-main">${c.name}</div><div class="small text-muted">${c.set} #${c.num} <span class="ms-2">${formatManaCost(c.manaCost)}</span></div></td>
        <td class="text-center text-nowrap">${btnImg}${btnHist}</td>
        <td class="text-center"><span class="badge-tech">${c.set}</span></td>
        <td class="text-center">${c.qty}</td>
        <td class="text-end pe-4 text-main fw-bold">${BRL.format(c.totalPrice)}</td>
      </tr>`
    })
    tb.insertAdjacentHTML('beforeend', htmlChunk)
  } catch (e) { console.error(e) }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (document.getElementById('kpiTotal')) {
    await initDashboard()
    await loadInventory()
  }
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW falhou:', err))
  })
}