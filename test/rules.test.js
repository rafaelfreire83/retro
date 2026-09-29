// Roda com: npm run test:rules (sobe o emulador do Firestore)
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

const TOKEN = 'token-secreto-de-admin-123'
let env

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-retro',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})
after(() => env.cleanup())
beforeEach(() => env.clearFirestore())

const db = (uid) => env.authenticatedContext(uid).firestore()
const google = (uid, email) =>
  env
    .authenticatedContext(uid, { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } })
    .firestore()
const superDb = () => google('super', 'rafaelsfreire83@gmail.com')

const COLUMNS = {
  good: { title: 'Pontos positivos', color: 'good', order: 0, voting: false },
  improve: { title: 'Pontos a melhorar', color: 'improve', order: 1, voting: true },
}

function newBoard(fs, uid, { anonymous = false, token = TOKEN, id = 'b1', createdBy = uid } = {}) {
  const b = writeBatch(fs)
  b.set(doc(fs, `boards/${id}`), {
    title: 'Retro',
    anonymous,
    createdAt: serverTimestamp(),
    createdBy,
    columns: COLUMNS,
    timer: { durationSec: 300, startedAt: null, stopped: false },
  })
  b.set(doc(fs, `boards/${id}/private/admin`), { token })
  b.set(doc(fs, `boards/${id}/admins/${uid}`), { token })
  return b.commit()
}

function addCard(fs, uid, id, extra = {}) {
  const b = writeBatch(fs)
  b.set(doc(fs, `boards/b1/cards/${id}`), {
    column: 'good',
    text: 'texto',
    author: null,
    order: 1,
    createdAt: serverTimestamp(),
    ...extra,
  })
  b.set(doc(fs, `boards/b1/owners/${id}`), { uid })
  return b.commit()
}

// Coloca o quadro num estado de timer sem passar pelas regras
async function setTimer(timer) {
  await env.withSecurityRulesDisabled((ctx) =>
    updateDoc(doc(ctx.firestore(), 'boards/b1'), { timer }),
  )
}
const running = () =>
  setTimer({ durationSec: 300, startedAt: Timestamp.now(), stopped: false })
const ended = () =>
  setTimer({ durationSec: 60, startedAt: Timestamp.fromMillis(Date.now() - 120_000), stopped: false })

describe('quadro', () => {
  test('qualquer um logado cria um quadro e vira admin', async () => {
    await assertSucceeds(newBoard(db('admin'), 'admin'))
  })

  test('não dá para listar todos os quadros; só os que eu criei', async () => {
    await newBoard(db('admin'), 'admin')
    await assertFails(getDocs(collection(db('x'), 'boards')))
    await assertSucceeds(getDocs(query(collection(db('admin'), 'boards'), where('createdBy', '==', 'admin'))))
    await assertFails(getDocs(query(collection(db('x'), 'boards'), where('createdBy', '==', 'admin'))))
  })

  test('não dá para criar quadro em nome de outra pessoa', async () => {
    await assertFails(newBoard(db('admin'), 'admin', { createdBy: 'outro' }))
  })

  test('admin adiciona e remove colunas; participante não', async () => {
    await newBoard(db('admin'), 'admin')
    const extra = { ...COLUMNS, x1: { title: 'Ideias', color: 'blue', order: 2 } }
    await assertFails(updateDoc(doc(db('p'), 'boards/b1'), { columns: extra }))
    await assertSucceeds(updateDoc(doc(db('admin'), 'boards/b1'), { columns: extra }))
    await assertSucceeds(updateDoc(doc(db('admin'), 'boards/b1'), { columns: { x1: extra.x1 } }))
    await assertFails(updateDoc(doc(db('admin'), 'boards/b1'), { columns: {} }))
  })

  test('não dá para trocar o criador do quadro', async () => {
    await newBoard(db('admin'), 'admin')
    await assertFails(updateDoc(doc(db('admin'), 'boards/b1'), { createdBy: 'outro' }))
  })

  test('ninguém lê o token de admin', async () => {
    await newBoard(db('admin'), 'admin')
    await assertFails(getDoc(doc(db('admin'), 'boards/b1/private/admin')))
  })

  test('participante não altera o quadro; admin altera', async () => {
    await newBoard(db('admin'), 'admin')
    await assertFails(updateDoc(doc(db('p'), 'boards/b1'), { anonymous: true }))
    await assertSucceeds(updateDoc(doc(db('admin'), 'boards/b1'), { anonymous: true }))
  })

  test('admin inicia o tempo só com o horário do servidor', async () => {
    await newBoard(db('admin'), 'admin')
    const ref = doc(db('admin'), 'boards/b1')
    await assertFails(
      updateDoc(ref, { 'timer.startedAt': Timestamp.fromMillis(Date.now() + 3_600_000) }),
    )
    await assertSucceeds(updateDoc(ref, { 'timer.startedAt': serverTimestamp() }))
  })

  test('link de admin: token certo vira admin, errado não', async () => {
    await newBoard(db('admin'), 'admin')
    await assertFails(setDoc(doc(db('p'), 'boards/b1/admins/p'), { token: 'errado-errado-errado-1' }))
    await assertSucceeds(setDoc(doc(db('p2'), 'boards/b1/admins/p2'), { token: TOKEN }))
    await assertSucceeds(updateDoc(doc(db('p2'), 'boards/b1'), { title: 'Novo' }))
  })

  test('não dá para se promover a admin de outro uid', async () => {
    await newBoard(db('admin'), 'admin')
    await assertFails(setDoc(doc(db('p'), 'boards/b1/admins/outro'), { token: TOKEN }))
  })

  test('só o admin exclui o quadro', async () => {
    await newBoard(db('admin'), 'admin')
    await assertFails(deleteDoc(doc(db('p'), 'boards/b1')))
    await assertSucceeds(deleteDoc(doc(db('admin'), 'boards/b1')))
  })
})

