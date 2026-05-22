import express from 'express'
import path from 'path'

const PORT = parseInt(process.env.DASHBOARD_PORT || '3001')

export function startServer() {
  const app = express()

  app.use(express.static(path.join(__dirname, '../public')))

  app.get('/api/config', (_req, res) => {
    res.json({
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseKey: process.env.SUPABASE_ANON_KEY || ''
    })
  })

  app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`)
  })
}
