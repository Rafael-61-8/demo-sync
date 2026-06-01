import 'dotenv/config'
import cron from 'node-cron'
import { syncDemos, syncSingleDoc } from './workflows/sync-demos'
import { syncFollowUps } from './workflows/sync-followups'
import { startServer } from './server'
import { supabase } from './tools/supabase'
import { closeStaleRuns } from './memory/supabase-store'

const SCHEDULE = process.env.CRON_SCHEDULE || '0 21 * * *'
const SCHEDULE_FOLLOWUPS = process.env.CRON_FOLLOWUPS_SCHEDULE || '10 21 * * *'

startServer()
closeStaleRuns()

console.log('🚀 demo-sync iniciado')
console.log(`📅 Agendamento: ${SCHEDULE} (${process.env.TZ || 'America/Sao_Paulo'})`)

// Assina inserções na tabela manual_triggers para processar docs manualmente
supabase
  .channel('manual-triggers')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'manual_triggers' }, async (payload) => {
    const { id, doc_id } = payload.new as { id: string; doc_id: string }
    console.log(`📨 Trigger manual recebido: doc_id=${doc_id}`)
    syncSingleDoc(doc_id, id).catch(console.error)
  })
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') console.log('🔔 Realtime: escutando manual_triggers')
  })

if (process.argv.includes('--now')) {
  console.log('▶️  Executando agora (--now) — todos os docs não processados')
  syncDemos({ last24h: false }).catch(console.error)
} else if (process.argv.includes('--followups')) {
  console.log('▶️  Executando follow-ups agora (--followups)')
  syncFollowUps({ last24h: false }).catch(console.error)
} else {
  const tz = process.env.TZ || 'America/Sao_Paulo'

  cron.schedule(SCHEDULE, () => {
    console.log('⏰ Cron disparado — processando docs das últimas 24h')
    syncDemos({ last24h: true }).catch(console.error)
  }, { timezone: tz })

  if (process.env.DRIVE_FOLLOWUPS_FOLDER_ID) {
    cron.schedule(SCHEDULE_FOLLOWUPS, () => {
      console.log('⏰ Cron follow-ups disparado — processando follow-ups das últimas 24h')
      syncFollowUps({ last24h: true }).catch(console.error)
    }, { timezone: tz })
    console.log(`📅 Follow-ups: ${SCHEDULE_FOLLOWUPS} (${tz})`)
  }

  console.log('✅ Aguardando próxima execução...')
}
