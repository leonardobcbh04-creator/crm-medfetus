# CRM Obstétrico

Primeira versão completa de um sistema web para clínica obstétrica, com frontend em React, backend em Node.js e banco local SQLite.

## Estrutura do projeto

```text
crm-obstetrico/
  frontend/   -> interface React
  backend/    -> API Node.js + SQLite
```

## O que já está pronto

- tela de login simples;
- dashboard inicial;
- tela principal com kanban;
- tela de cadastro de paciente;
- tela de configuração de exames;
- API local funcionando com rotas básicas;
- banco SQLite com seed automático;
- pacientes e exames de exemplo para teste.

## Tecnologias escolhidas

- frontend: React + TypeScript + Vite;
- backend: Node.js + Express;
- banco de dados: SQLite com `better-sqlite3`.

## Como rodar localmente

Antes de tudo, você precisa ter o `Node.js` instalado no computador.

### 1. Verificar se o Node está instalado

Abra o terminal e rode:

```bash
node -v
npm -v
```

Se aparecer uma versão, pode continuar.

### 2. Instalar dependências

Na pasta do projeto:

```bash
npm install
```

### 3. Rodar o backend

Em um terminal:

```bash
npm run dev:backend
```

O backend deve subir em `http://localhost:4000`.

### 4. Rodar o frontend

Em outro terminal:

```bash
npm run dev:frontend
```

O frontend deve abrir em `http://localhost:5173`.

## Login inicial para teste

- e-mail: `admin@clinica.com`
- senha: `123456`

## Seed do banco

O banco é criado automaticamente ao iniciar o backend pela primeira vez.

Se quiser resetar os dados de exemplo:

```bash
npm run seed
```

## Arquitetura pronta para WhatsApp Business API

O sistema ja ficou preparado para uma integracao futura, sem envio real ativo neste momento.

Ja existem:

- camada separada de mensageria;
- tabela de templates;
- tabela de logs de envio;
- configuracao central para provider externo futuro.

Documentacao simples:

- [docs/whatsapp-business-integration.md](C:\Users\Léo\Desktop\Projetos\docs\whatsapp-business-integration.md)

## Fluxo sugerido para testar

1. Faça login.
2. Veja o dashboard.
3. Abra o kanban e confira os pacientes de exemplo.
4. Cadastre uma nova paciente.
5. Abra a tela de configuração de exames.
6. Edite uma janela de exame.
7. Volte ao kanban e veja os alertas.

## Observação importante

Neste ambiente em que estou trabalhando, o `Node.js` não está instalado, então eu consegui montar toda a estrutura e os arquivos do projeto, mas não consegui executar `npm install`, subir o servidor nem validar o build automaticamente daqui.

Assim que você instalar o Node na sua máquina, eu consigo te ajudar no próximo passo com qualquer erro de dependência, execução ou build que aparecer.
