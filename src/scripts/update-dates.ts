import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { getAuthClient } from '../tools/google-auth'

// Versão com janela de busca maior para docs antigos
async function findEventWide(docTitle: string, docDate: string) {
  try {
    const auth = await getAuthClient()
    const calendar = google.calendar({ version: 'v3', auth })
    const center = new Date(docDate)
    const timeMin = new Date(center.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString() // 60 dias antes
    const timeMax = new Date(center.getTime() + 7  * 24 * 60 * 60 * 1000).toISOString()

    const res = await calendar.events.list({
      calendarId: 'primary', timeMin, timeMax,
      singleEvents: true, maxResults: 200, orderBy: 'startTime'
    })

    function norm(s: string) {
      return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s]/g,'').trim()
    }
    const na = norm(docTitle)
    let best: { start: string; score: number } | null = null

    for (const e of res.data.items || []) {
      const nb = norm(e.summary || '')
      let score = 0
      if (na === nb) score = 100
      else if (na.includes(nb) || nb.includes(na)) score = 85
      else {
        const wa = na.split(/\s+/), wb = nb.split(/\s+/).filter((w: string) => w.length > 2)
        const m = wb.filter((w: string) => wa.some((a: string) => a.includes(w) || w.includes(a))).length
        score = (m / Math.max(wb.length, 1)) * 70
      }
      const start = e.start?.dateTime || e.start?.date || ''
      if (score >= 60 && (!best || score > best.score)) best = { start, score }
    }
    return best?.start || null
  } catch { return null }
}

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

async function run() {
  console.log('🔍 Buscando registros para atualizar datas...')

  const { data: logs, error } = await sb
    .from('sync_logs')
    .select('id, doc_title, created_at, doc_date')
    .order('created_at', { ascending: false })

  if (error || !logs) {
    console.error('Erro ao buscar registros:', error)
    return
  }

  console.log(`📋 ${logs.length} registros encontrados`)

  let updated = 0
  let notFound = 0
  let skipped = 0

  // Agrupa por doc_title para não buscar o mesmo evento múltiplas vezes
  const seen = new Map<string, string | null>()

  for (const log of logs) {
    if (!log.doc_title) { skipped++; continue }

    let eventStart: string | null

    if (seen.has(log.doc_title)) {
      eventStart = seen.get(log.doc_title)!
    } else {
      eventStart = await findEventWide(log.doc_title, log.created_at)
      seen.set(log.doc_title, eventStart)

      if (eventStart) {
        console.log(`  ✅ "${log.doc_title}" → ${new Date(eventStart).toLocaleDateString('pt-BR')}`)
      } else {
        console.log(`  ⚠️  "${log.doc_title}" — evento não encontrado`)
      }

      await new Promise(r => setTimeout(r, 300))
    }

    if (eventStart) {
      const { error: updateError } = await sb
        .from('sync_logs')
        .update({ doc_date: eventStart })
        .eq('id', log.id)

      if (updateError) {
        console.error(`  ❌ Erro ao atualizar ${log.id}:`, updateError.message)
      } else {
        updated++
      }
    } else {
      notFound++
    }
  }

  console.log(`\n✅ Atualizados: ${updated} | ⚠️ Sem evento: ${notFound} | ⏭️ Pulados: ${skipped}`)
}

run().catch(console.error)
