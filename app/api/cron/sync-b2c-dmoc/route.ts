import { NextRequest, NextResponse } from 'next/server'
import { syncB2CDmoc } from '@/lib/b2c-dmoc'
import { alertSlack } from '@/lib/slack'

// Vercel Pro: max 300s, Hobby: max 60s
export const maxDuration = 300

export async function GET(request: NextRequest) {
  // Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[sync-b2c-dmoc] starting')
  const started = Date.now()

  try {
    const result = await syncB2CDmoc()
    const elapsed = Math.round((Date.now() - started) / 1000)

    console.log(
      `[sync-b2c-dmoc] done in ${elapsed}s — fetched=${result.fetched} written=${result.written} ` +
        `unchanged=${result.unchanged} userErrors=${result.userErrors.length}`
    )

    if (result.userErrors.length > 0) {
      console.error('[sync-b2c-dmoc] userErrors', JSON.stringify(result.userErrors))
      await alertSlack(
        'sync-b2c-dmoc',
        `⚠️ B2C DMOC sync finished with ${result.userErrors.length} userError(s) ` +
          `(written ${result.written}/${result.fetched}): ${JSON.stringify(result.userErrors)}`
      )
    }

    return NextResponse.json({ ok: true, elapsed_s: elapsed, ...result })
  } catch (err) {
    console.error('[sync-b2c-dmoc] fatal error', err)
    await alertSlack('sync-b2c-dmoc', `🔴 B2C DMOC sync FAILED: ${String(err)}`)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
