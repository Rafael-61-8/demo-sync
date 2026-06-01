import 'dotenv/config'
import { google } from 'googleapis'
import { getAuthClient } from '../tools/google-auth'

async function main() {
  const auth = await getAuthClient()
  const docs = google.docs({ version: 'v1', auth })
  const doc = await docs.documents.get({ documentId: '1HEfZLZzEP-1UYNZf3r8lmu2FEImn8NAl6CSFS4vHMRw' })
  let text = ''
  for (const el of doc.data.body?.content || []) {
    if (el.paragraph) {
      for (const pe of el.paragraph.elements || []) {
        text += pe.textRun?.content || ''
      }
    }
  }
  console.log(text.substring(0, 1500))
}

main().catch(console.error)
