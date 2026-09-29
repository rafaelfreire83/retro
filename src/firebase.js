import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const env = import.meta.env
const useEmulator = env.VITE_USE_EMULATOR === 'true'

// A config web do Firebase não é segredo: quem protege os dados são as regras (firestore.rules)
const config = useEmulator
  ? { apiKey: 'demo', authDomain: 'demo-retro.firebaseapp.com', projectId: 'demo-retro' }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    }

export const configured = Boolean(config.projectId && config.apiKey)

function connect(name) {
  const app = initializeApp(configured ? config : { apiKey: 'missing', projectId: 'missing' }, name)
  const auth = getAuth(app)
  const db = getFirestore(app)
  if (useEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
  }
  return { auth, db }
}

export const { auth, db } = connect()

// O super admin usa uma conexão separada: o login Google dele não substitui
// o login anônimo que o navegador usa nos quadros
let superConn = null
export function superAdmin() {
  superConn ??= connect('super')
  return {
    ...superConn,
    signIn: () => signInWithPopup(superConn.auth, new GoogleAuthProvider()),
    signOut: () => signOut(superConn.auth),
  }
}

// Login anônimo: cada navegador ganha um uid que fica salvo entre visitas
let pending = null
export function signIn() {
  pending ??= auth.authStateReady().then(async () => {
    if (!auth.currentUser) await signInAnonymously(auth)
    return auth.currentUser
  })
  return pending
}
