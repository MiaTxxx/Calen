/*
 * BaoStock TCP adapter for Calen.
 * Protocol constants and response layout were adapted from
 * Opptrix packages/a-stock-layer/src/providers/baostock (Apache-2.0),
 * then reduced and rewritten for Calen's snapshot/history Provider seam.
 */

import { createConnection, type Socket } from "node:net";
import { crc32, unzipSync } from "node:zlib";

import type {
  HistoryRequest,
  InstrumentRef,
  PriceBar,
  ProviderContext,
  ProviderEvidence,
  StockProvider,
  StockSnapshot,
} from "../types.ts";
import { ProviderError } from "./registry.ts";

const CLIENT_VERSION = "00.9.20";
const SERVER_HOST = "public-api.baostock.com";
const SERVER_PORT = 10030;
const MESSAGE_SPLIT = "\x01";
const MESSAGE_END_SUFFIX = Buffer.from("<![CDATA[]]>\n", "utf8");
const HEADER_LENGTH = 21;
const LOGIN_REQUEST = "00";
const LOGIN_RESPONSE = "01";
const KLINE_REQUEST = "95";
const KLINE_RESPONSE = "96";
const PAGE_SIZE = 500;
const KLINE_FIELDS = [
  "date",
  "code",
  "open",
  "high",
  "low",
  "close",
  "preclose",
  "volume",
  "amount",
  "adjustflag",
  "turn",
  "tradestatus",
  "pctChg",
].join(",");

export interface BaostockTcpConnection {
  request(payload: string, signal?: AbortSignal): Promise<Buffer>;
  close(): void;
}

export type BaostockTcpFactory = (
  signal?: AbortSignal
) => Promise<BaostockTcpConnection>;

export interface CreateBaostockProviderOptions {
  socketFactory?: BaostockTcpFactory;
}

export class BaostockProtocolError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "BaostockProtocolError";
  }
}

interface ParsedMessage {
  type: string;
  parts: string[];
}

interface DailyBar extends PriceBar {
  previousClose?: number;
  changePercent?: number;
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new ProviderError("BaoStock request cancelled");
}

function createNodeConnection(
  signal?: AbortSignal
): Promise<BaostockTcpConnection> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: SERVER_HOST, port: SERVER_PORT });
    let settled = false;
    const cleanup = () => {
      socket.off("connect", connected);
      socket.off("error", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const connected = () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.setNoDelay(true);
      resolve(new NodeBaostockConnection(socket));
    };
    const failed = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const aborted = () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(abortReason(signal));
    };
    socket.once("connect", connected);
    socket.once("error", failed);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

class NodeBaostockConnection implements BaostockTcpConnection {
  private readonly socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;
  }

  request(payload: string, signal?: AbortSignal): Promise<Buffer> {
    if (signal?.aborted) {
      this.close();
      return Promise.reject(abortReason(signal));
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let settled = false;
      const cleanup = () => {
        this.socket.off("data", received);
        this.socket.off("error", failed);
        this.socket.off("end", ended);
        signal?.removeEventListener("abort", aborted);
      };
      const finish = (error?: unknown, value?: Buffer) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error !== undefined) reject(error);
        else resolve(value ?? Buffer.alloc(0));
      };
      const received = (chunk: Buffer) => {
        chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (
          buffer.length >= MESSAGE_END_SUFFIX.length &&
          buffer
            .subarray(buffer.length - MESSAGE_END_SUFFIX.length)
            .equals(MESSAGE_END_SUFFIX)
        ) {
          finish(undefined, buffer);
        }
      };
      const failed = (error: Error) => finish(error);
      const ended = () =>
        finish(new BaostockProtocolError("BaoStock connection closed"));
      const aborted = () => {
        const reason = abortReason(signal);
        this.close();
        finish(reason);
      };
      this.socket.on("data", received);
      this.socket.once("error", failed);
      this.socket.once("end", ended);
      signal?.addEventListener("abort", aborted, { once: true });
      this.socket.write(payload, "utf8", (error) => {
        if (error) finish(error);
      });
    });
  }

  close(): void {
    this.socket.destroy();
  }
}

function buildRequest(type: string, bodyParts: string[]): string {
  const body = bodyParts.join(MESSAGE_SPLIT);
  const bodyLength = Buffer.byteLength(body, "utf8");
  const header = `${CLIENT_VERSION}${MESSAGE_SPLIT}${type}${MESSAGE_SPLIT}${String(bodyLength).padStart(10, "0")}`;
  const headBody = header + body;
  return `${headBody}${MESSAGE_SPLIT}${String(crc32(Buffer.from(headBody, "utf8")) >>> 0)}\n`;
}

