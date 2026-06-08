import express from 'express'
import path from 'path'
import { supabase } from './tools/supabase'

const PORT = parseInt(process.env.DASHBOARD_PORT || '3000')
const CLEANUP_TOKEN = process.env.CLEANUP_TOKEN || 'recrutei-cleanup-2026'

export function startServer() {
  const app = express()

  app.use(express.static(path.join(__dirname, '../public')))

  app.get('/api/config', (_req, res) => {
    res.json({
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseKey: process.env.SUPABASE_ANON_KEY || ''
    })
  })

  // Endpoint temporário — apaga interações duplicadas no Ploomes
  app.get('/api/cleanup-dupes', async (req, res) => {
    if (req.query.token !== CLEANUP_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
      const BASE_URL = 'https://api2.ploomes.com'
      const ploomesHeaders = {
        'User-Key': process.env.PLOOMES_USER_KEY!,
        'Content-Type': 'application/json'
      }

      // Pagina todos os logs de success
      const allRows: { doc_id: string; interaction_id: number }[] = []
      let from = 0
      const PAGE = 1000
      while (true) {
        const { data, error } = await supabase
          .from('sync_logs')
          .select('doc_id, interaction_id, created_at')
          .eq('status', 'success')
          .not('interaction_id', 'is', null)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        allRows.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }

      // Identifica duplicatas (mantém o mais antigo por doc_id)
      const byDoc: Record<string, number[]> = {}
      for (const row of allRows) {
        if (!byDoc[row.doc_id]) byDoc[row.doc_id] = []
        byDoc[row.doc_id].push(row.interaction_id)
      }
      const toDelete: number[] = []
      for (const ids of Object.values(byDoc)) {
        if (ids.length > 1) toDelete.push(...ids.slice(1))
      }

      res.json({ toDelete: toDelete.length, starting: true })

      // Deleta em background
      let deleted = 0, failed = 0
      for (const id of toDelete) {
        const r = await fetch(`${BASE_URL}/Interactions(${id})`, {
          method: 'DELETE', headers: ploomesHeaders
        })
        if (r.ok || r.status === 404) deleted++
        else failed++
        await new Promise(x => setTimeout(x, 150))
      }
      console.log(`[cleanup-dupes] Concluido: ${deleted} deletadas, ${failed} falhas`)
    } catch (err: any) {
      console.error('[cleanup-dupes] Erro:', err.message)
    }
  })

  app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`)
  })
}
