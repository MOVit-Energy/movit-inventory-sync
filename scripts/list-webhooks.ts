import { shopifyGraphQL } from '../lib/shopify.ts'

const query = `
  {
    webhookSubscriptions(first: 50) {
      edges {
        node {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint { callbackUrl }
          }
          createdAt
        }
      }
    }
  }
`

const result = await shopifyGraphQL(query)
console.log(JSON.stringify(result, null, 2))
