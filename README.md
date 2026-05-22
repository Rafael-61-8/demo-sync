# demo-sync

Lê Google Docs de resumos de demo de uma pasta no Drive e cria interações automáticas no Ploomes CRM.

## Pré-requisitos

- Node.js 18+
- Projeto no Google Cloud com as APIs ativadas:
  - Google Drive API
  - Google Docs API
  - Google Calendar API
- Credenciais OAuth2 (Client ID + Secret)

## Setup

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar .env

```bash
cp .env.example .env
```

Preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` com as credenciais do Google Cloud.

### 3. Autenticar com Google

```bash
npm run auth
```

Abrirá um link no terminal. Acesse, autorize e cole o código. O `GOOGLE_REFRESH_TOKEN` será exibido para adicionar no `.env`.

### 4. Testar agora

```bash
npm run now
```

### 5. Rodar com cron automático

```bash
npm start
# Roda todo dia às 21h por padrão
```

### 6. Deploy na VPS (pm2)

```bash
npm run build
pm2 start dist/index.js --name demo-sync
pm2 save
```

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `GOOGLE_CLIENT_ID` | Client ID do OAuth2 |
| `GOOGLE_CLIENT_SECRET` | Client Secret do OAuth2 |
| `GOOGLE_REFRESH_TOKEN` | Token gerado pelo `npm run auth` |
| `DRIVE_FOLDER_ID` | ID da pasta no Google Drive |
| `PLOOMES_USER_KEY` | Chave da API do Ploomes |
| `CRON_SCHEDULE` | Expressão cron (padrão: `0 21 * * *`) |
| `TZ` | Fuso horário (padrão: `America/Sao_Paulo`) |

## Logs

- Docs processados: `data/processed.json`
- Empresas não encontradas aparecem no log para revisão manual
