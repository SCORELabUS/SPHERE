# Implementación — Login/Registro con UVUS (CAS de la US)

> Guía directa de **qué archivos se crean/modifican y qué código va en cada uno**.
> Para el porqué de cada decisión y los riesgos, ver `sso-uvus-design.md`.
> Rama: `feature/sso-uvus` (desde `develop`). PR hacia `develop`.

---

## 0. Resumen de cambios

### Archivos nuevos
| Archivo | Qué es |
|---|---|
| `api/src/main/services/SSOService.ts` | Lógica CAS: URL de login, validar ticket, crear/recuperar usuario, emitir JWT. |
| `api/src/main/controllers/SSOController.ts` | `initiate`, `callback`, `exchange` (HTTP). |
| `api/src/main/routes/SSORoutes.ts` | Registra las rutas (auto-cargado). |
| `api/src/main/migrations/mongo/1782500000000-add-auth-provider.ts` | Backfill `authProvider:'local'`. |
| `frontend/src/modules/auth/pages/sso-callback/index.tsx` | Página que canjea el `code` por el token. |
| `api/src/test/unit-tests/sso-service.test.ts` | Unitarias del parseo/creación. |
| `api/src/test/sso.test.ts` | Integración de los 3 endpoints. |

### Archivos modificados
| Archivo | Cambio |
|---|---|
| `api/src/main/repositories/mongoose/models/UserMongoose.ts` | Campos `authProvider` + `ssoId`; `password` condicional. |
| `api/src/main/config/permissions.ts` | Regla pública `/users/auth/sso/us/*` **antes** de `/users/**`. |
| `api/src/main/config/container.ts` | Registrar `ssoService`. |
| `api/src/main/services/CacheService.ts` | Añadir método `del()`. |
| `frontend/src/routes/router.tsx` | Ruta pública `/sso/callback`. |
| `frontend/src/modules/auth/api/usersApi.ts` | `exchangeSsoCode(code)`. |
| `frontend/src/modules/auth/components/login-form/index.tsx` | Botón "Continuar con UVUS". |
| `frontend/src/modules/auth/components/register-form/index.tsx` | Botón "Continuar con UVUS". |
| `api/.env*`, `frontend/.env*` | Nuevas variables. |

---

## 1. Variables de entorno

`api/.env` (y `.env.testing`, `.env.production`):
```
SSO_US_CAS_URL=https://sso.us.es/cas
SSO_US_CALLBACK_URL=http://localhost:8080/api/v1/users/auth/sso/us/callback
FRONTEND_URL=http://localhost:5173
```
> `SSO_US_CALLBACK_URL` debe ser la URL pública real y **byte a byte idéntica** en
> `login` y en `serviceValidate`. En producción: dominio real + HTTPS (a través de nginx).
> No hace falta variable nueva en el frontend: el botón usa `VITE_API_URL`.

---

## 2. Backend

### 2.1 `UserMongoose.ts` — campos nuevos y password condicional

En el `userSchema`, junto al resto de campos:
```ts
authProvider: {
  type: String,
  enum: ['local', 'us-sso'],
  default: 'local',
},
ssoId: {
  type: String,
  index: true,
  sparse: true, // único-ish solo cuando existe; varios null no chocan
},
```
Cambiar la definición de `password`:
```ts
password: {
  type: String,
  minlength: 5,
  required: function (this: any) {
    return this.authProvider !== 'us-sso';
  },
  select: false,
},
```
Añadir a la interfaz `UserDocument`:
```ts
authProvider: 'local' | 'us-sso';
ssoId?: string;
```
> El `pre('save')` ya solo hashea `password` si está presente y modificado, así que un
> usuario SSO sin password no rompe ese hook.

### 2.2 `permissions.ts` — regla pública (ORDEN IMPORTANTE)

