# Preparación para login social con Google

> Qué se necesita y cómo dejar el código listo para añadir **"Continuar con Google"**
> **después** de que estén el login local y el de UVUS.
> Orden previsto: **local → UVUS (CAS) → Google (OAuth2/OIDC)**.
> Relacionado: `sso-uvus-design.md` y `sso-uvus-implementation.md`.

---

## 1. Idea clave

Google **no** usa CAS como la US: usa **OAuth 2.0 / OpenID Connect (código de
autorización)**. El flujo de navegador (botón → redirect al proveedor → callback →
one-time code → intercambio por JWT) es **el mismo** que el de UVUS y se reutiliza tal
cual. Lo que cambia es **cómo el backend valida la respuesta del proveedor**:

- UVUS/CAS: recibe un `ticket` y lo valida con `serviceValidate` (XML).
- Google/OAuth2: recibe un `code` + `state`, lo canjea por un `id_token` (JWT firmado por
  Google) y lee los datos del usuario de sus *claims*.

Por eso, si durante la fase de UVUS dejamos la parte de "identidad del proveedor" detrás
de una **interfaz común**, Google se añade como una implementación más sin tocar
controlador, rutas, one-time code ni frontend.

---

## 2. Qué hay que dar de alta en Google (fuera del código)

Todo esto se hace en **Google Cloud Console** (https://console.cloud.google.com), no
requiere trámite con terceros como la US, pero sí configuración:

1. **Crear un proyecto** (o reutilizar uno).
2. **OAuth consent screen** (pantalla de consentimiento):
   - Tipo **External** (para permitir cuentas fuera de la organización).
   - Nombre de la app, logo, email de soporte, dominios autorizados.
   - **Scopes**: `openid`, `email`, `profile`.
   - En modo *Testing* solo entran los *test users* que añadas; para abrirlo a cualquiera
     hay que **publicar** la app (y, si Google lo pide, pasar verificación — con los
     scopes básicos email/profile normalmente no hace falta revisión).
3. **Credentials → Create credentials → OAuth client ID**:
   - Tipo **Web application**.
   - **Authorized JavaScript origins**: el origin del frontend (p. ej.
     `http://localhost:5173`, y el dominio de producción con HTTPS).
   - **Authorized redirect URIs**: la URL de callback del **backend**
     (p. ej. `http://localhost:8080/api/v1/users/auth/sso/google/callback` y la de
     producción). Debe coincidir **exactamente** con la que use el código.
4. Guardar el **Client ID** y el **Client Secret** → van a variables de entorno.

> A diferencia de la US: no hay formulario ni espera de alta; lo controlas tú desde la
> consola. El único punto que puede tardar es la **verificación/publicación** si abrís la
> app a cualquier cuenta de Google.

---

## 3. Diferencias UVUS (CAS) vs Google (OAuth2/OIDC)

| | **UVUS / CAS** | **Google / OAuth2-OIDC** |
|---|---|---|
| Redirect de ida | `…/cas/login?service=CALLBACK` | `…/o/oauth2/v2/auth?client_id&redirect_uri&scope&state&response_type=code` |
| Qué llega al callback | `ticket` | `code` + `state` |
| Validación en backend | GET `serviceValidate` → XML | POST `token` (con client_secret) → `id_token` (JWT) |
| Datos del usuario | atributos CAS (`uid`, `mail`, `givenName`, `schacSn1`…) | claims OIDC (`sub`, `email`, `email_verified`, `given_name`, `family_name`, `picture`) |
| Email verificado | No lo garantiza | **Sí** (`email_verified: true`) |
| Secreto de cliente | No | **Sí** (`client_secret`, nunca en frontend) |
| CSRF | ticket de un solo uso | requiere parámetro **`state`** propio |
| Librería | ninguna (fetch + parseo) | recomendable `google-auth-library` |

---

## 4. Cómo dejar el código preparado durante la fase de UVUS

Estos ajustes se hacen **al implementar UVUS**, para que Google sea un *drop-in*. Son
pequeños cambios de forma respecto al `sso-uvus-implementation.md`:

### 4.1 Rutas genéricas por proveedor
En vez de rutas fijas `/users/auth/sso/us/*`, usar un segmento de proveedor:
```
GET /users/auth/sso/:provider/initiate
GET /users/auth/sso/:provider/callback
GET /users/auth/sso/:provider/exchange
```
La regla de permisos ya es genérica y sigue valiendo: `/users/auth/sso/*` **no**, ojo —
`*` casa un solo segmento y aquí hay dos (`:provider` + acción). Usar:
```ts
{ path: '/users/auth/sso/**', methods: ['GET'], isPublic: true },
```
colocada **antes** de `/users/**` (mismo criterio que en el doc de UVUS).

### 4.2 Interfaz común de proveedor
Definir una interfaz y un *registry*; UVUS es la primera implementación, Google la segunda:
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
- `UsCasProvider` implementa `IdentityProvider` con `name: 'us-sso'` (fase UVUS).
- `GoogleProvider` la implementará con `name: 'google'` (fase Google).
- El `SSOController` es genérico: recibe `:provider`, lo resuelve en el *registry* y llama
  a `buildLoginUrl` / `handleCallback`. El resto (one-time code, `findOrCreateUser` en
  `AuthProviderService`, emitir JWT) es **común**.

### 4.3 `findOrCreateUser` común y agnóstico de proveedor
`AuthProviderService.findOrCreateUser` toma un `ProviderProfile` (no un objeto específico
de CAS): crea/recupera usuario + organización personal + emite JWT una sola vez. Google
reutiliza exactamente esa función.

### 4.4 Parámetro `state` desde el principio
UVUS con CAS no lo necesita, pero el flujo genérico ya genera el `state` en el
controlador. Su ciclo de vida completo (guardar en caché en `initiate`, validar y borrar
en `callback`, un solo uso, TTL 600s) está definido en `sso-uvus-implementation.md` §2.12
y se activa en esta fase.

---

## 5. Cambios de modelo para multi-proveedor

**Decisión tomada (Google se hará seguro):** el modelo usa `identities[]` **desde la fase
UVUS**, no un `authProvider` + `ssoId` de un solo proveedor. Así se soporta que un usuario
tenga varias identidades (local + Google, o UVUS + Google) y se evita una migración
intermedia. Definición (ya incluida en `sso-uvus-implementation.md` §2.1):
```ts
identities: [
  {
    provider: { type: String, enum: ['us-sso', 'google'], required: true },
    providerId: { type: String, required: true }, // uid (UVUS) | sub (Google)
    email: { type: String },
    linkedAt: { type: Date, default: Date.now },
  },
],
```
- Índice compuesto único `(identities.provider, identities.providerId)` con `sparse`.
- `password` es obligatorio solo si el usuario no tiene identidades (cuenta local pura).
- Búsqueda de cuenta: por `(identities.provider, identities.providerId)`.
- Permite **vincular** un proveedor nuevo a una cuenta existente sin duplicar usuario.

Cuando entre Google, **no hay cambios de modelo**: solo se empieza a emitir
`provider: 'google'` en las identidades.

### 5.1 Vinculación de cuentas: aquí Google SÍ puede vincular por email
Google entrega `email_verified: true`, así que **sí es seguro** vincular una cuenta Google
a una cuenta existente (local o UVUS) que tenga el mismo email verificado. Esto contrasta
con UVUS/local, donde no había verificación (design §11.3). Regla propuesta:
- Buscar por `(provider, providerId)`. Si existe → entrar.
- Si no, y `email_verified === true` y hay una cuenta con ese email → **vincular** (añadir
  la identidad al usuario existente).
- Si no → crear cuenta nueva. **Username**: el `sub` de Google es un número de ~21 dígitos
  y no sirve como username legible; usar la **parte local del email** (`fran.garcia` de
  `fran.garcia@gmail.com`) como base, sufijando si choca. Para ello, en esta fase se añade
  un campo opcional `suggestedUsername?: string` a `ProviderProfile` y la capa común usa
  `resolveFreeUsername(profile.suggestedUsername ?? profile.providerId)` (UVUS no lo
  necesita: su `providerId` —el UVUS— ya es legible). El sufijado se resuelve **antes** de
  crear la organización personal, igual que en UVUS.

---

## 6. Variables de entorno (Google)

`api/.env*`:
```
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
GOOGLE_CALLBACK_URL=http://localhost:8080/api/v1/users/auth/sso/google/callback
```
`FRONTEND_URL` ya existe de la fase UVUS. El `client_secret` **solo** en el backend,
nunca en el frontend ni en el repo.

---

## 7. Dependencia recomendada

```
pnpm add google-auth-library
```
`OAuth2Client` cubre: construir la URL de login (`generateAuthUrl`), canjear el `code`
(`getToken`) y **verificar el `id_token`** (`verifyIdToken`), que valida firma, emisor,
audiencia y expiración. Evita implementar la validación OIDC a mano.

---

## 8. Flujo Google (cuando toque implementarlo)

1. `initiate` (provider=google): `res.redirect(oauth2Client.generateAuthUrl({ scope:
   ['openid','email','profile'], state, access_type: 'online', prompt: 'select_account' }))`.
   Guardar `state` en `CacheService` (TTL corto).
2. `callback`: recibe `code` + `state`. Validar `state` contra la caché. `getToken(code)`
   → `verifyIdToken(id_token)` → claims (`sub`, `email`, `email_verified`, `given_name`,
   `family_name`, `picture`) → `ProviderProfile`.
3. A partir de aquí, **idéntico a UVUS**: `findOrCreateUser(profile)`, one-time `code` en
   caché, redirect a `FRONTEND_URL/sso/callback?code=…`, y `exchange` devuelve el JWT.

---

## 9. Frontend

Reutiliza la página `/sso/callback` (es agnóstica del proveedor: solo canjea el `code`).
Solo hay que añadir **otro botón**:
```tsx
<a href={`${import.meta.env.VITE_API_URL}/users/auth/sso/google/initiate`} className="…">
  Continuar con Google
</a>
```
Mismo estilo que el botón UVUS (borde, secundario). Quedan los dos botones sociales
debajo del formulario, separados del login local por el divisor "o".

---

## 10. Tests (cuando se implemente)

- Unitarias: mockear `google-auth-library` (`verifyIdToken` → payload fijo) y comprobar
  el mapeo a `ProviderProfile`. Validación de `state` (rechazo si no coincide/expira).
- Integración: `initiate` → 302 a `accounts.google.com` con `client_id`/`state`;
  `callback` con `code` mockeado → crea/vincula usuario; `exchange` → JWT válido.
- Vinculación por email verificado: cuenta local + Google mismo email → misma cuenta.
- El test paramétrico de endpoints públicos seguirá pasando con la regla
  `/users/auth/sso/**` (genera `/users/auth/sso/sample` → 404, no error de auth;
  ver design §11.11).

---

## 11. Checklist

### Preparar AHORA (durante la fase UVUS) para que Google sea drop-in
- [ ] Rutas por proveedor `/users/auth/sso/:provider/*` y permiso `/users/auth/sso/**`.
- [ ] Interfaz `IdentityProvider` + *registry*; `UsCasProvider` como primera impl.
- [ ] `AuthProviderService.findOrCreateUser(ProviderProfile)` común (no atado a CAS).
- [ ] Parámetro `state` en el flujo genérico (aunque CAS no lo use).
- [ ] Modelo con `identities[]` (decidido) — ver `sso-uvus-implementation.md` §2.1.
- [ ] Página `/sso/callback` agnóstica del proveedor (ya lo es).

### Hacer DESPUÉS (fase Google)
- [ ] Proyecto + OAuth consent screen + OAuth Client ID en Google Cloud.
- [ ] Variables `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`.
- [ ] `pnpm add google-auth-library`.
- [ ] `GoogleProvider implements IdentityProvider` (login URL, token, verifyIdToken).
- [ ] `suggestedUsername` en `ProviderProfile` (parte local del email como base de username).
- [ ] Activar validación de `state` en callback (`sso-uvus-implementation.md` §2.12).
- [ ] Registrar `google` en el *registry*.
- [ ] Vinculación por email verificado.
- [ ] Botón "Continuar con Google" en login y registro.
- [ ] Tests unit + integración.
- [ ] Publicar/verificar la app en Google si se abre a cualquier cuenta.
