# Agenda Barbería (MVP backend)

Implementación inicial del backend HTTP sin dependencias externas para cubrir los flujos básicos definidos en `PLAN.md`.

## Ejecutar
```
node src/server.js
```
Por defecto usa el puerto `3000`.

## Autenticación
- **Admin**: login con `POST /auth/admin { "password": "admin123" }` (o variable de entorno `ADMIN_PASSWORD`).
- **Barbero demo**: seed automático con alias `demo`, contraseña `demo123`.

Usar el token recibido en el header `Authorization: Bearer <token>`.

## Endpoints principales
- `POST /barbers` (admin): alta de barbero.
- `PATCH /barbers/:id` (admin): edición/activación.
- `POST /services` (admin): alta de servicio (duración >=30 y múltiplo de 15).
- `PATCH /services/:id` (admin): edición.
- `PUT /barbers/:id/services` (barbero/admin): habilitar/ordenar servicios.
- `PUT /barbers/:id/availability` (barbero/admin): rangos de disponibilidad por día (`weekday 0-6`, `start`, `end`).
- `GET /barbers/:id/slots?date=YYYY-MM-DD&serviceId=<id>`: muestra horarios libres basados en disponibilidad y solapamiento.
- `POST /appointments` (cliente invitado): crea turno con snapshot de servicio y `cancelToken`.
- `POST /appointments/:id/cancel`: cancelación con `token` o con token de sesión admin/barbero.
- `GET /appointments/:id/history` (barbero/admin): historial de acciones.

## Datos y almacenamiento
- Almacena en `data/db.json` para simplificar el arranque local.
- La tabla de auditoría `histories` registra creación y cancelación.

## Limitaciones actuales
- Sin framework (HTTP nativo); no hay validación de CAPTCHA real ni notificaciones.
- Concurrencia mínima (lectura/escritura de archivo). Pensado como base incremental.
