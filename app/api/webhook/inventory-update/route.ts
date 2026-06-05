import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getProductIdFromInventoryItem, syncProduct } from '@/lib/sync'

function verifyHmac(rawBody: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_API_SECRET!
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader))
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256') ?? ''

  if (!verifyHmac(rawBody, hmacHeader)) {
    console.warn('[webhook] invalid HMAC')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: { inventory_item_id: number; location_id: number }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const inventoryItemGid = `gid://shopify/InventoryItem/${payload.inventory_item_id}`

  try {
    const productId = await getProductIdFromInventoryItem(inventoryItemGid)
    if (!productId) {
      console.warn(`[webhook] no product for inventoryItem=${inventoryItemGid}`)
      return NextResponse.json({ ok: true })
    }

    await syncProduct(productId)
    console.log(`[webhook] synced product=${productId}`)
  } catch (err) {
    console.error('[webhook] error', err)
    // Vracíme 200 i při chybě — Shopify by jinak webhook opakoval
    return NextResponse.json({ ok: false, error: String(err) })
  }

  return NextResponse.json({ ok: true })
}
