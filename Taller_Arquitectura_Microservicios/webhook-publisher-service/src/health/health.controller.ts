import { Controller, Get, Post } from '@nestjs/common';
import { SubscribersService } from '../webhook/subscribers.service';

@Controller('health')
export class HealthController {
  constructor(private readonly subscribersService: SubscribersService) {}

  @Get()
  check() {
    const subscriberStats = this.subscribersService.getCacheStats();
    
    return {
      status: 'ok',
      service: 'webhook-publisher-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      subscribers: {
        count: subscriberStats.subscriberCount,
        cacheValid: subscriberStats.isValid,
        usingFallback: subscriberStats.usingFallback,
        lastUpdated: subscriberStats.lastUpdated,
      },
    };
  }

  @Get('ready')
  ready() {
    const subscriberStats = this.subscribersService.getCacheStats();
    
    return {
      status: 'ready',
      rabbitmq: 'connected',
      redis: 'connected',
      subscribers: {
        loaded: subscriberStats.subscriberCount > 0,
        count: subscriberStats.subscriberCount,
        usingFallback: subscriberStats.usingFallback,
      },
    };
  }

  @Get('subscribers')
  async getSubscribers() {
    const subscribers = await this.subscribersService.getAllActiveSubscribers();
    const stats = this.subscribersService.getCacheStats();
    
    return {
      total: subscribers.length,
      cache: stats,
      subscribers: subscribers.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        eventPatterns: s.eventPatterns,
        isActive: s.isActive,
      })),
    };
  }

  @Post('subscribers/refresh')
  async refreshSubscribers() {
    const subscribers = await this.subscribersService.forceRefresh();
    
    return {
      message: 'Subscribers cache refreshed',
      count: subscribers.length,
      subscribers: subscribers.map((s) => ({
        name: s.name,
        eventPatterns: s.eventPatterns,
      })),
    };
  }
}
