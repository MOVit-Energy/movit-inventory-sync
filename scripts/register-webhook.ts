import { shopifyGraphQL } from '../lib/shopify.ts'

const mutation = `
  mutation {
    webhookSubscriptionCreate(
      topic: INVENTORY_LEVELS_UPDATE
      webhookSubscription: {
        callbackUrl: "https://movit-inventory-sync.vercel.app/api/webhook/inventory-update"
        format: JSON
      }
    ) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`

const result = await shopifyGraphQL(mutation)
console.log(JSON.stringify(result, null, 2))
