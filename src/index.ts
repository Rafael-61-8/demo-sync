import 'dotenv/config'
import cron from 'node-cron'
import { syncDemos, syncSingleDoc } from './workflows/sync-demos'
import { syncFollowUps } from './workflows/sync-followups'
import { startServer } from './server'
import { supabase } from './tools/supabase'
import { closeStaleRuns, cleanOldOutputs } from './memory/supabase-store'
import { runCleanupDuplicates } from './scripts/cleanup-duplicates'

// Seg–Sex, 8h–17h55 (último disparo 17:55), horário de São Paulo
const SCHEDULE = process.env.CRON_SCHEDULE || '*/5 8-17 * * 1-5'
const SCHEDULE_FOLLOWUPS = process.env.CRON_FOLLOWUPS_SCHEDULE || '*/5 8-17 * * 1-5'

startServer()
closeStaleRuns()
cleanOldOutputs()

console.log('🚀 demo-sync iniciado')
console.log(`📅 Agendamento: ${SCHEDULE} (${process.env.TZ || 'America/Sao_Paulo'})`)

// Assina inserções na tabela manual_triggers para processar docs manualmente
supabase
  .channel('manual-triggers')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'manual_triggers' }, async (payload) => {
    const { id, doc_id } = payload.new as { id: string; doc_id: string }
    console.log(`📨 Trigger manual recebido: doc_id=${doc_id}`)
    if (doc_id === '__cleanup_dupes__') {
      console.log('🧹 Iniciando limpeza de interações duplicadas no Ploomes...')
      runCleanupDuplicates().catch(console.error)
    } else {
      syncSingleDoc(doc_id, id).catch(console.error)
    }
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
    cleanOldOutputs().catch(console.error)
    console.log('⏰ Cron disparado — verificando docs das últimas 48h')
    syncDemos({ hoursBack: 48 }).catch(console.error)
  }, { timezone: tz })

  if (process.env.DRIVE_FOLLOWUPS_FOLDER_ID) {
    cron.schedule(SCHEDULE_FOLLOWUPS, () => {
      console.log('⏰ Cron follow-ups disparado — verificando follow-ups das últimas 48h')
      syncFollowUps({ hoursBack: 48 }).catch(console.error)
    }, { timezone: tz })
    console.log(`📅 Follow-ups: ${SCHEDULE_FOLLOWUPS} (${tz})`)
  }

  console.log('✅ Aguardando próxima execução...')
}
