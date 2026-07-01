# Implementación — Login/Registro con UVUS (CAS de la US)

> Guía directa de **qué archivos se crean/modifican y qué código va en cada uno**.
> Para el porqué de cada decisión y los riesgos, ver `sso-uvus-design.md`.
> Rama: `feature/sso-uvus` (desde `develop`). PR hacia `develop`.
>
> **Diseño multi-proveedor desde el principio.** Google se hará después, así que la capa
> de identidad se deja **genérica por proveedor** (interfaz + registry) y el modelo usa
> `identities[]`. Con esto, Google entra como una implementación más, sin tocar
> controlador, rutas, one-time code ni frontend. Ver `social-login-google-prep.md`.

---

## 0. Resumen de cambios

### Archivos nuevos
| Archivo | Qué es |
|---|---|
| `api/src/main/services/identity/IdentityProvider.ts` | Interfaz `IdentityProvider` + tipo `ProviderProfile`. |
| `api/src/main/services/identity/UsCasProvider.ts` | Implementación UVUS (CAS): URL de login, validar ticket → perfil. |
| `api/src/main/services/identity/providerRegistry.ts` | Mapa `nombre → proveedor`. Aquí se añadirá `google`. |
| `api/src/main/services/AuthProviderService.ts` | Lógica común: crear/recuperar usuario por identidad, org personal, JWT. |
| `api/src/main/controllers/SSOController.ts` | `initiate`, `callback`, `exchange` (genérico por `:provider`). |
| `api/src/main/routes/SSORoutes.ts` | Rutas `/users/auth/sso/:provider/*` (auto-cargado). |
| `frontend/src/modules/auth/pages/sso-callback/index.tsx` | Página que canjea el `code` por el token. |
| `api/src/test/unit-tests/us-cas-provider.test.ts` | Unitarias del parseo CAS. |
| `api/src/test/sso.test.ts` | Integración de los 3 endpoints. |

### Archivos modificados
| Archivo | Cambio |
|---|---|
| `api/src/main/repositories/mongoose/models/UserMongoose.ts` | `identities[]`; `password` condicional; índice único. |
| `api/src/main/config/permissions.ts` | Regla pública `/users/auth/sso/**` **antes** de `/users/**`. |
| `api/src/main/config/container.ts` | Registrar `authProviderService`. |
| `api/src/main/services/CacheService.ts` | Añadir método `del()`. |
| `frontend/src/routes/router.tsx` | Ruta pública `/sso/callback`. |
| `frontend/src/modules/auth/api/usersApi.ts` | `exchangeSsoCode(code)`. |
| `frontend/src/modules/auth/components/login-form/index.tsx` | Botón "Continuar con UVUS". |
| `frontend/src/modules/auth/components/register-form/index.tsx` | Botón "Continuar con UVUS". |
| `api/.env*` | Nuevas variables. |

> No hace falta migración: los usuarios existentes tienen contraseña y `identities`
> ausente/vacío, lo cual es coherente con el nuevo `password` condicional y con el índice
> `sparse`. (Opcional: una migración que ponga `identities: []` por limpieza.)

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

### 2.1 `UserMongoose.ts` — `identities[]` y password condicional

Nuevo subschema y campo (junto al resto del `userSchema`):
```ts
const IdentitySchema = new Schema(
  {
    provider: { type: String, enum: ['us-sso', 'google'], required: true },
    providerId: { type: String, required: true }, // uid (UVUS) | sub (Google)
    email: { type: String },
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// dentro de userSchema:
identities: { type: [IdentitySchema], default: [] },
```
`password` pasa a ser obligatorio **solo** para cuentas sin identidad externa (las locales):
```ts
password: {
  type: String,
  minlength: 5,
  select: false,
  required: function (this: any) {
    return !this.identities || this.identities.length === 0;
  },
},
```
Índice único por identidad (evita duplicar la misma identidad de proveedor):
```ts
userSchema.index(
  { 'identities.provider': 1, 'identities.providerId': 1 },
  { unique: true, sparse: true }
);
```
Añadir a la interfaz `UserDocument`:
```ts
identities: {
  provider: 'us-sso' | 'google';
  providerId: string;
  email?: string;
  linkedAt?: Date;
}[];
```
> El `pre('save')` ya solo hashea `password` si está presente y modificado, así que un
> usuario SSO sin password no rompe ese hook.

