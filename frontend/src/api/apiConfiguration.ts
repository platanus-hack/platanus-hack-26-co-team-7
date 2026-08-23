const HTTP_PROTOCOLS = {
  HTTP: 'http:',
  HTTPS: 'https:',
} as const;

export class ApiConfigurationError extends Error {}

export function getBuildApiBaseUrl(): string {
  return validateApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, 'EXPO_PUBLIC_API_BASE_URL');
}

export function isBuildDemoTriggerEnabled(): boolean {
  return process.env.EXPO_PUBLIC_DEMO_TRIGGER_ENABLED?.trim().toLowerCase() === 'true';
}

export function validateApiBaseUrl(value: string | undefined, source: string): string {
  if (!value?.trim()) {
    throw new ApiConfigurationError(`${source} is required. Set it before creating an Expo development or release build.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ApiConfigurationError(`${source} must be a valid http(s) URL.`);
  }

  if (parsed.protocol !== HTTP_PROTOCOLS.HTTP && parsed.protocol !== HTTP_PROTOCOLS.HTTPS) {
    throw new ApiConfigurationError(`${source} must use http:// or https://.`);
  }

  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new ApiConfigurationError(`${source} must not contain credentials and must include a host.`);
  }

  return parsed.toString().replace(/\/$/, '');
}
