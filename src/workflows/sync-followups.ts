import 'dotenv/config'
import { listNewDocs, readDocContent } from '../tools/google-drive'
import { searchCompany, getDeal, createFollowUpInteraction } from '../tools/ploomes'
import { loadProcessed, saveEntry } from '../memory/processed-store'
import { createRun, updateRun, logOutput, logDoc, getProcessedDocIds } from '../memory/supabase-store'

const FOLLOWUPS_FOLDER_ID = process.env.DRIVE_FOLLOWUPS_FOLDER_ID!

interface ParsedFollowUp {
  empresa: string
  pessoa: string
  whatsapp: string[]
  emails: { assunto: string; corpo: string }[]
  raw: string
}

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

function parseFollowUpDoc(content: string): ParsedFollowUp | null {
  try {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean)

    // Busca EMPRESA: e PESSOA: em qualquer posição da linha (Tactiq pode juntar metadados na mesma linha)
    const empresaLine = lines.find(l => l.includes('EMPRESA:'))
    const pessoaLine = lines.find(l => l.includes('PESSOA:'))

    const empresa = empresaLine?.split('EMPRESA:')[1]?.split('\n')[0]?.trim() || ''
    const pessoa = pessoaLine?.split('PESSOA:')[1]?.split('\n')[0]?.trim() || ''

    if (!empresa && !pessoa) return null

    // Extrai WhatsApp — mensagem pode ter múltiplas linhas
    const whatsapp: string[] = []
    for (let i = 1; i <= 3; i++) {
      const lineIdx = lines.findIndex(l => l.startsWith(`WHATSAPP ${i}:`))
      if (lineIdx === -1) continue

      const firstPart = lines[lineIdx].replace(`WHATSAPP ${i}:`, '').trim()
      const extraLines: string[] = []
      for (let j = lineIdx + 1; j < lines.length; j++) {
        const next = lines[j]
        if (next.startsWith(`WHATSAPP ${i + 1}:`) || next.startsWith('EMAIL ') || next.startsWith('---')) break
        extraLines.push(next)
      }
      const fullMsg = [firstPart, ...extraLines].filter(Boolean).join('\n')
      if (fullMsg) whatsapp.push(fullMsg)
    }

    // Extrai Emails — corpo pode ser multilinha
    const emails: { assunto: string; corpo: string }[] = []
    for (let i = 1; i <= 3; i++) {
      const lineIdx = lines.findIndex(l => l.includes(`EMAIL ${i} -`))
      if (lineIdx === -1) continue

      const headerLine = lines[lineIdx]
      const parts = headerLine.split('EMAIL ' + i + ' -')[1]?.split('| Corpo:') || []
      const assunto = parts[0]?.replace('Assunto:', '').trim() || ''

      // Corpo: primeira parte após "| Corpo:" + linhas seguintes até o próximo EMAIL ou "---"
      const firstBodyPart = parts[1]?.trim() || ''
      const extraLines: string[] = []
      for (let j = lineIdx + 1; j < lines.length; j++) {
        const next = lines[j]
        if (next.includes(`EMAIL ${i + 1} -`) || next.startsWith('---') || next.startsWith('EMAIL ')) break
        extraLines.push(next)
      }
      const corpo = [firstBodyPart, ...extraLines].filter(Boolean).join('\n')

      if (assunto) emails.push({ assunto, corpo })
    }

    return { empresa, pessoa, whatsapp, emails, raw: content }
  } catch {
    return null
  }
}

function buildFollowUpContent(parsed: ParsedFollowUp): string {
  const wLines = parsed.whatsapp.map((msg, i) => `${i + 1}. ${msg}`).join('\n\n')
  const eLines = parsed.emails.map((e, i) =>
    `${i + 1}. Assunto: ${e.assunto}\n${e.corpo}`
  ).join('\n\n')

  return `SUGESTÕES DE FOLLOW-UP\n\nPessoa: ${parsed.pessoa} | Empresa: ${parsed.empresa}\n\n--- WHATSAPP ---\n\n${wLines}\n\n--- EMAIL ---\n\n${eLines}`
}

