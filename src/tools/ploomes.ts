const BASE_URL = 'https://api2.ploomes.com'

function headers() {
  return {
    'User-Key': process.env.PLOOMES_USER_KEY!,
    'Content-Type': 'application/json'
  }
}

export interface PloomesContact {
  Id: number
  Name: string
  Email?: string
  LastDealId?: number
  score?: number
}

export interface PloomesDeal {
  Id: number
  Title: string
  ContactId: number
  ContactName: string
  PersonId?: number
  PersonName?: string
  PipelineId?: number
  PipelineName?: string
}

// Normaliza string para comparação: sem acento, lowercase, sem caracteres especiais
function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '').trim()
}

// Score de similaridade entre dois nomes de empresa
function similarityScore(found: string, searched: string): number {
  const a = normalize(found)
  const b = normalize(searched)

  if (a === b) return 100
  if (a.includes(b) || b.includes(a)) return 85

  const wordsA = a.split(/\s+/)
  const wordsB = b.split(/\s+/).filter(w => w.length > 2)
  const matches = wordsB.filter(w => wordsA.some(wa => wa.includes(w) || w.includes(wa))).length
  return (matches / Math.max(wordsB.length, 1)) * 70
}

const GENERIC_EMPRESA_NAMES = [
  'nao identificado',
  'nao informado',
  'nao identificada',
  'empresa nao informada',
  'nao desejo identificar',
  'empresa de ciberseguranca',
  'nao identificada na reuniao'
]

export async function searchCompany(empresa: string): Promise<PloomesContact | null> {
  const empresaNorm = normalize(empresa)
  if (GENERIC_EMPRESA_NAMES.some(g => empresaNorm.includes(g))) {
    console.warn(`[Ploomes] Nome genérico ignorado: "${empresa}"`)
    return null
  }

  // Remove sufixos comuns para a chave de busca
  const skip = new Set(['ltda', 'sa', 'me', 'epp', 'eireli', 'ss', 'sas', 'de', 'e', 'da', 'do'])
  const words = empresa.split(/\s+/).filter(w => w.length >= 3 && !skip.has(w.toLowerCase()))

  if (words.length === 0) return null

  // Busca pela palavra mais significativa (mais longa, não genérica)
  const genericWords = new Set(['consultoria', 'servicos', 'solucoes', 'grupo', 'gestao', 'tecnologia'])
  const uniqueWord = words
    .sort((a, b) => {
      const aGen = genericWords.has(normalize(a)) ? 0 : 1
      const bGen = genericWords.has(normalize(b)) ? 0 : 1
      return bGen - aGen || b.length - a.length
    })[0]

  const searchKey = uniqueWord.substring(0, 8)

  const url = `${BASE_URL}/Contacts?$filter=contains(Name,'${encodeURIComponent(searchKey)}')&$select=Id,Name,Email,LastDealId&$top=30`

  const res = await fetch(url, { headers: headers() })
  if (!res.ok) {
    console.error(`[Ploomes] searchCompany error ${res.status} for "${empresa}"`)
    return null
  }

  const data = await res.json() as { value: PloomesContact[] }
  const results = data.value || []

  if (results.length === 0) return null

  const scored = results
    .map(r => ({ ...r, score: similarityScore(r.Name, empresa) }))
    .sort((a, b) => b.score! - a.score!)

  const best = scored[0]
  if (best.score! < 50) {
    console.warn(`[Ploomes] Baixa confiança (score ${best.score}) para "${empresa}" → "${best.Name}"`)
    return null
  }

  console.log(`[Ploomes] Match: "${empresa}" → "${best.Name}" (score: ${best.score})`)
  return best
}

export async function searchByEmail(email: string): Promise<PloomesContact | null> {
  if (!email || !email.includes('@')) return null

  const url = `${BASE_URL}/Contacts?$filter=Email eq '${email}'&$select=Id,Name,Email,LastDealId&$top=5`

  const res = await fetch(url, { headers: headers() })
  if (!res.ok) {
    console.error(`[Ploomes] searchByEmail error ${res.status} for "${email}"`)
    return null
  }

  const data = await res.json() as { value: PloomesContact[] }
  const contact = data.value?.[0] || null

  if (contact) {
    console.log(`[Ploomes] Match por email: "${email}" → "${contact.Name}"`)
    return { ...contact, score: 100 }
  }
  return null
}

export async function getDeal(contactId: number): Promise<PloomesDeal | null> {
  const targetPipeline = (process.env.PLOOMES_PIPELINE_NAME || 'COMERCIAL - VENDAS').toLowerCase()

  const url = `${BASE_URL}/Deals?$filter=ContactId eq ${contactId}&$select=Id,Title,ContactId,ContactName,PersonId,PersonName,PipelineId,PipelineName&$top=50&$orderby=CreateDate desc`

  const res = await fetch(url, { headers: headers() })
  if (!res.ok) return null

  const data = await res.json() as { value: PloomesDeal[] }
  const deals = data.value || []

  if (deals.length === 0) return null

  // Prefere o deal mais recente no funil correto
  const inPipeline = deals.find(d =>
    d.PipelineName && d.PipelineName.toLowerCase().includes(targetPipeline)
  )

  if (inPipeline) {
    console.log(`[Ploomes] Deal no funil "${inPipeline.PipelineName}": "${inPipeline.Title}"`)
    return inPipeline
  }

  // Fallback: deal mais recente (qualquer funil) — avisa
  console.warn(`[Ploomes] ⚠️  Nenhum deal no funil "${targetPipeline}" para contact ${contactId} — usando mais recente (funil: "${deals[0].PipelineName}")`)
  return deals[0]
}

export async function createInteraction(
  contactId: number,
  dealId: number | null,
  resumo: string,
  empresa: string,
  pessoa: string,
  nomeReuniao: string,
  dataReuniao?: string
): Promise<number | null> {
  const content = `🤖 RESUMO DE DEMO\n\n${resumo}\n\n---\nReunião: ${nomeReuniao}\nEmpresa: ${empresa}\nPessoa: ${pessoa}`

  const body = {
    ContactId: contactId,
    DealId: dealId || null,
    Date: dataReuniao || new Date().toISOString(),
    TypeId: 5,
    Content: content
  }

  const res = await fetch(`${BASE_URL}/InteractionRecords`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[Ploomes] createInteraction error ${res.status}:`, err)
    return null
  }

  const data = await res.json() as { value: { Id: number }[] }
  return data.value?.[0]?.Id || null
}
