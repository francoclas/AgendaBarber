import crypto from 'crypto';
import { loadDb, saveDb } from './storage.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const sessionStore = new Map();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, hashed) {
  const [salt, original] = hashed.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(original, 'hex'), Buffer.from(hash, 'hex'));
}

export function ensureSeedBarber() {
  const db = loadDb();
  const existing = db.barbers.find((b) => b.alias === 'demo');
  if (!existing) {
    const now = new Date().toISOString();
    db.barbers.push({
      id: 1,
      name: 'Demo Barber',
      alias: 'demo',
      phone: '+598000000',
      email: 'demo@example.com',
      isActive: true,
      password: hashPassword('demo123'),
      createdAt: now,
      updatedAt: now
    });
    saveDb(db);
  } else if (!existing.password) {
    existing.password = hashPassword('demo123');
    existing.updatedAt = new Date().toISOString();
    saveDb(db);
  }
}

export function authenticate(token) {
  if (!token) return null;
  return sessionStore.get(token) || null;
}

export function createAdminSession(password) {
  if (password !== ADMIN_PASSWORD) return null;
  const token = crypto.randomUUID();
  sessionStore.set(token, { role: 'admin', userId: 0 });
  return token;
}

export function createBarberSession(alias, password) {
  const db = loadDb();
  const barber = db.barbers.find((b) => b.alias === alias && b.isActive !== false);
  if (!barber) return null;
  if (!verifyPassword(password, barber.password)) return null;
  const token = crypto.randomUUID();
  sessionStore.set(token, { role: 'barber', userId: barber.id });
  return token;
}

export { hashPassword };