En `ROUTE_PERMISSIONS`, **antes** de la regla catch-all `/users/**` (la de
`allowedUserRoles: ['ADMIN','USER']`), añadir:
```ts
// SSO UVUS (Universidad de Sevilla) — público; debe ir ANTES de /users/**
{
  path: '/users/auth/sso/us/*',
  methods: ['GET'],
  isPublic: true,
},
```
> Una sola regla cubre `initiate`, `callback` y `exchange` (los tres GET). Colocarla
> después de `/users/**` haría que ese comodín la capturase y exigiera token.

### 2.3 `CacheService.ts` — método `del`

```ts
async del(key: string) {
  if (!this.redisClient) {
    throw new Error('ERROR: Redis client not initialized');
  }
  await this.redisClient.del(key);
}
```

### 2.4 `container.ts` — registrar el servicio

Import:
```ts
import SSOService from "../services/SSOService";
```
En `container.register({ ... })`:
```ts
ssoService: asClass(SSOService).singleton(),
```

### 2.5 `SSOService.ts` (nuevo)

```ts
import crypto from 'crypto';
import container from '../config/container';
import UserRepository from '../repositories/mongoose/UserRepository';
import OrganizationService from './OrganizationService';
import { generateJwtToken, generateUserTokenDTO } from '../utils/users/helpers';

const CAS_BASE_URL = process.env.SSO_US_CAS_URL ?? 'https://sso.us.es/cas';
const CALLBACK_URL =
  process.env.SSO_US_CALLBACK_URL ??
  `http://localhost:${process.env.SERVER_PORT ?? 8080}/api/v1/users/auth/sso/us/callback`;

export interface CasData {
  uvus: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

class SSOService {
  private userRepository: UserRepository;
  private organizationService: OrganizationService;

  constructor() {
    this.userRepository = container.resolve('userRepository');
    this.organizationService = container.resolve('organizationService');
  }

  buildCasLoginUrl(): string {
    return `${CAS_BASE_URL}/login?service=${encodeURIComponent(CALLBACK_URL)}`;
  }

  // Llama al CAS de la US y parsea el XML. OJO: confirmar nombres de atributo reales
  // (ver design §11.10). Se usa /p3/serviceValidate para recibir <cas:attributes>.
  async validateCasTicket(ticket: string): Promise<CasData | null> {
    const url = `${CAS_BASE_URL}/p3/serviceValidate?ticket=${encodeURIComponent(
      ticket
    )}&service=${encodeURIComponent(CALLBACK_URL)}`;
    const xml = await (await fetch(url)).text();

    const userMatch = xml.match(/<cas:user>([^<]+)<\/cas:user>/);
    if (!userMatch) return null;

    const pick = (tag: string) => {
      const m = xml.match(new RegExp(`<cas:${tag}>([^<]+)</cas:${tag}>`));
      return m ? m[1].trim() : null;
    };

    return {
      uvus: userMatch[1].trim(),
      email: pick('mail'),
      firstName: pick('givenName'),
      // schacSn1/schacSn2 si la US los entrega; fallback a 'sn'
      lastName: [pick('schacSn1'), pick('schacSn2')].filter(Boolean).join(' ') || pick('sn'),
    };
  }

  // Crea o recupera el usuario SSO y devuelve un JWT de sesión.
  async findOrCreateSSOUser(casData: CasData): Promise<{ token: string }> {
    const { uvus, email, firstName, lastName } = casData;

    // 1. ¿Ya existe esta cuenta SSO?
    let user = await this.userRepository.findOne({ ssoId: uvus });

    if (!user) {
      // 2. username libre (sufijar si choca). NO vincular por email (design §6.1/§11.3).
      const username = await this.resolveFreeUsername(uvus);

      user = await this.userRepository.create({
        username,
        ssoId: uvus,
        authProvider: 'us-sso',
        firstName: firstName ?? uvus,
        lastName: lastName ?? 'US',
        email: email ?? `${uvus}@alum.us.es`,
        ...generateUserTokenDTO(),
      });

      // 3. Organización personal (igual que el registro local). Si falla, propaga.
      await this.organizationService.ensurePersonalOrganizationForUser({
        id: user.id,
        username: user.username,
      });
    }

    const token = generateJwtToken({ id: user.id, username: user.username, role: user.role });
    return { token };
  }

