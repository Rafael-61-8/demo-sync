import 'dotenv/config'

const BASE_URL = 'https://api2.ploomes.com'
const IDS = [
909270235,909270231,909270228,909270226,909270222,909270221,909270220,
909270219,909270217,909270214,909270213,909270211,909270209,909270206,
909270204,909270199,909270198,909270196,909270195,909270194,909270193,
909270192,909270190,909270186,909270183,909270182,909270181,909270180,
909270179,909270178,909270176,909270175,909270173,909270168,909270162,
909270159,909270158,909270157,909270156,909270155,909270151,909270148,
909270146,909270145,909270143,909270142,909270141,909270140,909270139,
909270136,909270135,909270134,909270129,909270128,909270125,909270123,
909270121,909270119,909270115,909270114,909270111,909270109,909270107,
909270105,909270104,909270102,909270100,909270099,909270097
]

function headers() {
  return { 'User-Key': process.env.PLOOMES_USER_KEY!, 'Content-Type': 'application/json' }
}

async function main() {
  console.log(`Deletando ${IDS.length} interações...`)
  let ok = 0, fail = 0

  for (const id of IDS) {
    const res = await fetch(`${BASE_URL}/InteractionRecords(${id})`, {
      method: 'DELETE',
      headers: headers()
    })
    if (res.ok || res.status === 204 || res.status === 404) {
      console.log(`✅ ${id} deletado`)
      ok++
    } else {
      console.error(`❌ ${id} falhou: ${res.status}`)
      fail++
    }
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\nConcluído: ${ok} deletados, ${fail} falhas`)
}

main().catch(console.error)
