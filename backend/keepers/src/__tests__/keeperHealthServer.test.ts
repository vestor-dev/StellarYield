import http from 'http';
import { startKeeperHealthServer } from '../api/queueHealth';
import type { Queue } from 'bullmq';
import { getQueueHealth } from '../queues';

jest.mock('../queues', () => ({
  getQueueHealth: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const mockGetQueueHealth = getQueueHealth as jest.MockedFunction<typeof getQueueHealth>;

function makeQueue(name: string): Queue {
  return { name, getJobCounts: jest.fn() } as unknown as Queue;
}

function httpGet(port: number, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let raw = '';
      res.on('data', (chunk: string) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: raw });
        }
      });
    });
    req.on('error', reject);
  });
}

function startAndGetPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.once('listening', () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

describe('startKeeperHealthServer', () => {
  let server: http.Server;

  afterEach((done) => {
    server.close(done);
    jest.clearAllMocks();
  });

  it('GET /health returns 200 with status ok and uptime', async () => {
    server = startKeeperHealthServer([], 0);
    const port = await startAndGetPort(server);

    const { status, body } = await httpGet(port, '/health');

    expect(status).toBe(200);
    expect((body as any).status).toBe('ok');
    expect(typeof (body as any).uptime).toBe('number');
  });

  it('GET /health/queues returns 200 with queue summary when healthy', async () => {
    const summary = {
      queues: [{ name: 'liquidation', counts: { waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 }, status: 'healthy' as const, warnings: [] as string[] }],
      overallStatus: 'healthy' as const,
      timestamp: new Date().toISOString(),
    };
    mockGetQueueHealth.mockResolvedValue(summary);

    server = startKeeperHealthServer([makeQueue('liquidation')], 0);
    const port = await startAndGetPort(server);

    const { status, body } = await httpGet(port, '/health/queues');

    expect(status).toBe(200);
    expect((body as any).overallStatus).toBe('healthy');
    expect(Array.isArray((body as any).queues)).toBe(true);
  });

  it('GET /health/queues returns 200 with warning overallStatus when queues are degraded', async () => {
    const summary = {
      queues: [{ name: 'liquidation', counts: { waiting: 0, active: 0, completed: 0, failed: 15, delayed: 0 }, status: 'warning' as const, warnings: ['failed jobs (15) exceed threshold (10)'] }],
      overallStatus: 'warning' as const,
      timestamp: new Date().toISOString(),
    };
    mockGetQueueHealth.mockResolvedValue(summary);

    server = startKeeperHealthServer([makeQueue('liquidation')], 0);
    const port = await startAndGetPort(server);

    const { status, body } = await httpGet(port, '/health/queues');

    expect(status).toBe(200);
    expect((body as any).overallStatus).toBe('warning');
  });

  it('GET /health/queues returns 503 when getQueueHealth throws', async () => {
    mockGetQueueHealth.mockRejectedValue(new Error('Redis connection lost'));

    server = startKeeperHealthServer([makeQueue('liquidation')], 0);
    const port = await startAndGetPort(server);

    const { status, body } = await httpGet(port, '/health/queues');

    expect(status).toBe(503);
    expect((body as any).error).toBeDefined();
  });

  it('unknown routes return 404', async () => {
    server = startKeeperHealthServer([], 0);
    const port = await startAndGetPort(server);

    const { status } = await httpGet(port, '/unknown');
    expect(status).toBe(404);
  });
});
