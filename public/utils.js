const token = localStorage.getItem('mercadia_token')
if (!token && !window.location.pathname.includes('login.html')) {
  window.location.href = 'login.html'
}

function escapeHTML(str) {
  if (typeof str !== 'string') return str || ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

async function apiFetch(endpoint, options = {}) {
  if (!options.headers) options.headers = {}
  options.headers['Authorization'] = `Bearer ${localStorage.getItem('mercadia_token')}`

  if (options.body && !options.headers['Content-Type']) {
    options.headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(endpoint, options)
  if (res.status === 401) {
    localStorage.removeItem('mercadia_token')
    window.location.href = 'login.html'
    throw new Error("Sessão expirada ou acesso negado.")
  }
  return res
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const safeSetText = (id, text) => {
  const el = document.getElementById(id)
  if (el) el.innerText = text
}

const safeSetHTML = (id, html) => {
  const el = document.getElementById(id)
  if (el) el.innerHTML = html
}

function setNumericText(id, text, rawValue) {
  const el = document.getElementById(id)
  if (!el) return
  const prevRaw = el.dataset.rawValue !== undefined ? parseFloat(el.dataset.rawValue) : null
  el.innerText = text
  if (prevRaw !== null && rawValue !== undefined && !Number.isNaN(rawValue) && rawValue !== prevRaw) {
    const cls = rawValue > prevRaw ? 'value-flash-up' : 'value-flash-down'
    el.classList.remove('value-flash-up', 'value-flash-down')
    void el.offsetWidth
    el.classList.add(cls)
    setTimeout(() => el.classList.remove(cls), 900)
  }
  if (rawValue !== undefined) el.dataset.rawValue = String(rawValue)
}

function formatManaCost(cost) {
  if (!cost) return ''
  const cleanCost = escapeHTML(cost)
  return cleanCost.replace(/{([^}]+)}/g, (match, p1) => {
    let symbol = p1.toUpperCase().replace('/', '')
    return `<img src="https://svgs.scryfall.io/card-symbols/${symbol}.svg" alt="${match}" style="height: 16px; vertical-align: text-bottom; margin: 0 1px; filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.8));">`
  })
}

function ensureToastContainer() {
  let container = document.getElementById('mercadiaToastContainer')
  if (!container) {
    container = document.createElement('div')
    container.id = 'mercadiaToastContainer'
    container.className = 'toast-container position-fixed bottom-0 end-0 p-3'
    container.style.zIndex = '1080'
    document.body.appendChild(container)
  }
  return container
}

const TOAST_STYLES = {
  success: { icon: 'bi-check-circle-fill', color: 'var(--accent-success)' },
  error: { icon: 'bi-x-circle-fill', color: 'var(--accent-danger)' },
  info: { icon: 'bi-info-circle-fill', color: 'var(--accent-primary)' },
}

function mercadiaToast(message, type = 'info') {
  const container = ensureToastContainer()
  const style = TOAST_STYLES[type] || TOAST_STYLES.info
  const toastEl = document.createElement('div')
  toastEl.className = 'toast mercadia-toast'
  toastEl.setAttribute('role', 'status')
  toastEl.setAttribute('aria-live', 'polite')
  toastEl.innerHTML = `
    <div class="d-flex align-items-center">
      <div class="toast-body d-flex align-items-center gap-2">
        <i class="bi ${style.icon}" style="color: ${style.color}; font-size: 1.1rem;"></i>
        <span>${escapeHTML(message)}</span>
      </div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button>
    </div>
  `
  container.appendChild(toastEl)
  const instance = new bootstrap.Toast(toastEl, { delay: 4000 })
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove())
  instance.show()
}

function ensureConfirmModal() {
  let modalEl = document.getElementById('mercadiaConfirmModal')
  if (!modalEl) {
    modalEl = document.createElement('div')
    modalEl.id = 'mercadiaConfirmModal'
    modalEl.className = 'modal fade'
    modalEl.tabIndex = -1
    modalEl.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-body p-4 text-center">
            <div id="mercadiaConfirmMessage" class="mb-4"></div>
            <div class="d-flex gap-2 justify-content-center">
              <button type="button" class="btn-filter flex-grow-1" data-mercadia-confirm="false" style="background: var(--bg-input); color: var(--text-main);">Cancelar</button>
              <button type="button" class="btn-filter flex-grow-1" data-mercadia-confirm="true" style="background: var(--accent-danger); color: #fff;">Confirmar</button>
            </div>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(modalEl)
  }
  return modalEl
}

function mercadiaConfirm(message) {
  return new Promise((resolve) => {
    const modalEl = ensureConfirmModal()
    modalEl.querySelector('#mercadiaConfirmMessage').innerText = message
    const instance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl)

    let resolved = false
    const onClick = (e) => {
      const btn = e.target.closest('[data-mercadia-confirm]')
      if (!btn) return
      resolved = true
      instance.hide()
      resolve(btn.dataset.mercadiaConfirm === 'true')
    }
    const onHidden = () => {
      modalEl.removeEventListener('click', onClick)
      modalEl.removeEventListener('hidden.bs.modal', onHidden)
      if (!resolved) resolve(false)
    }
    modalEl.addEventListener('click', onClick)
    modalEl.addEventListener('hidden.bs.modal', onHidden)
    instance.show()
  })
}

const CARD_PLACEHOLDER_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="419" viewBox="0 0 300 419">' +
  '<rect width="300" height="419" rx="18" fill="#1c1c1e"/>' +
  '<rect x="1" y="1" width="298" height="417" rx="17" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>' +
  '<text x="150" y="197" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="40" fill="rgba(235,235,245,0.28)" text-anchor="middle">\u{1F0A0}</text>' +
  '<text x="150" y="232" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="12" fill="rgba(235,235,245,0.45)" text-anchor="middle">Arte n\u00E3o dispon\u00EDvel</text>' +
  '</svg>'
)
window.CARD_PLACEHOLDER_SVG = CARD_PLACEHOLDER_SVG

window.escapeHTML = escapeHTML
window.apiFetch = apiFetch
window.BRL = BRL
window.safeSetText = safeSetText
window.safeSetHTML = safeSetHTML
window.setNumericText = setNumericText
window.formatManaCost = formatManaCost
window.mercadiaToast = mercadiaToast
window.mercadiaConfirm = mercadiaConfirm
