const DEFAULT_PROXY_MODELS = [
  'gpt-5.4-mini',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'codex-auto-review',
];

type ModelsResponse = {
  data?: Array<{
    id?: string;
  }>;
};

export async function fetchProxyModels() {
  try {
    const response = await fetch('http://127.0.0.1:10531/v1/models');
    if (!response.ok) {
      return DEFAULT_PROXY_MODELS;
    }

    const payload = (await response.json()) as ModelsResponse;
    const modelIds =
      payload.data
        ?.map((entry) => entry.id?.trim() || '')
        .filter(Boolean) ?? [];

    if (modelIds.length === 0) {
      return DEFAULT_PROXY_MODELS;
    }

    return Array.from(new Set([...modelIds, ...DEFAULT_PROXY_MODELS]));
  } catch {
    return DEFAULT_PROXY_MODELS;
  }
}

export { DEFAULT_PROXY_MODELS };
