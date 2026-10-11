import { z } from 'zod';

/**
 * Every frame that crosses the WebSocket is JSON matching one of these shapes.
 * The server and the web app both import this file, so a change here breaks
 * both builds at compile time instead of one of them at runtime.
 */

/** Sent by any client as its first frame. The server drops the socket if it never arrives. */
export const HelloMessage = z.object({
  type: z.literal('hello'),
  role: z.enum(['bridge', 'dashboard']),
  token: z.string().min(1),
});

/** A value the bridge laptop read from the phone over BLE. */
export const ReadingMessage = z.object({
  type: z.literal('reading'),
  source: z.literal('ble'),
  deviceName: z.string().optional(),
  value: z.string(),
  rssi: z.number().int().optional(),
  ts: z.number().int().nonnegative(),
});

/** Server -> client acknowledgement after a valid hello. */
export const WelcomeMessage = z.object({
  type: z.literal('welcome'),
  clientId: z.string(),
  peers: z.number().int().nonnegative(),
});

/** Server -> client when something is wrong with the last frame. */
export const ErrorMessage = z.object({
  type: z.literal('error'),
  code: z.enum(['unauthorized', 'invalid_message', 'payload_too_large']),
  detail: z.string().optional(),
});

export const Message = z.discriminatedUnion('type', [
  HelloMessage,
  ReadingMessage,
  WelcomeMessage,
  ErrorMessage,
]);

export type HelloMessage = z.infer<typeof HelloMessage>;
export type ReadingMessage = z.infer<typeof ReadingMessage>;
export type WelcomeMessage = z.infer<typeof WelcomeMessage>;
export type ErrorMessage = z.infer<typeof ErrorMessage>;
export type Message = z.infer<typeof Message>;
export type ClientRole = HelloMessage['role'];

export type ParseResult = { ok: true; message: Message } | { ok: false; reason: string };

/**
 * Turn a raw wire string into a typed Message.
 * Never throws: bad JSON and schema failures both come back as { ok: false }.
 */
export function parseMessage(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  const result = Message.safeParse(json);
  if (!result.success) {
    return { ok: false, reason: result.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, message: result.data };
}

export function serializeMessage(message: Message): string {
  return JSON.stringify(message);
}
