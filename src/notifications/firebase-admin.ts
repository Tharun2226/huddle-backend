import { Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import * as admin from 'firebase-admin';

const logger = new Logger('FirebaseAdmin');

let initialized = false;

/**
 * Initialize Firebase Admin once from env or a local service-account JSON path.
 * Safe to call repeatedly.
 */
export function initFirebaseAdmin(): admin.app.App | null {
  if (initialized) {
    return admin.apps.length ? admin.app() : null;
  }

  try {
    const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
    if (path && existsSync(path)) {
      const json = JSON.parse(readFileSync(path, 'utf8')) as admin.ServiceAccount;
      admin.initializeApp({
        credential: admin.credential.cert(json),
      });
      initialized = true;
      logger.log('Firebase Admin initialized from service account file');
      return admin.app();
    }

    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (projectId && clientEmail && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      initialized = true;
      logger.log('Firebase Admin initialized from env credentials');
      return admin.app();
    }

    logger.warn(
      'Firebase Admin not configured — set FIREBASE_* env vars or FIREBASE_SERVICE_ACCOUNT_PATH',
    );
    initialized = true;
    return null;
  } catch (err) {
    logger.error(
      `Firebase Admin init failed: ${err instanceof Error ? err.message : err}`,
    );
    initialized = true;
    return null;
  }
}

export function getMessaging(): admin.messaging.Messaging | null {
  const app = initFirebaseAdmin();
  if (!app) return null;
  return admin.messaging(app);
}
