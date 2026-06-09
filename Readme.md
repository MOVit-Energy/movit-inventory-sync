# Manual inventory update

GET https://movit-inventory-sync.vercel.app/api/sync-all?token=57c73978ac9c9ec363402c5151ca449e717ef5c1e57e146f

# Mutation to register webhook for inventory update

```graphql
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
```

# Created mutation

- see also `scripts/register-webhook.ts` and scripts/list-webhooks.ts:23
- `node --env-file=.env.local --experimental-strip-types scripts/list-webhooks.ts`

```json
{
  "webhookSubscriptionCreate": {
    "webhookSubscription": {
      "id": "gid://shopify/WebhookSubscription/2247787741561"
    },
    "userErrors": []
  }
}

```