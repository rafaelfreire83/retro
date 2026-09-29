import { useEffect, useState } from 'react'
import { setAdminToken } from './identity.js'
import { createBoard, watchMyBoards } from './data.js'
import { timerPhase, useNow } from './timer.js'

export default function Home() {
  const [title, setTitle] = useState('')
  const [anonymous, setAnonymous] = useState(true)
  const [minutes, setMinutes] = useState(5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mine, setMine] = useState([])

  useEffect(() => {
    let unsub = () => {}
    let alive = true
    watchMyBoards(setMine)
      .then((u) => (alive ? (unsub = u) : u()))
      .catch(() => {})
    return () => {
      alive = false
      unsub()
    }
  }, [])

  async function create(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { id, token } = await createBoard({ title, anonymous, minutes })
      setAdminToken(id, token)
      window.location.hash = `#/b/${id}`
    } catch {
      setError('Não foi possível criar a retrospectiva. Verifique a configuração do Firebase.')
      setBusy(false)
    }
  }

  return (
    <main className="home">
      <div className="home-stack">
        <form className="panel" onSubmit={create}>
          <h1>Nova retrospectiva</h1>
          <p className="muted">
            Crie o quadro e compartilhe o link com o time. Você será o administrador e decide quando o tempo começa.
          </p>
          <label className="field">
            <span>Título</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Sprint 42"
              maxLength={120}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Tempo para escrever (minutos)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
            <span>Cards anônimos</span>
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? 'Criando…' : 'Criar retrospectiva'}
          </button>
        </form>
        {mine.length > 0 && <MyBoards boards={mine} />}
      </div>
    </main>
  )
}

const STATUS = { waiting: 'Aguardando', running: 'Em andamento', ended: 'Encerrado o tempo' }

// Quadros que este navegador criou: facilita voltar como admin depois
function MyBoards({ boards }) {
  const now = useNow(1000)
  return (
    <section className="panel">
      <h2>Minhas retrospectivas</h2>
      <ul className="my-boards">
        {boards.map((b) => (
          <li key={b.id}>
            <a href={`#/b/${b.id}`}>
              <span>{b.title}</span>
              <span className="muted small">{STATUS[timerPhase(b.timer, now)]}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
