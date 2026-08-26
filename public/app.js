import { showCardDetails, openSyncModal, runSync } from './ui.js'
import { initDashboard, updateTimeRange } from './charts.js'
import { loadInventory, applyInventoryFilters, addExcludedSet, removeExcludedSet, switchInventoryView } from './inventory.js'

window.showCardDetails = showCardDetails
window.updateTimeRange = updateTimeRange
window.applyInventoryFilters = applyInventoryFilters
window.addExcludedSet = addExcludedSet
window.removeExcludedSet = removeExcludedSet
window.switchInventoryView = switchInventoryView
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

  tb.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Buscando...</td></tr>'
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
      let trendIcon = ''
      if (c.history && c.history.length > 1) {
        const cr = c.history[0].value, pr = c.history[1].value
        if (cr > pr) trendIcon = '<i class="bi bi-graph-up-arrow text-success ms-2" title="Em alta"></i>'
        else if (cr < pr) trendIcon = '<i class="bi bi-graph-down-arrow text-danger ms-2" title="Em queda"></i>'
      }

      const enc = btoa(encodeURIComponent(JSON.stringify(c)))
      const thumb = c.imageUri
        ? `<img src="${c.imageUri}" alt="" loading="lazy" style="width: 32px; height: 32px; object-fit: cover; object-position: top; border-radius: 6px; border: 1px solid var(--border-subtle); flex-shrink: 0;" onerror="this.onerror=null;this.src=window.CARD_PLACEHOLDER_SVG;this.style.objectFit='contain';this.style.objectPosition='center';">`
        : `<img src="${window.CARD_PLACEHOLDER_SVG}" alt="" style="width: 32px; height: 32px; object-fit: contain; border-radius: 6px; border: 1px solid var(--border-subtle); flex-shrink: 0;">`

      htmlChunk += `<tr style="cursor: pointer;" onclick="showCardDetails('${enc}')">
        <td class="ps-4">
          <div class="d-flex align-items-center gap-2">
            ${thumb}
            <div>
              <div class="col-card-name fw-bold text-main d-flex align-items-center">${escapeHTML(c.name)}${trendIcon}</div>
              <div class="small text-muted">${c.set} #${c.num} <span class="ms-2">${formatManaCost(c.manaCost)}</span></div>
            </div>
          </div>
        </td>
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
