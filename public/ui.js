export function showCardDetails(encStr) {
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

export function openHistory(i, currentSearchResults) {
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
    tb.insertAdjacentHTML('beforeend', `<tr><td class="ps-3 text-muted">${dp[2]}/${dp[1]}</td><td class="text-end pe-3 text-main fw-bold">${BRL.format(h.value)}${d}</td></tr>`)
  })
}

export function openSyncModal() {
  document.getElementById('syncHtmlInput').value = ''
  document.getElementById('btnRunSync').classList.remove('d-none')
  document.getElementById('syncLoading').classList.add('d-none')
  new bootstrap.Modal(document.getElementById('syncModal')).show()
}

export async function runSync() {
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