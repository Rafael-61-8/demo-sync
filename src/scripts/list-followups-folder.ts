import 'dotenv/config'
import { google } from 'googleapis'
import { getAuthClient } from '../tools/google-auth'

const FOLDER_ID = process.env.DRIVE_FOLLOWUPS_FOLDER_ID!

const auth = await getAuthClient()
const drive = google.drive({ version: 'v3', auth })

const res = await drive.files.list({
  q: `'${FOLDER_ID}' in parents and trashed=false`,
  fields: 'files(id,name,mimeType,createdTime)',
  pageSize: 20
})

const files = res.data.files || []
if (files.length === 0) {
  console.log('PASTA VAZIA')
} else {
  files.forEach(f => console.log(f.mimeType, '|', f.name, '|', f.createdTime))
}
