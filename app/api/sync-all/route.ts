import { NextRequest, NextResponse } from 'next/server'
import { syncAllProducts } from '@/lib/sync'

// Vercel Pro: max 300s, Hobby: max 60s
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token || token !== process.env.SYNC_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[sync-all] starting full sync')
  const started = Date.now()

  try {
    const result = await syncAllProducts()
    const elapsed = Math.round((Date.now() - started) / 1000)
    console.log(`[sync-all] done in ${elapsed}s`, result)
    return NextResponse.json({ ok: true, elapsed_s: elapsed, ...result })
  } catch (err) {
    console.error('[sync-all] fatal error', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
