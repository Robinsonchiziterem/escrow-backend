import { jest } from "@jest/globals";
import Database from "better-sqlite3";
import request from "supertest";
import express from "express";
import {
  initSchema,
  addWebhookSubscription,
  getWebhookSubscriptions,
  setDb,
} from "../src/indexer/db.js";
import webhookRoutes from "../src/routes/webhooks.js";
import {
  buildMilestoneWebhookPayload,
  parseMilestoneIndex,
  mapEventTypeToStatus,
} from "../src/webhooks/milestone-events.js";
import { deliverWebhook } from "../src/webhooks/deliver.js";
import { dispatchMilestoneWebhook } from "../src/webhooks/dispatcher.js";

let testDb: Database.Database;
let fetchMock: jest.Mock;

const app = express();
app.use(express.json());
app.use("/api/webhooks", webhookRoutes);

beforeAll(() => {
  testDb = new Database(":memory:");
  setDb(testDb);
  initSchema();
});

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  testDb.exec("DELETE FROM webhook_subscriptions");
  process.env.WEBHOOK_RETRY_DELAY_MS = "0";
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("milestone event parsing", () => {
  it("maps contract event types to webhook statuses", () => {
    expect(mapEventTypeToStatus("delivered")).toBe("delivered");
    expect(mapEventTypeToStatus("approved")).toBe("approved");
    expect(mapEventTypeToStatus("dispute_raised")).toBe("disputed");
    expect(mapEventTypeToStatus("dispute_resolved")).toBe("resolved");
  });

  it("parses milestone index from common payload shapes", () => {
    expect(parseMilestoneIndex(2)).toBe(2);
    expect(parseMilestoneIndex([1])).toBe(1);
    expect(parseMilestoneIndex({ index: 3 })).toBe(3);
    expect(parseMilestoneIndex({ milestone_index: 4 })).toBe(4);
    expect(parseMilestoneIndex({ unrelated: true })).toBeNull();
  });

  it("builds webhook payload with required fields", () => {
    const payload = buildMilestoneWebhookPayload(
      "C123",
      "delivered",
      { index: 1 },
      "abc123hash"
    );

    expect(payload).toEqual({
      contractId: "C123",
      milestoneIndex: 1,
      newStatus: "delivered",
      txHash: "abc123hash",
    });
  });

  it("returns null for non-milestone events", () => {
    expect(
      buildMilestoneWebhookPayload("C123", "funded", { index: 0 }, "hash")
    ).toBeNull();
  });
});

describe("POST /api/webhooks/subscribe", () => {
  it("registers a webhook URL", async () => {
    const res = await request(app)
      .post("/api/webhooks/subscribe")
      .send({ url: "https://example.com/hook" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toBe("https://example.com/hook");
    expect(res.body.data.id).toEqual(expect.any(Number));
    expect(getWebhookSubscriptions()).toHaveLength(1);
  });

  it("rejects invalid URLs", async () => {
    const res = await request(app)
      .post("/api/webhooks/subscribe")
      .send({ url: "not-a-url" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects duplicate subscriptions", async () => {
    await request(app)
      .post("/api/webhooks/subscribe")
      .send({ url: "https://example.com/hook" });

    const res = await request(app)
      .post("/api/webhooks/subscribe")
      .send({ url: "https://example.com/hook" });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already exists");
  });
});

describe("POST /api/webhooks/unsubscribe", () => {
  it("removes an existing subscription", async () => {
    addWebhookSubscription("https://example.com/hook");

    const res = await request(app)
      .post("/api/webhooks/unsubscribe")
      .send({ url: "https://example.com/hook" });

    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe("https://example.com/hook");
    expect(getWebhookSubscriptions()).toHaveLength(0);
  });

  it("returns 404 when subscription does not exist", async () => {
    const res = await request(app)
      .post("/api/webhooks/unsubscribe")
      .send({ url: "https://example.com/missing" });

    expect(res.status).toBe(404);
  });
});

describe("webhook delivery", () => {
  it("retries failed deliveries up to 3 times", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const payload = {
      contractId: "C123",
      milestoneIndex: 0,
      newStatus: "delivered",
      txHash: "hash",
    };

    const delivered = await deliverWebhook("https://example.com/hook", payload);

    expect(delivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify(payload));
  });

  it("returns false after 3 failed attempts", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const delivered = await deliverWebhook("https://example.com/hook", {
      contractId: "C123",
      milestoneIndex: 0,
      newStatus: "approved",
      txHash: "hash",
    });

    expect(delivered).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("dispatches to all subscribers", async () => {
    addWebhookSubscription("https://example.com/hook-a");
    addWebhookSubscription("https://example.com/hook-b");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    dispatchMilestoneWebhook({
      contractId: "C123",
      milestoneIndex: 2,
      newStatus: "disputed",
      txHash: "hash",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("subscription persistence", () => {
  it("keeps subscriptions after schema re-init on same database", () => {
    addWebhookSubscription("https://example.com/persisted");
    initSchema();

    const subs = getWebhookSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].url).toBe("https://example.com/persisted");
  });
});
