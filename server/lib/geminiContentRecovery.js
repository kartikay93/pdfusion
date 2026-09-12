import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config.js';

let client = null;

function getClient() {
  if (!config.geminiApiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

export function isGeminiAvailable() {
  return Boolean(config.geminiApiKey);
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    kind: {
      type: Type.STRING,
      enum: ['equation', 'table', 'other'],
      description: 'What the image actually shows.'
    },
    latex: {
      type: Type.STRING,
      description: 'Present only when kind is "equation": the exact LaTeX for the formula shown.'
    },
    rows: {
      type: Type.ARRAY,
      description: 'Present only when kind is "table": every row (including any header row) as an array of exact cell text, top to bottom, left to right.',
      items: { type: Type.ARRAY, items: { type: Type.STRING } }
    }
  },
  required: ['kind']
};

const PROMPT = `This image is a small region extracted from a page of a converted document — the conversion tool couldn't reconstruct it as normal text, so it was left as a picture. Determine what it actually shows:

- If it is a single mathematical equation or formula, set kind to "equation" and give the exact LaTeX for it. Do not include a "$" or "\\[" delimiter, just the LaTeX body.
- If it is a data table (rows and columns of text, whether or not it has visible grid lines), set kind to "table" and give its exact contents as "rows": an array of rows, each an array of exact cell text strings, top to bottom and left to right. Preserve every symbol, subscript/superscript character, and unit exactly as shown — do not paraphrase, summarize, or drop any row or column. Include a header row if one is visually present.
- For anything else — a photograph, chart, diagram, logo, decorative image, or ordinary paragraph text — set kind to "other" and nothing else.

Only transcribe what is visually present. Never invent or guess content that isn't legible — if a cell or symbol is genuinely illegible, use "?" for that cell rather than fabricating a plausible-looking value.`;

/**
 * Sends one image to Gemini and asks it to classify + extract in a single
 * call: is this a flattened equation, a flattened table, or something else
 * (a real photo/figure/decoration) that should be left untouched? Returns
 * null on any failure (missing key, API error, malformed response) — the
 * caller treats null exactly like "other": leave the original image alone.
 */
export async function recognizeContent(imageBuffer, mimeType = 'image/png') {
  const ai = getClient();
  if (!ai) return null;

  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT },
            { inlineData: { mimeType, data: imageBuffer.toString('base64') } }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA
      }
    });

    const text = response.text;
    if (!text) return null;
    const parsed = JSON.parse(text);

    if (parsed.kind === 'equation' && typeof parsed.latex === 'string' && parsed.latex.trim()) {
      return { kind: 'equation', latex: parsed.latex.trim() };
    }
    if (parsed.kind === 'table' && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
      const rows = parsed.rows
        .filter((r) => Array.isArray(r) && r.length > 0)
        .map((r) => r.map((cell) => String(cell ?? '')));
      if (rows.length === 0) return null;
      return { kind: 'table', rows };
    }
    return { kind: 'other' };
  } catch (err) {
    console.error('[geminiContentRecovery] recognizeContent failed:', err.message);
    return null;
  }
}
