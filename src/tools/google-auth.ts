import { google } from 'googleapis'
import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'

const TOKEN_PATH = path.join(__dirname, '../../token.json')
const REDIRECT_URI = 'http://localhost:3000/callback'
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/calendar.readonly'
]

export async function getAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)

  if (refreshToken) {
    oauth2Client.setCredentials({ refresh_token: refreshToken })
    return oauth2Client
  }

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
    oauth2Client.setCredentials(token)
    return oauth2Client
  }

  throw new Error('Sem credenciais Google. Execute: npm run auth')
}

export async function runAuthFlow() {
  const clientId = process.env.GOOGLE_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  })

  console.log('\n🔐 Abrindo navegador para autorização...')
  console.log('\nSe não abrir automaticamente, acesse:\n')
  console.log(authUrl)
  console.log('\n⏳ Aguardando autorização na porta 3000...\n')

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:3000`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      if (error) {
        res.end('<h2>❌ Autorização negada. Pode fechar essa aba.</h2>')
        server.close()
        reject(new Error(error))
        return
      }

      if (code) {
        res.end('<h2>✅ Autorizado! Pode fechar essa aba e voltar ao terminal.</h2>')
        server.close()
        resolve(code)
      }
    })

    server.listen(3000, () => {
      const { exec } = require('child_process')
      exec(`start "" "${authUrl}"`)
    })

    server.on('error', reject)
  })

  const { tokens } = await oauth2Client.getToken(code)
  oauth2Client.setCredentials(tokens)

  const dir = path.dirname(TOKEN_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2))

  console.log('✅ Autenticado com sucesso!')
  if (tokens.refresh_token) {
    console.log(`\nAdicione no .env:\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`)
  }
}
