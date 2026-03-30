let currentDecks = []
let activeDeckId = null
let currentPreviewImage = null
let currentPreviewName = null

// ==========================================
// CONTROLE DE VIEWS
// ==========================================
function showLibrary() {
  document.getElementById('libraryView').classList.remove('d-none')
  document.getElementById('deckDetailView').classList.add('d-none')
  activeDeckId = null
  loadDecks()
}

function showDeckDetail() {
  document.getElementById('libraryView').classList.add('d-none')
  document.getElementById('deckDetailView').classList.remove('d-none')
}

// ==========================================
// PREVIEW E SELEÇÕES
// ==========================================
function setPreviewCard(imgUrl, cardName) {
  if (imgUrl && imgUrl !== 'null') {
    document.getElementById('livePreviewImage').src = imgUrl
    currentPreviewImage = imgUrl
  }
  if (cardName) currentPreviewName = cardName
}

function openCardModal(imgUrl) {
  if (imgUrl && imgUrl !== 'null') {
    document.getElementById('scryfallImage').src = imgUrl
    new bootstrap.Modal(document.getElementById('imagePreviewModal')).show()
  }
}

async function setAsCover() {
  if (!activeDeckId || !currentPreviewImage) return alert("Por favor, selecione uma carta com imagem válida primeiro.")

  const artCropUri = currentPreviewImage.replace(/\/(normal|large|small|png)\//, '/art_crop/')
  const btn = document.getElementById('btnSetCover')
  const originalText = btn.innerHTML
  btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>...'

  try {
    const req = await apiFetch(`/api/decks/${activeDeckId}/cover`, {
      method: 'PUT', body: JSON.stringify({ imageUri: artCropUri })
    })
    if (!req.ok) throw new Error("Erro")

    btn.innerHTML = '<i class="bi bi-check-lg text-success"></i> Capa Salva!'
    const coverEl = document.getElementById('activeDeckCover')
    if (coverEl) coverEl.style.backgroundImage = `url('${artCropUri}')`
    setTimeout(() => btn.innerHTML = originalText, 2000)
  } catch (e) {
    btn.innerHTML = originalText
    alert("Erro ao alterar a capa do deck.")
  }
}

async function setAsCommander() {
  if (!activeDeckId || !currentPreviewName) return alert("Por favor, selecione uma carta primeiro.")

  const btn = document.getElementById('btnSetCommander')
  const originalText = btn.innerHTML
  btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>...'

  try {
    const req = await apiFetch(`/api/decks/${activeDeckId}/commander`, {
      method: 'PUT', body: JSON.stringify({ cardName: currentPreviewName })
    })
    if (!req.ok) throw new Error("Erro")

    btn.innerHTML = '<i class="bi bi-check-lg text-success"></i> Salvo!'
    setTimeout(() => { btn.innerHTML = originalText; loadDeckData(activeDeckId) }, 1000)
  } catch (e) {
    btn.innerHTML = originalText
    alert("Erro ao definir o comandante.")
  }
}

// ==========================================
// MUDAR A ARTE DA CARTA (PRINT SELECTOR)
// ==========================================
async function openPrintSelector() {
  if (!currentPreviewName) return alert("Por favor, selecione uma carta primeiro.")

  document.getElementById('printSelectorTitle').innerText = currentPreviewName
  const grid = document.getElementById('printSelectorGrid')
  grid.innerHTML = ''

  document.getElementById('printSelectorLoading').classList.remove('d-none')
  new bootstrap.Modal(document.getElementById('printSelectorModal')).show()

  try {
    const req = await apiFetch(`/api/cards/prints?name=${encodeURIComponent(currentPreviewName)}`)
    const prints = await req.json()

    document.getElementById('printSelectorLoading').classList.add('d-none')

    if (prints.length === 0) {
      grid.innerHTML = '<div class="col-12 text-center text-muted">Nenhuma variação de arte encontrada.</div>'
      return
    }

    prints.forEach(p => {
      const safeUrl = p.image_uri.replace(/'/g, "\\'")
      const safeSet = p.set.replace(/'/g, "\\'")

      grid.innerHTML += `
        <div class="col-6 col-md-4 col-lg-3 col-xl-2">
          <div class="print-option text-center" onclick="selectPrint('${safeSet}', '${safeUrl}')">
            <img src="${p.image_uri}" class="img-fluid rounded-3 mb-2 shadow-sm" alt="${p.set}" loading="lazy">
            <div class="badge-tech d-inline-block">${p.set} #${p.collector_number}</div>
          </div>
        </div>
      `
    })
  } catch (e) {
    document.getElementById('printSelectorLoading').classList.add('d-none')
    grid.innerHTML = '<div class="col-12 text-center text-danger">Erro ao buscar artes no Scryfall.</div>'
  }
}

async function selectPrint(setCode, imageUri) {
  try {
    const req = await apiFetch(`/api/decks/${activeDeckId}/card-print`, {
      method: 'PUT', body: JSON.stringify({ cardName: currentPreviewName, setCode, imageUri })
    })

    if (!req.ok) throw new Error("Erro ao salvar")

    bootstrap.Modal.getInstance(document.getElementById('printSelectorModal')).hide()
    setPreviewCard(imageUri, currentPreviewName)
    loadDeckData(activeDeckId)
  } catch (e) {
    alert("Erro ao aplicar a nova versão da carta.")
  }
}

// ==========================================
// CRUD DA BIBLIOTECA
// ==========================================
async function loadDecks() {
  const grid = document.getElementById('decksGrid')
  if (!grid) return

  grid.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-primary" role="status"></div></div>'

  try {
    const req = await apiFetch('/api/decks')
    currentDecks = await req.json()

    grid.innerHTML = ''
    if (currentDecks.length === 0) {
      grid.innerHTML = '<div class="col-12 text-center py-5 text-muted">Você ainda não tem nenhum deck salvo. Clique em "Novo Deck" lá em cima.</div>'
      return
    }

    currentDecks.forEach(deck => {
      const cover = deck.cover_image_uri || 'https://cards.scryfall.io/art_crop/front/1/7/17b3a9bb-8152-474d-bbbb-cc748dae321b.jpg'
      const date = new Date(deck.created_at).toLocaleDateString('pt-BR')

      grid.innerHTML += `
        <div class="col-12 col-sm-6 col-lg-4 col-xl-3">
          <div class="ui-panel p-0 deck-card h-100" onclick="loadDeckData(${deck.id})">
            <div class="deck-cover" style="background-image: url('${cover}'); background-position: center; border-bottom: none;"></div>
            <div class="deck-info" style="border-top: 1px solid var(--border-color);">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="badge-tech">${deck.format}</span>
                <span class="text-muted" style="font-size: 0.65rem;">${date}</span>
              </div>
              <h5 class="fw-bold text-main mb-0 text-truncate">${deck.name}</h5>
            </div>
          </div>
        </div>
      `
    })
  } catch (e) {
    console.error(e)
    grid.innerHTML = '<div class="col-12 text-center py-5 text-danger">Erro ao carregar a biblioteca de decks.</div>'
  }
}

// ==========================================
// RENDERIZAÇÃO MOXFIELD (MASONRY)
// ==========================================
async function loadDeckData(id) {
  activeDeckId = id
  showDeckDetail()

  const container = document.getElementById('deckMasonryContainer')
  if (!container) return

  container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>'

  try {
    const req = await apiFetch(`/api/decks/${id}`)
    if (!req.ok) throw new Error("Erro na API")
    const data = await req.json()

    const cover = data.deck.cover_image_uri || 'https://cards.scryfall.io/art_crop/front/1/7/17b3a9bb-8152-474d-bbbb-cc748dae321b.jpg'
    const coverEl = document.getElementById('activeDeckCover')
    if (coverEl) coverEl.style.backgroundImage = `url('${cover}')`

    if (data.categorized.commander.length > 0) {
      setPreviewCard(data.categorized.commander[0].image_uri, data.categorized.commander[0].name)
    } else {
      const firstValidCard = Object.values(data.categorized).flat().find(c => c.image_uri)
      if (firstValidCard) setPreviewCard(firstValidCard.image_uri, firstValidCard.name)
    }

    document.getElementById('activeDeckName').innerText = data.deck.name
    document.getElementById('activeDeckFormat').innerText = data.deck.format

    document.getElementById('kpiDeckOwnedCards').innerText = `${data.summary.ownedCards} / ${data.summary.totalCards}`
    document.getElementById('kpiDeckValue').innerText = BRL.format(data.summary.totalValue)
    document.getElementById('kpiDeckMissingValue').innerText = BRL.format(data.summary.missingValue)

    container.innerHTML = ''

    const categories = [
      { key: 'commander', label: 'Comandante', icon: 'bi-star-fill text-warning' },
      { key: 'planeswalker', label: 'Planeswalkers', icon: 'bi-person-fill-up' },
      { key: 'creature', label: 'Criaturas', icon: 'bi-emoji-angry-fill' },
      { key: 'sorcery', label: 'Feitiços', icon: 'bi-magic' },
      { key: 'instant', label: 'Instantâneas', icon: 'bi-lightning-charge-fill' },
      { key: 'artifact', label: 'Artefatos', icon: 'bi-cup-hot-fill' },
      { key: 'enchantment', label: 'Encantamentos', icon: 'bi-stars' },
      { key: 'land', label: 'Terrenos', icon: 'bi-tree-fill' }
    ]

    categories.forEach(cat => {
      const group = data.categorized[cat.key]
      if (group && group.length > 0) {
        const groupCount = group.reduce((acc, c) => acc + c.qty, 0)

        let htmlBlock = `<div class="deck-group"><div class="deck-group-header"><i class="bi ${cat.icon} text-muted me-1"></i> ${cat.label} (${groupCount})</div><div class="d-flex flex-column gap-1">`

        group.forEach(c => {
          let cssClass = ''
          if (c.status === 'missing') cssClass = 'missing'
          else if (c.status === 'partial') cssClass = 'partial'

          const safeUrl = c.image_uri ? c.image_uri.replace(/'/g, "\\'") : 'null'
          const safeName = c.name.replace(/'/g, "\\'")
          const manaCostSvg = c.mana_cost ? formatManaCost(c.mana_cost) : ''
          const priceDisplay = c.unitPrice > 0 ? BRL.format(c.unitPrice) : '--'

          htmlBlock += `
            <div class="deck-item ${cssClass}" onclick="setPreviewCard('${safeUrl}', '${safeName}')" ondblclick="openCardModal('${safeUrl}')">
              <span class="fw-bold" style="width: 20px; text-align: right;">${c.qty}</span>
              <span class="text-truncate flex-grow-1">${c.name}</span>
              ${manaCostSvg ? `<span class="ms-1 d-flex align-items-center">${manaCostSvg}</span>` : ''}
              <span class="fw-bold ms-2" style="font-size: 0.75rem; opacity: 0.7; text-align: right; min-width: 60px;">${priceDisplay}</span>
            </div>
          `
        })
        htmlBlock += `</div></div>`
        container.innerHTML += htmlBlock
      }
    })

  } catch (e) {
    console.error(e)
    alert("Erro ao carregar os dados detalhados deste deck.")
    showLibrary()
  }
}

async function confirmDeleteDeck() {
  if (confirm("Quer deletar esse deck?")) {
    try {
      await apiFetch(`/api/decks/${activeDeckId}`, { method: 'DELETE' })
      showLibrary()
    } catch (e) {
      alert("Erro ao apagar o deck.")
    }
  }
}

function openNewDeckModal() {
  document.getElementById('newDeckName').value = ''
  document.getElementById('newDeckList').value = ''
  document.getElementById('btnSaveDeck').classList.remove('d-none')
  document.getElementById('newDeckLoading').classList.add('d-none')
  new bootstrap.Modal(document.getElementById('newDeckModal')).show()
}

async function submitNewDeck() {
  const name = document.getElementById('newDeckName').value.trim()
  const format = document.getElementById('newDeckFormat').value
  const list = document.getElementById('newDeckList').value.trim()

  if (!name || !list) return alert("Por favor, preencha o nome do deck e cole a lista de cartas.")

  document.getElementById('btnSaveDeck').classList.add('d-none')
  document.getElementById('newDeckLoading').classList.remove('d-none')

  try {
    const req = await apiFetch('/api/decks', {
      method: 'POST', body: JSON.stringify({ name, format, deckText: list })
    })

    if (!req.ok) throw new Error("Erro na API")
    const res = await req.json()
    bootstrap.Modal.getInstance(document.getElementById('newDeckModal')).hide()
    loadDeckData(res.deckId)
  } catch (e) {
    console.error(e)
    alert("Erro ao salvar. Verifique se o formato das linhas está correto (1 Nome [Edição]).")
    document.getElementById('btnSaveDeck').classList.remove('d-none')
    document.getElementById('newDeckLoading').classList.add('d-none')
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('libraryView')) loadDecks()
})