function parseResponse(raw: Buffer, expectedType: string): ParsedMessage {
  if (raw.length < HEADER_LENGTH) {
    throw new BaostockProtocolError("BaoStock response header is truncated");
  }
  const header = raw.subarray(0, HEADER_LENGTH).toString("utf8");
  const [version, type, rawLength] = header.split(MESSAGE_SPLIT);
  if (
    version !== CLIENT_VERSION ||
    !type ||
    !/^\d{10}$/.test(rawLength ?? "")
  ) {
    throw new BaostockProtocolError("BaoStock response header is invalid");
  }
  if (type !== expectedType) {
    throw new BaostockProtocolError(
      `BaoStock 响应类型错误：期望 ${expectedType}，实际 ${type}`
    );
  }
  const bodyLength = Number(rawLength);
  if (raw.length < HEADER_LENGTH + bodyLength) {
    throw new BaostockProtocolError("BaoStock response body is truncated");
  }
  const encodedBody = raw.subarray(HEADER_LENGTH, HEADER_LENGTH + bodyLength);
  let body: Buffer;
  try {
    body = type === KLINE_RESPONSE ? unzipSync(encodedBody) : encodedBody;
  } catch (error) {
    throw new BaostockProtocolError("BaoStock response decompression failed", {
      cause: error,
    });
  }
  return { type, parts: body.toString("utf8").split(MESSAGE_SPLIT) };
}

function parseRecords(raw: string | undefined): unknown[][] {
  if (!raw?.trim()) return [];
  try {
    const payload = JSON.parse(raw.replace(/\s+/g, "")) as {
      record?: unknown;
    };
    if (!Array.isArray(payload.record)) return [];
    return payload.record.filter(Array.isArray);
  } catch (error) {
    throw new BaostockProtocolError("BaoStock row payload is invalid", {
      cause: error,
    });
  }
}

function numeric(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function chinaDateOnly(date: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function daysBefore(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ProviderError(`BaoStock invalid date: ${date}`);
  }
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return dateOnly(parsed);
}

function providerCode(instrument: InstrumentRef): string | null {
  if (instrument.market !== "CN") return null;
  if (instrument.exchange === "SSE") return `sh.${instrument.symbol}`;
  if (instrument.exchange === "SZSE") return `sz.${instrument.symbol}`;
  return null;
}

function marketClose(date: string): string {
  return `${date}T15:00:00.000+08:00`;
}

function mapRows(fields: string[], records: unknown[][]): DailyBar[] {
  const bars = records.flatMap((record): DailyBar[] => {
    const row = Object.fromEntries(
      fields.map((field, index) => [field, record[index]])
    );
    if (String(row.tradestatus ?? "1") === "0") return [];
    const time = typeof row.date === "string" ? row.date.slice(0, 10) : "";
    const open = numeric(row.open);
    const high = numeric(row.high);
    const low = numeric(row.low);
    const close = numeric(row.close);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(time) ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      close <= 0
    ) {
      return [];
    }
    const bar: DailyBar = { time, open, high, low, close };
    const volume = numeric(row.volume);
    const previousClose = numeric(row.preclose);
    const changePercent = numeric(row.pctChg);
    if (volume !== undefined) bar.volume = volume;
    if (previousClose !== undefined) bar.previousClose = previousClose;
    if (changePercent !== undefined) bar.changePercent = changePercent;
    return [bar];
  });
  return bars.sort((left, right) => left.time.localeCompare(right.time));
}

function assertSuccess(parts: string[], operation: string): void {
  if (parts[0] !== "0") {
    throw new ProviderError(
      `BaoStock ${operation} failed (${parts[0] ?? "unknown"}): ${parts[1] ?? "unknown error"}`
    );
  }
}

async function login(
  connection: BaostockTcpConnection,
  signal?: AbortSignal
): Promise<void> {
  const payload = buildRequest(LOGIN_REQUEST, [
    "login",
    "anonymous",
    "123456",
    "0",
  ]);
  const parsed = parseResponse(
    await connection.request(payload, signal),
    LOGIN_RESPONSE
  );
  assertSuccess(parsed.parts, "login");
}

