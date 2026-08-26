import { matchScryfallQuery } from './scryfallParser.js'

export let fullInventory = []
let excludedSets = []
let currentRenderLimit = 50
let observer = null
let filtered = []
let searchDebounceTimeout = null
export let currentViewMode = 'grid'

export async function loadInventory() {
  try {
    const req = await window.apiFetch('/api/inventory')
    fullInventory = await req.json()
    const sets = [...new Set(fullInventory.filter(c => c.qty > 0).map(c => c.set))].sort()

    const setSelect = document.getElementById('filterSet')
    if (setSelect) {
      setSelect.innerHTML = '<option value="all">Todas Edições</option>'
      sets.forEach(s => {
        const opt = document.createElement('option'); opt.value = s; opt.innerText = s; setSelect.appendChild(opt)
      })
    }

    const setExcludeSelect = document.getElementById('filterSetExclude')
    if (setExcludeSelect) {
      setExcludeSelect.innerHTML = '<option value="none">Excluir Edição...</option>'
      sets.forEach(s => {
        const opt = document.createElement('option'); opt.value = s; opt.innerText = s; setExcludeSelect.appendChild(opt)
      })
    }

    const textInput = document.getElementById('filterText')
    if (textInput) {
      textInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimeout)
        searchDebounceTimeout = setTimeout(() => applyInventoryFilters(), 150)
      })
    }

    applyInventoryFilters()
  } catch (e) { console.error('Erro ao carregar inventário:', e) }
}

export function switchInventoryView(mode) {
  currentViewMode = mode

  const btnGrid = document.getElementById('btnViewGrid')
  const btnTable = document.getElementById('btnViewTable')

  if (btnGrid && btnTable) {
    btnGrid.classList.toggle('active', mode === 'grid')
    btnTable.classList.toggle('active', mode === 'table')
  }

  const gridContainer = document.getElementById('gridInventory')
  const tableContainer = document.getElementById('tableWrapperInventory')

  if (gridContainer && tableContainer) {
    if (mode === 'grid') {
      gridContainer.classList.remove('d-none')
      tableContainer.classList.add('d-none')
    } else {
      gridContainer.classList.add('d-none')
      tableContainer.classList.remove('d-none')
    }
  }

  currentRenderLimit = 50
  const tbody = document.getElementById('tableInventory')
  if (tbody) tbody.innerHTML = ''
  if (gridContainer) gridContainer.innerHTML = ''

  renderInventoryChunk()
}

export function addExcludedSet() {
  const select = document.getElementById('filterSetExclude')
  if (!select) return
  const val = select.value

  if (val !== 'none' && !excludedSets.includes(val)) {
    excludedSets.push(val)
    renderExcludedTags()
    applyInventoryFilters()
  }

  select.value = 'none'
}

export function removeExcludedSet(val) {
  excludedSets = excludedSets.filter(s => s !== val)
  renderExcludedTags()
  applyInventoryFilters()
}

function renderExcludedTags() {
  const container = document.getElementById('excludedTags')
  if (!container) return
  container.innerHTML = ''

  excludedSets.forEach(s => {
    container.innerHTML += `
      <span class="badge d-flex align-items-center gap-1" style="background: var(--accent-danger); font-size: 0.75rem;">
        ${window.escapeHTML(s)} 
        <i class="bi bi-x-circle" style="cursor: pointer;" onclick="removeExcludedSet('${s}')"></i>
      </span>
    `
  })
}

