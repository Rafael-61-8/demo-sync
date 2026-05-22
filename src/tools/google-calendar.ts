import { google } from 'googleapis'
import { getAuthClient } from './google-auth'

export interface CalendarEvent {
  id: string
  summary: string
  start: string
  attendeeEmails: string[]
  descriptionEmails: string[]
  companyName: string | null
}

function norm(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '').trim()
}

function titleMatch(a: string, b: string): number {
  const na = norm(a)
  const nb = norm(b)
  if (na === nb) return 100
  if (na.includes(nb) || nb.includes(na)) return 85
  const wordsA = na.split(/\s+/)
  const wordsB = nb.split(/\s+/).filter(w => w.length > 2)
  const matches = wordsB.filter(w => wordsA.some(wa => wa.includes(w) || w.includes(wa))).length
  return (matches / Math.max(wordsB.length, 1)) * 70
}

// Extrai emails e nome da empresa da description do evento
// Formato típico:
//   Reservado por
//   Nome Pessoa
//   email@empresa.com
//   (telefone)
//
//   Qual nome da sua empresa?
//   Nome Empresa
//
//   Você já é cliente Recrutei?
function parseDescription(description: string): { emails: string[]; companyName: string | null } {
  if (!description) return { emails: [], companyName: null }

  // Remove tags HTML se houver
  const text = description
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

  // Extrai todos os emails do texto
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  const allEmails: string[] = text.match(emailRegex) || []
  const emails = allEmails.filter((e: string) =>
    !e.includes('recrutei') &&
    !e.endsWith('calendar.google.com') &&
    !e.includes('google.com')
  )

  // Extrai nome da empresa após "Qual nome da sua empresa?"
  const lines = text.split('\n').map(l => l.trim())
  let companyName: string | null = null

  const questionIdx = lines.findIndex(l => /qual nome da sua empresa/i.test(l))
  if (questionIdx !== -1) {
    for (let i = questionIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (
        line &&
        !/você já é cliente/i.test(line) &&
        !/qual /i.test(line) &&
        !/reservado por/i.test(line) &&
        line.length > 1
      ) {
        companyName = line
        break
      }
    }
  }

  return { emails, companyName }
}

export async function findEventForDoc(docTitle: string, docDate: string): Promise<CalendarEvent | null> {
  try {
    const auth = await getAuthClient()
    const calendar = google.calendar({ version: 'v3', auth })

    const center = new Date(docDate)
    const timeMin = new Date(center.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const timeMax = new Date(center.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString()

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 100,
      orderBy: 'startTime'
    })

    const events = res.data.items || []
    if (events.length === 0) return null

    let best: { event: typeof events[0]; score: number } | null = null

    for (const event of events) {
      const summary = event.summary || ''
      const score = titleMatch(docTitle, summary)
      if (score >= 60 && (!best || score > best.score)) {
        best = { event, score }
      }
    }

    if (!best) return null

    const e = best.event

    const attendeeEmails = (e.attendees || [])
      .map(a => a.email || '')
      .filter(em => em && !em.includes('recrutei') && !em.endsWith('calendar.google.com'))

    const { emails: descEmails, companyName } = parseDescription(e.description || '')

    // Combina emails de attendees + description, sem duplicatas
    const allEmails = [...new Set([...attendeeEmails, ...descEmails])]
      .filter(em => !em.includes('recrutei') && !em.endsWith('calendar.google.com'))

    console.log(`[Calendar] Evento: "${e.summary}"`)
    if (descEmails.length) console.log(`[Calendar] Emails da description: ${descEmails.join(', ')}`)
    if (companyName) console.log(`[Calendar] Empresa da description: "${companyName}"`)

    return {
      id: e.id || '',
      summary: e.summary || '',
      start: e.start?.dateTime || e.start?.date || '',
      attendeeEmails,
      descriptionEmails: descEmails,
      companyName: companyName
    }
  } catch (err: any) {
    console.error(`[Calendar] Erro: ${err.message}`)
    return null
  }
}
