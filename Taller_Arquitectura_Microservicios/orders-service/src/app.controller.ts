import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { RedisService } from './redis/redis.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async health() {
    let redisStatus = 'ok';
    try {
      await this.redisService.set('health-check', 'ping', 5);
      const result = await this.redisService.get('health-check');
      if (result !== 'ping') {
        redisStatus = 'error';
      }
    } catch (error) {
      redisStatus = 'error';
    }

    return {
      status: redisStatus === 'ok' ? 'ok' : 'degraded',
      service: 'orders-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      redis: redisStatus,
    };
  }
}
