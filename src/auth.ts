import 'dotenv/config'
import { runAuthFlow } from './tools/google-auth'

runAuthFlow().catch(console.error)
