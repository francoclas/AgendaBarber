import { parse } from 'url';
import { parseBody, sendJson, notFound, unauthorized, badRequest } from './http.js';
import { loadDb, saveDb, nextId } from './storage.js';
import { authenticate, createAdminSession, createBarberSession, ensureSeedBarber, hashPassword } from './security.js';
import crypto from 'crypto';

ensureSeedBarber();

const SLOT_MINUTES = 15;

function requireAuth(req, res, roles = []) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || null;
  const session = authenticate(token);
  if (!session || (roles.length && !roles.includes(session.role))) {
    unauthorized(res);
    return null;
  }
  return session;
}

function parseId(pathname, prefix) {
  const parts = pathname.split('/').filter(Boolean);
  const idx = parts.indexOf(prefix.replace('/', ''));
  if (idx === -1 || idx + 1 >= parts.length) return null;
  const id = Number(parts[idx + 1]);
  return Number.isNaN(id) ? null : id;
}

function slotToDate(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00.000Z`);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

async function handleRequest(req, res) {
  const { pathname, query } = parse(req.url, true);

  try {
    if (req.method === 'POST' && pathname === '/auth/admin') {
      const body = await parseBody(req);
      const token = createAdminSession(body.password || '');
      if (!token) return unauthorized(res);
      return sendJson(res, 200, { token, role: 'admin' });
    }

    if (req.method === 'POST' && pathname === '/auth/barber') {
      const body = await parseBody(req);
      const token = createBarberSession(body.alias, body.password);
      if (!token) return unauthorized(res);
      return sendJson(res, 200, { token, role: 'barber' });
    }

    if (req.method === 'GET' && pathname === '/barbers') {
      const session = requireAuth(req, res, ['admin']);
      if (!session) return;
      const db = loadDb();
      return sendJson(res, 200, db.barbers);
    }

    if (req.method === 'POST' && pathname === '/barbers') {
      const session = requireAuth(req, res, ['admin']);
      if (!session) return;
      const body = await parseBody(req);
      const db = loadDb();
      const now = new Date().toISOString();
      const barber = {
        id: nextId(db.barbers),
        name: body.name,
        alias: body.alias,
        phone: body.phone,
        email: body.email,
        isActive: body.isActive !== false,
        password: hashPassword(body.password || 'barber123'),
        createdAt: now,
        updatedAt: now
      };
      db.barbers.push(barber);
      saveDb(db);
      return sendJson(res, 201, barber);
    }

    if (req.method === 'PATCH' && pathname.startsWith('/barbers/')) {
      const session = requireAuth(req, res, ['admin']);
      if (!session) return;
      const barberId = parseId(pathname, 'barbers');
      if (!barberId) return notFound(res);
      const body = await parseBody(req);
      const db = loadDb();
      const barber = db.barbers.find((b) => b.id === barberId);
      if (!barber) return notFound(res);
      ['name', 'alias', 'phone', 'email'].forEach((field) => {
        if (body[field]) barber[field] = body[field];
      });
      if (typeof body.isActive === 'boolean') barber.isActive = body.isActive;
      barber.updatedAt = new Date().toISOString();
      saveDb(db);
      return sendJson(res, 200, barber);
    }

    if (req.method === 'GET' && pathname === '/services') {
      const db = loadDb();
      return sendJson(res, 200, db.services);
    }

    if (req.method === 'POST' && pathname === '/services') {
      const session = requireAuth(req, res, ['admin']);
      if (!session) return;
      const body = await parseBody(req);
      if ((body.durationMinutes || 0) < 30 || body.durationMinutes % SLOT_MINUTES !== 0) {
        return badRequest(res, 'Duración inválida');
      }
      const db = loadDb();
      const now = new Date().toISOString();
      const service = {
        id: nextId(db.services),
        name: body.name,
        description: body.description || '',
        price: Number(body.price) || 0,
        durationMinutes: body.durationMinutes,
        isActive: body.isActive !== false,
        createdAt: now,
        updatedAt: now
      };
      db.services.push(service);
      saveDb(db);
      return sendJson(res, 201, service);
    }

    if (req.method === 'PATCH' && pathname.startsWith('/services/')) {
      const session = requireAuth(req, res, ['admin']);
      if (!session) return;
      const serviceId = parseId(pathname, 'services');
      if (!serviceId) return notFound(res);
      const body = await parseBody(req);
      const db = loadDb();
      const service = db.services.find((s) => s.id === serviceId);
      if (!service) return notFound(res);
      if (body.durationMinutes) {
        if (body.durationMinutes < 30 || body.durationMinutes % SLOT_MINUTES !== 0) {
          return badRequest(res, 'Duración inválida');
        }
        service.durationMinutes = body.durationMinutes;
      }
      ['name', 'description'].forEach((field) => {
        if (body[field]) service[field] = body[field];
      });
      if (body.price !== undefined) service.price = Number(body.price);
      if (typeof body.isActive === 'boolean') service.isActive = body.isActive;
      service.updatedAt = new Date().toISOString();
      saveDb(db);
      return sendJson(res, 200, service);
    }

    if (req.method === 'PUT' && pathname.startsWith('/barbers/') && pathname.endsWith('/services')) {
      const session = requireAuth(req, res, ['barber', 'admin']);
      if (!session) return;
      const barberId = parseId(pathname, 'barbers');
      if (!barberId) return notFound(res);
      if (session.role === 'barber' && session.userId !== barberId) return unauthorized(res);
      const body = await parseBody(req);
      const db = loadDb();
      const entries = Array.isArray(body.services) ? body.services : [];
      db.barberServices = db.barberServices.filter((bs) => bs.barberId !== barberId);
      entries.forEach((entry, index) => {
        db.barberServices.push({
          barberId,
          serviceId: entry.serviceId,
          enabled: entry.enabled !== false,
          position: entry.position ?? index
        });
      });
      saveDb(db);
      return sendJson(res, 200, entries);
    }

    if (req.method === 'PUT' && pathname.startsWith('/barbers/') && pathname.endsWith('/availability')) {
      const session = requireAuth(req, res, ['barber', 'admin']);
      if (!session) return;
      const barberId = parseId(pathname, 'barbers');
      if (!barberId) return notFound(res);
      if (session.role === 'barber' && session.userId !== barberId) return unauthorized(res);
      const body = await parseBody(req);
      const entries = Array.isArray(body.slots) ? body.slots : [];
      const db = loadDb();
      db.availabilities = db.availabilities.filter((a) => a.barberId !== barberId);
      entries.forEach((entry) => {
        db.availabilities.push({
          id: nextId(db.availabilities),
          barberId,
          weekday: entry.weekday,
          start: entry.start,
          end: entry.end
        });
      });
      saveDb(db);
      return sendJson(res, 200, entries);
    }

    if (req.method === 'GET' && pathname.startsWith('/barbers/') && pathname.endsWith('/slots')) {
      const barberId = parseId(pathname, 'barbers');
      if (!barberId) return notFound(res);
      const date = query.date;
      const serviceId = Number(query.serviceId);
      if (!date || !serviceId) return badRequest(res, 'Falta fecha o servicio');
      const db = loadDb();
      const service = db.services.find((s) => s.id === serviceId && s.isActive !== false);
      if (!service) return badRequest(res, 'Servicio no disponible');
      const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
      const availabilities = db.availabilities.filter((a) => a.barberId === barberId && a.weekday === weekday);
      const slots = [];
      availabilities.forEach((a) => {
        let cursor = slotToDate(date, a.start);
        const end = slotToDate(date, a.end);
        while (addMinutes(cursor, service.durationMinutes) <= end) {
          slots.push(cursor.toISOString().slice(11, 16));
          cursor = addMinutes(cursor, SLOT_MINUTES);
        }
      });
      const appointments = db.appointments.filter(
        (ap) => ap.barberId === barberId && ap.status === 'reserved' && ap.date === date
      );
      const available = slots.filter((time) => {
        const start = slotToDate(date, time);
        const end = addMinutes(start, service.durationMinutes);
        return !appointments.some((ap) => overlaps(start, end, slotToDate(date, ap.time), addMinutes(slotToDate(date, ap.time), ap.serviceSnapshot.durationMinutes)));
      });
      return sendJson(res, 200, { slots: available });
    }

    if (req.method === 'POST' && pathname === '/appointments') {
      const body = await parseBody(req);
      if (!body.captchaToken) return badRequest(res, 'CAPTCHA requerido');
      const { barberId, serviceId, date, time, client } = body;
      const db = loadDb();
      const service = db.services.find((s) => s.id === serviceId && s.isActive !== false);
      if (!service) return badRequest(res, 'Servicio no disponible');
      const barber = db.barbers.find((b) => b.id === barberId && b.isActive !== false);
      if (!barber) return badRequest(res, 'Barbero no disponible');
      const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
      const avail = db.availabilities.filter((a) => a.barberId === barberId && a.weekday === weekday);
      const start = slotToDate(date, time);
      const end = addMinutes(start, service.durationMinutes);
      const withinAvailability = avail.some((a) => {
        const aStart = slotToDate(date, a.start);
        const aEnd = slotToDate(date, a.end);
        return start >= aStart && end <= aEnd;
      });
      if (!withinAvailability) return badRequest(res, 'Fuera de disponibilidad');
      const conflict = db.appointments.some((ap) => {
        if (ap.barberId !== barberId || ap.date !== date || ap.status !== 'reserved') return false;
        const apStart = slotToDate(date, ap.time);
        const apEnd = addMinutes(apStart, ap.serviceSnapshot.durationMinutes);
        return overlaps(start, end, apStart, apEnd);
      });
      if (conflict) return badRequest(res, 'El horario ya fue tomado, elegí otro');
      const snapshot = {
        serviceId,
        name: service.name,
        description: service.description,
        price: service.price,
        durationMinutes: service.durationMinutes
      };
      const now = new Date().toISOString();
      const appointment = {
        id: nextId(db.appointments),
        barberId,
        date,
        time,
        status: 'reserved',
        client: {
          name: client?.name,
          phone: client?.phone,
          email: client?.email
        },
        serviceSnapshot: snapshot,
        cancelToken: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now
      };
      db.appointments.push(appointment);
      db.histories.push({
        id: nextId(db.histories),
        appointmentId: appointment.id,
        action: 'created',
        actorRole: 'client',
        actorName: client?.name || 'invitado',
        reason: null,
        createdAt: now
      });
      saveDb(db);
      return sendJson(res, 201, appointment);
    }

    if (req.method === 'POST' && pathname.startsWith('/appointments/') && pathname.endsWith('/cancel')) {
      const appointmentId = parseId(pathname, 'appointments');
      if (!appointmentId) return notFound(res);
      const body = await parseBody(req);
      const token = body.token;
      const db = loadDb();
      const ap = db.appointments.find((a) => a.id === appointmentId);
      if (!ap) return notFound(res);
      const session = authenticate(req.headers['authorization']?.replace('Bearer ', '') || null);
      const isOwner = token && token === ap.cancelToken;
      const canAdmin = session && ['admin', 'barber'].includes(session.role);
      if (!isOwner && !canAdmin) return unauthorized(res);
      ap.status = 'cancelled';
      ap.updatedAt = new Date().toISOString();
      db.histories.push({
        id: nextId(db.histories),
        appointmentId: ap.id,
        action: 'cancelled',
        actorRole: isOwner ? 'client' : session.role,
        actorName: isOwner ? ap.client?.name : session.role,
        reason: body.reason || null,
        createdAt: ap.updatedAt
      });
      saveDb(db);
      return sendJson(res, 200, ap);
    }

    if (req.method === 'GET' && pathname.startsWith('/appointments/') && pathname.endsWith('/history')) {
      const appointmentId = parseId(pathname, 'appointments');
      if (!appointmentId) return notFound(res);
      const session = requireAuth(req, res, ['admin', 'barber']);
      if (!session) return;
      const db = loadDb();
      const history = db.histories.filter((h) => h.appointmentId === appointmentId);
      return sendJson(res, 200, history);
    }

    notFound(res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Error inesperado' });
  }
}

export { handleRequest };
