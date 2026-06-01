import 'dotenv/config'
import { listNewDocs, readDocContent, getDocMeta } from '../tools/google-drive'
import { parseDocContent, extractTitleName } from '../tools/doc-parser'
import { searchCompany, searchByEmail, getDeal, createInteraction, PloomesContact } from '../tools/ploomes'
import { findEventForDoc } from '../tools/google-calendar'
import { loadProcessed, saveEntry } from '../memory/processed-store'
import { createRun, updateRun, logOutput, logDoc, isRunning, updateTrigger, saveFollowUps } from '../memory/supabase-store'
import { generateFollowUps } from '../tools/follow-ups'

const FOLDER_ID = process.env.DRIVE_FOLDER_ID!

function makeLogger(runId: string | null) {
  const write = (msg: string, level: 'info' | 'warn' | 'error' | 'success') => {
    if (level === 'error') console.error(msg)
    else if (level === 'warn') console.warn(msg)
    else console.log(msg)
    if (runId) logOutput(runId, msg, level).catch(() => {})
  }
  return {
    info: (msg: string) => write(msg, 'info'),
    warn: (msg: string) => write(msg, 'warn'),
    error: (msg: string) => write(msg, 'error'),
    success: (msg: string) => write(msg, 'success'),
  }
}

// Busca empresa no Ploomes com múltiplas estratégias
async function findContact(
  empresa: string,
  docTitle: string,
  docDate: string,
  log: ReturnType<typeof makeLogger>
): Promise<{ contact: PloomesContact; strategy: string; eventDate?: string } | null> {

  // Estratégia 1: nome extraído do conteúdo JSON
  if (empresa) {
    const contact = await searchCompany(empresa)
    if (contact) return { contact, strategy: 'json' }
  }

  // Estratégia 2: nome extraído do título (parte após o "+")
  const titleName = extractTitleName(docTitle)
  if (titleName && titleName !== empresa) {
    log.info(`  [Estratégia 2] Tentando nome do título: "${titleName}"`)
    const contact = await searchCompany(titleName)
    if (contact) return { contact, strategy: 'title' }
  }

  // Estratégia 3: Google Calendar — emails + empresa do formulário + data do evento
  log.info(`  [Estratégia 3] Buscando evento no Google Agenda...`)
  const event = await findEventForDoc(docTitle, docDate)

  if (!event) {
    log.info(`  Nenhum evento correspondente encontrado no Agenda`)
    return null
  }

  const eventDate = event.start || undefined
  log.info(`  Evento: "${event.summary}"${eventDate ? ` | Data: ${new Date(eventDate).toLocaleDateString('pt-BR')}` : ''}`)

  // 3a: emails combinados (attendees + description), sem duplicatas
  const allEmails = [...new Set([...event.attendeeEmails, ...event.descriptionEmails])]
  if (allEmails.length > 0) {
    log.info(`  Emails encontrados: ${allEmails.join(', ')}`)
    for (const email of allEmails) {
      const contact = await searchByEmail(email)
      if (contact) return { contact, strategy: `email:${email}`, eventDate }
    }
  }

  // 3b: nome da empresa extraído do formulário de agendamento (description)
  if (event.companyName) {
    log.info(`  [Estratégia 3b] Empresa do formulário: "${event.companyName}"`)
    const contact = await searchCompany(event.companyName)
    if (contact) return { contact, strategy: `calendar-company:${event.companyName}`, eventDate }
  }

  return null
}

