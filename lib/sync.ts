import { shopifyGraphQL } from './shopify'

const LOCATION_B2C = process.env.LOCATION_ID_B2C!
const LOCATION_B2B = process.env.LOCATION_ID_B2B!

interface InventoryLevel {
  location: { id: string }
  quantities: { name: string; quantity: number }[]
}

interface Variant {
  inventoryItem: {
    inventoryLevels: {
      edges: { node: InventoryLevel }[]
    }
  }
}

interface Product {
  id: string
  variants: {
    edges: { node: Variant }[]
  }
}

const PRODUCT_INVENTORY_QUERY = `
  query GetProductInventory($id: ID!) {
    product(id: $id) {
      id
      variants(first: 100) {
        edges {
          node {
            inventoryItem {
              inventoryLevels(first: 10) {
                edges {
                  node {
                    location { id }
                    quantities(names: ["available"]) {
                      name
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`

const ALL_PRODUCTS_QUERY = `
  query GetAllProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          variants(first: 10) {
            edges {
              node {
                inventoryItem {
                  inventoryLevels(first: 3) {
                    edges {
                      node {
                        location { id }
                        quantities(names: ["available"]) {
                          name
                          quantity
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`

const INVENTORY_ITEM_QUERY = `
  query GetProductFromInventoryItem($id: ID!) {
    inventoryItem(id: $id) {
      variant {
        product { id }
      }
    }
  }
`

const METAFIELDS_SET_MUTATION = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`

function calcStock(product: Product): { stock_b2c: number; stock_b2b: number } {
  let stock_b2c = 0
  let stock_b2b = 0

  for (const { node: variant } of product.variants.edges) {
    for (const { node: level } of variant.inventoryItem.inventoryLevels.edges) {
      const available = level.quantities.find(q => q.name === 'available')?.quantity ?? 0
      if (level.location.id === LOCATION_B2C) stock_b2c += available
      if (level.location.id === LOCATION_B2B) stock_b2b += available
    }
  }

  return { stock_b2c, stock_b2b }
}

async function saveMetafields(productId: string, stock_b2c: number, stock_b2b: number) {
  const data = await shopifyGraphQL<{
    metafieldsSet: { userErrors: { field: string; message: string }[] }
  }>(METAFIELDS_SET_MUTATION, {
    metafields: [
      { ownerId: productId, namespace: 'custom', key: 'stock_b2c', type: 'number_integer', value: String(stock_b2c) },
      { ownerId: productId, namespace: 'custom', key: 'stock_b2b', type: 'number_integer', value: String(stock_b2b) },
    ],
  })

  const errors = data.metafieldsSet.userErrors
  if (errors.length > 0) {
    throw new Error(`metafieldsSet errors: ${JSON.stringify(errors)}`)
  }
}

export async function getProductIdFromInventoryItem(inventoryItemId: string): Promise<string | null> {
  const data = await shopifyGraphQL<{
    inventoryItem: { variant: { product: { id: string } } } | null
  }>(INVENTORY_ITEM_QUERY, { id: inventoryItemId })

  return data.inventoryItem?.variant?.product?.id ?? null
}

export async function syncProduct(productId: string): Promise<void> {
  const data = await shopifyGraphQL<{ product: Product }>(PRODUCT_INVENTORY_QUERY, { id: productId })
  const { stock_b2c, stock_b2b } = calcStock(data.product)

  console.log(`[sync] product=${productId} b2c=${stock_b2c} b2b=${stock_b2b}`)
  await saveMetafields(productId, stock_b2c, stock_b2b)
}

export async function syncAllProducts(): Promise<{ synced: number; errors: number }> {
  let cursor: string | null = null
  let synced = 0
  let errors = 0

  do {
    const data = await shopifyGraphQL<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string }
        edges: { node: Product }[]
      }
    }>(ALL_PRODUCTS_QUERY, { first: 50, after: cursor })

    const { products } = data

    for (const { node: product } of products.edges) {
      try {
        const { stock_b2c, stock_b2b } = calcStock(product)
        console.log(`[sync-all] product=${product.id} b2c=${stock_b2c} b2b=${stock_b2b}`)
        await saveMetafields(product.id, stock_b2c, stock_b2b)
        synced++
      } catch (err) {
        console.error(`[sync-all] error product=${product.id}`, err)
        errors++
      }
    }

    cursor = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null
  } while (cursor)

  return { synced, errors }
}