  private async resolveFreeUsername(base: string): Promise<string> {
    const candidates = [base, `${base}-us`];
    for (const c of candidates) {
      if (!(await this.userRepository.findByUsername(c))) return c;
    }
    let i = 2;
    while (await this.userRepository.findByUsername(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }
}

export default SSOService;
```

### 2.6 `SSOController.ts` (nuevo)

```ts
import crypto from 'crypto';
import container from '../config/container';
import SSOService from '../services/SSOService';
import CacheService from '../services/CacheService';
import { handleError } from '../utils/users/helpers';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const SSO_CODE_TTL = 30; // segundos

class SSOController {
  private ssoService: SSOService;
  private cacheService: CacheService;

  constructor() {
    this.ssoService = container.resolve('ssoService');
    this.cacheService = container.resolve('cacheService');
    this.initiate = this.initiate.bind(this);
    this.callback = this.callback.bind(this);
    this.exchange = this.exchange.bind(this);
  }

  initiate(_req: any, res: any) {
    res.redirect(this.ssoService.buildCasLoginUrl());
  }

  async callback(req: any, res: any) {
    const { ticket } = req.query;
    if (!ticket) return res.redirect(`${FRONTEND_URL}/sso/callback?sso_error=no_ticket`);

    try {
      const casData = await this.ssoService.validateCasTicket(ticket);
      if (!casData) return res.redirect(`${FRONTEND_URL}/sso/callback?sso_error=invalid_ticket`);

      const { token } = await this.ssoService.findOrCreateSSOUser(casData);

      const code = crypto.randomBytes(16).toString('hex');
      await this.cacheService.set(`sso:code:${code}`, { token }, SSO_CODE_TTL);

      return res.redirect(`${FRONTEND_URL}/sso/callback?code=${code}`);
    } catch (err: any) {
      console.error('[SSO] callback error:', err);
      return res.redirect(`${FRONTEND_URL}/sso/callback?sso_error=server_error`);
    }
  }

  async exchange(req: any, res: any) {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'Missing code parameter' });

    try {
      const data = await this.cacheService.get(`sso:code:${code}`);
      if (!data) return res.status(401).json({ error: 'Invalid or expired SSO code' });

      await this.cacheService.del(`sso:code:${code}`); // un solo uso
      return res.json({ token: data.token });
    } catch (err: any) {
      const { status, message } = handleError(err);
      return res.status(status).json({ error: message });
    }
  }
}

export default SSOController;
```

### 2.7 `SSORoutes.ts` (nuevo)

```ts
import express from 'express';
import SSOController from '../controllers/SSOController';

const loadSSORoutes = function (app: express.Application) {
  const ssoController = new SSOController();
  const baseUrl = (process.env.BASE_URL_PATH ?? '') + '/api/v1';

  app.route(baseUrl + '/users/auth/sso/us/initiate').get(ssoController.initiate);
  app.route(baseUrl + '/users/auth/sso/us/callback').get(ssoController.callback);
  app.route(baseUrl + '/users/auth/sso/us/exchange').get(ssoController.exchange);
};

export default loadSSORoutes;
```

### 2.8 Migración `1782500000000-add-auth-provider.ts` (nueva)

```ts
import { type Connection } from 'mongoose';
import UserMongoose from '../../repositories/mongoose/models/UserMongoose';

export async function up(connection: Connection): Promise<void> {
  const User = connection.models.User || connection.model('User', UserMongoose.schema, 'users');
  await User.updateMany({ authProvider: { $exists: false } }, { $set: { authProvider: 'local' } });
}

export async function down(connection: Connection): Promise<void> {
  const User = connection.models.User || connection.model('User', UserMongoose.schema, 'users');
  await User.updateMany({ authProvider: 'local' }, { $unset: { authProvider: '', ssoId: '' } });
}
```

---

## 3. Frontend

### 3.1 `usersApi.ts` — función de intercambio

```ts
export function exchangeSsoCode(code: string): Promise<{ token: string }> {
  return fetch(`${import.meta.env.VITE_API_URL}/users/auth/sso/us/exchange?code=${code}`)
    .then(async (response) => {
      const parsed = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(parsed.error || 'SSO exchange failed');
      return parsed;
    });
}
```

### 3.2 `sso-callback/index.tsx` (nuevo)

```tsx
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useRouter } from '../../../core/hooks/useRouter';
import { exchangeSsoCode } from '../../api/usersApi';

