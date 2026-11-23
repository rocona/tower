import net from 'node:net';
import { validateTargetHost } from '../security/ssrf.js';

export interface ProbeResult {
  nodeId: string;
  latencyMs: number | null;
  error: string | null;
}

export async function tcpHandshakeProbe(
  host: string,
  port: number,
  options: { allowPrivate: boolean; timeoutMs?: number },
): Promise<{ latencyMs: number | null; error: string | null }> {
  const timeoutMs = options.timeoutMs ?? 3500;
  let target: { address: string; family: 4 | 6 };
  try {
    target = await validateTargetHost(host, options.allowPrivate);
  } catch (err) {
    return { latencyMs: null, error: err instanceof Error ? err.message : '目标地址被安全策略拦截' };
  }

  return new Promise((resolve) => {
    const started = performance.now();
    const socket = net.createConnection({
      host: target.address,
      port,
      family: target.family,
    });
    let settled = false;

    const finish = (latencyMs: number | null, error: string | null) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ latencyMs, error });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      const elapsed = Math.max(1, Math.round(performance.now() - started));
      finish(elapsed, null);
    });
    socket.once('timeout', () => finish(null, 'TCP 连接超时'));
    socket.once('error', (err) => finish(null, err.message || 'TCP 连接失败'));
  });
}

export async function probeNodesBatch<T extends { id: string; host: string; port: number }>(
  nodes: T[],
  options: { allowPrivate: boolean; concurrency?: number; timeoutMs?: number },
): Promise<ProbeResult[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, 12));
  const results: ProbeResult[] = new Array(nodes.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= nodes.length) return;
      const node = nodes[index];
      const res = await tcpHandshakeProbe(node.host, node.port, options);
      results[index] = { nodeId: node.id, ...res };
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, nodes.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
