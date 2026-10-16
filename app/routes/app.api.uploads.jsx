import { authenticate } from "../shopify.server";
import { errorResponse, json, methodNotAllowed, readJsonBody } from "../services/http.server";
import { getOrCreateShop } from "../services/shop.server";
import { createUpload } from "../services/uploads.server";

// POST /app/api/uploads — action-only resource route (no UI).
export const loader = () => methodNotAllowed();

export const action = async ({ request }) => {
  if (request.method !== "POST") return methodNotAllowed();
  // Throws a Response for unauthenticated requests; the shop comes only from the verified session.
  const { session } = await authenticate.admin(request);
  try {
    const shop = await getOrCreateShop(session);
    const body = await readJsonBody(request);
    return json(await createUpload(shop, body), 201);
  } catch (error) {
    return errorResponse(error);
  }
};
