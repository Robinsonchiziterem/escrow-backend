import { Router, type Request, type Response } from "express";
import {
  addWebhookSubscription,
  removeWebhookSubscription,
} from "../indexer/db.js";
import { sendError, sendSuccess } from "../utils/api-response.js";

const router = Router();

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

router.post("/subscribe", (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    return sendError(res, 400, "url is required");
  }

  if (!isValidWebhookUrl(url)) {
    return sendError(res, 400, "url must be a valid http or https URL");
  }

  try {
    const subscription = addWebhookSubscription(url);
    return sendSuccess(res, {
      id: subscription.id,
      url: subscription.url,
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      return sendError(res, 409, "A subscription for this URL already exists");
    }
    return sendError(res, 500, "Failed to create webhook subscription");
  }
});

router.post("/unsubscribe", (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    return sendError(res, 400, "url is required");
  }

  const removed = removeWebhookSubscription(url);
  if (!removed) {
    return sendError(res, 404, "No subscription found for this URL");
  }

  return sendSuccess(res, { url });
});

export default router;
