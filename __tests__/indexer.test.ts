import Database from "better-sqlite3";
import {
  initSchema,
  getLastIndexedLedger,
  setLastIndexedLedger,
  insertEvent,
  getEventsByAddress,
  setDb,
  getDb,
} from "../src/indexer/db.js";

describe("Indexer Database", () => {
  let testDb: Database.Database;

  beforeAll(() => {
    testDb = new Database(":memory:");
    setDb(testDb);
  });

  afterAll(() => {
    testDb.close();
  });

  beforeEach(() => {
    testDb.exec("DROP TABLE IF EXISTS events");
    testDb.exec("DROP TABLE IF EXISTS indexer_state");
    testDb.exec("DROP TABLE IF EXISTS webhook_subscriptions");
    initSchema();
  });

  it("should track last indexed ledger correctly", () => {
    expect(getLastIndexedLedger()).toBe(0);
    setLastIndexedLedger(12345);
    expect(getLastIndexedLedger()).toBe(12345);
  });

  it("should avoid inserting duplicate events", () => {
    const contractId = "test-contract-id";
    const eventType = "test-event";
    const ledger1 = 100;
    const timestamp = 1234567890;
    const dataJson1 = JSON.stringify({ a: 1 });
    const dataJson2 = JSON.stringify({ a: 2 });

    insertEvent(contractId, eventType, ledger1, timestamp, dataJson1);
    insertEvent(contractId, eventType, ledger1, timestamp, dataJson2);

    const events = testDb.prepare("SELECT * FROM events").all();
    expect(events.length).toBe(1);
    expect((events[0] as any).data_json).toEqual(dataJson1);
  });

  it("should return events filtered by address", () => {
    const contractId = "test-contract-id";
    const addr1 = "GAAAAA1";
    const addr2 = "GAAAAA2";
    const data1 = JSON.stringify({ client: addr1, freelancer: addr2 });
    const data2 = JSON.stringify({ arbiter: addr1 });
    const data3 = JSON.stringify({ someone: "else" });

    insertEvent(contractId, "event1", 100, 123456, data1);
    insertEvent(contractId, "event2", 101, 123457, data2);
    insertEvent(contractId, "event3", 102, 123458, data3);

    const events1 = getEventsByAddress(addr1);
    expect(events1.length).toBe(2);

    const events2 = getEventsByAddress(addr2);
    expect(events2.length).toBe(1);
  });
});
