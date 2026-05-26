import 'dotenv/config'

const BASE_URL = 'https://api2.ploomes.com'
const CONTACT_ID = 901386543
const INTERACTION_ID = 909163316
const TARGET_PIPELINE = 'COMERCIAL - VENDAS'

function headers() {
  return {
    'User-Key': process.env.PLOOMES_USER_KEY!,
    'Content-Type': 'application/json'
  }
}

async function run() {
  console.log(`\n🔍 Buscando deals do contato ${CONTACT_ID}...`)

  const dealsRes = await fetch(
    `${BASE_URL}/Deals?$filter=ContactId eq ${CONTACT_ID}&$select=Id,Title,PipelineId,PipelineName,ContactName&$top=50&$orderby=CreateDate desc`,
    { headers: headers() }
  )

  if (!dealsRes.ok) {
    console.error(`Erro ao buscar deals: ${dealsRes.status} ${await dealsRes.text()}`)
    process.exit(1)
  }

  const dealsData = await dealsRes.json() as { value: any[] }
  const deals = dealsData.value || []

  console.log(`\n📋 ${deals.length} deal(s) encontrado(s):`)
  deals.forEach((d: any) => console.log(`  [${d.Id}] "${d.Title}" — Funil: "${d.PipelineName}"`))

  const correctDeal = deals.find((d: any) =>
    d.PipelineName?.toLowerCase().includes(TARGET_PIPELINE.toLowerCase())
  )

  if (!correctDeal) {
    console.error(`\n❌ Nenhum deal no funil "${TARGET_PIPELINE}" encontrado para o contato ${CONTACT_ID}`)
    process.exit(1)
  }

  console.log(`\n✅ Deal correto: [${correctDeal.Id}] "${correctDeal.Title}" (${correctDeal.PipelineName})`)
  console.log(`\n📝 Atualizando interação ${INTERACTION_ID} → DealId ${correctDeal.Id}...`)

  const patchRes = await fetch(
    `${BASE_URL}/InteractionRecords(${INTERACTION_ID})`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ DealId: correctDeal.Id })
    }
  )

  if (!patchRes.ok) {
    const err = await patchRes.text()
    console.error(`❌ Erro ao atualizar interação: ${patchRes.status}`, err)
    process.exit(1)
  }

  console.log(`✅ Interação ${INTERACTION_ID} atualizada com DealId ${correctDeal.Id}`)
  console.log(`\nConcluído! Verifique no Ploomes: contato Telecall → deal "${correctDeal.Title}"`)
}

run().catch(console.error)
