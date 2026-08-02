export class BackendError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Thin REST client for the BugDetekter backend, authenticated with a bd_ API token. */
export class BugDetekterClient {
  constructor(
    private baseUrl: string,
    private token: string
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (err) {
      throw new BackendError(0, `Cannot reach BugDetekter at ${this.baseUrl} — is the backend running? (${(err as Error).message})`);
    }
    const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      const detail = parsed?.error ?? `HTTP ${response.status}`;
      if (response.status === 401) {
        throw new BackendError(401, `Authentication failed: ${detail}. Check BUGDETEKTER_TOKEN (create one in the dashboard under API tokens).`);
      }
      if (response.status === 403) {
        throw new BackendError(403, `Not allowed: ${detail}. This tool needs a write-scope token.`);
      }
      throw new BackendError(response.status, detail);
    }
    return parsed as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** Resolve a project reference (uuid, slug, or name — case-insensitive) to its id. */
  async resolveProject(ref: string | undefined): Promise<{ id: string; name: string } | null> {
    const { projects } = await this.get<{ projects: Array<{ id: string; name: string; slug: string }> }>('/api/projects');
    if (!ref) return projects.length === 1 ? projects[0]! : null;
    const needle = ref.trim().toLowerCase();
    return (
      projects.find((p) => p.id === needle) ??
      projects.find((p) => p.slug.toLowerCase() === needle) ??
      projects.find((p) => p.name.toLowerCase() === needle) ??
      null
    );
  }
}