export function applyInventoryFilters() {
  currentRenderLimit = 50
  const getVal = id => { const el = document.getElementById(id); return el ? el.value : 'all' }
  const setF = getVal('filterSet'), extraF = getVal('filterExtra'), typeF = getVal('filterType')
  const rarityF = getVal('filterRarity'), tierF = getVal('filterTier'), sortF = getVal('sortOrder')
  const usageF = getVal('filterUsage')

  const textEl = document.getElementById('filterText')
  const rawQuery = textEl ? textEl.value.trim() : ''

  filtered = fullInventory.filter(c => {
    if (rawQuery !== '' && !matchScryfallQuery(c, rawQuery)) return false
    if (setF !== 'all' && c.set !== setF) return false
    if (excludedSets.length > 0 && excludedSets.includes(c.set)) return false
    if (extraF === 'foil' && (!c.extras || c.extras.trim() === '')) return false
    if (extraF === 'normal' && c.extras && c.extras.trim() !== '') return false
    if (rarityF !== 'all' && (!c.rarity || c.rarity.toLowerCase() !== rarityF)) return false
    if (typeF !== 'all') { if (!c.typeLine) return false; if (!c.typeLine.toLowerCase().includes(typeF)) return false }

    if (tierF !== 'all') {
      const p = c.unitPrice
      if (tierF === 'lixo' && p >= 0.50) return false
      if (tierF === 'bulk' && (p < 0.50 || p >= 2)) return false
      if (tierF === 'low' && (p < 2 || p >= 10)) return false
      if (tierF === 'mid' && (p < 10 || p >= 50)) return false
      if (tierF === 'high' && p < 50) return false
    }

    if (usageF !== 'all') {
      if (usageF === 'free' && c.usedInDecks >= c.qty) return false
      if (usageF === 'used' && c.usedInDecks === 0) return false
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
  const gridContainer = document.getElementById('gridInventory')
  if (tbody) tbody.innerHTML = ''
  if (gridContainer) gridContainer.innerHTML = ''

  renderInventoryChunk()
}

function renderInventoryChunk() {
  const displayList = filtered.slice(currentRenderLimit - 50, currentRenderLimit)
  const usageF = document.getElementById('filterUsage') ? document.getElementById('filterUsage').value : 'all'

  const oldSentinel = document.getElementById('scroll-sentinel')
  if (oldSentinel) oldSentinel.remove()

  if (currentViewMode === 'grid') {
    renderGridChunk(displayList)
  } else {
    renderTableChunk(displayList, usageF)
  }

  const visibleRows = Math.min(currentRenderLimit, filtered.length)
  const physicalVolume = filtered.reduce((acc, c) => {
    const qtyToCount = usageF === 'free' ? (c.qty - c.usedInDecks) : c.qty
    return acc + qtyToCount
  }, 0)

  window.safeSetText('inventoryCount', `Mostrando ${visibleRows} de ${filtered.length} cartas (Volume: ${physicalVolume} físicas)`)

  setupIntersectionObserver()
}

function renderGridChunk(displayList) {
  const gridContainer = document.getElementById('gridInventory')
  if (!gridContainer) return

  let htmlChunk = ''
  displayList.forEach(c => {
    const safeName = window.escapeHTML(c.name)
    const enc = btoa(encodeURIComponent(JSON.stringify(c)))
    const imgUrl = c.imageUri || 'https://cards.scryfall.io/large/front/1/7/17b3a9bb-8152-474d-bbbb-cc748dae321b.jpg'

    htmlChunk += `
      <div class="col-6 col-sm-4 col-md-3 col-xl-2">
        <div class="card-grid-item position-relative" onclick="showCardDetails('${enc}')" title="${safeName}">
          <img src="${imgUrl}" class="img-fluid rounded-3 w-100 shadow-sm" alt="${safeName}" loading="lazy" onerror="this.onerror=null;this.src=window.CARD_PLACEHOLDER_SVG;this.style.objectFit='contain';">
          
          <!-- Etiqueta de Preço Minimalista (Apple Glass) -->
          <div class="position-absolute bottom-0 end-0 m-2">
            <span class="badge bg-dark bg-opacity-75 text-success border border-secondary border-opacity-25 shadow-sm" style="backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font-size: 0.75rem;">
              ${window.BRL.format(c.unitPrice || 0)}
            </span>
          </div>
        </div>
      </div>
    `
  })

  gridContainer.insertAdjacentHTML('beforeend', htmlChunk)
}

function renderTableChunk(displayList, usageF) {
  const tbody = document.getElementById('tableInventory')
  if (!tbody) return

  let htmlChunk = ''
  displayList.forEach((c) => {
    const safeExtras = window.escapeHTML(c.extras)
    const safeName = window.escapeHTML(c.name)
    const badge = c.extras ? `<span class="badge-extra ms-1">${safeExtras}</span>` : ''
    const enc = btoa(encodeURIComponent(JSON.stringify(c)))
    const imgBtn = c.imageUri ? `<button class="btn btn-sm btn-link p-0 text-muted" onclick="showCardDetails('${enc}')"><i class="bi bi-image"></i></button>` : ''

    const availableQty = usageF === 'free' ? (c.qty - c.usedInDecks) : c.qty
    const inDeckIcon = c.usedInDecks > 0 ? `<i class="bi bi-inboxes-fill text-primary ms-1" title="Em uso num deck (${c.usedInDecks} cópias)" style="font-size: 0.7rem;"></i>` : ''

    htmlChunk += `<tr>
      <td class="text-center ps-4">${imgBtn}</td>
      <td>
        <div class="col-card-name fw-bold text-main d-flex align-items-center flex-wrap gap-2">
          ${safeName} <span class="fs-6 d-inline-flex align-items-center">${window.formatManaCost(c.manaCost)}</span>
        </div>
        ${badge}
      </td>
      <td class="text-center small text-muted">${c.typeLine ? window.escapeHTML(c.typeLine.split('—')[0].trim()) : ''}</td>
      <td class="text-center"><span class="badge-tech">${window.escapeHTML(c.set)}</span></td>
      <td class="text-center text-muted">${availableQty}${inDeckIcon}</td>
      <td class="text-end text-muted small">${window.BRL.format(c.unitPrice)}</td>
      <td class="text-end fw-bold text-main pe-4">${window.BRL.format(c.unitPrice * availableQty)}</td>
    </tr>`
  })

  tbody.insertAdjacentHTML('beforeend', htmlChunk)
}

function setupIntersectionObserver() {
  if (observer) observer.disconnect()

  if (currentRenderLimit < filtered.length) {
    const isGrid = currentViewMode === 'grid'
    const container = isGrid ? document.getElementById('gridInventory') : document.getElementById('tableInventory')
    if (!container) return

    const sentinelHtml = isGrid
      ? `<div id="scroll-sentinel" class="col-12 text-center text-muted py-4 small"><div class="spinner-border spinner-border-sm text-primary me-2" style="width: 1rem; height: 1rem;"></div> Carregando mais cartas...</div>`
      : `<tr id="scroll-sentinel"><td colspan="7" class="text-center text-muted py-3 small"><div class="spinner-border spinner-border-sm text-primary me-2" style="width: 1rem; height: 1rem;"></div> Carregando...</div></td></tr>`

    container.insertAdjacentHTML('beforeend', sentinelHtml)

    const sentinel = document.getElementById('scroll-sentinel')
    const scrollRoot = isGrid ? null : container.closest('.table-responsive')

    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        currentRenderLimit += 50
        renderInventoryChunk()
      }
    }, { root: scrollRoot, rootMargin: '200px' })

    observer.observe(sentinel)
  }
}

window.switchInventoryView = switchInventoryView