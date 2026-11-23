import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type TowerAppInstance } from '../src/server/app.js';
import { createDbClient } from '../src/server/db/client.js';
import { loadConfig } from '../src/server/config.js';

describe('Tower API E2E (PGlite PostgreSQL)', () => {
  let instance: TowerAppInstance;
  let sessionCookie = '';

  beforeAll(async () => {
    const config = {
      ...loadConfig({
        PORT: '8080',
        DATABASE_URL: 'pglite://memory',
        PUBLIC_BASE_URL: 'https://tower.test',
        ALLOW_PRIVATE_FETCH: 'false',
      }),
    };
    const db = await createDbClient(config);
    instance = await buildApp({ config, db });
  });

  afterAll(async () => {
    if (instance) {
      await instance.app.close();
    }
  });

  it('exposes /healthz and blocks unauthenticated admin API access', async () => {
    const health = await instance.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('ok');

    const unauth = await instance.app.inject({ method: 'GET', url: '/api/overview' });
    expect(unauth.statusCode).toBe(401);
  });

  it('initializes admin password, imports nodes, and serves client-tagged hosted links', async () => {
    const setupRes = await instance.app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'tower-admin-password-2026' },
    });
    expect(setupRes.statusCode).toBe(200);
    const setCookie = setupRes.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    sessionCookie = Array.isArray(setCookie) ? setCookie[0].split(';')[0] : setCookie!.split(';')[0];

    // Import manual nodes
    const importRes = await instance.app.inject({
      method: 'POST',
      url: '/api/sources/manual/import',
      headers: { cookie: sessionCookie },
      payload: {
        text: [
          'ss://YWVzLTI1Ni1nY206c2VjcmV0@1.2.3.4:8388#%F0%9F%87%AD%F0%9F%87%B0%20%E9%A6%99%E6%B8%AF%200.1x',
          `hysteria2://hy2pass@jp.example.com:443?sni=jp.example.com&pinSHA256=${'c'.repeat(64)}#%F0%9F%87%AF%F0%9F%87%B5%20%E4%B8%9C%E4%BA%AC%20Hy2`,
        ].join('\n'),
      },
    });
    expect(importRes.statusCode).toBe(201);
    expect(importRes.json().importedCount).toBe(2);

    // Create Surge hosted channel
    const surgeChRes = await instance.app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { cookie: sessionCookie },
      payload: { name: 'iPhone Surge', client: 'surge', mode: 'full' },
    });
    expect(surgeChRes.statusCode).toBe(201);
    const surgeChannel = surgeChRes.json().channel;
    expect(surgeChannel.subscribeUrl).toBe(`https://tower.test/sub/surge/${surgeChannel.token}`);
    expect(surgeChannel).not.toHaveProperty('expiresAt');

    // Create Clash hosted channel
    const clashChRes = await instance.app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { cookie: sessionCookie },
      payload: { name: 'Mac Clash', client: 'clash', mode: 'full' },
    });
    expect(clashChRes.statusCode).toBe(201);
    const clashChannel = clashChRes.json().channel;
    expect(clashChannel.subscribeUrl).toBe(`https://tower.test/sub/clash/${clashChannel.token}`);

    // Public fetch Surge link (no admin cookie required)
    const subSurge = await instance.app.inject({
      method: 'GET',
      url: `/sub/surge/${surgeChannel.token}`,
    });
    expect(subSurge.statusCode).toBe(200);
    expect(subSurge.body).toContain('#!MANAGED-CONFIG https://tower.test/sub/surge/');
    expect(subSurge.body).toContain(`server-cert-fingerprint-sha256=${'c'.repeat(64)}`);

    // Mismatched client prefix must return 404
    const wrongPrefix = await instance.app.inject({
      method: 'GET',
      url: `/sub/clash/${surgeChannel.token}`,
    });
    expect(wrongPrefix.statusCode).toBe(404);

    // Public fetch Clash link
    const subClash = await instance.app.inject({
      method: 'GET',
      url: `/sub/clash/${clashChannel.token}`,
    });
    expect(subClash.statusCode).toBe(200);
    expect(subClash.body).toContain('proxies:');

    // Rotate Surge token -> old link stops working, new link works
    const rotRes = await instance.app.inject({
      method: 'POST',
      url: `/api/channels/${surgeChannel.id}/rotate`,
      headers: { cookie: sessionCookie },
    });
    expect(rotRes.statusCode).toBe(200);
    const rotated = rotRes.json().channel;
    expect(rotated.token).not.toBe(surgeChannel.token);
    expect(rotated.subscribeUrl).toBe(`https://tower.test/sub/surge/${rotated.token}`);

    const oldSub = await instance.app.inject({
      method: 'GET',
      url: `/sub/surge/${surgeChannel.token}`,
    });
    expect(oldSub.statusCode).toBe(404);

    const newSub = await instance.app.inject({
      method: 'GET',
      url: `/sub/surge/${rotated.token}`,
    });
    expect(newSub.statusCode).toBe(200);
  });

  it('backfills stale region and multiplier metadata for existing nodes', async () => {
    const importRes = await instance.app.inject({
      method: 'POST',
      url: '/api/sources/manual/import',
      headers: { cookie: sessionCookie },
      payload: {
        text: 'ss://YWVzLTI1Ni1nY206c2VjcmV0@1.2.3.4:8388#x1.0%20%E7%BE%8E%E8%A5%BF%20-%20%E4%B8%AD%E8%BD%AC1',
      },
    });
    expect(importRes.statusCode).toBe(201);
    const target = (importRes.json().nodes as Array<{ id: string; originalName: string }>).find(
      (node) => node.originalName === 'x1.0 美西 - 中转1',
    );
    expect(target).toBeTruthy();

    await instance.db.query(
      `UPDATE nodes
       SET detected_region = 'OTHER', multiplier = NULL, tags = '[]'::jsonb
       WHERE id = $1`,
      [target!.id],
    );

    const updated = await instance.repo.backfillNodeMetadata();
    expect(updated).toBeGreaterThan(0);

    const node = await instance.repo.getNode(target!.id);
    expect(node?.region).toBe('US');
    expect(node?.multiplier).toBe(1);
  });

  it('prunes informational nodes that were stored before filtering rules existed', async () => {
    const source = await instance.repo.ensureManualSource();
    const config = {
      protocol: 'ss' as const,
      host: '1.2.3.9',
      port: 8388,
      method: 'aes-256-gcm',
      password: 'secret',
      udp: true,
    };
    const inserted = await instance.repo.addManualNodes(source.id, [
      {
        fingerprint: 'informational-node-test',
        originalName: '-若无法使用请更新节点-',
        protocol: 'ss',
        host: config.host,
        port: config.port,
        config,
        detectedRegion: 'OTHER',
        multiplier: null,
        tags: [],
      },
    ]);
    const junk = inserted.find((node) => node.originalName === '-若无法使用请更新节点-');
    expect(junk).toBeTruthy();

    const removed = await instance.repo.pruneInformationalNodes();
    expect(removed).toBeGreaterThan(0);
    expect(await instance.repo.getNode(junk!.id)).toBeNull();
  });
});