const ERROR_MESSAGES: Record<string, string> = {
  no_ticket: 'No se recibió respuesta de la Universidad de Sevilla.',
  invalid_ticket: 'La validación con la Universidad de Sevilla falló.',
  server_error: 'Error procesando el inicio de sesión con UVUS.',
};

export default function SsoCallbackPage() {
  const [params] = useSearchParams();
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const ssoError = params.get('sso_error');
    if (ssoError) {
      setError(ERROR_MESSAGES[ssoError] ?? 'Error de autenticación.');
      return;
    }

    const code = params.get('code');
    if (!code) {
      setError('Falta el código de autenticación.');
      return;
    }

    exchangeSsoCode(code)
      .then(async ({ token }) => {
        window.history.replaceState({}, '', '/sso/callback'); // limpia ?code
        await login(token);
        router.push('/');
      })
      .catch((e: Error) => setError(e.message));
  }, [params, login, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error} <a href="/authentication" className="font-medium underline">Volver</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-tp-steel">Iniciando sesión con UVUS…</p>
    </div>
  );
}
```

### 3.3 `router.tsx` — ruta pública

Importar y añadir como ruta pública (junto a `/authentication`, fuera de `ProtectedRoute`):
```tsx
import SsoCallbackPage from '../modules/auth/pages/sso-callback';
// ...
{ element: <SsoCallbackPage />, path: '/sso/callback' },
```

### 3.4 Botón "Continuar con UVUS" (login y registro)

En `login-form/index.tsx` y `register-form/index.tsx`, **debajo** del `<form>`:
```tsx
<div className="my-5 flex items-center gap-3">
  <div className="h-px flex-1 bg-tp-input-border" />
  <span className="text-xs text-tp-muted">o</span>
  <div className="h-px flex-1 bg-tp-input-border" />
</div>

<a
  href={`${import.meta.env.VITE_API_URL}/users/auth/sso/us/initiate`}
  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-tp-input-border bg-tp-input-bg text-sm font-medium text-tp-ink transition-colors duration-200 hover:border-tp-primary"
>
  Continuar con UVUS
