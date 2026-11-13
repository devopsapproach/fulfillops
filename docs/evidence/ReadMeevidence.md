# T18 local container stack evidence

Captured on 13 Nov 2026 by Jaimie Mathangi on branch `feat/container-stack`.

| #   | What it proves                                                                   | Screenshot                         |
| --- | -------------------------------------------------------------------------------- | ---------------------------------- |
| 01  | Image build generates the Prisma client and compiles TypeScript                  | ![build](01-build.png)             |
| 02  | Runtime image runs as non-root (uid 1000) and contains the Prisma client         | ![image](02-image.png)             |
| 03  | migrate exits 0, API healthy, API and worker share one image                     | ![stack](03-stack.png)             |
| 04  | Migrations and catalog seed run in the one-shot job                              | ![migrate](04-migrate.png)         |
| 05  | An order is accepted (202, queued) and the worker completes it                   | ![order](05-order-flow.png)        |
| 06  | After recreating all containers the same order is still retrievable              | ![persistence](06-persistence.png) |
| 07  | API and worker stop cleanly within the 30 s grace period                         | ![shutdown](07-shutdown.png)       |
| 08  | Public checker passes against the container stack (metrics pending, Developer C) | ![checker](08-checker.png)         |