### 2.2 `permissions.ts` — regla pública (ORDEN IMPORTANTE)

En `ROUTE_PERMISSIONS`, **antes** del catch-all `/users/**`, añadir:
```ts
// Login social (UVUS, Google, …) — público; debe ir ANTES de /users/**
{
  path: '/users/auth/sso/**',
  methods: ['GET'],
  isPublic: true,
},
```
> `**` (no `*`) porque la ruta tiene dos segmentos variables: `:provider` + acción. Cubre
> `initiate`, `callback` y `exchange` de **cualquier** proveedor.

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

```ts
import AuthProviderService from "../services/AuthProviderService";
// ...
authProviderService: asClass(AuthProviderService).singleton(),
```

### 2.5 `services/identity/IdentityProvider.ts` (nuevo) — contrato común

```ts
export interface ProviderProfile {
  provider: 'us-sso' | 'google';
  providerId: string;      // uid (UVUS) | sub (Google)
  email: string | null;
  emailVerified: boolean;  // UVUS: false; Google: claim email_verified
  firstName: string | null;
  lastName: string | null;
}

export interface IdentityProvider {
  name: 'us-sso' | 'google';
  buildLoginUrl(state: string): string;
  // Traduce lo que llegue al callback (ticket | code) en un perfil normalizado.
  handleCallback(query: Record<string, string>): Promise<ProviderProfile | null>;
}
```

### 2.6 `services/identity/UsCasProvider.ts` (nuevo) — proveedor UVUS

```ts
import { IdentityProvider, ProviderProfile } from './IdentityProvider';

const CAS_BASE_URL = process.env.SSO_US_CAS_URL ?? 'https://sso.us.es/cas';
const CALLBACK_URL =
  process.env.SSO_US_CALLBACK_URL ??
  `http://localhost:${process.env.SERVER_PORT ?? 8080}/api/v1/users/auth/sso/us/callback`;

export class UsCasProvider implements IdentityProvider {
  name = 'us-sso' as const;

  buildLoginUrl(): string {
    // CAS no usa 'state'; el ticket es de un solo uso y se valida en servidor.
    return `${CAS_BASE_URL}/login?service=${encodeURIComponent(CALLBACK_URL)}`;
  }

  async handleCallback(query: Record<string, string>): Promise<ProviderProfile | null> {
    const ticket = query.ticket;
    if (!ticket) return null;

    // /p3/serviceValidate devuelve <cas:attributes>. OJO: confirmar nombres reales
    // de atributo con la US antes del E2E (design §11.10).
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

    const uvus = userMatch[1].trim();
    return {
      provider: 'us-sso',
      providerId: uvus, // uid / UVUS
      // Los defaults específicos de la US se resuelven AQUÍ, para que AuthProviderService
      // quede neutral (no conozca ningún proveedor). Ver nota en §2.8.
      email: pick('mail') ?? `${uvus}@alum.us.es`,
      emailVerified: false, // la US no lo garantiza; ver §6.1 del design
      firstName: pick('givenName') ?? uvus,
      lastName:
        [pick('schacSn1'), pick('schacSn2')].filter(Boolean).join(' ') || pick('sn') || 'US',
    };
  }
}
```

### 2.7 `services/identity/providerRegistry.ts` (nuevo)

```ts
import { IdentityProvider } from './IdentityProvider';
import { UsCasProvider } from './UsCasProvider';

const providers: Record<string, IdentityProvider> = {
  us: new UsCasProvider(),
  // 'google': new GoogleProvider(),  ← se añadirá en la fase Google
};

export function getProvider(name: string): IdentityProvider | null {
  return providers[name] ?? null;
}
```
> La URL de proveedor es `/users/auth/sso/**us**/…`; la clave del registry (`us`) es el
> segmento `:provider`, distinta del `name` interno (`us-sso`).

### 2.8 `AuthProviderService.ts` (nuevo) — lógica común

```ts
import container from '../config/container';
import UserRepository from '../repositories/mongoose/UserRepository';
import OrganizationService from './OrganizationService';
import { ProviderProfile } from './identity/IdentityProvider';
import { generateJwtToken, generateUserTokenDTO } from '../utils/users/helpers';

class AuthProviderService {
  private userRepository: UserRepository;
  private organizationService: OrganizationService;

  constructor() {
    this.userRepository = container.resolve('userRepository');
    this.organizationService = container.resolve('organizationService');
  }

