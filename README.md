# Retrospectiva

Quadro de retrospectiva em tempo real: **Pontos positivos** e **Pontos a melhorar**.

**Acesse:** https://rafaelfreire83.github.io/retro/

- React (Vite), publicado como site estático no **GitHub Pages**
- **Firebase** (plano grátis): Firestore guarda os dados e sincroniza em tempo real;
  login anônimo identifica cada navegador, sem cadastro
- As permissões ficam em [`firestore.rules`](firestore.rules): só o admin mexe no quadro e no
  tempo, cards só entram com o tempo correndo, e assim por diante

## Como usar

1. Na página inicial, dê um título, defina os minutos e escolha se os cards serão anônimos.
2. Você cai no quadro como **admin**. Use **Copiar link do time** e mande para o pessoal.
3. No timer (canto superior direito) o admin clica **Iniciar** quando quiser. Antes disso
   ninguém escreve. Durante a contagem (visível para todos) os cards ficam liberados; o admin
   pode dar **+1 min** ou **Parar**. Quando o tempo acaba a escrita trava, e dá para
   **Iniciar novamente**.
4. Só o admin arrasta os cards para reordenar — a ordem sincroniza para todos.
5. Com o tempo correndo, cada um edita e remove os próprios cards (o admin pode remover
   qualquer um). Com o tempo encerrado, só o admin edita ou remove.
6. O admin pode renomear, ligar/desligar o anonimato e copiar o **link de admin** para abrir
   em outro dispositivo.
7. **Colunas:** o quadro começa com "Pontos positivos" e "Pontos a melhorar". O admin adiciona
   colunas com **+ Coluna** (até 8), muda de posição com ◀ ▶, renomeia com ✎ e remove com ×
   (com confirmação — os cards da coluna são apagados).
8. **Votação:** em "Pontos a melhorar" (e em qualquer coluna em que o admin ligar 🗳), cada
   pessoa dá um voto por card (▲) para escolher o que atacar na próxima sprint. O mais votado
   ganha destaque e o admin pode **Ordenar por votos**. Card votado não pode ser removido — nem a
   coluna que tiver cards votados; eles só somem ao encerrar a retrospectiva.
9. **Encerrar retrospectiva** apaga o quadro e todos os cards; o link deixa de funcionar.

Qualquer pessoa pode criar a própria retrospectiva e ser admin dela. A página inicial mostra
**Minhas retrospectivas** — as criadas naquele navegador — para voltar como admin depois.

### Super Admin

Em [`#/super`](https://rafaelfreire83.github.io/retro/#/super), com login Google, o dono do
sistema vê todas as retrospectivas abertas (status, colunas, cards, pessoas online) e pode
abrir, entrar como admin ou encerrar qualquer uma. O acesso é liberado pelas regras do
Firestore só para o e-mail definido em `isSuperAdmin()` em `firestore.rules`.

No modo anônimo o nome não é gravado e o dono de cada card fica num registro que só o
próprio autor consegue ler — por isso cada um vê "Você" só nos seus cards.

## Publicar (uma vez)

### 1. Firebase

1. Crie um projeto em https://console.firebase.google.com (o Analytics pode ficar desligado).
2. **Authentication > Método de login**: ative **Anônimo**.
3. **Firestore Database > Criar banco de dados**: modo de produção, na região que preferir.
4. **Firestore > Regras**: cole o conteúdo de `firestore.rules` e publique.
   (Ou, com o CLI: `npx firebase login`, `npx firebase use --add` e `npm run deploy:rules`.)
5. **Configurações do projeto > Seus apps > Web (`</>`)**: registre um app e copie
   `apiKey`, `authDomain`, `projectId` e `appId`.
6. **Authentication > Método de login**: ative também **Google** (usado só pelo Super Admin).
7. **Authentication > Configurações > Domínios autorizados**: adicione `<usuario>.github.io`.

### 2. GitHub Pages

1. Suba este projeto para um repositório no GitHub (branch `main`).
2. **Settings > Secrets and variables > Actions > Variables**: crie
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` e
   `VITE_FIREBASE_APP_ID` com os valores do passo 1.5. (A config web do Firebase não é
   segredo — quem protege os dados são as regras.)
3. **Settings > Pages > Source**: escolha **GitHub Actions**.
4. A cada push na `main`, o workflow `.github/workflows/deploy.yml` gera o build e publica em
   `https://<usuario>.github.io/<repositorio>/`.

## Desenvolvimento

```bash
npm install
npm run dev:local    # emuladores do Firebase + app em http://localhost:5180 (sem projeto real)
npm run test:rules   # testa as regras de segurança no emulador
npm run dev          # app contra o Firebase real (precisa de .env.local, veja .env.example)
```

Os emuladores precisam de Java 17+.