export async function syncFollowUps(options: { last24h?: boolean; hoursBack?: number } = {}): Promise<void> {
  const runId = await createRun()
  const log = makeLogger(runId)

  let successCount = 0
  let notFoundCount = 0
  let errorCount = 0

  log.info(`\n${'='.repeat(50)}`)
  log.info(`[sync-followups] Iniciando ${new Date().toLocaleString('pt-BR')}${options.last24h ? ' (últimas 24h)' : ''}`)
  log.info('='.repeat(50))

  try {
    // Usa prefixo diferente no processed-store para não conflitar com sync-demos
    const processedIds = await getProcessedDocIds()
    const docs = await listNewDocs(FOLLOWUPS_FOLDER_ID, processedIds, options.last24h, options.hoursBack)

    if (docs.length === 0) {
      log.info('[sync-followups] Nenhum follow-up novo encontrado.')
      await updateRun(runId!, { finished_at: new Date().toISOString(), total: 0, success_count: 0, not_found_count: 0, error_count: 0, status: 'done' })
      return
    }

    log.info(`[sync-followups] ${docs.length} follow-up(s) novo(s) encontrado(s)`)

    for (const doc of docs) {
      log.info(`\n→ Processando follow-up: "${doc.name}"`)

      try {
        const content = await readDocContent(doc.id)
        const parsed = parseFollowUpDoc(content)

        if (!parsed || (!parsed.empresa && !parsed.pessoa)) {
          log.warn('  ⚠️  Não foi possível identificar empresa/pessoa — pulando')
          saveEntry({ docId: doc.id, docName: doc.name, empresa: '', interactionId: null, processedAt: new Date().toISOString(), status: 'error', error: 'sem empresa/pessoa' }, 'followups')
          errorCount++
          continue
        }

        log.info(`  Empresa: "${parsed.empresa}" | Pessoa: "${parsed.pessoa}"`)
        log.info(`  Follow-ups: ${parsed.whatsapp.length} WhatsApp, ${parsed.emails.length} email`)

        // Busca contato no Ploomes (empresa do prospect)
        const contact = await searchCompany(parsed.empresa)

        if (!contact) {
          log.warn(`  ❌ Empresa não encontrada no Ploomes: "${parsed.empresa}"`)
          saveEntry({ docId: doc.id, docName: doc.name, empresa: parsed.empresa, interactionId: null, processedAt: new Date().toISOString(), status: 'not_found' }, 'followups')
          await logDoc(runId!, { doc_id: doc.id, doc_title: doc.name, empresa: parsed.empresa, pessoa: parsed.pessoa, status: 'not_found' })
          notFoundCount++
          continue
        }

        log.info(`  ✓ Contato: "${contact.Name}" (score: ${contact.score})`)

        const deal = await getDeal(contact.Id)
        const dealId = deal?.Id || contact.LastDealId || null

        const followUpContent = buildFollowUpContent(parsed)

        const interactionId = await createFollowUpInteraction(
          contact.Id,
          dealId,
          followUpContent,
          doc.name,
          doc.createdTime
        )

        if (interactionId) {
          log.success(`  ✅ Follow-up enviado ao Ploomes: ${interactionId} → ${contact.Name}`)
          saveEntry({ docId: doc.id, docName: doc.name, empresa: contact.Name, interactionId, processedAt: new Date().toISOString(), status: 'success' }, 'followups')
          await logDoc(runId!, { doc_id: doc.id, doc_title: doc.name, empresa: contact.Name, pessoa: parsed.pessoa, status: 'success', interaction_id: interactionId, contact_id: contact.Id, doc_date: doc.createdTime })
          successCount++
        } else {
          log.error(`  ❌ Falha ao criar interação no Ploomes`)
          saveEntry({ docId: doc.id, docName: doc.name, empresa: contact.Name, interactionId: null, processedAt: new Date().toISOString(), status: 'error', error: 'falha ao criar interação' }, 'followups')
          errorCount++
        }

        await new Promise(r => setTimeout(r, 1000))

      } catch (err: any) {
        log.error(`  ❌ Erro: ${err.message}`)
        saveEntry({ docId: doc.id, docName: doc.name, empresa: '', interactionId: null, processedAt: new Date().toISOString(), status: 'error', error: err.message }, 'followups')
        errorCount++
      }
    }

    const total = successCount + notFoundCount + errorCount
    log.info(`\n[sync-followups] Concluído — ${total} docs | ✅ ${successCount} | ⚠️ ${notFoundCount} | ❌ ${errorCount}`)
    await updateRun(runId!, { finished_at: new Date().toISOString(), total, success_count: successCount, not_found_count: notFoundCount, error_count: errorCount, status: 'done' })

  } catch (err: any) {
    log.error(`[sync-followups] Erro fatal: ${err.message}`)
    await updateRun(runId!, { finished_at: new Date().toISOString(), total: successCount + notFoundCount + errorCount, success_count: successCount, not_found_count: notFoundCount, error_count: errorCount, status: 'error' })
    throw err
  }
}
