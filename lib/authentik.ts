/**
 * elysia-authentik — Headless ElysiaJS Plugin for Authentik OIDC SSO
 *
 * Zero-magic, self-contained. No auto-reading of process.env.
 * The developer provides explicit configuration via dependency injection.
 *
 * @module
 */

import { Elysia, type Context } from "elysia";
import * as client from "openid-client";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Configuration required to initialize the AuthentikAuth wrapper.
 * All values must be explicitly provided (no auto-reading of env vars).
 */
export interface AuthentikConfig {
    /** Authentik Issuer URL, e.g. "https://auth.example.com/application/o/my-app/" */
    issuer: string;
    /** OIDC Client ID from Authentik */
    clientId: string;
    /** OIDC Client Secret from Authentik */
    clientSecret: string;
    /** Full redirect URI registered in Authentik, e.g. "http://localhost:3000/auth/callback" */
    redirectUri: string;
    /** A 32+ character secret used to encrypt session cookies (use crypto.randomBytes) */
    sessionSecret: string;
    /** OIDC scopes to request. Default: "openid profile email" */
    scopes?: string;
    /** Base path for auth routes. Default: "/auth" */
    basePath?: string;
    /** Where to redirect after successful login. Default: "/" */
    postLoginRedirect?: string;
    /** Where to redirect after logout. Default: "/" */
    postLogoutRedirect?: string;
    /** Cookie name for the session. Default: "authentik_session" */
    cookieName?: string;
    /** Cookie max age in seconds. Default: 86400 (24 hours) */
    cookieMaxAge?: number;
    /** Allow insecure HTTP requests (for local dev only). Default: false */
    allowHttp?: boolean;
    /**
     * OIDC prompt parameter — controls the Authentik login/consent UX.
     * - undefined (default): Authentik decides (silent SSO if session exists)
     * - "consent": Force consent screen ("Do you authorize this app?")
     * - "login": Force re-authentication even if SSO session exists
     * - "login consent": Force both re-login and consent
     * - "select_account": Show account picker
     * - "none": Silent check only — error if no session exists
     */
    prompt?: "none" | "login" | "consent" | "select_account" | "login consent";
    /**
     * Additional OIDC authorization parameters to forward to the authorization URL.
     * Use this escape hatch for any parameters not covered by named options,
     * e.g. { acr_values: "...", login_hint: "user@example.com", ui_locales: "en" }
     */
    authorizationParams?: Record<string, string>;
}

/**
 * The user identity exposed to Elysia routes via context.
 * Derived from OIDC ID Token claims + optional UserInfo response.
 */
export interface AuthentikUser {
    /** OIDC subject identifier (unique user ID from Authentik) */
    sub: string;
    /** User's preferred username */
    preferred_username: string;
    /** User's display name */
    name: string;
    /** User's email address */
    email: string;
    /** Whether the email has been verified */
    email_verified: boolean;
    /** Authentik groups the user belongs to */
    groups: string[];
    /** Raw claims from the ID token for advanced use cases */
    raw: Record<string, unknown>;
}

// ─── Cookie Encryption Utilities ─────────────────────────────────────────────
// Uses Web Crypto API (AES-256-GCM) — works in Bun, Deno, Cloudflare Workers.

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

async function deriveKey(secret: string): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        ENCODER.encode(secret.padEnd(32, "0").slice(0, 32)),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: ENCODER.encode("elysia-authentik-salt"),
            iterations: 100_000,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: ALGORITHM, length: KEY_LENGTH },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encrypt(data: string, secret: string): Promise<string> {
    const key = await deriveKey(secret);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encrypted = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        key,
        ENCODER.encode(data)
    );
    // Combine IV + ciphertext, then base64url encode
    const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function decrypt(encoded: string, secret: string): Promise<string> {
    const key = await deriveKey(secret);
    // Base64url decode
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const iv = bytes.slice(0, IV_LENGTH);
    const ciphertext = bytes.slice(IV_LENGTH);
    const decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        key,
        ciphertext
    );
    return DECODER.decode(decrypted);
}

// ─── Main Class ──────────────────────────────────────────────────────────────

export class AuthentikAuth {
    private config: Required<
        Pick<
            AuthentikConfig,
            | "issuer"
            | "clientId"
            | "clientSecret"
            | "redirectUri"
            | "sessionSecret"
            | "scopes"
            | "basePath"
            | "postLoginRedirect"
            | "postLogoutRedirect"
            | "cookieName"
            | "cookieMaxAge"
            | "allowHttp"
        >
    > & {
        prompt: AuthentikConfig["prompt"];
        authorizationParams: Record<string, string>;
    };

