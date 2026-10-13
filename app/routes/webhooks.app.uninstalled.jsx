import db from "../db.server";
import { markShopUninstalled } from "../repositories/shop.server";
import { withIdempotency } from "../services/webhooks.server";

export const action = async ({ request }) =>
  withIdempotency(request, "app/uninstalled", async ({ shop, session, topic }) => {
    console.log(`Received ${topic} webhook for ${shop}`);

    // Webhook requests can trigger multiple times and after an app has already been uninstalled.
    // If this webhook already ran, the session may have been deleted previously.
    if (session) {
      await db.session.deleteMany({ where: { shop } });
    }
    // Shop data is kept until shop/redact (Day 13); just record the uninstall.
    await markShopUninstalled(shop);
  });
