export interface ParsedDemo {
  empresa: string
  pessoa: string
  resumo: string
  source: 'json' | 'title' | 'fallback'
}

export function parseDocContent(content: string, docTitle: string): ParsedDemo {
  // Estratégia 1: JSON embutido pelo Tactiq
  const jsonResult = extractFromJson(content)
  if (jsonResult) return { ...jsonResult, source: 'json' }

  // Estratégia 2: título do documento
  const titleResult = extractFromTitle(docTitle)
  if (titleResult) return { ...titleResult, source: 'title' }

  // Fallback
  return { empresa: docTitle, pessoa: '', resumo: content.slice(0, 3000), source: 'fallback' }
}

function extractFromJson(content: string): Omit<ParsedDemo, 'source'> | null {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  const jsonStr = content.slice(start, end + 1)

  // Estratégia 1a: parse direto
  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed.empresa && parsed.resumo) return parsed
  } catch (_) {}

  // Estratégia 1b: fix newlines literais dentro de strings
  try {
    let fixed = '', inStr = false, esc = false
    for (let i = 0; i < jsonStr.length; i++) {
      const c = jsonStr[i]
      if (esc) { fixed += c; esc = false; continue }
      if (c === '\\' && inStr) { fixed += c; esc = true; continue }
      if (c === '"') { inStr = !inStr; fixed += c; continue }
      if (inStr && c === '\n') { fixed += '\\n'; continue }
      if (inStr && c === '\r') { fixed += '\\r'; continue }
      fixed += c
    }
    const parsed = JSON.parse(fixed)
    if (parsed.empresa && parsed.resumo) return parsed
  } catch (_) {}

  // Estratégia 1c: regex field-by-field
  const getField = (txt: string, key: string): string => {
    const re = new RegExp(`"${key}"\\s*:\\s*"`)
    const m = re.exec(txt)
    if (!m) return ''
    let val = '', i = m.index + m[0].length, esc2 = false
    while (i < txt.length) {
      const c = txt[i++]
      if (esc2) { val += c === 'n' ? '\n' : c === 't' ? '\t' : c; esc2 = false }
      else if (c === '\\') { esc2 = true }
      else if (c === '"') { break }
      else { val += c }
    }
    return val
  }

  const empresa = getField(jsonStr, 'empresa')
  const resumo = getField(jsonStr, 'resumo')
  if (empresa && resumo) {
    return { empresa, pessoa: getField(jsonStr, 'pessoa'), resumo }
  }

  return null
}

function extractFromTitle(title: string): Omit<ParsedDemo, 'source'> | null {
  const empresa = extractTitleName(title)
  if (empresa) return { empresa, pessoa: '', resumo: '' }
  return null
}

// Extrai o nome da empresa do título do doc (parte após o "+")
// Ex: "[DEMO] Recrutei + CCBN" → "CCBN"
export function extractTitleName(title: string): string | null {
  const patterns = [
    /\[DEMO\].*?\+\s*(.+)/i,
    /DEMO.*?\+\s*(.+)/i,
    /\(DEMO\).*?\+\s*(.+)/i,
    /DEMO\s*[-–]\s*(.+)/i,
  ]

  for (const pattern of patterns) {
    const match = title.match(pattern)
    if (match) {
      const empresa = match[1]
        .split(/[\/|]/)[0]          // pega só a primeira parte (antes de / ou |)
        .replace(/\(.*?\)/g, '')    // remove parênteses
        .replace(/\d{4}-\d{2}-\d{2}/, '') // remove datas
        .trim()
      if (empresa) return empresa
    }
  }
  return null
}