async function queryDailyBars(
  connection: BaostockTcpConnection,
  instrument: InstrumentRef,
  request: HistoryRequest,
  context: ProviderContext
): Promise<DailyBar[]> {
  const code = providerCode(instrument);
  if (!code) return [];
  const limit = Math.min(Math.max(request.limit ?? 120, 1), 2_000);
  const end = request.end ?? chinaDateOnly(context.now());
  const start = request.start ?? daysBefore(end, limit * 2 + 30);
  const records: unknown[][] = [];
  let page = 1;
  let fields: string[] = [];
  for (;;) {
    if (context.signal?.aborted) throw abortReason(context.signal);
    const payload = buildRequest(KLINE_REQUEST, [
      "query_history_k_data_plus",
      "anonymous",
      String(page),
      String(PAGE_SIZE),
      code,
      KLINE_FIELDS,
      start,
      end,
      "d",
      "2",
    ]);
    const parsed = parseResponse(
      await connection.request(payload, context.signal),
      KLINE_RESPONSE
    );
    assertSuccess(parsed.parts, "history query");
    const pageRecords = parseRecords(parsed.parts[6]);
    fields = (parsed.parts[8] ?? "")
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    if (!fields.length) {
      throw new BaostockProtocolError("BaoStock history fields are missing");
    }
    records.push(...pageRecords);
    if (pageRecords.length < PAGE_SIZE) break;
    page += 1;
  }
  return mapRows(fields, records).slice(-limit);
}

async function withSession<T>(
  factory: BaostockTcpFactory,
  context: ProviderContext,
  operation: (connection: BaostockTcpConnection) => Promise<T>
): Promise<T> {
  let connection: BaostockTcpConnection | undefined;
  try {
    connection = await factory(context.signal);
    await login(connection, context.signal);
    return await operation(connection);
  } catch (error) {
    if (context.signal?.aborted) throw abortReason(context.signal);
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      `BaoStock request failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  } finally {
    connection?.close();
  }
}

function unsupported(
  instrument: InstrumentRef,
  context: ProviderContext
): ProviderEvidence<never> {
  return {
    data: null,
    asOf: context.now().toISOString(),
    warnings: [
      instrument.market !== "CN"
        ? "BaoStock 首版仅支持 A 股日 K"
        : "BaoStock 首版暂不支持北交所标的",
    ],
  };
}

export function createBaostockProvider(
  options: CreateBaostockProviderOptions = {}
): StockProvider {
  const socketFactory = options.socketFactory ?? createNodeConnection;
  return {
    id: "baostock",
    priority: 40,
    free: true,
    capabilities: ["snapshot", "history"],
    async history(instrument, request, context) {
      if (!providerCode(instrument)) return unsupported(instrument, context);
      const bars = await withSession(socketFactory, context, (connection) =>
        queryDailyBars(connection, instrument, request, context)
      );
      const historyBars: PriceBar[] = bars.map((bar) => {
        const normalized: PriceBar = {
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        };
        if (bar.volume !== undefined) normalized.volume = bar.volume;
        return normalized;
      });
      return {
        data: historyBars.length ? historyBars : null,
        asOf: historyBars.at(-1)?.time ?? context.now().toISOString(),
      };
    },
    async snapshot(
      instrument,
      context
    ): Promise<ProviderEvidence<StockSnapshot>> {
      if (!providerCode(instrument)) return unsupported(instrument, context);
      const bars = await withSession(socketFactory, context, (connection) =>
        queryDailyBars(connection, instrument, { limit: 5 }, context)
      );
      const latest = bars.at(-1);
      if (!latest) {
        return {
          data: null,
          asOf: context.now().toISOString(),
          warnings: ["BaoStock 未返回可用日 K，未构造快照"],
        };
      }
      const asOf = marketClose(latest.time);
      const data: StockSnapshot = {
        instrument,
        price: latest.close,
        open: latest.open,
        high: latest.high,
        low: latest.low,
        marketTime: asOf,
      };
      if (latest.volume !== undefined) data.volume = latest.volume;
      if (latest.previousClose !== undefined) {
        data.previousClose = latest.previousClose;
        data.change = latest.close - latest.previousClose;
      }
      if (latest.changePercent !== undefined) {
        data.changePercent = latest.changePercent;
      } else if (latest.previousClose && latest.previousClose > 0) {
        data.changePercent =
          ((latest.close - latest.previousClose) / latest.previousClose) * 100;
      }
      return {
        data,
        asOf,
        warnings: [
          "BaoStock 不提供实时行情；此快照由最近交易日日 K 构造，可能存在延迟。",
        ],
      };
    },
  };
}
