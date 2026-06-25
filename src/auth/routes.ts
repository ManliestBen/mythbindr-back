import { Router } from 'express';
import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { User, publicUser, type UserDoc } from '../models/User';
import { Credential } from '../models/Credential';
import { rpID, rpName, expectedOrigin } from '../lib/webauthn';
import { asyncHandler, requireAuth } from './middleware';

const router = Router();

const ALLOWED_THEMES = [
  'mythic-gold',
  'arcane-navy',
  'parchment-tome',
  'ember-violet',
];

// ── Current user ────────────────────────────────────────────────────────
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.session.userId) return res.json({ user: null });
    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy(() => undefined);
      return res.json({ user: null });
    }
    res.json({ user: publicUser(user as UserDoc) });
  }),
);

// ── Registration ────────────────────────────────────────────────────────
router.post(
  '/register/options',
  asyncHandler(async (req, res) => {
    const displayName = String(req.body?.displayName ?? '').trim();
    if (!displayName) {
      return res.status(400).json({ error: 'Display name is required' });
    }

    const webauthnUserIDBytes = crypto.randomBytes(16);
    const webauthnUserID = webauthnUserIDBytes.toString('base64url');

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: webauthnUserIDBytes,
      userName: displayName,
      userDisplayName: displayName,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    req.session.currentChallenge = options.challenge;
    req.session.pendingRegistration = { displayName, webauthnUserID };
    res.json(options);
  }),
);

router.post(
  '/register/verify',
  asyncHandler(async (req, res) => {
    const pending = req.session.pendingRegistration;
    const expectedChallenge = req.session.currentChallenge;
    if (!pending || !expectedChallenge) {
      return res.status(400).json({ error: 'No registration in progress' });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Registration could not be verified' });
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    // First registered user bootstraps as admin (PLAN.md §5.1).
    const userCount = await User.countDocuments();
    const user = await User.create({
      displayName: pending.displayName,
      webauthnUserID: pending.webauthnUserID,
      isAdmin: userCount === 0,
      theme: 'mythic-gold',
    });

    await Credential.create({
      userId: user._id,
      credentialID: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      deviceName: 'Passkey',
      lastUsedAt: new Date(),
    });

    req.session.userId = String(user._id);
    req.session.currentChallenge = undefined;
    req.session.pendingRegistration = undefined;

    res.json({ user: publicUser(user as UserDoc) });
  }),
);

// ── Authentication (usernameless / discoverable) ────────────────────────
router.post(
  '/login/options',
  asyncHandler(async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
    });
    req.session.currentChallenge = options.challenge;
    res.json(options);
  }),
);

router.post(
  '/login/verify',
  asyncHandler(async (req, res) => {
    const expectedChallenge = req.session.currentChallenge;
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No login in progress' });
    }

    const credential = await Credential.findOne({ credentialID: req.body?.id });
    if (!credential) {
      return res.status(400).json({ error: 'Unrecognized passkey' });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpID,
        credential: {
          id: credential.credentialID,
          publicKey: new Uint8Array(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports as
            | AuthenticatorTransportFuture[]
            | undefined,
        },
        requireUserVerification: false,
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    if (!verification.verified) {
      return res.status(400).json({ error: 'Could not verify passkey' });
    }

    credential.counter = verification.authenticationInfo.newCounter;
    credential.lastUsedAt = new Date();
    await credential.save();

    req.session.userId = String(credential.userId);
    req.session.currentChallenge = undefined;

    const user = await User.findById(credential.userId);
    res.json({ user: user ? publicUser(user as UserDoc) : null });
  }),
);

// ── Logout ──────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('mythbindr.sid');
    res.json({ ok: true });
  });
});

// ── Update own profile (theme persistence, display name) ────────────────
router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const update: Record<string, unknown> = {};
    const { theme, displayName } = req.body ?? {};
    if (typeof theme === 'string' && ALLOWED_THEMES.includes(theme)) {
      update.theme = theme;
    }
    if (typeof displayName === 'string' && displayName.trim()) {
      update.displayName = displayName.trim();
    }
    const user = await User.findByIdAndUpdate(req.session.userId, update, {
      new: true,
    });
    res.json({ user: user ? publicUser(user as UserDoc) : null });
  }),
);

export default router;
