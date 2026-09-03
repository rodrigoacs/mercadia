import { loadInventory } from './inventory.js'
import { initDashboard } from './charts.js'

let sparklineChart = null
let cameFromSearchModal = false

const RARITY_LABELS = { common: 'Comum', uncommon: 'Incomum', rare: 'Rara', mythic: 'Mítica' }
const RARITY_COLORS = { common: '#8E8E93', uncommon: '#5AC8FA', rare: '#007AFF', mythic: '#FF9500' }

function renderDetailHistory(history) {
  const section = document.getElementById('detailHistorySection')
  const tableWrap = document.getElementById('detailHistoryTable')
  const tableBody = document.getElementById('detailHistoryTableBody')
  if (!section) return

  if (!history || history.length < 2) {
    section.classList.add('d-none')
    return
  }
  section.classList.remove('d-none')
  if (tableWrap) tableWrap.classList.add('d-none')

  const chronological = [...history].reverse()
  const values = chronological.map(h => h.value)
  const labels = chronological.map(h => h.date)
  const isUp = values[values.length - 1] >= values[0]
  const lineColor = isUp ? '#34C759' : '#FF3B30'

  const canvas = document.getElementById('detailSparkline')
  if (canvas) {
    if (sparklineChart) sparklineChart.destroy()
    sparklineChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{ data: values, borderColor: lineColor, borderWidth: 2, pointRadius: 0, pointHitRadius: 12, tension: 0.3, fill: false }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => BRL.format(ctx.raw) } }
        },
        scales: { x: { display: false }, y: { display: false } }
      }
    })
  }

  if (tableBody) {
    tableBody.innerHTML = ''
    history.forEach((h, i) => {
      let d = ''
      if (i < history.length - 1) {
        const p = history[i + 1].value
        if (h.value > p) d = '<span class="text-success ms-1">▲</span>'
        else if (h.value < p) d = '<span class="text-danger ms-1">▼</span>'
      }
      const dp = h.date.split('-')
      tableBody.insertAdjacentHTML('beforeend', `<tr><td class="ps-2 text-muted">${dp[2]}/${dp[1]}</td><td class="text-end pe-2 text-main fw-bold">${BRL.format(h.value)}${d}</td></tr>`)
    })
  }
}

window.toggleDetailHistoryTable = () => {
  const el = document.getElementById('detailHistoryTable')
  if (el) el.classList.toggle('d-none')
}

export async function showCardDetails(encStr) {
  try {
    const c = JSON.parse(decodeURIComponent(atob(encStr)))

    const imgEl = document.getElementById('detailImage')
    if (imgEl) imgEl.src = c.imageUri || window.CARD_PLACEHOLDER_SVG

    safeSetText('detailName', c.name)
    safeSetHTML('detailMana', formatManaCost(c.manaCost))
    safeSetText('detailType', c.typeLine || 'Desconhecido')

    let oracle = c.oracleText || 'Sem texto de regras.'
    safeSetHTML('detailOracle', formatManaCost(oracle))

    const catalogParts = [c.set.toUpperCase(), `#${c.num || '?'}`]
    if (c.extras) catalogParts.push(c.extras)
    safeSetText('detailCatalogTag', catalogParts.join(' · '))

    const rarityKey = c.rarity?.toLowerCase()
    safeSetText('detailRarity', RARITY_LABELS[rarityKey] || c.rarity || '-')
    const dotEl = document.getElementById('detailRarityDot')
    if (dotEl) dotEl.style.background = RARITY_COLORS[rarityKey] || 'var(--text-muted)'

    safeSetText('detailQty', `${c.qty}x`)
    safeSetText('detailUnit', BRL.format(c.unitPrice || 0))
    safeSetText('detailTotal', BRL.format((c.unitPrice || 0) * (c.qty || 1)))

    if (c.history && c.history.length > 1) {
      renderDetailHistory(c.history)
    } else {
      renderDetailHistory(null)
      apiFetch(`/api/cards/history?name=${encodeURIComponent(c.name)}&set=${encodeURIComponent(c.set)}&num=${encodeURIComponent(c.num || '')}&extras=${encodeURIComponent(c.extras || '')}`)
        .then(req => req.json())
        .then(history => renderDetailHistory(history))
        .catch(() => { })
    }

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

    const actionContainer = document.getElementById('detailActions') || createDetailActionsContainer()
    if (actionContainer) {
      actionContainer.innerHTML = `
        <button class="btn btn-outline-light w-100 mt-3 d-flex align-items-center justify-content-center gap-2" 
                onclick="openInventoryPrintSelector('${encStr}')"
                style="border-radius: var(--radius-sm); font-size: 0.85rem;">
          <i class="bi bi-palette-fill text-primary"></i> Alterar Edição
        </button>
      `
    }

    const modalEl = document.getElementById('imagePreviewModal')
    if (modalEl) {
      const searchModalEl = document.getElementById('searchModal')
      const searchInstance = searchModalEl ? bootstrap.Modal.getInstance(searchModalEl) : null
      cameFromSearchModal = !!(searchInstance && searchModalEl.classList.contains('show'))

      const openDetailModal = () => {
        const modalInstance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl)
        modalInstance.show()
      }

      if (cameFromSearchModal) {
        searchModalEl.addEventListener('hidden.bs.modal', openDetailModal, { once: true })
        searchInstance.hide()
      } else {
        openDetailModal()
      }
    }
  } catch (e) { console.error('Erro ao abrir detalhes', e) }
}

