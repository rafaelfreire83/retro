import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db, signIn } from './firebase.js'

const DEFAULT_MINUTES = 5
export const MAX_COLUMNS = 8
export const DEFAULT_COLUMNS = {
  good: { title: 'Pontos positivos', color: 'good', order: 0 },
  improve: { title: 'Pontos a melhorar', color: 'improve', order: 1 },
}
const EXTRA_COLORS = ['blue', 'purple', 'pink', 'teal', 'yellow', 'gray']
// Lotes pequenos para caber no limite de leituras das regras por batch
const CHUNK = 10

const boardRef = (id, fs = db) => doc(fs, 'boards', id)
const sub = (id, name, fs = db) => collection(fs, 'boards', id, name)

// Colunas do quadro em ordem (quadros antigos não têm o campo e usam as padrão)
export function columnsOf(board) {
  return Object.entries(board.columns ?? DEFAULT_COLUMNS)
    .map(([id, col]) => ({ id, ...col }))
    .sort((a, b) => a.order - b.order)
}

export const toSeconds = (minutes) =>
  Math.round(Math.max(1, Math.min(120, Number(minutes) || DEFAULT_MINUTES)) * 60)

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function createBoard({ title, anonymous, minutes }) {
  const user = await signIn()
  const ref = doc(collection(db, 'boards'))
  const token = randomToken()
  const batch = writeBatch(db)
  batch.set(ref, {
    title: title.trim().slice(0, 120) || 'Retrospectiva',
    anonymous: Boolean(anonymous),
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    columns: DEFAULT_COLUMNS,
    timer: { durationSec: toSeconds(minutes), startedAt: null, stopped: false },
  })
  batch.set(doc(ref, 'private', 'admin'), { token })
  batch.set(doc(ref, 'admins', user.uid), { token })
  await batch.commit()
  return { id: ref.id, token }
}

// Já é admin, ou vira admin apresentando o token do link de admin
export async function checkAdmin(boardId, uid, token) {
  const ref = doc(sub(boardId, 'admins'), uid)
  try {
    if ((await getDoc(ref)).exists()) return true
    if (!token) return false
    await setDoc(ref, { token })
    return true
  } catch {
    return false
  }
}

export function watchBoard(boardId, onData, onMissing) {
  return onSnapshot(
    boardRef(boardId),
    (snap) => {
      if (!snap.exists()) return onMissing()
      // 'estimate' evita startedAt nulo enquanto o horário do servidor não volta
      onData({ id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) })
    },
    onMissing,
  )
}

// Quadros criados neste navegador (o login anônimo fica salvo entre visitas)
export async function watchMyBoards(onData) {
  const user = await signIn()
  return onSnapshot(query(collection(db, 'boards'), where('createdBy', '==', user.uid)), (snap) =>
    onData(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
        .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()),
    ),
  )
}

export function addColumn(board, title) {
  const columns = columnsOf(board)
  const used = new Set(columns.map((c) => c.color))
  const color = EXTRA_COLORS.find((c) => !used.has(c)) ?? EXTRA_COLORS[columns.length % EXTRA_COLORS.length]
  const order = Math.max(...columns.map((c) => c.order)) + 1
  const id = doc(collection(db, 'x')).id.slice(0, 8)
  return updateBoard(board.id, {
    columns: { ...toMap(columns), [id]: { title: title.trim().slice(0, 40), color, order } },
  })
}

export function renameColumn(board, columnId, title) {
  const columns = toMap(columnsOf(board))
  columns[columnId] = { ...columns[columnId], title: title.trim().slice(0, 40) }
  return updateBoard(board.id, { columns })
}

// Apaga os cards da coluna e depois a própria coluna
export async function removeColumn(board, columnId, cardIds) {
  await deleteCardsAndOwners(board.id, cardIds)
  const columns = toMap(columnsOf(board).filter((c) => c.id !== columnId))
  await updateBoard(board.id, { columns })
}

function toMap(columns) {
  return Object.fromEntries(columns.map(({ id, title, color, order }) => [id, { title, color, order }]))
}

async function deleteCardsAndOwners(boardId, cardIds, fs = db) {
  for (let i = 0; i < cardIds.length; i += CHUNK) {
    const batch = writeBatch(fs)
    for (const id of cardIds.slice(i, i + CHUNK)) {
      batch.delete(doc(sub(boardId, 'cards', fs), id))
      batch.delete(doc(sub(boardId, 'owners', fs), id))
    }
    await batch.commit()
  }
}

export function watchCards(boardId, onData) {
  return onSnapshot(query(sub(boardId, 'cards'), orderBy('order')), (snap) =>
    onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  )
}

// Ids dos cards que eu criei (o dono fica fora do card para manter o anonimato)
export function watchMine(boardId, uid, onData) {
  return onSnapshot(query(sub(boardId, 'owners'), where('uid', '==', uid)), (snap) =>
    onData(new Set(snap.docs.map((d) => d.id))),
  )
}

