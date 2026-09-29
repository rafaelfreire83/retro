import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { superAdmin } from './firebase.js'
import { boardStats, closeBoard, columnsOf, readAdminToken, watchAllBoards } from './data.js'
import { boardLink } from './routes.js'
import { endsAt, formatTime, timerPhase, useNow } from './timer.js'

async function fetchStats(fs, boards) {
  const entries = await Promise.all(
    boards.map(async (b) => [b.id, await boardStats(fs, b.id).catch(() => null)]),
  )
  return Object.fromEntries(entries)
}

const STATUS = { waiting: 'Aguardando', running: 'Em andamento', ended: 'Tempo encerrado' }

// Acesso liberado pelas regras do Firestore só para a conta Google do dono (isSuperAdmin)
export default function SuperAdmin() {
  const sa = superAdmin()
  const [user, setUser] = useState(undefined)
  const [boards, setBoards] = useState(null)
  const [denied, setDenied] = useState(false)
  const [stats, setStats] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const now = useNow(1000)

  useEffect(() => onAuthStateChanged(sa.auth, setUser), [sa.auth])

  useEffect(() => {
    if (!user) return
    return watchAllBoards(
      sa.db,
      (list) => {
        setDenied(false)
        setBoards(list)
      },
      () => setDenied(true),
    )
  }, [user, sa.db])

  useEffect(() => {
    if (!boards) return
    let alive = true
    fetchStats(sa.db, boards).then((s) => alive && setStats(s))
    return () => {
      alive = false
    }
  }, [boards, sa.db])

  async function openAsAdmin(board) {
    try {
      const token = await readAdminToken(sa.db, board.id)
      window.open(boardLink(board.id, token), '_blank', 'noopener')
    } catch {
      setError('Não foi possível ler o link de admin.')
    }
  }

  async function close(board) {
    const count = stats[board.id]?.cards
    const detail = count ? ` Os ${count} cards serão apagados.` : ''
    if (!window.confirm(`Encerrar "${board.title}"?${detail} O link deixará de funcionar.`)) return
    setBusy(board.id)
    try {
      await closeBoard(board.id, sa.db)
    } catch {
      setError(`Não foi possível encerrar "${board.title}".`)
    }
    setBusy('')
  }

  if (user === undefined) return <main className="home muted">Carregando…</main>

  if (!user) {
    return (
      <main className="home">
        <div className="panel">
          <h1>Super Admin</h1>
          <p className="muted">Entre com a conta Google autorizada para gerenciar as retrospectivas.</p>
          <button
            className="primary"
            onClick={() => sa.signIn().catch(() => setError('Não foi possível entrar com o Google.'))}
          >
            Entrar com Google
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </main>
    )
  }

  if (denied) {
    return (
      <main className="home">
        <div className="panel">
          <h1>Acesso restrito</h1>
          <p className="muted">A conta {user.email} não tem permissão de super admin.</p>
          <button onClick={sa.signOut}>Sair</button>
        </div>
      </main>
    )
  }

  return (
    <div className="board">
      <header className="topbar">
        <div>
          <h1>Super Admin</h1>
          <p className="muted small">
            {boards ? `${boards.length} ${boards.length === 1 ? 'retrospectiva aberta' : 'retrospectivas abertas'}` : 'Carregando…'}
          </p>
        </div>
        <div className="topbar-side">
          <span className="muted small">{user.email}</span>
          <button onClick={() => boards && fetchStats(sa.db, boards).then(setStats)}>Atualizar números</button>
          <button onClick={sa.signOut}>Sair</button>
        </div>
      </header>

      {error && <p className="notice">{error}</p>}

      {boards?.length === 0 && <p className="muted">Nenhuma retrospectiva aberta.</p>}

      {boards?.length > 0 && (
        <div className="table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Retrospectiva</th>
                <th>Criada em</th>
                <th>Status</th>
                <th className="num">Colunas</th>
                <th className="num">Cards</th>
                <th className="num">Online</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {boards.map((b) => {
                const phase = timerPhase(b.timer, now)
                const s = stats[b.id]
                return (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.title}</strong>
                      <div className="muted small">{b.anonymous ? 'Anônimo' : 'Identificado'}</div>
                    </td>
                    <td>{b.createdAt?.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>
                      <span className={`pill pill-${phase}`}>{STATUS[phase]}</span>
                      {phase === 'running' && (
                        <div className="muted small">{formatTime((endsAt(b.timer) - now) / 1000)} restantes</div>
                      )}
                    </td>
                    <td className="num">{columnsOf(b).length}</td>
                    <td className="num">{s ? s.cards : '–'}</td>
                    <td className="num">{s ? s.online : '–'}</td>
                    <td className="actions">
                      <a href={boardLink(b.id)} target="_blank" rel="noreferrer">
                        Abrir
                      </a>
                      <button className="link accent" onClick={() => openAsAdmin(b)}>
                        Abrir como admin
                      </button>
                      <button className="link" disabled={busy === b.id} onClick={() => close(b)}>
                        {busy === b.id ? 'Encerrando…' : 'Encerrar'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
