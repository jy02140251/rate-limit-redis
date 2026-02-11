import { Redis } from 'ioredis';
import { Request, Response, NextFunction } from 'express';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  total: number;
  resetAt: Date;
}

export interface RateLimiterOptions {
  redis: Redis;
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
}

export class RateLimiter {
  private redis: Redis;
  private windowMs: number;
  private max: number;
  private keyPrefix: string;

  constructor(options: RateLimiterOptions) {
    this.redis = options.redis;
    this.windowMs = options.windowMs || 60000;
    this.max = options.max || 100;
    this.keyPrefix = options.keyPrefix || 'rl:';
  }

  private getKey(identifier: string): string {
    return `${this.keyPrefix}${identifier}`;
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const key = this.getKey(identifier);
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Remove old entries and count current
    const multi = this.redis.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zcard(key);
    multi.pttl(key);

    const results = await multi.exec();
    const count = (results?.[1]?.[1] as number) || 0;
    const ttl = (results?.[2]?.[1] as number) || this.windowMs;

    const remaining = Math.max(0, this.max - count);
    const resetAt = new Date(now + Math.max(ttl, 0));

    return {
      allowed: count < this.max,
      remaining,
      total: this.max,
      resetAt,
    };
  }

  async consume(identifier: string, cost = 1): Promise<RateLimitResult> {
    const key = this.getKey(identifier);
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const multi = this.redis.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zcard(key);

    const results = await multi.exec();
    const currentCount = (results?.[1]?.[1] as number) || 0;

    if (currentCount >= this.max) {
      const ttl = await this.redis.pttl(key);
      return {
        allowed: false,
        remaining: 0,
        total: this.max,
        resetAt: new Date(now + Math.max(ttl, 0)),
      };
    }

    // Add new entries
    const addMulti = this.redis.multi();
    for (let i = 0; i < cost; i++) {
      addMulti.zadd(key, now + i, `${now}-${i}-${Math.random()}`);
    }
    addMulti.pexpire(key, this.windowMs);
    await addMulti.exec();

    const remaining = Math.max(0, this.max - currentCount - cost);

    return {
      allowed: true,
      remaining,
      total: this.max,
      resetAt: new Date(now + this.windowMs),
    };
  }

  async reset(identifier: string): Promise<void> {
    await this.redis.del(this.getKey(identifier));
  }
}

export interface MiddlewareOptions {
  max?: number;
  windowMs?: number;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean | Promise<boolean>;
  handler?: (req: Request, res: Response) => void;
  headers?: boolean;
}

export function expressMiddleware(
  limiter: RateLimiter,
  options: MiddlewareOptions = {}
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const keyGenerator = options.keyGenerator || ((req) => req.ip || 'unknown');
  const skip = options.skip || (() => false);
  const headers = options.headers !== false;
  const handler = options.handler || ((req, res) => {
    res.status(429).json({
      error: 'Too Many Requests',
      retryAfter: res.getHeader('Retry-After'),
    });
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (await skip(req)) {
        return next();
      }

      const key = keyGenerator(req);
      const result = await limiter.consume(key);

      if (headers) {
        res.setHeader('X-RateLimit-Limit', result.total);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt.getTime() / 1000));
      }

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return handler(req, res);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export default RateLimiter;