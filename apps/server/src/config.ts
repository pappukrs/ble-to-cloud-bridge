export interface ServerConfig {
  port: number;
  authToken: string;
  maxPayloadBytes: number;
  helloTimeoutMs: number;
}

/** Read config from the environment. Throws on a missing token so a misconfigured deploy fails loudly. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const authToken = env.AUTH_TOKEN;
  if (!authToken) {
    throw new Error('AUTH_TOKEN env var is required');
  }
  return {
    port: Number(env.PORT ?? 8080),
    authToken,
    maxPayloadBytes: Number(env.MAX_PAYLOAD_BYTES ?? 1024),
    helloTimeoutMs: Number(env.HELLO_TIMEOUT_MS ?? 5000),
  };
}
