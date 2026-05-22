import 'dotenv/config'
import cron from 'node-cron'
import { syncDemos } from './workflows/sync-demos'
import { startServer } from './server'

const SCHEDULE = process.env.CRON_SCHEDULE || '0 21 * * *'

startServer()

console.log('🚀 demo-sync iniciado')
console.log(`📅 Agendamento: ${SCHEDULE} (${process.env.TZ || 'America/Sao_Paulo'})`)

if (process.argv.includes('--now')) {
  console.log('▶️  Executando agora (--now) — todos os docs não processados')
  syncDemos({ last24h: false }).catch(console.error)
} else {
  cron.schedule(SCHEDULE, () => {
    console.log('⏰ Cron disparado — processando docs das últimas 24h')
    syncDemos({ last24h: true }).catch(console.error)
  }, { timezone: process.env.TZ || 'America/Sao_Paulo' })

  console.log('✅ Aguardando próxima execução...')
}
