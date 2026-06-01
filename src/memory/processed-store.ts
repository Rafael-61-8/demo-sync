import * as fs from 'fs'
import * as path from 'path'

const DATA_DIR = path.join(__dirname, '../../data')

function storePath(key = 'processed') {
  return path.join(DATA_DIR, `${key}.json`)
}

export interface ProcessedEntry {
  docId: string
  docName: string
  empresa: string
  interactionId: number | null
  processedAt: string
  status: 'success' | 'not_found' | 'error'
  error?: string
}

export function loadProcessed(key = 'processed'): { ids: Set<string>; entries: ProcessedEntry[] } {
  const p = storePath(key)
  if (!fs.existsSync(p)) return { ids: new Set(), entries: [] }
  const entries: ProcessedEntry[] = JSON.parse(fs.readFileSync(p, 'utf8'))
  const ids = new Set(entries.map(e => e.docId))
  return { ids, entries }
}

export function saveEntry(entry: ProcessedEntry, key = 'processed'): void {
  const p = storePath(key)
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  const { entries } = loadProcessed(key)
  entries.push(entry)
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), 'utf8')
}

export function getPendingReview(): ProcessedEntry[] {
  const { entries } = loadProcessed()
  return entries.filter(e => e.status === 'not_found')
}
