import db from "../db.server";
import { withIdempotency } from "../services/webhooks.server";

export const action = async ({ request }) =>
  withIdempotency(request, "app/scopes_update", async ({ payload, session, topic, shop }) => {
    console.log(`Received ${topic} webhook for ${shop}`);
    const current = payload.current;

    if (session) {
      await db.session.update({
        where: {
          id: session.id,
        },
        data: {
          scope: current.toString(),
        },
      });
    }
  });
