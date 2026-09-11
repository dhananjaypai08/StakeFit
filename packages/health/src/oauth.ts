export const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
export const ACTIVITY_SCOPE = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";
export const SETTINGS_SCOPE = "https://www.googleapis.com/auth/googlehealth.settings.readonly";
export const HEALTH_SCOPES = [ACTIVITY_SCOPE, SETTINGS_SCOPE] as const;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
}

export interface GoogleProfile {
  id: string;
  email: string;
  name?: string;
}

export function authorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", ["openid", "email", "profile", ...HEALTH_SCOPES].join(" "));
  return url.toString();
}

export async function exchangeCode(config: GoogleOAuthConfig, code: string): Promise<GoogleTokens> {
  return tokenRequest(config, { grant_type: "authorization_code", code, redirect_uri: config.redirectUri });
}

export async function refreshAccessToken(config: GoogleOAuthConfig, refreshToken: string): Promise<GoogleTokens> {
  const tokens = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken });
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

async function tokenRequest(config: GoogleOAuthConfig, extra: Record<string, string>): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...extra,
  });
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope,
  };
}

export async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id: string; email: string; name?: string };
  return { id: json.id, email: json.email, name: json.name };
}