function createDetailActionsContainer() {
  const target = document.querySelector('#imagePreviewModal .col-12.col-md-7')
  if (!target) return null
  const div = document.createElement('div')
  div.id = 'detailActions'
  target.appendChild(div)
  return div
}

export async function openInventoryPrintSelector(encStr) {
  const modalEl = document.getElementById('printSelectorModal')
  const titleEl = document.getElementById('printSelectorTitle')
  const grid = document.getElementById('printSelectorGrid')
  const loadingEl = document.getElementById('printSelectorLoading')

  if (!modalEl || !titleEl || !grid || !loadingEl) {
    mercadiaToast('Erro de interface: o modal de seleção de artes não foi encontrado na página.', 'error')
    return
  }

  const c = JSON.parse(decodeURIComponent(atob(encStr)))

  bootstrap.Modal.getInstance(document.getElementById('imagePreviewModal'))?.hide()

  titleEl.innerText = `Escolha a versão exata de: ${c.name}`
  grid.innerHTML = ''
  loadingEl.classList.remove('d-none')

  const printModal = new bootstrap.Modal(modalEl)
  printModal.show()

  try {
    const req = await apiFetch(`/api/cards/prints?name=${encodeURIComponent(c.name)}`)
    const prints = await req.json()

    loadingEl.classList.add('d-none')

    if (prints.length === 0) {
      grid.innerHTML = '<div class="col-12 text-center text-muted">Nenhuma variação encontrada no Scryfall.</div>'
      return
    }

    prints.forEach(p => {
      const safeUrl = p.image_uri.replace(/'/g, "\\'")
      const safeSet = p.set.replace(/'/g, "\\'")

      grid.innerHTML += `
        <div class="col-6 col-md-4 col-lg-3 col-xl-2">
          <div class="print-option text-center" style="cursor: pointer;" onclick="saveInventoryOverride('${encStr}', '${safeSet}', '${safeUrl}')">
            <img src="${p.image_uri}" class="img-fluid rounded-3 mb-2 shadow-sm" alt="${p.set}" loading="lazy">
            <div class="badge-tech d-inline-block">${p.set} #${p.collector_number}</div>
          </div>
        </div>
      `
    })
  } catch (e) {
    loadingEl.classList.add('d-none')
    grid.innerHTML = '<div class="col-12 text-center text-danger">Erro ao buscar impressões.</div>'
  }
}

export async function saveInventoryOverride(encStr, newScryfallSet, newImageUri) {
  const c = JSON.parse(decodeURIComponent(atob(encStr)))
  try {
    const res = await apiFetch('/api/inventory/override', {
      method: 'PUT',
      body: JSON.stringify({
        name: c.name,
        setCode: c.set,
        num: c.num,
        extras: c.extras,
        newScryfallSet,
        newImageUri
      })
    })

    if (!res.ok) throw new Error()

    bootstrap.Modal.getInstance(document.getElementById('printSelectorModal'))?.hide()
    mercadiaToast('Edição alterada com sucesso!', 'success')
    await loadInventory()
  } catch (e) {
    mercadiaToast('Erro ao salvar override manual.', 'error')
  }
}

export function openSyncModal() {
  const input = document.getElementById('syncHtmlInput')
  if (input) input.value = ''
  const btn = document.getElementById('btnRunSync')
  if (btn) btn.classList.remove('d-none')
  const loading = document.getElementById('syncLoading')
  if (loading) loading.classList.add('d-none')
  const modalEl = document.getElementById('syncModal')
  if (modalEl) new bootstrap.Modal(modalEl).show()
}

export async function runSync() {
  const inputEl = document.getElementById('syncHtmlInput')
  const htmlContent = inputEl ? inputEl.value.trim() : ''
  if (!htmlContent) return mercadiaToast("Cole o código fonte primeiro.", 'info')

  const btn = document.getElementById('btnRunSync')
  if (btn) btn.classList.add('d-none')
  const loading = document.getElementById('syncLoading')
  if (loading) loading.classList.remove('d-none')

  try {
    const res = await apiFetch('/api/sync-liga', {
      method: 'POST',
      body: JSON.stringify({ html: htmlContent })
    })

    if (!res.ok) throw new Error("Erro na sincronização")

    const data = await res.json()
    mercadiaToast(`Sucesso! ${data.count} cartas sincronizadas no valor de ${BRL.format(data.total)}.`, 'success')
    bootstrap.Modal.getInstance(document.getElementById('syncModal'))?.hide()
    await initDashboard()
    await loadInventory()
  } catch (error) {
    mercadiaToast("Erro crítico ao ler o HTML. Confirme se colou o código inteiro (Ctrl+U).", 'error')
  } finally {
    if (btn) btn.classList.remove('d-none')
    if (loading) loading.classList.add('d-none')
  }
}

window.openInventoryPrintSelector = openInventoryPrintSelector
window.saveInventoryOverride = saveInventoryOverride

document.addEventListener('DOMContentLoaded', () => {
  const modalEl = document.getElementById('imagePreviewModal')
  if (!modalEl) return
  modalEl.addEventListener('hidden.bs.modal', () => {
    if (!cameFromSearchModal) return
    cameFromSearchModal = false
    const searchModalEl = document.getElementById('searchModal')
    if (searchModalEl) new bootstrap.Modal(searchModalEl).show()
  })
})
