import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Set once a user is authenticated. */
    userId?: string;
    /** Challenge for the in-flight WebAuthn ceremony. */
    currentChallenge?: string;
    /** Held between register/options and register/verify (user not yet created). */
    pendingRegistration?: {
      displayName: string;
      webauthnUserID: string;
    };
  }
}