  // Crea o recupera el usuario a partir de un perfil de proveedor y devuelve un JWT.
  async findOrCreateUser(profile: ProviderProfile): Promise<{ token: string }> {
    const { provider, providerId, email, emailVerified, firstName, lastName } = profile;

    // 1. ¿Ya existe esta identidad?
    let user = await this.userRepository.findOne({
      'identities.provider': provider,
      'identities.providerId': providerId,
    });

    // 2. Vinculación por email SOLO si el proveedor verifica el email (Google sí, UVUS no).
    if (!user && emailVerified && email) {
      const existing = await this.userRepository.findByEmail(email);
      if (existing) {
        await this.userRepository.updateById(existing.id, {
          $push: { identities: { provider, providerId, email } },
        } as any);
        user = await this.userRepository.findById(existing.id);
      }
    }

    // 3. Si no existe, crear cuenta nueva. El proveedor ya entrega un perfil válido
    //    (con sus propios defaults); esta capa es neutral y no conoce ningún proveedor.
    if (!user) {
      if (!email) throw new Error('INVALID DATA: provider did not supply an email');
      const username = await this.resolveFreeUsername(providerId);
      user = await this.userRepository.create({
        username,
        identities: [{ provider, providerId, email }],
        firstName: firstName ?? username,
        lastName: lastName ?? '-', // el modelo exige lastName; los proveedores lo rellenan
        email,
        ...generateUserTokenDTO(),
      });
      // Organización personal (igual que el registro local). Si falla, propaga.
      await this.organizationService.ensurePersonalOrganizationForUser({
        id: user.id,
        username: user.username,
      });
    }

    const token = generateJwtToken({ id: user!.id, username: user!.username, role: user!.role });
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

export default AuthProviderService;
```
> Esta capa es **neutral**: no contiene defaults de ningún proveedor. Cada proveedor
> entrega en su `ProviderProfile` el email/nombre ya resueltos (UVUS pone el fallback
> `@alum.us.es` en `UsCasProvider`, §2.6). Así, añadir proveedores no obliga a tocar aquí.
> El `throw` por email ausente es defensa: el modelo exige `email` único.

### 2.9 `SSOController.ts` (nuevo) — genérico por proveedor

```ts
import crypto from 'crypto';
import container from '../config/container';
import AuthProviderService from '../services/AuthProviderService';
import CacheService from '../services/CacheService';
import { getProvider } from '../services/identity/providerRegistry';
import { handleError } from '../utils/users/helpers';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const SSO_CODE_TTL = 30; // segundos

class SSOController {
  private authProviderService: AuthProviderService;
  private cacheService: CacheService;

  constructor() {
    this.authProviderService = container.resolve('authProviderService');
    this.cacheService = container.resolve('cacheService');
    this.initiate = this.initiate.bind(this);
    this.callback = this.callback.bind(this);
    this.exchange = this.exchange.bind(this);
  }

  initiate(req: any, res: any) {
    const provider = getProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: 'Unknown provider' });
    const state = crypto.randomBytes(16).toString('hex'); // usado por OAuth (Google)
    res.redirect(provider.buildLoginUrl(state));
  }

