# Deploy no Render

## Visao simples

Para publicar o Medfetus fora do seu computador, a estrutura recomendada agora e:

- frontend React/Vite como `Static Site`
- backend Node/Express como `Web Service`
- banco SQLite em `Persistent Disk` do Render
- sincronizacao do Shosp e limpeza de logs rodando dentro da propria API

Essa abordagem preserva o sistema atual sem reescrever o banco agora.

## Quando vale migrar para Postgres

SQLite continua valido para um primeiro ambiente real se voce usar:

- uma unica instancia do backend
- um disco persistente
- os workers rodando dentro da API

Postgres passa a fazer mais sentido quando voce quiser:

- mais de uma instancia do backend
- background worker separado da API
- concorrencia maior
- escalabilidade maior

Para o estado atual do projeto, a recomendacao mais segura e **publicar primeiro com SQLite persistente**.

## 1. Preparar o GitHub

1. Crie um repositorio vazio no GitHub.
2. No terminal, na raiz do projeto:

```powershell
git init
git add .
git commit -m "Prepare production deploy on Render"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Se o repositorio ja existir, basta fazer:

```powershell
git add .
git commit -m "Prepare production deploy on Render"
git push
```

## 2. Variaveis importantes

Backend:

- `NODE_ENV=production`
- `DATABASE_URL=/var/data/clinic.sqlite`
- `CORS_ALLOWED_ORIGINS=https://SEU-FRONTEND.onrender.com`
- `RUN_BACKGROUND_WORKERS_IN_API=true`
- `SHOSP_USE_MOCK=false` quando quiser usar a API real
- `SHOSP_API_URL`
- `SHOSP_API_KEY`
- `SHOSP_ACCOUNT_ID`
- `SHOSP_SYNC_INTERVAL=300000`

Frontend:

- `VITE_API_BASE_URL=https://SEU-BACKEND.onrender.com/api`

## 3. Publicar no Render

### Opcao mais facil: Blueprint

1. Entre no Render.
2. Clique em `New` > `Blueprint`.
3. Conecte o repositorio do GitHub.
4. O Render vai ler o arquivo [C:\Users\Léo\Desktop\Projetos\render.yaml](C:\Users\Léo\Desktop\Projetos\render.yaml).
5. Antes de confirmar, preencha os valores marcados como `sync: false`.

### Servicos que serao criados

- `medfetus-backend`
- `medfetus-frontend`

## 4. Configurar o backend no Render

Confirme estes pontos no service `medfetus-backend`:

- runtime `Node`
- build command:

```text
npm install --workspaces
```

- start command:

```text
npm run start --workspace backend
```

- health check:

```text
/api/health
```

- persistent disk montado em:

```text
/var/data
```

## 5. Configurar o frontend no Render

No `medfetus-frontend`:

- build command:

```text
npm install --workspaces && npm run build --workspace frontend
```

- publish directory:

```text
frontend/dist
```

- variavel:

```text
VITE_API_BASE_URL=https://SEU-BACKEND.onrender.com/api
```

## 6. Primeiro acesso em producao

Depois do deploy:

1. abra a URL do frontend
2. faca login com o usuario admin existente
3. teste:
   - dashboard
   - clientes
   - pipeline
   - cadastro de paciente
   - detalhes da paciente
   - central de lembretes
   - relatorios
   - area administrativa
   - integracao com Shosp

## 7. Habilitar o Shosp real

No backend do Render:

- deixe `SHOSP_USE_MOCK=false`
- preencha:
  - `SHOSP_API_URL`
  - `SHOSP_API_KEY`
  - `SHOSP_ACCOUNT_ID`

Se a API exigir mais autenticacao, preencha tambem:

- `SHOSP_API_TOKEN`
- `SHOSP_USERNAME`
- `SHOSP_PASSWORD`

Depois clique em `Manual Deploy` > `Deploy latest commit` ou reinicie o servico.

## 8. Reverter para modo seguro

Se a integracao real der problema:

- altere `SHOSP_USE_MOCK=true`
- altere `SHOSP_SYNC_INTERVAL=0`
- redeploy ou restart no backend

Assim o CRM continua operando sem depender da API real do Shosp.

## 9. Como garantir acesso de varios usuarios

O sistema ja esta pronto para isso porque:

- o backend fica publicado em URL publica
- o frontend fica publicado em URL publica
- autenticacao por login e senha ja existe
- sessoes sao gravadas no banco
- usuarios e perfis ja existem

Para uso real da clinica:

- crie os usuarios pela `Area administrativa`
- use senhas individuais
- restrinja a area admin aos perfis corretos

## 10. Checklist final

Antes de liberar para a equipe:

1. validar login e logout
2. validar criacao de paciente
3. validar pipeline
4. validar mensagens e lembretes
5. validar relatorios
6. validar Shosp em mock
7. validar Shosp real com um sync manual pequeno
8. validar backup do disco persistente

## Fontes oficiais uteis

- [Render Blueprints](https://render.com/docs/blueprint-spec)
- [Render Persistent Disks](https://render.com/docs/disks)
- [Render Static Sites](https://render.com/docs/static-sites)
