const token = localStorage.getItem('mercadia_token')
if (!token && !window.location.pathname.includes('login.html')) {
  window.location.href = 'login.html'
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

const safeSetText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text }
const safeSetHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html }

function formatManaCost(cost) {
  if (!cost) return ''
  return cost.replace(/{([^}]+)}/g, (match, p1) => {
    let symbol = p1.toUpperCase().replace('/', '')
    return `<img src="https://svgs.scryfall.io/card-symbols/${symbol}.svg" alt="${match}" style="height: 16px; vertical-align: text-bottom; margin: 0 1px; filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.8));">`
  })
}