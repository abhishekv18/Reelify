import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

// Placeholder until the Dashboard is built (see PROGRESS.md).
export default function Index() {
  return (
    <s-page heading="Reelify">
      <s-section heading="Welcome to Reelify">
        <s-paragraph>
          Shoppable videos for your store. Setup is in progress.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
