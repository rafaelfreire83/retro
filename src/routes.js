// Rotas por hash (#/b/<id>): funcionam no GitHub Pages, que não sabe redirecionar para o index.html
export function parseRoute() {
  const [path, search = ''] = window.location.hash.replace(/^#/, '').split('?')
  const match = path.match(/^\/b\/([\w-]+)/)
  return {
    isSuper: path === '/super',
    boardId: match?.[1] ?? null,
    adminToken: new URLSearchParams(search).get('admin'),
  }
}

export function boardLink(boardId, adminToken) {
  const base = `${window.location.origin}${window.location.pathname}#/b/${boardId}`
  return adminToken ? `${base}?admin=${encodeURIComponent(adminToken)}` : base
}
