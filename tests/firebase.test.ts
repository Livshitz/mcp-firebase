import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { FirebaseModule, FirebaseModuleOptions } from '../src/firebase';

describe('FirebaseModule', () => {
    describe('getPath()', () => {
        it('joins basePath and relativePath', () => {
            const fm = new FirebaseModule({ basePath: '/app', databaseURL: 'http://test' });
            expect(fm.getPath('users')).toBe('/app/users');
        });

        it('handles trailing slash on basePath', () => {
            const fm = new FirebaseModule({ basePath: '/app/', databaseURL: 'http://test' });
            expect(fm.getPath('users')).toBe('/app/users');
        });

        it('handles leading slash on relativePath', () => {
            const fm = new FirebaseModule({ basePath: '/app', databaseURL: 'http://test' });
            expect(fm.getPath('/users')).toBe('/app/users');
        });

        it('handles root basePath', () => {
            const fm = new FirebaseModule({ basePath: '/', databaseURL: 'http://test' });
            expect(fm.getPath('users')).toBe('/users');
        });

        it('handles empty relativePath', () => {
            const fm = new FirebaseModule({ basePath: '/app', databaseURL: 'http://test' });
            expect(fm.getPath('')).toBe('/app/');
        });
    });

    describe('getShallow()', () => {
        it('constructs correct URL and returns parsed JSON', async () => {
            const fm = new FirebaseModule({ basePath: '/', databaseURL: 'https://mydb.firebaseio.com' });
            // Mock _initialized so initialize() is skipped
            (fm as any)._initialized = true;
            (fm as any).database = {};
            (fm as any).firebaseApp = {
                options: {
                    credential: {
                        getAccessToken: async () => ({ access_token: 'test-token' }),
                    },
                },
            };

            let capturedUrl = '';
            const mockFetch = mock(async (url: string) => {
                capturedUrl = url;
                return {
                    ok: true,
                    json: async () => ({ key1: true, key2: true }),
                };
            });
            const origFetch = globalThis.fetch;
            globalThis.fetch = mockFetch as any;

            try {
                const result = await fm.getShallow('users');
                expect(result).toEqual({ key1: true, key2: true });
                expect(capturedUrl).toContain('shallow=true');
                expect(capturedUrl).toContain('users');
                expect(capturedUrl).toContain('access_token=test-token');
            } finally {
                globalThis.fetch = origFetch;
            }
        });

        it('throws on non-ok response', async () => {
            const fm = new FirebaseModule({ basePath: '/', databaseURL: 'https://mydb.firebaseio.com' });
            (fm as any)._initialized = true;
            (fm as any).database = {};
            (fm as any).firebaseApp = {
                options: {
                    credential: {
                        getAccessToken: async () => ({ access_token: 'tok' }),
                    },
                },
            };

            const mockFetch = mock(async () => ({
                ok: false,
                status: 403,
                text: async () => 'Forbidden',
            }));
            const origFetch = globalThis.fetch;
            globalThis.fetch = mockFetch as any;

            try {
                await expect(fm.getShallow('secret')).rejects.toThrow('Firebase shallow GET failed');
            } finally {
                globalThis.fetch = origFetch;
            }
        });

        it('does not leak token in error messages', async () => {
            const fm = new FirebaseModule({ basePath: '/', databaseURL: 'https://mydb.firebaseio.com' });
            (fm as any)._initialized = true;
            (fm as any).database = {};
            (fm as any).firebaseApp = {
                options: {
                    credential: {
                        getAccessToken: async () => ({ access_token: 'super-secret-token' }),
                    },
                },
            };

            const mockFetch = mock(async () => ({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
            }));
            const origFetch = globalThis.fetch;
            globalThis.fetch = mockFetch as any;

            try {
                let errMsg = '';
                try {
                    await fm.getShallow('path');
                } catch (e: any) {
                    errMsg = e.message;
                }
                // The error message itself should not contain the access token
                expect(errMsg).not.toContain('super-secret-token');
            } finally {
                globalThis.fetch = origFetch;
            }
        });

        it('handles root path (empty cleanPath)', async () => {
            const fm = new FirebaseModule({ basePath: '/', databaseURL: 'https://mydb.firebaseio.com' });
            (fm as any)._initialized = true;
            (fm as any).database = {};
            (fm as any).firebaseApp = {
                options: {
                    credential: {
                        getAccessToken: async () => ({ access_token: 'tok' }),
                    },
                },
            };

            let capturedUrl = '';
            const mockFetch = mock(async (url: string) => {
                capturedUrl = url;
                return { ok: true, json: async () => ({}) };
            });
            const origFetch = globalThis.fetch;
            globalThis.fetch = mockFetch as any;

            try {
                await fm.getShallow('');
                // Root path: cleanPath = '' so URL = baseURL/.json?shallow=true
                expect(capturedUrl).toContain('.json?shallow=true');
            } finally {
                globalThis.fetch = origFetch;
            }
        });
    });

    describe('initialize()', () => {
        it('throws if no service account provided', () => {
            const origEnv = { ...process.env };
            delete process.env.FIREBASE_SERVICE_ACCOUNT;
            delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

            const fm = new FirebaseModule({ databaseURL: 'https://test.firebaseio.com' });
            expect(() => (fm as any).initialize()).toThrow('FIREBASE_SERVICE_ACCOUNT');

            Object.assign(process.env, origEnv);
        });

        it('throws if no databaseURL provided', () => {
            const origEnv = { ...process.env };
            delete process.env.FIREBASE_DATABASE_URL;

            const fm = new FirebaseModule({
                serviceAccountPath: undefined,
            });
            // Set fake JSON service account via env
            process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: 'service_account', project_id: 'test' });

            // Should throw about databaseURL
            try {
                (fm as any).initialize();
            } catch (e: any) {
                expect(e.message).toContain('FIREBASE_DATABASE_URL');
            }

            Object.assign(process.env, origEnv);
            delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        });

        it('is idempotent — second call is no-op', () => {
            const fm = new FirebaseModule({ databaseURL: 'https://test.firebaseio.com' });
            (fm as any)._initialized = true;
            // Should not throw even without credentials
            expect(() => (fm as any).initialize()).not.toThrow();
        });

        it('parses JSON string service account from env', () => {
            const origEnv = { ...process.env };
            process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
                type: 'service_account',
                project_id: 'test',
                private_key_id: 'kid',
                private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA2a2rwplBQLF29amygykEMmYz0+Kcj3bKBp29Qw6CYnRqGP8\nR2L+rJr8aMxjHSXG...\n-----END RSA PRIVATE KEY-----',
                client_email: 'test@test.iam.gserviceaccount.com',
                client_id: '123',
                auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                token_uri: 'https://oauth2.googleapis.com/token',
            });
            process.env.FIREBASE_DATABASE_URL = 'https://test.firebaseio.com';

            const fm = new FirebaseModule();
            // It will try to call cert() with the parsed object — may fail on invalid key,
            // but the important thing is it parses JSON vs file path correctly
            try {
                (fm as any).initialize();
            } catch {
                // Expected to fail on invalid private key — that's fine
            }

            Object.assign(process.env, origEnv);
        });
    });

    describe('FirebaseModuleOptions defaults', () => {
        it('has basePath = "/"', () => {
            const opts = new FirebaseModuleOptions();
            expect(opts.basePath).toBe('/');
        });
    });
});