describe('cards e tempo', () => {
  beforeEach(() => newBoard(db('admin'), 'admin'))

  test('antes de iniciar ninguém cria card', async () => {
    await assertFails(addCard(db('p'), 'p', 'c1'))
    await assertFails(addCard(db('admin'), 'admin', 'c1'))
  })

  test('com o tempo correndo cria; depois de encerrado não', async () => {
    await running()
    await assertSucceeds(addCard(db('p'), 'p', 'c1'))
    await ended()
    await assertFails(addCard(db('p'), 'p', 'c2'))
  })

  test('parar o tempo trava a escrita', async () => {
    await setTimer({ durationSec: 300, startedAt: Timestamp.now(), stopped: true })
    await assertFails(addCard(db('p'), 'p', 'c1'))
  })

  test('não dá para criar card em nome de outra pessoa', async () => {
    await running()
    await assertFails(addCard(db('p'), 'outro', 'c1'))
  })

  test('modo anônimo não aceita nome do autor', async () => {
    await updateDoc(doc(db('admin'), 'boards/b1'), { anonymous: true })
    await running()
    await assertFails(addCard(db('p'), 'p', 'c1', { author: 'Ana' }))
    await assertSucceeds(addCard(db('p'), 'p', 'c2'))
  })

  test('cada um só lê o próprio dono de card', async () => {
    await running()
    await addCard(db('p'), 'p', 'c1')
    await assertSucceeds(getDoc(doc(db('p'), 'boards/b1/owners/c1')))
    await assertFails(getDoc(doc(db('admin'), 'boards/b1/owners/c1')))
  })

  test('só o admin reordena os cards', async () => {
    await running()
    await addCard(db('p'), 'p', 'c1')
    await assertFails(updateDoc(doc(db('p'), 'boards/b1/cards/c1'), { order: 5 }))
    await assertFails(updateDoc(doc(db('outro'), 'boards/b1/cards/c1'), { order: 5 }))
    await assertSucceeds(updateDoc(doc(db('admin'), 'boards/b1/cards/c1'), { order: 5 }))
  })

  test('tempo correndo: autor edita e remove; admin remove mas não edita', async () => {
    await running()
    await addCard(db('p'), 'p', 'c1')
    await addCard(db('p'), 'p', 'c2')
    await assertFails(updateDoc(doc(db('outro'), 'boards/b1/cards/c1'), { text: 'x' }))
    await assertFails(updateDoc(doc(db('admin'), 'boards/b1/cards/c1'), { text: 'x' }))
    await assertSucceeds(updateDoc(doc(db('p'), 'boards/b1/cards/c1'), { text: 'novo' }))
    await assertFails(deleteDoc(doc(db('outro'), 'boards/b1/cards/c1')))
    await assertSucceeds(deleteDoc(doc(db('p'), 'boards/b1/cards/c1')))
    await assertSucceeds(deleteDoc(doc(db('admin'), 'boards/b1/cards/c2')))
  })

  test('tempo encerrado: só o admin edita e remove', async () => {
    await running()
    await addCard(db('p'), 'p', 'c1')
    await ended()
    await assertFails(updateDoc(doc(db('p'), 'boards/b1/cards/c1'), { text: 'novo' }))
    await assertFails(deleteDoc(doc(db('p'), 'boards/b1/cards/c1')))
    await assertSucceeds(updateDoc(doc(db('admin'), 'boards/b1/cards/c1'), { text: 'admin' }))
    await assertSucceeds(deleteDoc(doc(db('admin'), 'boards/b1/cards/c1')))
  })

  test('não dá para trocar a coluna ou o autor de um card', async () => {
    await running()
    await addCard(db('p'), 'p', 'c1')
    await assertFails(updateDoc(doc(db('p'), 'boards/b1/cards/c1'), { column: 'improve' }))
    await assertFails(updateDoc(doc(db('p'), 'boards/b1/cards/c1'), { author: 'Outro' }))
  })

  test('admin apaga cards e donos em lote (encerrar retrospectiva)', async () => {
    await running()
    for (let i = 0; i < 10; i++) await addCard(db(`p${i}`), `p${i}`, `c${i}`)
    const fs = db('admin')
    const b = writeBatch(fs)
    for (let i = 0; i < 10; i++) {
      b.delete(doc(fs, `boards/b1/cards/c${i}`))
      b.delete(doc(fs, `boards/b1/owners/c${i}`))
    }
    await assertSucceeds(b.commit())
    const end = writeBatch(fs)
    end.delete(doc(fs, 'boards/b1'))
    end.delete(doc(fs, 'boards/b1/private/admin'))
    end.delete(doc(fs, 'boards/b1/admins/admin'))
    await assertSucceeds(end.commit())
  })

  test('card só entra em coluna que existe', async () => {
    await running()
    await assertFails(addCard(db('p'), 'p', 'c1', { column: 'inexistente' }))
    await updateDoc(doc(db('admin'), 'boards/b1'), {
      columns: { ...COLUMNS, x1: { title: 'Ideias', color: 'blue', order: 2 } },
    })
    await assertSucceeds(addCard(db('p'), 'p', 'c2', { column: 'x1' }))
  })

  test('texto vazio ou longo demais é recusado', async () => {
    await running()
    await assertFails(addCard(db('p'), 'p', 'c1', { text: '' }))
    await assertFails(addCard(db('p'), 'p', 'c2', { text: 'x'.repeat(501) }))
  })
})

