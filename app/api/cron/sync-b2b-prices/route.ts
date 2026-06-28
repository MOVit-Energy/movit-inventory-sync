import { NextRequest, NextResponse } from 'next/server'
import { syncB2BPrices } from '@/lib/b2b-prices'

// Vercel Pro: max 300s, Hobby: max 60s
export const maxDuration = 300

async function alertSlack(text: string) {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    console.error('[sync-b2b-prices] slack alert failed', err)
  }
}

export async function GET(request: NextRequest) {
  // Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[sync-b2b-prices] starting')
  const started = Date.now()

  try {
    const result = await syncB2BPrices()
    const elapsed = Math.round((Date.now() - started) / 1000)

    console.log(
      `[sync-b2b-prices] done in ${elapsed}s — fetched=${result.fetched} written=${result.written} userErrors=${result.userErrors.length}`
    )

    if (result.userErrors.length > 0) {
      console.error('[sync-b2b-prices] userErrors', JSON.stringify(result.userErrors))
      await alertSlack(
        `⚠️ B2B price sync finished with ${result.userErrors.length} userError(s) ` +
          `(written ${result.written}/${result.fetched}): ${JSON.stringify(result.userErrors)}`
      )
    }

    return NextResponse.json({ ok: true, elapsed_s: elapsed, ...result })
  } catch (err) {
    console.error('[sync-b2b-prices] fatal error', err)
    await alertSlack(`🔴 B2B price sync FAILED: ${String(err)}`)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
