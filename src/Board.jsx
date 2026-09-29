import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { signIn } from './firebase.js'
import * as data from './data.js'
import { boardLink } from './routes.js'
import { getAdminToken, getName, setName as saveName } from './identity.js'

const COLUMNS = [
  { key: 'good', title: 'Pontos positivos', placeholder: 'O que funcionou bem?' },
  { key: 'improve', title: 'Pontos a melhorar', placeholder: 'O que podemos melhorar?' },
]
const ONLINE_WINDOW_MS = 75_000

export default function Board({ boardId }) {
  const [uid, setUid] = useState(null)
  const [board, setBoard] = useState(null)
  const [cards, setCards] = useState([])
  const [mine, setMine] = useState(() => new Set())
  const [isAdmin, setIsAdmin] = useState(false)
  const [beats, setBeats] = useState([])
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [name, setName] = useState(getName)
  // Diferença entre o relógio do servidor e o local, para a contagem bater em todos
  const [clockOffset, setClockOffset] = useState(0)
  const now = useNow() + clockOffset

  useEffect(() => {
    signIn()
      .then((user) => setUid(user.uid))
      .catch(() => setError('Não foi possível conectar ao Firebase'))
  }, [])

  useEffect(() => {
    if (!uid) return
    const missing = () => setError('Retrospectiva não encontrada ou encerrada')
    const unsubs = [
      data.watchBoard(boardId, setBoard, missing),
      data.watchCards(boardId, setCards),
      data.watchMine(boardId, uid, setMine),
      data.startPresence(boardId, uid, { onOnline: setBeats, onClockOffset: setClockOffset }),
    ]
    data.checkAdmin(boardId, uid, getAdminToken(boardId)).then(setIsAdmin)
    return () => unsubs.forEach((unsub) => unsub())
  }, [boardId, uid])

  if (error) {
    return (
      <main className="home">
        <div className="panel">
          <h1>{error}</h1>
          <a href="#/">Criar uma nova retrospectiva</a>
        </div>
      </main>
    )
  }
  if (!board) return <main className="home muted">Conectando…</main>

  const needsName = !board.anonymous && !name.trim()
  const phase = timerPhase(board.timer, now)
  const online = beats.filter((t) => now - t < ONLINE_WINDOW_MS).length
  const byColumn = (column) =>
    cards
      .filter((c) => c.column === column)
      .map((c) => ({ ...c, author: board.anonymous ? null : c.author, mine: mine.has(c.id) }))

  // Toda escrita passa pelas regras do Firestore; se recusar (ex.: o tempo acabou), avisa
  const run = (promise) =>
    promise.catch(() => {
      setFlash('Não foi possível salvar. O tempo pode ter acabado ou você não tem permissão.')
      setTimeout(() => setFlash(''), 4000)
    })

  function moveCard(column, activeId, overId) {
    const list = byColumn(column)
    const from = list.findIndex((c) => c.id === activeId)
    const to = list.findIndex((c) => c.id === overId)
    if (from < 0 || to < 0) return
    const moved = arrayMove(list, from, to)
    const prev = moved[to - 1]
    const next = moved[to + 1]
    // Ordem fracionária: só o card movido é gravado
    const order =
      prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next.order - 1
    setCards((all) => all.map((c) => (c.id === activeId ? { ...c, order } : c)).sort((a, b) => a.order - b.order))
    run(data.moveCard(boardId, activeId, order))
  }

  const timerActions = {
    setDuration: (minutes) => run(data.setDuration(boardId, minutes)),
    start: (minutes) => run(data.startTimer(boardId, minutes)),
    addMinute: () => run(data.addMinute(boardId)),
    stop: () => run(data.stopTimer(boardId)),
  }

  return (
    <div className="board">
      <header className="topbar">
        <div>
          <h1>{board.title}</h1>
          <p className="muted small">
            {board.anonymous ? 'Modo anônimo' : 'Cards identificados'} · {online}{' '}
            {online === 1 ? 'pessoa' : 'pessoas'} online
          </p>
        </div>
        <div className="topbar-side">
          <TimerBanner timer={board.timer} phase={phase} now={now} isAdmin={isAdmin} actions={timerActions} />
          {!board.anonymous && (
            <label className="field inline">
              <span>Seu nome</span>
              <input
                value={name}
                maxLength={60}
                placeholder="Como quer aparecer"
                onChange={(e) => {
                  setName(e.target.value)
                  saveName(e.target.value)
                }}
              />
            </label>
          )}
        </div>
      </header>

      {isAdmin && (
        <AdminBar
          key={board.title}
          board={board}
          onUpdate={(patch) => run(data.updateBoard(boardId, patch))}
          onClose={() => run(data.closeBoard(boardId))}
        />
      )}

      {flash && <p className="notice">{flash}</p>}
      {needsName && phase === 'running' && (
        <p className="notice">Informe seu nome acima para adicionar cards.</p>
      )}

      <div className="columns">
        {COLUMNS.map((col) => (
          <Column
            key={col.key}
            column={col}
            cards={byColumn(col.key)}
            canAdd={!needsName && phase === 'running'}
            lockedText={LOCKED_TEXT[phase]}
            isAdmin={isAdmin}
            running={phase === 'running'}
            onEdit={(cardId, text) => run(data.editCard(boardId, cardId, text))}
            onAdd={(text) =>
              run(data.addCard(boardId, uid, { column: col.key, text, author: board.anonymous ? null : name }))
            }
            onDelete={(cardId) => run(data.deleteCard(boardId, cardId))}
            onMove={(a, b) => moveCard(col.key, a, b)}
          />
        ))}
      </div>
    </div>
  )
}