export async function syncDemos(options: { last24h?: boolean } = {}): Promise<void> {
  // Evita execução dupla caso o cron dispare com dois processos rodando simultaneamente
  const alreadyRunning = await isRunning()
  if (alreadyRunning) {
    console.warn('[sync-demos] ⚠️  Já existe uma execução em andamento — ignorando disparo duplicado')
    return
  }

  const runId = await createRun()
  const log = makeLogger(runId)

  let successCount = 0
  let notFoundCount = 0
  let errorCount = 0

  log.info(`\n${'='.repeat(50)}`)
  log.info(`[sync-demos] Iniciando ${new Date().toLocaleString('pt-BR')}${options.last24h ? ' (últimas 24h)' : ''}`)
  log.info('='.repeat(50))

  try {
    const { ids: processedIds } = loadProcessed()
    const docs = await listNewDocs(FOLDER_ID, processedIds, options.last24h)

    if (docs.length === 0) {
      log.info('[sync-demos] Nenhum doc novo encontrado.')
      if (runId) await updateRun(runId, { finished_at: new Date().toISOString(), total: 0, success_count: 0, not_found_count: 0, error_count: 0, status: 'done' })
      return
    }

    log.info(`[sync-demos] ${docs.length} doc(s) novo(s) encontrado(s)`)

    for (const doc of docs) {
      log.info(`\n→ Processando: "${doc.name}"`)

      try {
        const content = await readDocContent(doc.id)
        const parsed = parseDocContent(content, doc.name)
        log.info(`  Empresa: "${parsed.empresa}" | Pessoa: "${parsed.pessoa}" (via ${parsed.source})`)

        if (!parsed.resumo) {
          log.warn('  ⚠️  Resumo vazio — pulando')
          saveEntry({ docId: doc.id, docName: doc.name, empresa: parsed.empresa, interactionId: null, processedAt: new Date().toISOString(), status: 'error', error: 'resumo vazio' })
          if (runId) await logDoc(runId, { doc_id: doc.id, doc_title: doc.name, empresa: parsed.empresa, pessoa: parsed.pessoa, status: 'error', notes: 'resumo vazio', doc_date: doc.createdTime })
          errorCount++
          continue
        }

        // Busca multi-estratégia
        const result = await findContact(parsed.empresa, doc.name, doc.createdTime, log)

        if (!result) {
          log.warn(`  ❌ Empresa não encontrada no Ploomes após todas as estratégias`)
          saveEntry({ docId: doc.id, docName: doc.name, empresa: parsed.empresa, interactionId: null, processedAt: new Date().toISOString(), status: 'not_found' })
          if (runId) await logDoc(runId, { doc_id: doc.id, doc_title: doc.name, empresa: parsed.empresa, pessoa: parsed.pessoa, status: 'not_found', doc_date: doc.createdTime })
          notFoundCount++
          continue
        }

        const { contact, strategy, eventDate } = result
        const docDate = eventDate || doc.createdTime
        log.info(`  ✓ Encontrado via [${strategy}]: "${contact.Name}" (score: ${contact.score ?? 100})`)

        const deal = await getDeal(contact.Id)
        const dealId = deal?.Id || contact.LastDealId || null
        log.info(`  Deal: ${deal ? `"${deal.Title}" (${dealId})` : 'nenhum'}`)

        const interactionId = await createInteraction(
          contact.Id,
          dealId,
          parsed.resumo,
          parsed.empresa,
          parsed.pessoa,
          doc.name,
          doc.createdTime
        )

        if (interactionId) {
          log.success(`  ✅ Interação criada: ${interactionId} → ${contact.Name}`)

          // Gera follow-ups com Gemini em background (não bloqueia o fluxo)
          if (process.env.GEMINI_API_KEY && parsed.resumo) {
            generateFollowUps(parsed.resumo, parsed.empresa, parsed.pessoa).then(async followUps => {
              if (followUps) {
                log.info(`  💬 Follow-ups gerados (${followUps.whatsapp.length} WhatsApp, ${followUps.email.length} email)`)
                await saveFollowUps({ interaction_id: interactionId, empresa: contact.Name, pessoa: parsed.pessoa, whatsapp: followUps.whatsapp, email: followUps.email })
              }
            }).catch(() => {})
          }

          saveEntry({ docId: doc.id, docName: doc.name, empresa: contact.Name, interactionId, processedAt: new Date().toISOString(), status: 'success' })
          if (runId) await logDoc(runId, {
            doc_id: doc.id,
            doc_title: doc.name,
            empresa: contact.Name,
            pessoa: parsed.pessoa,
            status: 'success',
            interaction_id: interactionId,
            match_score: contact.score != null ? Math.round(contact.score) : null,
            contact_id: contact.Id,
            search_strategy: strategy,
            doc_date: docDate
          })
          successCount++
        } else {
          log.error(`  ❌ Falha ao criar interação`)
          saveEntry({ docId: doc.id, docName: doc.name, empresa: contact.Name, interactionId: null, processedAt: new Date().toISOString(), status: 'error', error: 'falha ao criar interação' })
          if (runId) await logDoc(runId, {
            doc_id: doc.id,
            doc_title: doc.name,
            empresa: contact.Name,
            pessoa: parsed.pessoa,
            status: 'error',
            notes: 'falha ao criar interação',
            contact_id: contact.Id,
            search_strategy: strategy,
            doc_date: docDate
          })
          errorCount++
        }

        await new Promise(r => setTimeout(r, 1000))

      } catch (err: any) {
        log.error(`  ❌ Erro inesperado: ${err.message}`)
        saveEntry({ docId: doc.id, docName: doc.name, empresa: '', interactionId: null, processedAt: new Date().toISOString(), status: 'error', error: err.message })
        if (runId) await logDoc(runId, { doc_id: doc.id, doc_title: doc.name, empresa: '', status: 'error', notes: err.message })
        errorCount++
      }
    }

    const total = successCount + notFoundCount + errorCount
    log.info(`\n[sync-demos] Concluído — ${total} docs | ✅ ${successCount} | ⚠️ ${notFoundCount} | ❌ ${errorCount}`)

    if (runId) {
      await updateRun(runId, {
        finished_at: new Date().toISOString(),
        total,
        success_count: successCount,
        not_found_count: notFoundCount,
        error_count: errorCount,
        status: 'done'
      })
    }

  } catch (err: any) {
    log.error(`[sync-demos] Erro fatal: ${err.message}`)
    if (runId) {
      await updateRun(runId, {
        finished_at: new Date().toISOString(),
        total: successCount + notFoundCount + errorCount,
        success_count: successCount,
        not_found_count: notFoundCount,
        error_count: errorCount,
        status: 'error'
      })
    }
    throw err
  }
}

