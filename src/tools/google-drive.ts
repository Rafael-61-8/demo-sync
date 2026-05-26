import { google } from 'googleapis'
import { getAuthClient } from './google-auth'

export interface DriveDoc {
  id: string
  name: string
  createdTime: string
  modifiedTime: string
}

export async function listNewDocs(folderId: string, processedIds: Set<string>, last24h = false): Promise<DriveDoc[]> {
  const auth = await getAuthClient()
  const drive = google.drive({ version: 'v3', auth })

  let query = `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`

  if (last24h) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    query += ` and createdTime > '${yesterday}'`
  }

  const res = await drive.files.list({
    q: query,
    fields: 'files(id, name, createdTime, modifiedTime)',
    orderBy: 'createdTime desc',
    pageSize: 100
  })

  const files = res.data.files || []
  return files.filter(f => f.id && !processedIds.has(f.id)) as DriveDoc[]
}

export async function getDocMeta(docId: string): Promise<{ name: string; createdTime: string }> {
  const auth = await getAuthClient()
  const drive = google.drive({ version: 'v3', auth })
  const res = await drive.files.get({ fileId: docId, fields: 'name,createdTime' })
  return {
    name: res.data.name || docId,
    createdTime: res.data.createdTime || new Date().toISOString()
  }
}

export async function readDocContent(docId: string): Promise<string> {
  const auth = await getAuthClient()
  const docs = google.docs({ version: 'v1', auth })

  const doc = await docs.documents.get({ documentId: docId })
  const content = doc.data.body?.content || []

  let text = ''
  for (const element of content) {
    if (element.paragraph) {
      for (const pe of element.paragraph.elements || []) {
        text += pe.textRun?.content || ''
      }
    }
  }
  return text
}
