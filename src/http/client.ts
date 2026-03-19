export class TractionEyeHttpClient {
  constructor(private readonly baseUrl: string, private readonly agentToken: string) {}

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `agent ${this.agentToken}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }
}