</a>
```
> Es un `<a href>` (navegación completa), no `fetch`: el flujo CAS necesita redirects de
> navegador. En dev, Vite proxya `/api/v1` al backend.

---

## 4. Tests

### 4.1 `unit-tests/sso-service.test.ts`
- `validateCasTicket`: mockear `fetch` (`vi.stubGlobal('fetch', ...)`):
  - XML `authenticationSuccess` con atributos → `CasData` correcto.
  - XML `authenticationFailure` → `null`.
  - XML sin `<cas:user>` → `null`.
- `resolveFreeUsername`: sufijado ante colisiones.

### 4.2 `sso.test.ts` (integración, supertest; requiere Mongo+Redis)
- `GET /users/auth/sso/us/initiate` → 302 a `…/cas/login?service=…` (URL correcta).
- `callback` sin `ticket` → 302 a `…/sso/callback?sso_error=no_ticket`.
- `callback` con ticket válido (mock de `validateCasTicket`) → crea usuario + org personal,
  302 con `?code=`.
- segundo `callback` con el mismo UVUS → no duplica (busca por `ssoId`).
- `exchange` con code válido → `{ token }` (verificable con `JWT_SECRET`); el JWT vale en
  `GET /users/me`.
- `exchange` con code inexistente o ya usado → 401.

> El test paramétrico de `auth.test.ts` no necesita cambios (design §11.11).

---

## 5. Qué hay que pedir a la Universidad de Sevilla

La integración con el CAS **no es automática**: hay que enviar el formulario
`SolicitudSSO.pdf` desde https://sos.us.es → "PETICIÓN DE INTEGRACIÓN DE APP CON EL SSO /
FEDERACIÓN". Sin esa alta, la URL de callback no está autorizada como `service` y el CAS
rechaza la autenticación. **Hacerlo en paralelo desde el principio: el alta tarda.**

### 5.1 Datos del formulario
| Campo | Valor |
|---|---|
| Nombre de la aplicación | SPHERE |
| URL | URL pública de despliegue con HTTPS (la misma de `SSO_US_CALLBACK_URL`, dominio real en producción). |
| Descripción y colectivos | Plataforma de gestión y análisis de *pricings*; la usan alumnado y PDI del grupo de investigación. |
| Protocolo de integración | **CAS**. |

### 5.2 Atributos a marcar "Sí" (solo los que se usan)
| Atributo (formulario) | Clave | Uso en SPHERE |
|---|---|---|
| **UVUS (uid)** | `uid` | `ssoId` + base de `username`. |
| **Nombre (givenName)** | `givenName` | `firstName`. |
| **Primer apellido (schacSn1)** | `schacSn1` | `lastName`. |
| Segundo apellido (schacSn2) | `schacSn2` | `lastName` (parte 2). |
| **Correo US (mail)** | `mail` | `email`. |
| Tipo de usuario (eduPersonAffiliation) | `eduPersonAffiliation` | Distinguir alumno/PDI/PAS (uso futuro). |

> El resto de atributos del formulario (centro, departamento, relación, unidad
> administrativa, `schacUserStatus`, `schacPersonalUniqueId`) **no se piden**:
> minimización de datos (RGPD).

### 5.3 Qué devuelve la US al aprobar
- Autoriza la URL de callback (`SSO_US_CALLBACK_URL`) como `service` válido.
- Confirma los **endpoints CAS reales** y los **nombres exactos de los atributos** en la
  respuesta de `serviceValidate`. → Con eso se ajusta `validateCasTicket` (§2.5) y se hace
  el E2E real (ver §11.10 del design: no dar por buenos los nombres hasta verificarlos).

Normativa y docs: https://sic.us.es/servicios/cuentas-y-accesos-los-servicios/integracion-con-sso

---

## 6. Orden de ejecución (checklist)

1. [ ] `UserMongoose.ts`: `authProvider` + `ssoId` + `password` condicional.
2. [ ] Migración `add-auth-provider` + `npx migrate up`.
3. [ ] `permissions.ts`: regla pública antes de `/users/**`.
4. [ ] `CacheService.ts`: `del()`.
5. [ ] `SSOService.ts` + registro en `container.ts`.
6. [ ] `SSOController.ts` + `SSORoutes.ts`.
7. [ ] Backend tests (unit + integración) en verde.
8. [ ] `usersApi.exchangeSsoCode` + `sso-callback` + ruta en `router.tsx`.
9. [ ] Botón UVUS en login y registro.
10. [ ] Variables de entorno en `api/.env*`.
11. [ ] Enviar `SolicitudSSO.pdf` a la US (en paralelo) y, al tener el alta, **verificar
    los nombres de atributo CAS reales** (design §11.10) y E2E real.
12. [ ] PR `feature/sso-uvus` → `develop`.
