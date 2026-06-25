import { env } from './env';

// Relying Party config for SimpleWebAuthn. In dev: rpID=localhost,
// origin=http://localhost:5173 (the page origin the ceremony runs at).
export const rpName = env.rp.name;
export const rpID = env.rp.id;
export const expectedOrigin = env.rp.origin;
