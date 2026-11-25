import { SQLiteRepository } from "./SQLiteRepository.js";
import { PostgresRepository } from "./PostgresRepository.js";
import type { PlayerRepository } from "./Repository.js";

export type RepositoryBackend = "sqlite" | "postgres";

export async function createRepository(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlayerRepository> {
  const backend = String(env.ASHENFALL_REPOSITORY || "sqlite")
    .trim()
    .toLowerCase();

  if (backend === "postgres" || backend === "postgresql") {
    const repository = new PostgresRepository(env.DATABASE_URL || "");
    await repository.ready();
    await repository.initializeEconomyCache();
    await repository.initializeWorldStateCache();
    return repository;
  }

  if (backend !== "sqlite") {
    throw new Error(
      `Unsupported ASHENFALL_REPOSITORY "${backend}". Use sqlite or postgres.`,
    );
  }

  return new SQLiteRepository();
}