  async callback(req: any, res: any) {
    const provider = getProvider(req.params.provider);
    if (!provider) return res.redirect(`${FRONTEND_URL}/sso/callback?sso_error=unknown_provider`);

    try {
      const profile = await provider.handleCallback(req.query);
      if (!profile) return res.redirect(`${FRONTEND_URL}/sso/callback?sso_error=invalid_response`);

      const { token } = await this.authProviderService.findOrCreateUser(profile);

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

### 2.10 `SSORoutes.ts` (nuevo)

```ts
import express from 'express';
import SSOController from '../controllers/SSOController';

const loadSSORoutes = function (app: express.Application) {
  const ssoController = new SSOController();
  const baseUrl = (process.env.BASE_URL_PATH ?? '') + '/api/v1';

  app.route(baseUrl + '/users/auth/sso/:provider/initiate').get(ssoController.initiate);
  app.route(baseUrl + '/users/auth/sso/:provider/callback').get(ssoController.callback);
  app.route(baseUrl + '/users/auth/sso/:provider/exchange').get(ssoController.exchange);
};

export default loadSSORoutes;
```
> El botón UVUS apunta a `/users/auth/sso/us/initiate`; el de Google (futuro) a
> `/users/auth/sso/google/initiate`. Solo hay que registrar el proveedor en el registry.

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
> El `exchange` es genérico: no usa el `:provider` (solo lee el code de la caché), pero la
> ruta lleva ese segmento como las demás. Se usa el mismo proveedor que originó el flujo
> (aquí `us`); para Google sería `…/sso/google/exchange`.

### 3.2 `sso-callback/index.tsx` (nuevo)

```tsx
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useRouter } from '../../../core/hooks/useRouter';
import { exchangeSsoCode } from '../../api/usersApi';

// Claves emitidas por el backend en ?sso_error= (ver SSOController).
const ERROR_MESSAGES: Record<string, string> = {
  invalid_response: 'La validación con el proveedor falló.',
  unknown_provider: 'Proveedor de identidad no reconocido.',
  server_error: 'Error procesando el inicio de sesión.',
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
      <p className="text-sm text-tp-steel">Iniciando sesión…</p>
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
> Es un `<a href>` (navegación completa), no `fetch`: el flujo necesita redirects de
> navegador. En dev, Vite proxya `/api/v1` al backend. El botón de Google (futuro) es una
> copia con `href` a `…/sso/google/initiate`.

---

## 4. Tests

### 4.1 `unit-tests/us-cas-provider.test.ts`
- `UsCasProvider.handleCallback`: mockear `fetch` (`vi.stubGlobal('fetch', ...)`):
  - XML `authenticationSuccess` con atributos → `ProviderProfile` correcto (`provider:'us-sso'`).
  - XML `authenticationFailure` → `null`.
  - XML sin `<cas:user>` → `null`.
  - sin `ticket` en la query → `null`.

### 4.2 `sso.test.ts` (integración, supertest; requiere Mongo+Redis)
- `GET /users/auth/sso/us/initiate` → 302 a `…/cas/login?service=…`.
- `GET /users/auth/sso/desconocido/initiate` → 404.
- `callback` sin `ticket` → 302 a `…/sso/callback?sso_error=invalid_response`.
- `callback` con ticket válido (mock del proveedor) → crea usuario + org personal, 302 `?code=`.
- segundo `callback` con la misma identidad → no duplica (busca por `identities`).
- `exchange` con code válido → `{ token }` (JWT en `GET /users/me`).
- `exchange` con code inexistente o ya usado → 401.

> El test paramétrico de `auth.test.ts` no necesita cambios (design §11.11): la regla
> `/users/auth/sso/**` genera una ruta `sample` → 302/404, no error de auth.

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
| **UVUS (uid)** | `uid` | `identities.providerId` + base de `username`. |
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
  respuesta de `serviceValidate`. → Con eso se ajusta `UsCasProvider.handleCallback`
  (§2.6) y se hace el E2E real (design §11.10: no dar por buenos los nombres hasta
  verificarlos).

Normativa y docs: https://sic.us.es/servicios/cuentas-y-accesos-los-servicios/integracion-con-sso

---

## 6. Orden de ejecución (checklist)

1. [ ] `UserMongoose.ts`: `identities[]` + `password` condicional + índice único.
2. [ ] `permissions.ts`: regla pública `/users/auth/sso/**` antes de `/users/**`.
3. [ ] `CacheService.ts`: `del()`.
4. [ ] Capa de identidad: `IdentityProvider`, `UsCasProvider`, `providerRegistry`.
5. [ ] `AuthProviderService` + registro en `container.ts`.
6. [ ] `SSOController.ts` + `SSORoutes.ts`.
7. [ ] Backend tests (unit + integración) en verde (Mongo+Redis levantados).
8. [ ] `usersApi.exchangeSsoCode` + `sso-callback` + ruta en `router.tsx`.
9. [ ] Botón UVUS en login y registro.
10. [ ] Variables de entorno en `api/.env*`.
11. [ ] Enviar `SolicitudSSO.pdf` a la US (en paralelo) y, al tener el alta, **verificar
    los nombres de atributo CAS reales** (design §11.10) y E2E real.
12. [ ] PR `feature/sso-uvus` → `develop`.

> Google (fase siguiente): añadir `GoogleProvider implements IdentityProvider` y
> registrarlo en `providerRegistry`. No toca modelo, controlador, rutas ni frontend salvo
> el botón. Ver `social-login-google-prep.md`.
