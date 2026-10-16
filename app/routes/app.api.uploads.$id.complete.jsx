import { authenticate } from "../shopify.server";
import { errorResponse, json, methodNotAllowed } from "../services/http.server";
import { getOrCreateShop } from "../services/shop.server";
import { completeUpload } from "../services/uploads.server";

// POST /app/api/uploads/:id/complete — the browser's hint that its upload finished. The server never
// trusts it: it re-reads the video from Stream. No body is accepted.
export const loader = () => methodNotAllowed();

export const action = async ({ request, params }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const { session } = await authenticate.admin(request);
  try {
    const shop = await getOrCreateShop(session);
    return json(await completeUpload(shop, params.id));
  } catch (error) {
    return errorResponse(error);
  }
};
