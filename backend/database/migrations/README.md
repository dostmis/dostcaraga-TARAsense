TARAsense Laravel uses the existing Prisma-managed PostgreSQL schema.

Do not run Laravel's default `users`, `cache`, or `jobs` migrations against the
production TARAsense database. The current schema source of truth remains
`../prisma/schema.prisma` until the Laravel migration reaches full parity.

Laravel queue, cache, session, and rate-limit state should use Redis.
