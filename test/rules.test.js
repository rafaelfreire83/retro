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
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
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

function newBoard(fs, uid, { anonymous = false, token = TOKEN } = {}) {
  const b = writeBatch(fs)
  b.set(doc(fs, 'boards/b1'), {
    title: 'Retro',
    anonymous,
    createdAt: serverTimestamp(),
    timer: { durationSec: 300, startedAt: null, stopped: false },
  })
  b.set(doc(fs, 'boards/b1/private/admin'), { token })
  b.set(doc(fs, `boards/b1/admins/${uid}`), { token })
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

  test('não dá para listar quadros', async () => {
    await newBoard(db('admin'), 'admin')
    const { getDocs, collection } = await import('firebase/firestore')
    await assertFails(getDocs(collection(db('x'), 'boards')))
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

  test('qualquer um reordena', async () => {
    await running()
    await addCard(db('p'), 'p', 'c1')
    await ended()
    await assertSucceeds(updateDoc(doc(db('outro'), 'boards/b1/cards/c1'), { order: 5 }))
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

  test('texto vazio ou longo demais é recusado', async () => {
    await running()
    await assertFails(addCard(db('p'), 'p', 'c1', { text: '' }))
    await assertFails(addCard(db('p'), 'p', 'c2', { text: 'x'.repeat(501) }))
  })
})