    private oidcConfig: client.Configuration | null = null;
    private initPromise: Promise<void> | null = null;

    constructor(config: AuthentikConfig) {
        if (!config.issuer) throw new Error("[elysia-authentik] 'issuer' is required.");
        if (!config.clientId) throw new Error("[elysia-authentik] 'clientId' is required.");
        if (!config.clientSecret) throw new Error("[elysia-authentik] 'clientSecret' is required.");
        if (!config.redirectUri) throw new Error("[elysia-authentik] 'redirectUri' is required.");
        if (!config.sessionSecret) throw new Error("[elysia-authentik] 'sessionSecret' is required.");
        if (config.sessionSecret.length < 32) {
            throw new Error("[elysia-authentik] 'sessionSecret' must be at least 32 characters.");
        }

        this.config = {
            issuer: config.issuer,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            redirectUri: config.redirectUri,
            sessionSecret: config.sessionSecret,
            scopes: config.scopes ?? "openid profile email",
            basePath: config.basePath ?? "/auth",
            postLoginRedirect: config.postLoginRedirect ?? "/",
            postLogoutRedirect: config.postLogoutRedirect ?? "/",
            cookieName: config.cookieName ?? "authentik_session",
            cookieMaxAge: config.cookieMaxAge ?? 86400,
            allowHttp: config.allowHttp ?? false,
            prompt: config.prompt,
            authorizationParams: config.authorizationParams ?? {},
        };
    }

    /**
     * Performs OIDC Discovery against the Authentik issuer.
     * Lazily called and cached — safe to call multiple times.
     */
    private async initialize(): Promise<client.Configuration> {
        if (this.oidcConfig) return this.oidcConfig;

        if (!this.initPromise) {
            this.initPromise = (async () => {
                const issuerUrl = new URL(this.config.issuer);

                const discoveryOptions: client.DiscoveryRequestOptions = {};
                if (this.config.allowHttp) {
                    discoveryOptions.execute = [client.allowInsecureRequests];
                }

                this.oidcConfig = await client.discovery(
                    issuerUrl,
                    this.config.clientId,
                    this.config.clientSecret,
                    client.ClientSecretPost(this.config.clientSecret),
                    discoveryOptions
                );

                console.log(
                    `[elysia-authentik] ✓ OIDC Discovery complete for issuer: ${this.config.issuer}`
                );
            })();
        }

        await this.initPromise;
        return this.oidcConfig!;
    }