export async function addCard(boardId, uid, { column, text, author }) {
  const ref = doc(sub(boardId, 'cards'))
  const batch = writeBatch(db)
  batch.set(ref, {
    column,
    text: text.trim().slice(0, 500),
    author: author?.trim().slice(0, 60) || null,
    order: Date.now(),
    createdAt: serverTimestamp(),
  })
  batch.set(doc(sub(boardId, 'owners'), ref.id), { uid })
  await batch.commit()
}

export const editCard = (boardId, cardId, text) =>
  updateDoc(doc(sub(boardId, 'cards'), cardId), { text: text.trim().slice(0, 500) })

export const moveCard = (boardId, cardId, order) =>
  updateDoc(doc(sub(boardId, 'cards'), cardId), { order })

export function deleteCard(boardId, cardId) {
  const batch = writeBatch(db)
  batch.delete(doc(sub(boardId, 'cards'), cardId))
  batch.delete(doc(sub(boardId, 'owners'), cardId))
  return batch.commit()
}

export const updateBoard = (boardId, patch) => updateDoc(boardRef(boardId), patch)

export const setDuration = (boardId, minutes) =>
  updateBoard(boardId, { 'timer.durationSec': toSeconds(minutes) })

export const startTimer = (boardId, minutes) =>
  updateBoard(boardId, {
    'timer.durationSec': toSeconds(minutes),
    'timer.startedAt': serverTimestamp(),
    'timer.stopped': false,
  })

export const addMinute = (boardId) => updateBoard(boardId, { 'timer.durationSec': increment(60) })
export const stopTimer = (boardId) => updateBoard(boardId, { 'timer.stopped': true })

// Encerrar apaga tudo: cards, donos, presença, admins e o próprio quadro.
// `fs` permite que o super admin encerre usando a conexão dele.
export async function closeBoard(boardId, fs = db) {
  const cards = await getDocs(sub(boardId, 'cards', fs))
  const presence = await getDocs(sub(boardId, 'presence', fs))
  const admins = await getDocs(sub(boardId, 'admins', fs))
  await deleteCardsAndOwners(boardId, cards.docs.map((d) => d.id), fs)
  for (let i = 0; i < presence.docs.length; i += CHUNK) {
    const batch = writeBatch(fs)
    for (const d of presence.docs.slice(i, i + CHUNK)) batch.delete(d.ref)
    await batch.commit()
  }
  const batch = writeBatch(fs)
  batch.delete(doc(sub(boardId, 'private', fs), 'admin'))
  for (const d of admins.docs) batch.delete(d.ref)
  batch.delete(boardRef(boardId, fs))
  await batch.commit()
}

// --- Super admin ---

export function watchAllBoards(fs, onData, onError) {
  return onSnapshot(
    collection(fs, 'boards'),
    (snap) =>
      onData(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
          .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
      ),
    onError,
  )
}

export async function boardStats(fs, boardId) {
  const since = new Date(Date.now() - 75_000)
  const [cards, online] = await Promise.all([
    getCountFromServer(sub(boardId, 'cards', fs)),
    getCountFromServer(query(sub(boardId, 'presence', fs), where('lastSeen', '>', since))),
  ])
  return { cards: cards.data().count, online: online.data().count }
}

export async function readAdminToken(fs, boardId) {
  return (await getDoc(doc(sub(boardId, 'private', fs), 'admin'))).get('token')
}

// Presença: cada navegador grava um batimento com o horário do servidor.
// O mesmo batimento serve para calcular a diferença entre o relógio local e o do servidor.
export function startPresence(boardId, uid, { onOnline, onClockOffset }) {
  const ref = doc(sub(boardId, 'presence'), uid)
  let sentAt = 0
  const beat = () => {
    sentAt = Date.now()
    setDoc(ref, { lastSeen: serverTimestamp() }).catch(() => {})
  }
  const unsubMine = onSnapshot(ref, (snap) => {
    const lastSeen = snap.get('lastSeen')
    if (!snap.metadata.hasPendingWrites && lastSeen && sentAt) {
      onClockOffset(lastSeen.toMillis() - (sentAt + Date.now()) / 2)
      sentAt = 0
    }
  })
  const unsubAll = onSnapshot(sub(boardId, 'presence'), (snap) =>
    onOnline(snap.docs.map((d) => d.get('lastSeen')?.toMillis() ?? 0)),
  )
  beat()
  const timer = setInterval(beat, 30_000)
  const leave = () => deleteDoc(ref).catch(() => {})
  window.addEventListener('pagehide', leave)
  return () => {
    clearInterval(timer)
    unsubMine()
    unsubAll()
    window.removeEventListener('pagehide', leave)
    leave()
  }
}
