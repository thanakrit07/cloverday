// ADR-0017: reads a photographed till slip and *proposes* a Receipt. It writes
// nothing — the household confirms every figure in the split form before any
// row reaches the ledger.
//
// This lives in an Edge Function for one reason: an API key in a client bundle
// is a published API key. The app is otherwise a pure SPA talking straight to
// PostgREST, so this is the project's only server-side code.
//
// Deno. Deploy with `supabase functions deploy scan-bill`, and set the key with
// `supabase secrets set ANTHROPIC_API_KEY=...`.

import Anthropic from 'npm:@anthropic-ai/sdk@^0.70.0'

// Extraction, not reasoning -- and the accuracy question is empirical, so this
// starts at the cheapest capable tier and moves up only if Thai slips read
// badly (ADR-0017). Moving up is this line: claude-sonnet-5, then claude-opus-5.
//
// Four things this model's generation does NOT take, all of which 400 or
// silently do nothing: `output_config.effort` (errors), adaptive thinking
// (it wants the older budget_tokens form -- and extraction needs no thinking,
// so none is sent), server-side `fallbacks` (an Opus 5 / Fable 5 refusal
// feature), and prompt caching (its minimum cacheable prefix is 4096 tokens;
// ours is roughly a third of that, so a cache_control marker would be a no-op).
const MODEL = 'claude-haiku-4-5'

// Constrains the response shape so nothing here has to parse prose. Note the
// schema dialect's limits: no `minimum`/`maxLength`, and every object needs
// `additionalProperties: false` plus a complete `required`.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['merchant', 'date', 'total', 'lines'],
  properties: {
    merchant: {
      type: 'string',
      description: 'The shop name as printed. Empty string if the slip does not show one.',
    },
    date: {
      type: 'string',
      description: 'The purchase date as yyyy-mm-dd. Empty string if the slip does not show one.',
    },
    total: {
      type: 'number',
      description:
        'The grand total actually charged, after discounts, in baht. This is the figure the payment was for.',
    },
    lines: {
      type: 'array',
      description:
        'One entry per category the payment covered — typically three or four, never one per item.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category_id', 'amount', 'items'],
        properties: {
          category_id: {
            // Nullable on purpose (ADR-0017): an item the model cannot place
            // becomes a line the household must fill in, never a silent
            // "Other" -- the exact substitution ADR-0014 deleted.
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description:
              'The id of one of the household categories provided. null when none of them fits — never invent an id.',
          },
          amount: { type: 'number', description: 'Subtotal for this category, in baht.' },
          items: {
            type: 'array',
            description: 'The item names from the slip that were grouped into this line.',
            items: { type: 'string' },
          },
        },
      },
    },
  },
} as const

const SYSTEM = `You read Thai retail receipts and group what was bought into the household's own spending categories.

Group by category, not by item. A Makro slip has thirty lines; the household wants to know which three or four categories the payment covered, with a subtotal for each. Put every item into a line, and list the item names you grouped so the household can check your work.

Only ever use a category id from the list you are given. If an item does not fit any of them, put it in a line with category_id null rather than forcing it somewhere — a wrong category is worse than an unanswered one, because the household can see the blank and cannot see the mistake.

The total is the amount actually charged after discounts. Read it off the slip's grand total rather than adding the items up: your line subtotals may legitimately not reach it, because discounts, VAT lines and rounding are on the slip too, and the household's form absorbs the difference.

Amounts are in baht. If the slip is unreadable, return a total of 0 and no lines.`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

interface RequestBody {
  /** Base64, no data: prefix. */
  image: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  /** The household's own categories — id plus the path the user would recognise. */
  categories: { id: string; path: string }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'Bill scanning is not configured on this project.' }, 500)

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Malformed request' }, 400)
  }
  if (!body.image || !body.mediaType || !body.categories?.length) {
    return json({ error: 'Malformed request' }, 400)
  }

  const client = new Anthropic({ apiKey })

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: body.mediaType, data: body.image } },
            {
              type: 'text',
              text: `The household's categories:\n${body.categories
                .map((c) => `${c.id} — ${c.path}`)
                .join('\n')}\n\nRead this receipt.`,
            },
          ],
        },
      ],
    })
  } catch (error) {
    console.error('Anthropic call failed', error)
    const status = (error as { status?: number }).status
    // 429 and 5xx are worth retrying from the phone; a 400 is ours to fix and
    // retrying it just burns another request.
    return json(
      { error: status === 429 ? 'Too many scans at once — try again in a moment.' : 'Could not read that photo.' },
      status === 429 ? 429 : 502,
    )
  }

  // Claude returns a *successful* 200 with stop_reason "refusal" rather than
  // an error, so this has to be checked before content is read — `content` is
  // empty on a pre-output refusal and indexing into it would throw.
  if (response.stop_reason === 'refusal') {
    console.warn('Refused', response.stop_details)
    return json({ error: 'The model declined to read that image.' }, 422)
  }

  const text = response.content.find((b) => b.type === 'text')?.text
  if (!text) return json({ error: 'Could not read that photo.' }, 502)

  try {
    // Shape is guaranteed by the schema; the app validates the *values*
    // (ids that exist, amounts that are positive) before showing them.
    return json({ ...JSON.parse(text), usage: response.usage })
  } catch {
    console.error('Unparseable model output', text.slice(0, 500))
    return json({ error: 'Could not read that photo.' }, 502)
  }
})