// Processa um único documento manualmente (disparado pelo dashboard)
export async function syncSingleDoc(docId: string, triggerId: string): Promise<void> {
  const runId = await createRun()
  const log = makeLogger(runId)

  log.info(`\n${'='.repeat(50)}`)
  log.info(`[manual] Processando doc ${docId} — ${new Date().toLocaleString('pt-BR')}`)
  log.info('='.repeat(50))

  try {
    const meta = await getDocMeta(docId)
    const doc = { id: docId, name: meta.name, createdTime: meta.createdTime }
    log.info(`  Documento: "${doc.name}"`)

    const content = await readDocContent(docId)

    const parsed = parseDocContent(content, doc.name)
    log.info(`  Empresa: "${parsed.empresa}" | Pessoa: "${parsed.pessoa}" (via ${parsed.source})`)

    if (!parsed.resumo) {
      log.warn('  ⚠️  Resumo vazio — abortando')
      await updateRun(runId!, { finished_at: new Date().toISOString(), total: 1, error_count: 1, status: 'done' })
      await updateTrigger(triggerId, 'error', { error: 'resumo vazio' })
      return
    }

    const result = await findContact(parsed.empresa, doc.name, doc.createdTime, log)

    if (!result) {
      log.warn(`  ❌ Empresa não encontrada no Ploomes após todas as estratégias`)
      if (runId) await logDoc(runId, { doc_id: docId, doc_title: doc.name, empresa: parsed.empresa, pessoa: parsed.pessoa, status: 'not_found', doc_date: doc.createdTime })
      await updateRun(runId!, { finished_at: new Date().toISOString(), total: 1, not_found_count: 1, status: 'done' })
      await updateTrigger(triggerId, 'not_found', { empresa: parsed.empresa })
      return
    }

    const { contact, strategy, eventDate } = result
    const docDate = eventDate || doc.createdTime
    log.info(`  ✓ Encontrado via [${strategy}]: "${contact.Name}" (score: ${contact.score ?? 100})`)

    const deal = await getDeal(contact.Id)
    const dealId = deal?.Id || contact.LastDealId || null
    log.info(`  Deal: ${deal ? `"${deal.Title}" (${dealId})` : 'nenhum'}`)

    const interactionId = await createInteraction(
      contact.Id,
      dealId,
      parsed.resumo,
      parsed.empresa,
      parsed.pessoa,
      doc.name,
      docDate
    )

    if (interactionId) {
      log.success(`  ✅ Interação criada: ${interactionId} → ${contact.Name}`)

      if (process.env.GEMINI_API_KEY && parsed.resumo) {
        generateFollowUps(parsed.resumo, parsed.empresa, parsed.pessoa).then(async followUps => {
          if (followUps) {
            log.info(`  💬 Follow-ups gerados (${followUps.whatsapp.length} WhatsApp, ${followUps.email.length} email)`)
            await saveFollowUps({ interaction_id: interactionId, empresa: contact.Name, pessoa: parsed.pessoa, whatsapp: followUps.whatsapp, email: followUps.email })
          }
        }).catch(() => {})
      }

      if (runId) await logDoc(runId, {
        doc_id: docId,
        doc_title: doc.name,
        empresa: contact.Name,
        pessoa: parsed.pessoa,
        status: 'success',
        interaction_id: interactionId,
        match_score: contact.score != null ? Math.round(contact.score) : null,
        contact_id: contact.Id,
        search_strategy: strategy,
        doc_date: docDate
      })
      await updateRun(runId!, { finished_at: new Date().toISOString(), total: 1, success_count: 1, status: 'done' })
      await updateTrigger(triggerId, 'done', { contact: contact.Name, interactionId, dealId })
    } else {
      log.error(`  ❌ Falha ao criar interação`)
      if (runId) await logDoc(runId, { doc_id: docId, doc_title: doc.name, empresa: contact.Name, pessoa: parsed.pessoa, status: 'error', notes: 'falha ao criar interação', contact_id: contact.Id, search_strategy: strategy, doc_date: docDate })
      await updateRun(runId!, { finished_at: new Date().toISOString(), total: 1, error_count: 1, status: 'done' })
      await updateTrigger(triggerId, 'error', { error: 'falha ao criar interação' })
    }

  } catch (err: any) {
    log.error(`[manual] Erro: ${err.message}`)
    if (runId) await updateRun(runId, { finished_at: new Date().toISOString(), total: 1, error_count: 1, status: 'error' })
    await updateTrigger(triggerId, 'error', { error: err.message })
  }
}