    /**
     * Returns the Elysia plugin instance.
     * Auto-mounts: GET {basePath}/login, GET {basePath}/callback, GET {basePath}/logout
     * Derives: `user: AuthentikUser | null` on every request context.
     */
    plugin() {
        const self = this;
        const {
            basePath,
            redirectUri,
            scopes,
            sessionSecret,
            postLoginRedirect,
            postLogoutRedirect,
            cookieName,
            cookieMaxAge,
        } = self.config;

        const tempCookieName = `${cookieName}_pkce`;

        return new Elysia({ name: "elysia-authentik", seed: self.config.issuer })
            // ─── Session Reader (runs on every request) ──────────────────
            .derive({ as: "global" }, async ({ cookie }) => {
                const sessionCookie = cookie[cookieName];
                const cookieVal = sessionCookie?.value as string | undefined;
                if (!cookieVal) {
                    return { user: null as AuthentikUser | null };
                }
                try {
                    const decrypted = await decrypt(cookieVal, sessionSecret);
                    const user: AuthentikUser = JSON.parse(decrypted);
                    return { user: user as AuthentikUser | null };
                } catch {
                    // Cookie is corrupted or tampered — clear it
                    sessionCookie?.remove();
                    return { user: null as AuthentikUser | null };
                }
            })

            // ─── GET /auth/login ─────────────────────────────────────────
            .get(`${basePath}/login`, async ({ cookie, redirect, query }) => {
                const oidc = await self.initialize();

                // Generate PKCE pair
                const codeVerifier = client.randomPKCECodeVerifier();
                const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

                // Generate state for CSRF protection
                const state = client.randomState();

                // Generate nonce for ID Token validation
                const nonce = client.randomNonce();

                // Store PKCE verifier, state, and nonce in a temporary encrypted cookie
                const tempData = JSON.stringify({
                    codeVerifier,
                    state,
                    nonce,
                    returnTo: (query as Record<string, string>)?.returnTo || postLoginRedirect,
                });
                const encryptedTemp = await encrypt(tempData, sessionSecret);

                const tempCookie = cookie[tempCookieName];
                tempCookie!.set({
                    value: encryptedTemp,
                    httpOnly: true,
                    secure: !self.config.allowHttp,
                    sameSite: "lax",
                    path: "/",
                    maxAge: 600, // 10 minutes — enough for the login flow
                });

                // Build the authorization URL
                const authParams: Record<string, string> = {
                    redirect_uri: redirectUri,
                    scope: scopes,
                    code_challenge: codeChallenge,
                    code_challenge_method: "S256",
                    state,
                    nonce,
                    // Spread any extra OIDC params the developer configured
                    ...self.config.authorizationParams,
                };

                // Add prompt if configured
                if (self.config.prompt) {
                    authParams.prompt = self.config.prompt;
                }

                const authUrl = client.buildAuthorizationUrl(oidc, authParams);

                return redirect(authUrl.toString());
            })

            // ─── GET /auth/callback ──────────────────────────────────────
            .get(`${basePath}/callback`, async ({ cookie, redirect, request }) => {
                const oidc = await self.initialize();
                const pkceCookie = cookie[tempCookieName];
                const pkceCookieVal = pkceCookie?.value as string | undefined;

                if (!pkceCookieVal) {
                    return new Response(
                        "Authentication failed: missing PKCE session. Please try logging in again.",
                        { status: 400 }
                    );
                }

                let tempData: {
                    codeVerifier: string;
                    state: string;
                    nonce: string;
                    returnTo: string;
                };

                try {
                    const decrypted = await decrypt(pkceCookieVal, sessionSecret);
                    tempData = JSON.parse(decrypted);
                } catch {
                    pkceCookie?.remove();
                    return new Response(
                        "Authentication failed: corrupted PKCE session. Please try logging in again.",
                        { status: 400 }
                    );
                }

                // Clear the temp cookie immediately
                pkceCookie?.remove();

                try {
                    // Exchange authorization code for tokens.
                    // openid-client v6 accepts a Request object directly!
                    const tokens = await client.authorizationCodeGrant(
                        oidc,
                        new URL(request.url),
                        {
                            pkceCodeVerifier: tempData.codeVerifier,
                            expectedState: tempData.state,
                            expectedNonce: tempData.nonce,
                            idTokenExpected: true,
                        }
                    );

                    // Extract claims from the ID token
                    const claims = tokens.claims();
                    if (!claims) {
                        return new Response("Authentication failed: no ID token received.", {
                            status: 400,
                        });
                    }

                    // Build the AuthentikUser object
                    const user: AuthentikUser = {
                        sub: claims.sub,
                        preferred_username: (claims.preferred_username as string) ?? "",
                        name: (claims.name as string) ?? "",
                        email: (claims.email as string) ?? "",
                        email_verified: (claims.email_verified as boolean) ?? false,
                        groups: (claims.groups as string[]) ?? [],
                        raw: claims as unknown as Record<string, unknown>,
                    };

                    // Encrypt user identity into a session cookie
                    const encryptedSession = await encrypt(JSON.stringify(user), sessionSecret);

                    const sessCookie = cookie[cookieName];
                    sessCookie!.set({
                        value: encryptedSession,
                        httpOnly: true,
                        secure: !self.config.allowHttp,
                        sameSite: "lax",
                        path: "/",
                        maxAge: cookieMaxAge,
                    });

                    return redirect(tempData.returnTo || postLoginRedirect);
                } catch (error: unknown) {
                    console.error("[elysia-authentik] Callback error:", error);

                    if (error instanceof client.AuthorizationResponseError) {
                        return new Response(
                            `Authentication failed: ${error.message}`,
                            { status: 400 }
                        );
                    }

                    return new Response(
                        "Authentication failed: an unexpected error occurred during token exchange.",
                        { status: 500 }
                    );
                }
            })

            // ─── GET /auth/logout ────────────────────────────────────────
            .get(`${basePath}/logout`, async ({ cookie, redirect }) => {
                // Clear the session cookie
                cookie[cookieName]?.remove();

                // Attempt to redirect to Authentik's end session endpoint
                try {
                    const oidc = await self.initialize();
                    const serverMeta = oidc.serverMetadata();
                    const endSessionEndpoint = serverMeta.end_session_endpoint;

                    if (endSessionEndpoint) {
                        const logoutUrl = new URL(endSessionEndpoint);
                        logoutUrl.searchParams.set(
                            "post_logout_redirect_uri",
                            postLogoutRedirect
                        );
                        logoutUrl.searchParams.set("client_id", self.config.clientId);
                        return redirect(logoutUrl.toString());
                    }
                } catch {
                    // If we can't reach the OIDC config, just do a local logout
                }

                return redirect(postLogoutRedirect);
            });
    }
}

// Default export for convenience
export default AuthentikAuth;
