import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export interface FollowUpSuggestions {
  whatsapp: { msg: string }[]
  email: { assunto: string; corpo: string }[]
}

export async function generateFollowUps(
  resumo: string,
  empresa: string,
  pessoa: string
): Promise<FollowUpSuggestions | null> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const prompt = `Você é especialista em vendas B2B de SaaS de RH. Com base neste resumo de demo, crie follow-ups personalizados usando APENAS informações presentes no resumo.

RESUMO DA DEMO:
${resumo}

Pessoa: ${pessoa} | Empresa: ${empresa}

Gere EXATAMENTE neste formato JSON (sem markdown, sem explicações):
{
  "whatsapp": [
    {"msg": "mensagem curta 1"},
    {"msg": "mensagem curta 2"},
    {"msg": "mensagem curta 3"}
  ],
  "email": [
    {"assunto": "assunto 1", "corpo": "corpo do email 1"},
    {"assunto": "assunto 2", "corpo": "corpo do email 2"},
    {"assunto": "assunto 3", "corpo": "corpo do email 3"}
  ]
}

Regras:
- WhatsApp: máximo 2 linhas, tom informal, use o primeiro nome da pessoa
- Email: 3-4 linhas, tom profissional
- Use APENAS o que está no resumo (dores, objeções, próximos passos, interesses mencionados)
- Não invente informações`

    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Resposta sem JSON válido')

    const parsed = JSON.parse(jsonMatch[0]) as FollowUpSuggestions

    if (!parsed.whatsapp?.length || !parsed.email?.length) {
      throw new Error('JSON incompleto')
    }

    return parsed
  } catch (err: any) {
    console.error('[FollowUps] Erro ao gerar:', err.message)
    return null
  }
}
