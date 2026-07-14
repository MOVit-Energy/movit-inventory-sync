import { shopifyGraphQL } from './shopify'

// Variant.metafields.b2c.dmoc (type money), consumed by the B2B partner feed —
// B2B-only products live outside the CZ B2C catalog, so the feed cannot read the
// B2C price directly and needs it snapshotted on the variant.
//
// DMOC = variant compare-at price; when that is unset the variant price *is* the DMOC.
const METAFIELD_NAMESPACE = 'b2c'
const METAFIELD_KEY = 'dmoc'

const PAGE_SIZE = 250

// metafieldsSet accepts max 25 metafields per call.
const BATCH_SIZE = 25

const SHOP_CURRENCY_QUERY = `
  query ShopCurrency {
    shop { currencyCode }
  }
`

const VARIANTS_QUERY = `
  query B2CVariants($first: Int!, $after: String, $namespace: String!, $key: String!) {
    productVariants(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          sku
          price
          compareAtPrice
          product { title }
          metafield(namespace: $namespace, key: $key) { value }
        }
      }
    }
  }
`

const SET_DMOC_MUTATION = `
  mutation SetB2CDmocBatch($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`

interface VariantNode {
  id: string
  title: string | null
  sku: string | null
  price: string
  compareAtPrice: string | null
  product: { title: string | null } | null
  metafield: { value: string } | null
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

export interface SyncB2CDmocResult {
  fetched: number
  written: number
  unchanged: number
  userErrors: UserError[]
}

async function fetchShopCurrency(): Promise<string> {
  const data = await shopifyGraphQL<{ shop: { currencyCode: string } }>(SHOP_CURRENCY_QUERY)
  return data.shop.currencyCode
}

async function fetchVariants(): Promise<VariantNode[]> {
  const variants: VariantNode[] = []
  let cursor: string | null = null

  do {
    type VariantsPage = {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string }
        edges: { node: VariantNode }[]
      }
    }

    const data: VariantsPage = await shopifyGraphQL<VariantsPage>(VARIANTS_QUERY, {
      first: PAGE_SIZE,
      after: cursor,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
    })

    const { productVariants } = data
    variants.push(...productVariants.edges.map(e => e.node))
    cursor = productVariants.pageInfo.hasNextPage ? productVariants.pageInfo.endCursor : null
  } while (cursor)

  return variants
}

// The stored value is a money metafield: {"amount":"123.0","currency_code":"CZK"}.
// Compare numerically so "123.0" and "123.00" do not count as a change.
function isUnchanged(existing: string | null | undefined, amount: string, currency: string): boolean {
  if (!existing) return false
  try {
    const parsed = JSON.parse(existing) as { amount?: string; currency_code?: string }
    return (
      parsed.currency_code === currency &&
      parsed.amount !== undefined &&
      Number(parsed.amount) === Number(amount)
    )
  } catch {
    return false
  }
}

function toMetafieldInputs(
  variants: VariantNode[],
  currency: string
): { inputs: MetafieldsSetInput[]; unchanged: number } {
  const inputs: MetafieldsSetInput[] = []
  let unchanged = 0

  for (const variant of variants) {
    const amount = variant.compareAtPrice ?? variant.price
    if (!amount) {
      console.warn(`[sync-b2c-dmoc] skipping variant without price: ${variant.id}`)
      continue
    }

    if (isUnchanged(variant.metafield?.value, amount, currency)) {
      unchanged++
      continue
    }

    const productTitle = variant.product?.title ?? '(unknown product)'
    const variantTitle = variant.title ? ` / ${variant.title}` : ''
    const sku = variant.sku ? ` [${variant.sku}]` : ''
    const source = variant.compareAtPrice ? 'compareAtPrice' : 'price'
    console.log(
      `[sync-b2c-dmoc] ${productTitle}${variantTitle}${sku} (${variant.id}) -> ` +
        `${amount} ${currency} (from ${source})`
    )

    inputs.push({
      ownerId: variant.id,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
      type: 'money',
      value: JSON.stringify({ amount, currency_code: currency }),
    })
  }

  return { inputs, unchanged }
}

export async function syncB2CDmoc(): Promise<SyncB2CDmocResult> {
  const [currency, variants] = await Promise.all([fetchShopCurrency(), fetchVariants()])
  const { inputs, unchanged } = toMetafieldInputs(variants, currency)

  let written = 0
  const userErrors: UserError[] = []

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE)

    const data = await shopifyGraphQL<{
      metafieldsSet: {
        metafields: { id: string }[]
        userErrors: UserError[]
      }
    }>(SET_DMOC_MUTATION, { metafields: batch })

    written += data.metafieldsSet.metafields.length
    userErrors.push(...data.metafieldsSet.userErrors)
  }

  return { fetched: variants.length, written, unchanged, userErrors }
}
