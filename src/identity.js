// Preferências locais do navegador (o id da pessoa vem do login anônimo do Firebase)
function read(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* modo privado: segue sem persistir */
  }
}

export const getName = () => read('retro-name') || ''
export const setName = (name) => write('retro-name', name)

export const getAdminToken = (boardId) => read(`retro-admin-${boardId}`)
export const setAdminToken = (boardId, token) => write(`retro-admin-${boardId}`, token)