const LOCKED_TEXT = {
  waiting: 'Aguardando o admin iniciar o tempo…',
  ended: 'Tempo encerrado',
}

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  return now
}

const endsAt = (timer) => timer.startedAt.toMillis() + timer.durationSec * 1000

function timerPhase(timer, now) {
  if (!timer.startedAt) return 'waiting'
  if (timer.stopped) return 'ended'
  return now < endsAt(timer) ? 'running' : 'ended'
}

function formatTime(totalSec) {
  const sec = Math.max(0, Math.ceil(totalSec))
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

function TimerBanner({ timer, phase, now, isAdmin, actions }) {
  const [minutes, setMinutes] = useState(String(timer.durationSec / 60))
  const shown =
    phase === 'running' ? (endsAt(timer) - now) / 1000 : phase === 'ended' ? 0 : timer.durationSec
  const label = {
    waiting: 'Aguardando o início',
    running: 'Tempo restante',
    ended: 'Tempo encerrado',
  }[phase]
  const urgent = phase === 'running' && shown <= 30

  return (
    <section className={`timer timer-${phase}${urgent ? ' urgent' : ''}`}>
      <div>
        <span className="timer-label">{label}</span>
        <span className="timer-clock">{formatTime(shown)}</span>
      </div>
      {isAdmin && (
        <div className="timer-actions">
          {phase === 'running' ? (
            <>
              <button onClick={actions.addMinute}>+1 min</button>
              <button onClick={actions.stop}>Parar</button>
            </>
          ) : (
            <>
              <label className="field inline-min">
                <span className="small">Minutos</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  onBlur={() => actions.setDuration(minutes)}
                />
              </label>
              <button className="primary" onClick={() => actions.start(minutes)}>
                {phase === 'ended' ? 'Iniciar novamente' : 'Iniciar'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function AdminBar({ board, onUpdate, onClose }) {
  const [title, setTitle] = useState(board.title)
  const [copied, setCopied] = useState('')
  const [closing, setClosing] = useState(false)
  const teamLink = boardLink(board.id)

  async function copy(label, text) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      window.prompt('Copie o link:', text)
    }
  }

  return (
    <section className="adminbar">
      <strong>Administração</strong>
      <input
        className="title-input"
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== board.title && onUpdate({ title: title.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-label="Título"
      />
      <label className="toggle">
        <input
          type="checkbox"
          checked={board.anonymous}
          onChange={(e) => onUpdate({ anonymous: e.target.checked })}
        />
        <span>Anônimo</span>
      </label>
      <button onClick={() => copy('time', teamLink)}>
        {copied === 'time' ? 'Copiado!' : 'Copiar link do time'}
      </button>
      <button onClick={() => copy('admin', boardLink(board.id, getAdminToken(board.id)))}>
        {copied === 'admin' ? 'Copiado!' : 'Copiar link de admin'}
      </button>
      <button
        className="danger"
        disabled={closing}
        onClick={() => {
          if (
            window.confirm(
              'Encerrar a retrospectiva? O link deixará de funcionar e todos os cards serão apagados.',
            )
          ) {
            setClosing(true)
            onClose()
          }
        }}
      >
        {closing ? 'Encerrando…' : 'Encerrar retrospectiva'}
      </button>
    </section>
  )
}

function Column({ column, cards, canAdd, lockedText, isAdmin, running, onEdit, onAdd, onDelete, onMove }) {
  const [text, setText] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = useMemo(() => cards.map((c) => c.id), [cards])

  function submit(e) {
    e.preventDefault()
    if (!text.trim() || !canAdd) return
    onAdd(text)
    setText('')
  }

  return (
    <section className={`column column-${column.key}`}>
      <h2>
        {column.title} <span className="count">{cards.length}</span>
      </h2>
      <form onSubmit={submit} className="add">
        <textarea
          value={text}
          rows={2}
          maxLength={500}
          placeholder={canAdd || !lockedText ? column.placeholder : lockedText}
          disabled={!canAdd}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e)
          }}
        />
        <button className="primary" disabled={!canAdd || !text.trim()}>
          Adicionar
        </button>
      </form>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => over && active.id !== over.id && onMove(active.id, over.id)}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="cards">
            {cards.map((card) => (
              <Card
                key={card.id}
                card={card}
                // Mesma regra do servidor: fora do tempo, só o admin mexe nos cards
                canDelete={running ? card.mine || isAdmin : isAdmin}
                canEdit={running ? card.mine : isAdmin}
                onDelete={() => onDelete(card.id)}
                onEdit={(text) => onEdit(card.id, text)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {cards.length === 0 && <p className="muted small empty">Nenhum card ainda.</p>}
    </section>
  )
}

function Card({ card, canDelete, canEdit, onDelete, onEdit }) {
  const [draft, setDraft] = useState(null)
  const editing = draft !== null && canEdit
  // Enquanto edita, o card não arrasta (senão espaço/setas do teclado moveriam o card)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: editing,
  })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const stop = (e) => e.stopPropagation()

  function save() {
    const text = draft.trim()
    if (text && text !== card.text) onEdit(text)
    setDraft(null)
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`card${isDragging ? ' dragging' : ''}${card.mine ? ' mine' : ''}${editing ? ' editing' : ''}`}
      {...attributes}
      {...(editing ? {} : listeners)}
    >
      {editing ? (
        <textarea
          className="edit"
          value={draft}
          rows={3}
          maxLength={500}
          autoFocus
          onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              save()
            }
            if (e.key === 'Escape') setDraft(null)
          }}
        />
      ) : (
        <p>{card.text}</p>
      )}
      <footer>
        <span className="muted small">{card.author || (card.mine ? 'Você' : '')}</span>
        <span className="card-actions" onPointerDown={stop} onKeyDown={stop}>
          {editing ? (
            <>
              <button className="link muted" onClick={() => setDraft(null)}>
                Cancelar
              </button>
              <button className="link accent" onClick={save}>
                Salvar
              </button>
            </>
          ) : (
            <>
              {canEdit && (
                <button className="link accent" onClick={() => setDraft(card.text)}>
                  Editar
                </button>
              )}
              {canDelete && (
                <button
                  className="link"
                  onClick={() => window.confirm('Remover este card?') && onDelete()}
                >
                  Remover
                </button>
              )}
            </>
          )}
        </span>
      </footer>
    </li>
  )
}