describe('super admin', () => {
  beforeEach(async () => {
    await newBoard(db('a1'), 'a1', { id: 'b1' })
    await newBoard(db('a2'), 'a2', { id: 'b2' })
  })

  test('lista todos os quadros e lê o token de admin', async () => {
    const snap = await assertSucceeds(getDocs(collection(superDb(), 'boards')))
    if (snap.size !== 2) throw new Error(`esperava 2 quadros, veio ${snap.size}`)
    await assertSucceeds(getDoc(doc(superDb(), 'boards/b1/private/admin')))
  })

  test('outra conta Google não é super admin', async () => {
    const other = google('x', 'alguem@gmail.com')
    await assertFails(getDocs(collection(other, 'boards')))
    await assertFails(getDoc(doc(other, 'boards/b1/private/admin')))
  })

  test('login anônimo não vira super admin mesmo com o e-mail no token', async () => {
    const fake = env
      .authenticatedContext('f', {
        email: 'rafaelsfreire83@gmail.com',
        email_verified: true,
        firebase: { sign_in_provider: 'anonymous' },
      })
      .firestore()
    await assertFails(getDocs(collection(fake, 'boards')))
  })

  test('encerra o quadro de outra pessoa', async () => {
    await setTimer({ durationSec: 300, startedAt: Timestamp.now(), stopped: false })
    await addCard(db('p'), 'p', 'c1')
    const fs = superDb()
    const cards = writeBatch(fs)
    cards.delete(doc(fs, 'boards/b1/cards/c1'))
    cards.delete(doc(fs, 'boards/b1/owners/c1'))
    await assertSucceeds(cards.commit())
    await assertSucceeds(getDocs(collection(fs, 'boards/b1/admins')))
    const end = writeBatch(fs)
    end.delete(doc(fs, 'boards/b1/private/admin'))
    end.delete(doc(fs, 'boards/b1/admins/a1'))
    end.delete(doc(fs, 'boards/b1'))
    await assertSucceeds(end.commit())
  })
})

