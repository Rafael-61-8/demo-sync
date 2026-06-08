import 'dotenv/config'
import { supabase } from '../tools/supabase'

const BASE_URL = 'https://api2.ploomes.com'
const PAGE_SIZE = 1000

async function getPloomesHeaders() {
  return {
    'User-Key': process.env.PLOOMES_USER_KEY!,
    'Content-Type': 'application/json'
  }
}

async function deleteInteraction(id: number): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/Interactions(${id})`, {
    method: 'DELETE',
    headers: await getPloomesHeaders()
  })
  return res.ok || res.status === 404
}

async function getDuplicateIds(): Promise<number[]> {
  console.log('Buscando IDs duplicados no sync_logs...')

  const allRows: { doc_id: string; interaction_id: number; created_at: string }[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('sync_logs')
      .select('doc_id, interaction_id, created_at')
      .eq('status', 'success')
      .not('interaction_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  console.log(`Total de entradas success com interaction_id: ${allRows.length}`)

  const byDoc: Record<string, number[]> = {}
  for (const row of allRows) {
    if (!byDoc[row.doc_id]) byDoc[row.doc_id] = []
    byDoc[row.doc_id].push(row.interaction_id)
  }

  const toDelete: number[] = []
  for (const [, ids] of Object.entries(byDoc)) {
    if (ids.length > 1) {
      toDelete.push(...ids.slice(1))
    }
  }

  return toDelete
}

async function main() {
  console.log('=== Limpeza de interacoes duplicadas no Ploomes ===\n')
  const toDelete = await getDuplicateIds()
  console.log(`\nTotal a deletar: ${toDelete.length} interacoes\n`)

  if (toDelete.length === 0) {
    console.log('Nada a deletar.')
    return
  }

  let deleted = 0
  let failed = 0

  for (const id of toDelete) {
    const ok = await deleteInteraction(id)
    if (ok) {
      deleted++
      process.stdout.write(`\rDeletadas: ${deleted} | Falhas: ${failed}`)
    } else {
      failed++
      console.log(`\nFalha ao deletar interaction ${id}`)
    }
    await new Promise(r => setTimeout(r, 150))
  }

  console.log(`\n\nConcluido: ${deleted} deletadas, ${failed} falhas.`)
}

main().catch(console.error)
