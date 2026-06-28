import { shopifyGraphQL } from './shopify'

// Shopify Markets price list "B2B All". Override via env if it ever changes.
const PRICE_LIST_ID = process.env.B2B_PRICE_LIST_ID ?? 'gid://shopify/PriceList/43564958073'

// Variant.metafields.b2b.price (type money), consumed by the Feediyo product feed.
const METAFIELD_NAMESPACE = 'b2b'
const METAFIELD_KEY = 'price'

// metafieldsSet accepts max 25 metafields per call.
const BATCH_SIZE = 25

const PRICE_LIST_QUERY = `
  query B2BPriceList($id: ID!) {
    priceList(id: $id) {
      prices(first: 250) {
        edges {
          node {
            price { amount currencyCode }
            variant {
              id
              title
              sku
              product { title }
            }
          }
        }
      }
    }
  }
`

const SET_B2B_PRICE_MUTATION = `
  mutation SetB2BPriceBatch($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`

interface PriceNode {
  price: { amount: string; currencyCode: string } | null
  variant: {
    id: string
    title: string | null
    sku: string | null
    product: { title: string | null } | null
  } | null
}

interface MetafieldsSetInput {
  ownerId: string
  namespace: string
  key: string
  type: 'money'
  value: string
}

interface UserError {
  field: string[] | null
  message: string
}

export interface SyncB2BPricesResult {
  fetched: number
  written: number
  userErrors: UserError[]
}

async function fetchB2BPrices(): Promise<PriceNode[]> {
  const data = await shopifyGraphQL<{
    priceList: { prices: { edges: { node: PriceNode }[] } } | null
  }>(PRICE_LIST_QUERY, { id: PRICE_LIST_ID })

  if (!data.priceList) {
    throw new Error(`Price list not found: ${PRICE_LIST_ID}`)
  }

  return data.priceList.prices.edges.map(e => e.node)
}

function toMetafieldInputs(prices: PriceNode[]): MetafieldsSetInput[] {
  const inputs: MetafieldsSetInput[] = []

  for (const node of prices) {
    if (!node.variant?.id || !node.price) {
      console.warn(
        `[sync-b2b-prices] skipping row — missing variant or price: ${JSON.stringify(node)}`
      )
      continue
    }

    const productTitle = node.variant.product?.title ?? '(unknown product)'
    const variantTitle = node.variant.title ?? ''
    const sku = node.variant.sku ? ` [${node.variant.sku}]` : ''
    console.log(
      `[sync-b2b-prices] ${productTitle}${variantTitle ? ` / ${variantTitle}` : ''}${sku} ` +
        `(${node.variant.id}) -> ${node.price.amount} ${node.price.currencyCode}`
    )

    inputs.push({
      ownerId: node.variant.id,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
      type: 'money',
      value: JSON.stringify({
        amount: node.price.amount,
        currency_code: node.price.currencyCode,
      }),
    })
  }

  return inputs
}

export async function syncB2BPrices(): Promise<SyncB2BPricesResult> {
  const prices = await fetchB2BPrices()
  const metafields = toMetafieldInputs(prices)

  let written = 0
  const userErrors: UserError[] = []

  for (let i = 0; i < metafields.length; i += BATCH_SIZE) {
    const batch = metafields.slice(i, i + BATCH_SIZE)

    const data = await shopifyGraphQL<{
      metafieldsSet: {
        metafields: { id: string }[]
        userErrors: UserError[]
      }
    }>(SET_B2B_PRICE_MUTATION, { metafields: batch })

    written += data.metafieldsSet.metafields.length
    userErrors.push(...data.metafieldsSet.userErrors)
  }

  return { fetched: prices.length, written, userErrors }
}
