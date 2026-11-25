class PostgresRepository {
  async savePlayer(_player: any) {
    throw new Error("Postgres adapter not configured.");
  }
  async getPlayer(_id: string) {
    return null;
  }
  async allPlayers() {
    return [];
  }
  async flush() {}
}
export { PostgresRepository };
