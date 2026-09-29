import { useEffect, useState } from 'react'
import Home from './Home.jsx'
import Board from './Board.jsx'
import { configured } from './firebase.js'
import { parseRoute } from './routes.js'
import { setAdminToken } from './identity.js'

function readRoute() {
  const route = parseRoute()
  // O link de admin traz ?admin=<token>; guardamos e limpamos a URL
  if (route.boardId && route.adminToken) {
    setAdminToken(route.boardId, route.adminToken)
    window.history.replaceState(null, '', `#/b/${route.boardId}`)
  }
  return route.boardId
}

export default function App() {
  const [boardId, setBoardId] = useState(readRoute)

  useEffect(() => {
    const onChange = () => setBoardId(readRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  if (!configured) {
    return (
      <main className="home">
        <div className="panel">
          <h1>Firebase não configurado</h1>
          <p className="muted">
            Defina as variáveis VITE_FIREBASE_* (veja o README) e gere o build novamente.
          </p>
        </div>
      </main>
    )
  }
  return boardId ? <Board key={boardId} boardId={boardId} /> : <Home />
}
