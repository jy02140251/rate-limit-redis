# Rate Limit Redis

High-performance Redis rate limiter with sliding window algorithm.

## Features

- Sliding window algorithm (more accurate than fixed window)
- Redis-backed (distributed rate limiting)
- Express & Fastify middleware
- Multiple rate limit strategies
- Custom key generators
- TypeScript support

## Installation

```bash
npm install rate-limit-redis ioredis
```

## Quick Start

```typescript
import { RateLimiter, expressMiddleware } from 'rate-limit-redis';
import Redis from 'ioredis';
import express from 'express';

const redis = new Redis();
const limiter = new RateLimiter({
  redis,
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
});

const app = express();

// Apply to all routes
app.use(expressMiddleware(limiter));

// Or specific routes
app.get('/api/expensive', expressMiddleware(limiter, {
  max: 10,
  keyGenerator: (req) => req.ip + ':expensive',
}), (req, res) => {
  res.json({ data: 'expensive operation' });
});
```

## API Reference

### `new RateLimiter(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `redis` | Redis | required | ioredis instance |
| `windowMs` | number | `60000` | Time window in ms |
| `max` | number | `100` | Max requests per window |
| `keyPrefix` | string | `'rl:'` | Redis key prefix |

### Methods

```typescript
// Check rate limit (returns remaining requests)
const result = await limiter.check(key);
// { allowed: true, remaining: 99, resetAt: Date }

// Consume one request
const result = await limiter.consume(key);

// Reset rate limit for key
await limiter.reset(key);
```

## Middleware Options

```typescript
expressMiddleware(limiter, {
  // Custom key generator
  keyGenerator: (req) => req.user?.id || req.ip,
  
  // Skip rate limiting
  skip: (req) => req.user?.role === 'admin',
  
  // Custom response
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests' });
  },
  
  // Add headers
  headers: true, // X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
});
```

## License

MIT