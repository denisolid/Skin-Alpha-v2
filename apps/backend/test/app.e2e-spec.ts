import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from '../src/app.module';

interface HealthResponseBody {
  name: string;
  environment: string;
  status: string;
  timestamp: string;
  services: {
    config: string;
    database: string;
    redis: string;
    queue: string;
  };
}

describe('HealthController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the application health payload', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];
    const response = await request(httpServer).get('/api/health').expect(200);
    const body = response.body as HealthResponseBody;

    expect(body).toMatchObject({
      name: 'SkinAlpha v2 API',
      environment: 'test',
      status: 'ok',
      services: {
        config: 'configured',
        database: 'configured',
        redis: 'configured',
        queue: 'configured',
      },
    });
    expect(typeof body.timestamp).toBe('string');
    expect(typeof response.headers['x-request-id']).toBe('string');
  });
});
