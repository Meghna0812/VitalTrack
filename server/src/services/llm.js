// Calls the DeepSeek API to turn report text into structured JSON.
//
// DeepSeek's API is "OpenAI-compatible": same request/response format as OpenAI's
// /chat/completions, so a plain fetch() is enough – no SDK needed.
import { config } from '../config.js';
import { ExtractionSchema } from './schema.js';

const SYSTEM_PROMPT = `You extract laboratory test results from the text of a blood test report.
Return ONLY a JSON object with this exact shape:

{
  "reportDate": "YYYY-MM-DD" or null,
  "biomarkers": [
    {
      "name": "test name exactly as printed",
      "value": <number>,
      "unit": "unit exactly as printed" or null,
      "refLow": <number> or null,
      "refHigh": <number> or null,
      "confidence": <number between 0 and 1>,
      "sourceText": "the line of the report this result came from, copied exactly"
    }
  ]
}

Rules:
- Copy values and units exactly as printed. Do NOT convert units. Do NOT round.
- "value" must be a plain number. Skip qualitative results (e.g. "Positive", "Nil").
- Reference range "13.0 - 17.0" -> refLow 13, refHigh 17. "< 200" -> refLow null, refHigh 200. "> 40" -> refLow 40, refHigh null.
- reportDate is the sample collection date (or report date if no collection date).
  Treat dates like 12/01/2026 as DD/MM/YYYY unless the report clearly uses another format.
- Never invent a result. If a value is unclear or cut off, include it with a low confidence (< 0.5).
- confidence: 1.0 = clearly printed and unambiguous; lower it for unclear layout, OCR noise or ambiguous units.
- Text in square brackets like [NAME] has been redacted for privacy; ignore it.`;

const MAX_CHARS = 30000; // keep requests within the model's context and cost limits

async function chat(messages) {
  if (!config.deepseek.apiKey) throw new Error('DEEPSEEK_API_KEY is not set');
  const res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.deepseek.apiKey}` },
    body: JSON.stringify({
      model: config.deepseek.model,
      messages,
      temperature: 0,                          // same input -> (nearly) same output
      response_format: { type: 'json_object' }, // ask the API to guarantee syntactically valid JSON
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const err = new Error(`DeepSeek API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

/**
 * Extract biomarkers from (already redacted!) report text.
 * If the answer fails validation we tell the model what was wrong and let it try once more.
 */
export async function extractWithLLM(redactedText) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Report text:\n\n${redactedText.slice(0, MAX_CHARS)}` },
  ];

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const content = await chat(messages);
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      lastError = 'response was not valid JSON';
    }
    if (parsed) {
      const result = ExtractionSchema.safeParse(parsed);
      if (result.success) return result.data;
      lastError = result.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    }
    messages.push(
      { role: 'assistant', content },
      { role: 'user', content: `Your JSON did not match the required schema (${lastError}). Return the corrected JSON only.` },
    );
  }
  throw new Error(`LLM output failed schema validation twice: ${lastError}`);
}
