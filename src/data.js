import {
  collection,
  deleteDoc,
  doc,
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
// Lotes pequenos para caber no limite de leituras das regras por batch
const CHUNK = 10

const boardRef = (id) => doc(db, 'boards', id)
const sub = (id, name) => collection(db, 'boards', id, name)

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

// Encerrar apaga tudo: cards, donos, presença, admins e o próprio quadro
export async function closeBoard(boardId) {
  const cards = await getDocs(sub(boardId, 'cards'))
  const presence = await getDocs(sub(boardId, 'presence'))
  const admins = await getDocs(sub(boardId, 'admins'))
  const cardIds = cards.docs.map((d) => d.id)
  for (let i = 0; i < cardIds.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const id of cardIds.slice(i, i + CHUNK)) {
      batch.delete(doc(sub(boardId, 'cards'), id))
      batch.delete(doc(sub(boardId, 'owners'), id))
    }
    await batch.commit()
  }
  for (let i = 0; i < presence.docs.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const d of presence.docs.slice(i, i + CHUNK)) batch.delete(d.ref)
    await batch.commit()
  }
  const batch = writeBatch(db)
  batch.delete(doc(sub(boardId, 'private'), 'admin'))
  for (const d of admins.docs) batch.delete(d.ref)
  batch.delete(boardRef(boardId))
  await batch.commit()
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