function vote(fs, uid, cardId, on = true) {
  const b = writeBatch(fs)
  const v = doc(fs, `boards/b1/votes/${cardId}_${uid}`)
  if (on) b.set(v, { card: cardId, uid })
  else b.delete(v)
  b.update(doc(fs, `boards/b1/cards/${cardId}`), { votes: increment(on ? 1 : -1) })
  return b.commit()
}

describe('votação', () => {
  beforeEach(async () => {
    await newBoard(db('admin'), 'admin')
    await running()
    await addCard(db('p'), 'p', 'm1', { column: 'improve', votes: 0 })
    await addCard(db('p'), 'p', 'g1', { column: 'good', votes: 0 })
  })

  test('todos votam na coluna com votação; um voto por pessoa', async () => {
    await assertSucceeds(vote(db('a'), 'a', 'm1'))
    await assertSucceeds(vote(db('b'), 'b', 'm1'))
    await assertFails(vote(db('a'), 'a', 'm1'))
    const snap = await getDoc(doc(db('a'), 'boards/b1/cards/m1'))
    if (snap.get('votes') !== 2) throw new Error(`esperava 2 votos, veio ${snap.get('votes')}`)
  })

  test('tirar o voto desconta', async () => {
    await vote(db('a'), 'a', 'm1')
    await assertSucceeds(vote(db('a'), 'a', 'm1', false))
    await assertFails(vote(db('b'), 'b', 'm1', false))
  })

  test('não dá para mexer no contador sem registrar o voto', async () => {
    await assertFails(updateDoc(doc(db('a'), 'boards/b1/cards/m1'), { votes: 10 }))
    await assertFails(updateDoc(doc(db('a'), 'boards/b1/cards/m1'), { votes: increment(1) }))
  })

  test('não dá para votar em nome de outra pessoa', async () => {
    const fs = db('a')
    const b = writeBatch(fs)
    b.set(doc(fs, 'boards/b1/votes/m1_b'), { card: 'm1', uid: 'b' })
    b.update(doc(fs, 'boards/b1/cards/m1'), { votes: increment(1) })
    await assertFails(b.commit())
  })

  test('coluna sem votação não aceita voto', async () => {
    await assertFails(vote(db('a'), 'a', 'g1'))
  })

  test('card não nasce com votos', async () => {
    await assertFails(addCard(db('p'), 'p', 'm2', { column: 'improve', votes: 3 }))
  })

  test('card votado não pode ser apagado, nem pelo admin nem pelo autor', async () => {
    await vote(db('a'), 'a', 'm1')
    await assertFails(deleteDoc(doc(db('p'), 'boards/b1/cards/m1')))
    await assertFails(deleteDoc(doc(db('admin'), 'boards/b1/cards/m1')))
  })

  test('encerrando a retrospectiva, o admin apaga cards votados e os votos', async () => {
    await vote(db('a'), 'a', 'm1')
    const fs = db('admin')
    await assertSucceeds(updateDoc(doc(fs, 'boards/b1'), { closing: true }))
    await assertSucceeds(getDocs(collection(fs, 'boards/b1/votes')))
    const b = writeBatch(fs)
    b.delete(doc(fs, 'boards/b1/cards/m1'))
    b.delete(doc(fs, 'boards/b1/owners/m1'))
    b.delete(doc(fs, 'boards/b1/votes/m1_a'))
    await assertSucceeds(b.commit())
  })

  test('cada um só vê os próprios votos (o admin vê todos)', async () => {
    await vote(db('a'), 'a', 'm1')
    await assertSucceeds(getDoc(doc(db('a'), 'boards/b1/votes/m1_a')))
    await assertFails(getDoc(doc(db('b'), 'boards/b1/votes/m1_a')))
    await assertSucceeds(getDoc(doc(db('admin'), 'boards/b1/votes/m1_a')))
  })
})
