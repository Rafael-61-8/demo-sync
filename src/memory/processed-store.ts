import * as fs from 'fs'
import * as path from 'path'

const STORE_PATH = path.join(__dirname, '../../data/processed.json')

export interface ProcessedEntry {
  docId: string
  docName: string
  empresa: string
  interactionId: number | null
  processedAt: string
  status: 'success' | 'not_found' | 'error'
  error?: string
}

export function loadProcessed(): { ids: Set<string>; entries: ProcessedEntry[] } {
  if (!fs.existsSync(STORE_PATH)) {
    return { ids: new Set(), entries: [] }
  }
  const entries: ProcessedEntry[] = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
  const ids = new Set(entries.map(e => e.docId))
  return { ids, entries }
}

export function saveEntry(entry: ProcessedEntry): void {
  const dir = path.dirname(STORE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const { entries } = loadProcessed()
  entries.push(entry)
  fs.writeFileSync(STORE_PATH, JSON.stringify(entries, null, 2), 'utf8')
}

export function getPendingReview(): ProcessedEntry[] {
  const { entries } = loadProcessed()
  return entries.filter(e => e.status === 'not_found')
}
