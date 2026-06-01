import 'dotenv/config'
import { listNewDocs, readDocContent } from '../tools/google-drive'
import { searchCompany, searchByEmail, getDeal, createInteraction } from '../tools/ploomes'
import { loadProcessed, saveEntry } from '../memory/processed-store'
import { createRun, updateRun, logOutput, logDoc } from '../memory/supabase-store'

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

    const empresaLine = lines.find(l => l.startsWith('EMPRESA:'))
    const pessoaLine = lines.find(l => l.startsWith('PESSOA:'))

    const empresa = empresaLine?.replace('EMPRESA:', '').trim() || ''
    const pessoa = pessoaLine?.replace('PESSOA:', '').trim() || ''

    if (!empresa && !pessoa) return null

    // Extrai WhatsApp
    const whatsapp: string[] = []
    for (let i = 1; i <= 3; i++) {
      const line = lines.find(l => l.startsWith(`WHATSAPP ${i}:`))
      if (line) whatsapp.push(line.replace(`WHATSAPP ${i}:`, '').trim())
    }

    // Extrai Emails
    const emails: { assunto: string; corpo: string }[] = []
    for (let i = 1; i <= 3; i++) {
      const line = lines.find(l => l.startsWith(`EMAIL ${i} -`))
      if (line) {
        const parts = line.replace(`EMAIL ${i} -`, '').split('| Corpo:')
        const assunto = parts[0]?.replace('Assunto:', '').trim() || ''
        const corpo = parts[1]?.trim() || ''
        if (assunto) emails.push({ assunto, corpo })
      }
    }

    return { empresa, pessoa, whatsapp, emails, raw: content }
  } catch {
    return null
  }
}

function buildFollowUpContent(parsed: ParsedFollowUp): string {
  const wLines = parsed.whatsapp.map((msg, i) => `📱 WhatsApp ${i + 1}: ${msg}`).join('\n')
  const eLines = parsed.emails.map((e, i) =>
    `📧 Email ${i + 1}\nAssunto: ${e.assunto}\n${e.corpo}`
  ).join('\n\n')

  return `🤖 SUGESTÕES DE FOLLOW-UP\n\nPessoa: ${parsed.pessoa}\nEmpresa: ${parsed.empresa}\n\n━━━ WHATSAPP ━━━\n${wLines}\n\n━━━ EMAIL ━━━\n${eLines}`
}

export async function syncFollowUps(options: { last24h?: boolean } = {}): Promise<void> {
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
    const processedKey = 'followups'
    const { ids: processedIds } = loadProcessed(processedKey)
    const docs = await listNewDocs(FOLLOWUPS_FOLDER_ID, processedIds, options.last24h)

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
          saveEntry({ docId: doc.id, docName: doc.name, empresa: '', interactionId: null, processedAt: new Date().toISOString(), status: 'error', error: 'sem empresa/pessoa' }, processedKey)
          errorCount++
          continue
        }

        log.info(`  Empresa: "${parsed.empresa}" | Pessoa: "${parsed.pessoa}"`)
        log.info(`  Follow-ups: ${parsed.whatsapp.length} WhatsApp, ${parsed.emails.length} email`)

        // Busca contato no Ploomes (empresa do prospect)
        const contact = await searchCompany(parsed.empresa)

        if (!contact) {
          log.warn(`  ❌ Empresa não encontrada no Ploomes: "${parsed.empresa}"`)
          saveEntry({ docId: doc.id, docName: doc.name, empresa: parsed.empresa, interactionId: null, processedAt: new Date().toISOString(), status: 'not_found' }, processedKey)
          await logDoc(runId!, { doc_id: doc.id, doc_title: doc.name, empresa: parsed.empresa, pessoa: parsed.pessoa, status: 'not_found' })
          notFoundCount++
          continue
        }

        log.info(`  ✓ Contato: "${contact.Name}" (score: ${contact.score})`)

        const deal = await getDeal(contact.Id)
        const dealId = deal?.Id || contact.LastDealId || null

        const followUpContent = buildFollowUpContent(parsed)

        const interactionId = await createInteraction(
          contact.Id,
          dealId,
          followUpContent,
          parsed.empresa,
          parsed.pessoa,
          doc.name,
          doc.createdTime
        )

        if (interactionId) {
          log.success(`  ✅ Follow-up enviado ao Ploomes: ${interactionId} → ${contact.Name}`)
          saveEntry({ docId: doc.id, docName: doc.name, empresa: contact.Name, interactionId, processedAt: new Date().toISOString(), status: 'success' }, processedKey)
          await logDoc(runId!, { doc_id: doc.id, doc_title: doc.name, empresa: contact.Name, pessoa: parsed.pessoa, status: 'success', interaction_id: interactionId, contact_id: contact.Id, doc_date: doc.createdTime })
          successCount++
        } else {
          log.error(`  ❌ Falha ao criar interação no Ploomes`)
          saveEntry({ docId: doc.id, docName: doc.name, empresa: contact.Name, interactionId: null, processedAt: new Date().toISOString(), status: 'error', error: 'falha ao criar interação' }, processedKey)
          errorCount++
        }

        await new Promise(r => setTimeout(r, 1000))

      } catch (err: any) {
        log.error(`  ❌ Erro: ${err.message}`)
        saveEntry({ docId: doc.id, docName: doc.name, empresa: '', interactionId: null, processedAt: new Date().toISOString(), status: 'error', error: err.message }, processedKey)
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
