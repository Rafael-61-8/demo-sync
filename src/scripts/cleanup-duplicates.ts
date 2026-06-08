import 'dotenv/config'
import { supabase } from '../tools/supabase'

const BASE_URL = 'https://api2.ploomes.com'
const PAGE_SIZE = 1000

export async function runCleanupDuplicates(): Promise<void> {
  const headers = {
    'User-Key': process.env.PLOOMES_USER_KEY!,
    'Content-Type': 'application/json'
  }

  // Pagina todos os logs de success
  const allRows: { doc_id: string; interaction_id: number }[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('sync_logs')
      .select('doc_id, interaction_id, created_at')
      .eq('status', 'success')
      .not('interaction_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error || !data || data.length === 0) break
    allRows.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  console.log(`[cleanup] Total entradas success: ${allRows.length}`)

  // Identifica duplicatas — mantém o mais antigo por doc_id
  const byDoc: Record<string, number[]> = {}
  for (const row of allRows) {
    if (!byDoc[row.doc_id]) byDoc[row.doc_id] = []
    byDoc[row.doc_id].push(row.interaction_id)
  }

  const toDelete: number[] = []
  for (const ids of Object.values(byDoc)) {
    if (ids.length > 1) toDelete.push(...ids.slice(1))
  }

  console.log(`[cleanup] ${toDelete.length} interacoes duplicadas a deletar`)

  let deleted = 0
  let failed = 0

  for (const id of toDelete) {
    const r = await fetch(`${BASE_URL}/Interactions(${id})`, {
      method: 'DELETE',
      headers
    })
    if (r.ok || r.status === 404) deleted++
    else { failed++; console.warn(`[cleanup] Falha ao deletar ${id}: ${r.status}`) }
    await new Promise(x => setTimeout(x, 150))
  }

  console.log(`[cleanup] Concluido: ${deleted} deletadas, ${failed} falhas`)
}

// Permite rodar direto: npx tsx src/scripts/cleanup-duplicates.ts
if (require.main === module) {
  runCleanupDuplicates().catch(console.error)
}
