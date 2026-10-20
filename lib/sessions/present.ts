import { sanitizeRichText, toPlainText } from '@/lib/bank/sanitize'

export function passageFor(section: string | null, questionNumber: number | null) {
  if (!section) return null
  const match = section.match(/(?:<[^>]+>\s*)*Passage\s+([A-Za-z]),\s*(\d+)\s*-\s*(\d+)\s*$/i)
  const html = sanitizeRichText(match ? section.slice(0, match.index).trim() : section)
  return { html: html ?? '', range: match ? [Number(match[2]), Number(match[3])] as [number, number] : null }
}

function source(q: any) { return q?.raw_payload && typeof q.raw_payload === 'object' ? q.raw_payload : q }

export function normalizeChoice(value: unknown, options?: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  if (/^[A-E]$/.test(normalized)) return normalized
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    const entry = Object.entries(options as Record<string, unknown>).find(([, text]) => typeof text === 'string' && text.trim().toLowerCase() === value.trim().toLowerCase())
    if (entry && /^[A-E]$/i.test(entry[0])) return entry[0].toUpperCase()
  }
  if (Array.isArray(options)) {
    const index = options.findIndex((text) => typeof text === 'string' && text.trim().toLowerCase() === value.trim().toLowerCase())
    if (index >= 0 && index < 5) return String.fromCharCode(65 + index)
  }
  return null
}

export function questionContent(q: any) {
  const s = source(q)
  const options = s.options ?? q?.options ?? {}
  const text = s.text ?? s.question ?? q?.text ?? q?.question ?? ''
  const correctChoice = normalizeChoice(s.correctAnswer ?? s.correct_answer ?? q?.correct_answer ?? q?.correct_option ?? q?.correct_choice, options)
  const optionEntries = Array.isArray(options) ? options.map((text: unknown, i: number) => ({ key: String.fromCharCode(65 + i), text: String(text ?? '') })) : Object.entries(options).map(([key, text]) => ({ key: key.toUpperCase(), text: String(text ?? '') }))
  return { text: String(text), options: optionEntries, correctChoice, passage: q?.has_passage ? passageFor(q.section, q.question_number) : null, imageUrl: s.imageUrl ?? s.image_url ?? q?.image_url ?? null }
}

export function presentQuestion(q: any, firstInPage = true) {
  const content = questionContent(q)
  return { number: q.position, position: q.position, ref: q.ref, subject: q.subject_slug, subject_number: q.subject_number, text: content.text, options: content.options, image_url: content.imageUrl, instruction: q.has_passage ? null : toPlainText(q.section), passage: firstInPage ? content.passage : null, passage_key: q.passage_key }
}
