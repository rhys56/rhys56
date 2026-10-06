#!/usr/bin/env node
// Minimal MCP server (stdio, newline-delimited JSON-RPC) that forwards prompts
// to the Google Gemini API. No dependencies; needs Node 18+ and GEMINI_API_KEY.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'

const API = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'
const MAX_FILE_BYTES = 200_000

const TOOLS = [
  {
    name: 'ask_gemini',
    description:
      'Send a prompt to Google Gemini and return its answer. Use for a second opinion, ' +
      'a cross-check, or when the user asks for Gemini. Optionally attach local files ' +
      '(their contents are appended to the prompt).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The question or instruction for Gemini.' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional local file paths whose contents are included after the prompt.',
        },
        system: { type: 'string', description: 'Optional system instruction.' },
        model: { type: 'string', description: `Gemini model id. Defaults to ${DEFAULT_MODEL}.` },
        temperature: { type: 'number', description: 'Optional sampling temperature (0-2).' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list_gemini_models',
    description: 'List the Gemini models available to the configured API key.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function apiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set. Get a key at https://aistudio.google.com/apikey and add it to your environment.')
  return key
}

async function gemini(path, init = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey(), ...init.headers },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${body.error?.message ?? res.statusText}`)
  return body
}

async function askGemini({ prompt, files = [], system, model = DEFAULT_MODEL, temperature }) {
  let text = prompt
  for (const f of files) {
    const buf = await readFile(resolve(f))
    const content = buf.subarray(0, MAX_FILE_BYTES).toString('utf8')
    const note = buf.length > MAX_FILE_BYTES ? ` (truncated to ${MAX_FILE_BYTES} bytes)` : ''
    text += `\n\n--- ${f}${note} ---\n${content}`
  }
  const req = { contents: [{ role: 'user', parts: [{ text }] }] }
  if (system) req.systemInstruction = { parts: [{ text: system }] }
  if (temperature !== undefined) req.generationConfig = { temperature }

  const id = model.replace(/^models\//, '')
  const body = await gemini(`models/${encodeURIComponent(id)}:generateContent`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
  const cand = body.candidates?.[0]
  const answer = cand?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
  if (!answer) {
    const why = cand?.finishReason ?? body.promptFeedback?.blockReason ?? 'no candidates returned'
    throw new Error(`Gemini returned no text (${why}).`)
  }
  return `${answer}\n\n— ${body.modelVersion ?? id}`
}

async function listModels() {
  const names = []
  let pageToken = ''
  do {
    const body = await gemini(`models?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`)
    for (const m of body.models ?? []) {
      if (m.supportedGenerationMethods?.includes('generateContent')) {
        names.push(`${m.name.replace(/^models\//, '')} — ${m.displayName ?? ''}`)
      }
    }
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return names.join('\n')
}

async function callTool(name, args = {}) {
  if (name === 'ask_gemini') return askGemini(args)
  if (name === 'list_gemini_models') return listModels()
  throw new Error(`Unknown tool: ${name}`)
}

function send(msg) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
}

async function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined) return // notification
  switch (method) {
    case 'initialize':
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'gemini', version: '0.1.0' },
        },
      })
    case 'ping':
      return send({ id, result: {} })
    case 'tools/list':
      return send({ id, result: { tools: TOOLS } })
    case 'tools/call':
      try {
        const text = await callTool(params?.name, params?.arguments)
        return send({ id, result: { content: [{ type: 'text', text }] } })
      } catch (err) {
        return send({ id, result: { content: [{ type: 'text', text: String(err.message ?? err) }], isError: true } })
      }
    default:
      return send({ id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return send({ id: null, error: { code: -32700, message: 'Parse error' } })
  }
  handle(msg)
})
