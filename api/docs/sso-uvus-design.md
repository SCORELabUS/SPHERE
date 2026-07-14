# Diseño — Registro / Login con UVUS (SSO Universidad de Sevilla)

> Documento de diseño previo a la implementación. Define qué hay que solicitar a la US,
> qué protocolo usar, cómo encaja en la arquitectura actual de SPHERE, los cambios de
> modelo, los endpoints, el flujo frontend, la seguridad y las suites de pruebas.
>
> **Estado:** propuesta de diseño. No incluye código de producción todavía.
> **Rama de trabajo sugerida:** `feature/sso-uvus` partiendo de `develop`, PR hacia `develop`.

---

## 1. Objetivo

Añadir un botón **"Continuar con UVUS"** en las pantallas de login y registro de SPHERE
que permita a cualquier miembro de la Universidad de Sevilla (alumnado, PDI, PAS)
**autenticarse y crear cuenta** en SPHERE usando su identidad institucional (UVUS),
sin tener que rellenar el formulario de registro ni gestionar otra contraseña.

Debe convivir con el login/registro local existente (usuario+contraseña) sin romperlo.

---

## 2. Qué hay que pedirle a la Universidad de Sevilla

La integración con el SSO de la US **no es automática**: hay que enviar una solicitud
formal (formulario `SolicitudSSO.pdf`, accesible desde https://sos.us.es →
"PETICIÓN DE INTEGRACIÓN DE APP CON EL SSO / FEDERACIÓN").

Normativa y docs de referencia:
- Política/normativa: https://sic.us.es/servicios/cuentas-y-accesos-los-servicios/integracion-con-sso/politica-y-normativa-integracion-con-0
- Info general: https://sic.us.es/servicios/cuentas-y-accesos-los-servicios/integracion-con-sso
- Atributos: https://sic.us.es/servicios/cuentas-y-accesos-los-servicios/integracion-con-sso/sso-atributos

### 2.1 Campos del formulario de solicitud

| Campo | Valor propuesto para SPHERE |
|---|---|
| **Nombre de la aplicación** | SPHERE |
| **URL** | URL pública de despliegue (p. ej. `https://sphere.us.es` o la que corresponda). En desarrollo se suele aceptar `http://localhost:5173`/`localhost` para pruebas, pero producción exige dominio real con HTTPS. |
| **Descripción y colectivos** | Plataforma de gestión y análisis de *pricings* (Pricing-as-a-Service). La usarán alumnado y PDI del grupo de investigación / asignaturas implicadas. |
| **Protocolo de integración** | **CAS** (recomendado, ver §3). Alternativa: SAML. |

### 2.2 Atributos a solicitar (marcar "Sí" en el formulario)

Solo se piden los necesarios para crear la cuenta. Mínimos imprescindibles en **negrita**:

| Atributo (formulario) | Clave técnica | Uso en SPHERE |
|---|---|---|
| **UVUS (uid)** | `uid` | Identificador único → base de `username` y `identities.providerId`. |
| **Nombre (givenName)** | `givenName` | `firstName`. |
| **Primer apellido (schacSn1)** | `schacSn1` | `lastName` (parte 1). |
| Segundo apellido (schacSn2) | `schacSn2` | `lastName` (parte 2, opcional). |
| **Correo US (mail)** | `mail` | `email` (institucional `@us.es` / `@alum.us.es`). |
| Tipo de usuario (eduPersonAffiliation) | `eduPersonAffiliation` | Distinguir alumno/PDI/PAS (futuro: roles). |
| Vinculación (ou) | `ou` | Metadato opcional de perfil. |

> El resto de atributos del formulario (centro, departamento, relación, unidad
> administrativa, schacUserStatus, schacPersonalUniqueId) **no son necesarios** para
> esta integración. Pedir solo lo que se usa (principio de minimización de datos / RGPD).

### 2.3 Resultado de la solicitud

La US, tras aprobar, devuelve:
- Para **CAS**: el alta del *service* (la URL de callback queda autorizada como
  `service`). Endpoints CAS de la US.
- Para **SAML**: `entityID` del IdP, URL de metadatos del IdP, y registran el
  `entityID`/ACS de SPHERE (Service Provider).

**Acción pendiente (bloqueante para producción):** enviar la solicitud cuanto antes,
porque el alta tarda. Mientras tanto se puede desarrollar contra un CAS/IdP de pruebas
o con *mocks* (ver §8).

---

## 3. Decisión de protocolo: CAS vs SAML

La US ofrece ambos. La plataforma de e-learning de la US (`ev.us.es`) usa SAML
(`/auth-saml/saml/login?apId=...`), pero para SPHERE se recomienda **CAS**:

| | **CAS (recomendado)** | SAML |
|---|---|---|
| Complejidad | Baja: 2 redirects + 1 validación HTTP (XML) | Alta: metadatos, firmado XML, certificados |
| Dependencias | Ninguna nueva (solo `fetch`) | `passport-saml` / `node-saml` + gestión de certs |
| Atributos | Suficientes vía `serviceValidate` (p3) | Más ricos, pero no necesarios aquí |
| Encaje con investigación previa | El `SSOController.ts` del compañero **ya es CAS** | Habría que reescribir |

**Decisión:** implementar **CAS**, con la capa de proveedor aislada (`UsCasProvider`
detrás de la interfaz `IdentityProvider`, §5.2) para poder añadir SAML u otros proveedores
después sin tocar controlador ni frontend.

Endpoints CAS de la US (**confirmados** en la doc oficial y en el alta de julio 2026):
- Base producción: `https://sso.us.es/CAS` · preproducción: `https://ssopre.us.es/CAS`
  (path `/CAS` en mayúsculas).
- Login: `GET {base}/login?service={callbackUrlEncoded}`
- Validación: `GET {base}/serviceValidate?ticket={ticket}&service={callbackUrlEncoded}`.
  La US (adAS) soporta **CAS 1.0/2.0**: no existe `/p3/serviceValidate` (CAS 3.0); los
  atributos llegan en la respuesta de `serviceValidate` (nombres a verificar, §11.10).
- Estado del alta y pasos de prueba: ver `sso-uvus-implementation.md` §5.3.

---

## 4. Arquitectura actual relevante (lo que ya existe)

Para que la integración respete las convenciones del repo:

- **Backend** (`api/src/main`): Express + inyección de dependencias con **Awilix**
  (`config/container.ts`). Patrón **Controller → Service → Repository (mongoose)**.
- **Rutas auto-cargadas**: `routes/index.ts` importa todos los `*Routes.ts` de la
  carpeta y ejecuta su `default(app)`. Basta crear un fichero nuevo para registrar rutas.
- **Auth**: `AuthenticationMiddleware` rellena `req.user` desde un **JWT** (`Bearer`)
  o una API key. Los tokens se emiten con `generateJwtToken({id, username, role})`
  (`utils/users/helpers.ts`), expiración `JWT_EXPIRATION` (24h).
- **Registro local** (`UserService.register`): crea el usuario y **siempre** una
  organización personal vía `organizationService.ensurePersonalOrganizationForUser(...)`;
  devuelve `{ registeredUser, token }`.
- **Caché**: `CacheService` (Redis) ya está en el contenedor → ideal para el
  *one-time code* del intercambio SSO.
- **Modelo `UserMongoose`** (campos relevantes): `username` (único, req.),
  `password` (`select:false`, **required**, hash en `pre('save')`), `role`
  (`'ADMIN'|'USER'`, default `'USER'`), `firstName` (req.), `lastName` (req.),
  `email` (único, req., con regex), `settings` (embebido: phone, avatar, profile…),
  `token`/`tokenExpiration` (legacy).
- **Frontend** (`frontend/src/modules/auth`): `authentication-page` muestra
  `LoginForm` o `RegisterForm` según `?view=register`. `useAuth().login(token)` hace
  `getCurrentUser` y guarda sesión en `localStorage` (`VITE_API_URL`).

### 4.1 ⚠️ Aviso sobre el `SSOController.ts` del compañero

El controller de investigación (`API-TaskForce/SPHERE`) **NO es compatible tal cual**
con el modelo actual de `Alex-GF/SPHERE`. Hay que adaptarlo:

| En el controller del compañero | Realidad en el modelo actual |
|---|---|
| `new UserMongoose({ ..., phone, userType, avatar, token })` | No existen `phone`/`userType`/`avatar` top-level; `phone` y `avatar` viven en `settings`. No hay `userType` (es `role`). |
| `organizationService.createPersonal(id, username)` | El método actual es `ensurePersonalOrganizationForUser({ id, username })`. |
| Devuelve `token` legacy aleatorio como sesión | La sesión actual usa **JWT** (`generateJwtToken`). El callback debe emitir JWT. |
| `password: crypto.randomBytes(...)` sin hashear, guardado directo | El `pre('save')` solo hashea si `isModified('password')`; hay que decidir cómo modelar cuentas sin contraseña (ver §6). |

La **lógica** (initiate → redirect CAS → callback valida ticket → one-time code en
caché → exchange) es correcta y se reutiliza; solo cambian las llamadas al dominio.

---

## 5. Diseño de la solución (flujo end-to-end)

```
┌─────────┐      1. click "Continuar con UVUS"      ┌──────────────────┐
│ Browser │ ───────────────────────────────────────►│ GET /users/auth/ │
│ (React) │                                          │  sso/us/initiate │
└─────────┘                                          └────────┬─────────┘
     ▲                                                        │ 302 redirect
     │                                                        ▼
     │                                          https://sso.us.es/cas/login
     │                                           ?service={callback}
     │                                                        │ usuario se loga (UVUS)
     │                                                        ▼
     │   4. 302 a {FRONTEND}/sso/callback?code=XXXX   ┌──────────────────────────┐
     │ ◄──────────────────────────────────────────────│ GET .../sso/us/callback  │
     │                                                 │ ?ticket=ST-...           │
     │                                                 │  - provider.handleCallback│
     │                                                 │  - findOrCreateUser()    │
     │                                                 │  - code=randomHex →      │
     │                                                 │    CacheService(TTL 30s) │
     │                                                 └──────────────────────────┘
     │ 5. SsoCallbackPage hace
     │    POST/GET /users/auth/sso/us/exchange?code=XXXX
     ▼                                                 ┌──────────────────────────┐
  guarda JWT en localStorage ◄───────── { token } ────│ exchange: code→userData, │
  useAuth.login(token) → router.push('/')             │ emite JWT, invalida code  │
                                                       └──────────────────────────┘
```

**Por qué el *one-time code* y no devolver el JWT en la URL del redirect:** evitar que
el token de sesión quede en el historial del navegador / logs de la US. El callback
guarda los datos en Redis con un código efímero (TTL ~30s, un solo uso) y el frontend
lo canjea por el JWT mediante una petición directa al backend.

### 5.1 Endpoints nuevos (backend)

Fichero nuevo `routes/SSORoutes.ts` (se auto-carga). Base actual: `{BASE_URL_PATH}/api/v1`.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/users/auth/sso/us/initiate` | pública | Redirige al login CAS de la US. (Un `?redirect=` opcional de retorno queda **fuera del alcance de esta fase**; si se añade, exige validar que sea ruta interna — §7.) |
| `GET` | `/users/auth/sso/us/callback` | pública | Recibe el `ticket` de CAS, valida, crea/recupera usuario, genera `code` y redirige al frontend. |
| `GET` | `/users/auth/sso/us/exchange?code=` | pública | Canjea el `code` por `{ token }` (JWT). Invalida el code. |

> Las rutas reales son **genéricas por proveedor**: `/users/auth/sso/:provider/{initiate,
> callback,exchange}`. La tabla muestra la instancia de UVUS (`us`); Google usará
> `google`. Ver `sso-uvus-implementation.md` §2.10.
>
> Se respeta el prefijo `/users` que ya aparece en las notas (`/users/auth`).
>
> ⚠️ **No basta con crear el fichero de rutas.** `authenticationMiddleware` y
> `authorizationMiddleware` son **globales** (`GlobalMiddlewaresLoader`) y el segundo
> **deniega por defecto** (`403`) cualquier path que no tenga una regla en
> `config/permissions.ts → ROUTE_PERMISSIONS`. Hay que añadir las 3 rutas SSO como
> `isPublic: true` **y colocarlas ANTES del catch-all `/users/**`** (igual que
> `/users/login` y `/users/register`), o quedarán capturadas por él y exigirán token.
> Ver §11.1.

### 5.2 Capas nuevas (backend) — diseño genérico por proveedor

Se separa lo **común a todos los proveedores** de lo **específico de cada uno**, para que
Google entre como una implementación más (ver §6 y `social-login-google-prep.md`). El
detalle de código está en `sso-uvus-implementation.md` §2:

- `controllers/SSOController.ts` — `initiate`, `callback`, `exchange`, **genérico por
  `:provider`**. Resuelve el proveedor del *registry* y delega en él; el one-time code y
  el intercambio son comunes.
- `services/identity/IdentityProvider.ts` — interfaz común + tipo `ProviderProfile`.
- `services/identity/UsCasProvider.ts` — implementación UVUS (CAS): `buildLoginUrl()` y
  `handleCallback(query)` (fetch a `/p3/serviceValidate` + parseo XML → `ProviderProfile`).
- `services/identity/providerRegistry.ts` — mapa `nombre → proveedor` (aquí se añade Google).
- `services/AuthProviderService.ts` — lógica común: `findOrCreateUser(profile)` (reutiliza
  `userRepository` + `ensurePersonalOrganizationForUser` + `generateJwtToken`). Registrado
  en `container.ts` como `authProviderService: asClass(AuthProviderService).singleton()`.

El **parseo del XML CAS** vive en `UsCasProvider`. El `match` con regex del controller del
compañero funciona, pero para una integración fiable conviene un parser XML
(`fast-xml-parser`) y usar `/p3/serviceValidate`, que devuelve los atributos dentro de
`<cas:attributes>`. Ver §11.10 sobre el riesgo de los nombres de atributo.

### 5.3 Frontend

- **Botón "Continuar con UVUS"** en `login-form/index.tsx` y `register-form/index.tsx`,
  bajo el formulario, separado por un divisor "o". Es un enlace/redirect a
  `${VITE_API_URL}/users/auth/sso/us/initiate` (navegación completa, no `fetch`, porque
  el flujo CAS necesita redirects de navegador).
- **Página de callback** `modules/auth/pages/sso-callback/index.tsx`, ruta
  `/sso/callback`, registrada en `frontend/src/routes/router.tsx` (no en `App.tsx`)
  como **ruta pública** (bloque público, fuera de `ProtectedRoute`, junto a
  `/authentication`). Lee `?code=` (o `?sso_error=`), llama a
  `exchangeSsoCode(code)` en `usersApi.ts`, y con el `token` resultante hace
  `useAuth().login(token)` + `router.push('/')`. Muestra un loader (reutilizar
  `BanterLoader`/`LoadingModal`) y errores con el mismo patrón de alerta rojo existente.
- **`usersApi.ts`**: añadir `export function exchangeSsoCode(code)` (GET a
  `/users/auth/sso/us/exchange?code=`).
- Manejo de `?sso_error=invalid_response|unknown_provider|server_error` (los que emite el
  `SSOController` genérico) → pintar el mensaje correspondiente.

#### Estilo del botón (coherente con DESIGN.md / Tailwind tokens del repo)

Reutiliza las clases ya presentes (`tp-input-border`, `tp-ink`, `h-11`, `rounded-lg`).
Botón **secundario** (borde, no relleno `tp-primary`, que se reserva para la acción
principal "Sign in"/"Create account"):

```tsx
{/* Divisor */}
<div className="my-5 flex items-center gap-3">
  <div className="h-px flex-1 bg-tp-input-border" />
  <span className="text-xs text-tp-muted">or</span>
  <div className="h-px flex-1 bg-tp-input-border" />
</div>

{/* Botón UVUS */}
<a
  href={`${import.meta.env.VITE_API_URL}/users/auth/sso/us/initiate`}
  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border
             border-tp-input-border bg-tp-input-bg text-sm font-medium text-tp-ink
             transition-colors duration-200 hover:border-tp-primary"
>
  {/* icono US / candado */}
  Continuar con UVUS
</a>
```

---

## 6. Cambios en el modelo de datos

El reto: el `password` es **`required`** en `UserMongoose`, pero una cuenta SSO no tiene
contraseña local. Además, **Google se hará después** (decisión confirmada), así que el
modelo se diseña **multi-proveedor desde ya** para no encadenar migraciones.

**Modelo elegido — array de identidades vinculadas (`identities[]`):**
```ts
const IdentitySchema = new Schema({
  provider: { type: String, enum: ['us-sso', 'google'], required: true },
  providerId: { type: String, required: true }, // uid (UVUS) | sub (Google)
  email: { type: String },
  linkedAt: { type: Date, default: Date.now },
}, { _id: false });

// userSchema:
identities: { type: [IdentitySchema], default: [] },
```
- `providerId` es la clave estable de vinculación (no depender de `username`, que el
  usuario podría cambiar).
- `password` pasa a obligatorio **solo** para cuentas sin identidad externa:
  `required: function () { return !this.identities?.length; }`.
- Índice único `(identities.provider, identities.providerId)` con `sparse`.
- Permite que una misma cuenta tenga **varias** identidades (p. ej. local + Google, o
  UVUS + Google) sin duplicar usuario.

> Por qué `identities[]` y no un simple `authProvider` + `ssoId`: con un solo campo, un
> usuario quedaría atado a un único proveedor y añadir Google exigiría otra migración.
> El array lo evita y habilita la vinculación de cuentas. Ver `social-login-google-prep.md`.
>
> **Password aleatorio (descartado):** generar `crypto.randomBytes(32)` como contraseña
> deja una "contraseña fantasma", no distingue cuentas SSO de locales y no es auditable.

### 6.1 Estrategia de `username` y colisiones

- `username` debe ser único. El UVUS es buen candidato, pero puede chocar con un
  username local existente. Algoritmo de `findOrCreateUser(profile)`:
  1. Buscar por identidad `(provider, providerId)` → si existe, es la misma cuenta:
     actualizar y entrar.
  2. Si no, y **solo si el proveedor verifica el email** (`emailVerified === true`),
     buscar por email y **vincular** añadiendo la identidad al usuario existente:
     - **UVUS: NO verifica el email** → nunca entra por aquí. SPHERE **no verifica el
       email** en el registro local (confirmado, §11.3); auto-vincular por email no
       verificado sería un vector de *account takeover*. Por eso el UVUS crea siempre
       cuenta nueva (paso 3), no fusiona.
     - **Google: SÍ verifica el email** (`email_verified`) → aquí sí es seguro vincular.
       Esta rama queda lista para la fase Google sin tocar la lógica.
  3. Si no existe nada → crear cuenta nueva con `username = providerId`; si ya está
     tomado por otra cuenta, sufijar (`uvus`, `uvus-us`, `uvus-2`…).
     ⚠️ **El sufijado debe resolverse ANTES de crear la organización personal**
     (§11.2): `ensurePersonalOrganizationForUser` lanza `CONFLICT` si ya hay una org
     personal con ese `name` (= username en minúsculas), y dejaría el usuario sin org
     personal (invariante rota).
- `firstName = givenName`, `lastName = trim(schacSn1 + ' ' + schacSn2)`,
  `email = mail` (o fallback `${uvus}@alum.us.es` si la US no entrega `mail`).
- Tras crear: `ensurePersonalOrganizationForUser({ id, username })` (igual que el
  registro local) para no romper la invariante "todo usuario tiene su org personal".
- Emitir sesión con `generateJwtToken({ id, username, role })`.

---

## 7. Seguridad y consideraciones

- **Validación server-side del ticket**: el `ticket` SOLO es válido si
  `serviceValidate` lo confirma; nunca confiar en parámetros del cliente.
- **One-time code**: TTL corto (≤30s) y de un solo uso (invalidar tras `exchange`).
  Ya hay `CacheService` (Redis) para esto.
- **`service` exacto**: la URL `service` de `login` y de `serviceValidate` debe ser
  **idéntica** (byte a byte tras `encodeURIComponent`), o CAS rechaza el ticket.
- **HTTPS en producción** obligatorio (la US lo exige para el alta).
- **CSRF/`state`**: para CAS el `ticket` es de un solo uso y validado; aun así conviene
  un parámetro `state` firmado si se admite `?redirect=` para evitar *open redirect*
  (validar que el `redirect` sea una ruta interna).
- **Datos personales (RGPD)**: pedir solo los atributos de §2.2; no almacenar atributos
  que no se usen. Documentar en la política de privacidad que se procesa identidad US.
- **Cierre de sesión (sin Single Logout)**: el logout de SPHERE solo borra el JWT local;
  la **sesión CAS de la US sigue viva** en el navegador, así que pulsar "Continuar con
  UVUS" de nuevo entra sin pedir credenciales. Es el comportamiento SSO estándar, pero en
  **ordenadores compartidos** (bibliotecas/laboratorios de la US) implica que otro usuario
  podría reentrar. Decisión de esta fase: **no** implementar CAS Single Logout; documentar
  al usuario que debe cerrar la sesión de la US (o el navegador) en equipos compartidos.
- **Gestión de identidades en ajustes — fuera del alcance de esta fase**: no habrá UI para
  vincular/desvincular identidades ni para que una cuenta SSO establezca contraseña local.
  Dos reglas quedan fijadas para cuando se haga: (1) una cuenta SSO **sin** contraseña no
  puede desvincular su única identidad (se quedaría sin acceso); (2) si un usuario SSO
  establece contraseña desde ajustes, pasa a ser también cuenta local (coherente con el
  `password` condicional del modelo).
- **(REQUISITO NUEVO) Guardia en `UserService.login` para cuentas sin contraseña**: con un
  usuario SSO sin `password`, `bcrypt.compare(password, undefined)` **lanza excepción**
  ("Illegal arguments") → respuesta 500. Hay que añadir antes del `compare`:
  `if (!user.password) throw new Error('INVALID DATA: Invalid credentials');`
  para que el login local de una cuenta SSO devuelva 401 limpio.
- **Variables de entorno** (no hardcodear): añadir a `.env` / `.env.*`:
  ```
  SSO_US_CAS_URL=https://sso.us.es/cas
  SSO_US_CALLBACK_URL=https://<api>/api/v1/users/auth/sso/us/callback
  FRONTEND_URL=https://<frontend>
  ```
  Y reutilizar `JWT_SECRET`, `JWT_EXPIRATION`, `BASE_URL_PATH`, `SERVER_PORT` ya existentes.

---

## 8. Suites de pruebas

Ubicación: `api/src/test` (ya hay `auth.test.ts`, `user.test.ts`,
`unit-tests/auth-middleware.test.ts` y helpers en `test/utils/auth/`). Reutilizar
`auth.testHelpers.ts` / `userTestUtils.ts`.

### 8.1 Backend — unitarias
`UsCasProvider.handleCallback` (`unit-tests/us-cas-provider.test.ts`), mockeando `fetch`:
  - XML `cas:authenticationSuccess` con atributos → `ProviderProfile` (`provider:'us-sso'`).
  - XML `cas:authenticationFailure` → `null`.
  - XML sin `cas:user` → `null`.
  - query sin `ticket` → `null`.
  - `mail` ausente → email fallback `${uvus}@alum.us.es` (el default vive en el proveedor).

`AuthProviderService.findOrCreateUser(profile)` (`unit-tests/auth-provider-service.test.ts`):
  - usuario nuevo → crea con `identities: [{ provider:'us-sso', providerId:uvus }]` y
    llama a `ensurePersonalOrganizationForUser`.
  - usuario existente por identidad `(provider, providerId)` → no duplica, emite JWT.
  - colisión de `username` → aplica sufijo (antes de crear la org personal).
  - `emailVerified === false` (UVUS) → NO vincula por email, crea cuenta nueva.
  - `emailVerified === true` con email ya existente → vincula (añade identidad, no duplica).

### 8.2 Backend — integración (`api/src/test/sso.test.ts`, supertest)
- `GET /users/auth/sso/us/initiate` → 302 a `sso.us.es/cas/login` con `service` correcto.
- `GET /users/auth/sso/us/callback` sin `ticket` → 302 a `{FRONTEND}/...sso_error=invalid_response`.
- `GET /users/auth/sso/desconocido/initiate` → 404 (proveedor no registrado).
- callback con `ticket` válido (mock de `serviceValidate`) → crea usuario + redirige con `code`.
- `GET /users/auth/sso/us/exchange?code=` válido → `{ token }` (JWT verificable con `JWT_SECRET`).
- `exchange` con code inexistente/expirado → 401.
- `exchange` reusando un code ya canjeado → 401 (un solo uso).
- el JWT emitido sirve para `GET /users/me` (integración con `AuthenticationMiddleware`).

### 8.3 Frontend
- `SsoCallbackPage`: con `?code=` llama a `exchangeSsoCode` y navega a `/`; con
  `?sso_error=` muestra el mensaje. (RTL + mock de `usersApi`).
- Botón "Continuar con UVUS" presente en login y registro y apunta a `/users/auth/sso/us/initiate`.

### 8.4 Manual / E2E (cuando la US dé de alta el service)
- Login real con UVUS de prueba → cuenta creada, org personal creada, sesión iniciada.
- Segundo login con el mismo UVUS → no duplica, entra a la cuenta existente.

---

## 9. Plan de implementación (orden de PRs / commits)

1. **Modelo**: `identities[]` + `password` condicional + índice único en `UserMongoose`.
   Sin migración obligatoria (usuarios existentes tienen password e `identities` vacío).
   Tests de modelo.
2. **Backend SSO (genérico por proveedor)**: `IdentityProvider` + `UsCasProvider` +
   `providerRegistry` + `AuthProviderService` + `SSOController` + `SSORoutes` + registro
   en `container.ts` + variables `.env`. Unitarias + integración con mocks.
3. **Frontend**: `exchangeSsoCode` en `usersApi`, `SsoCallbackPage`, ruta en
   `routes/router.tsx`, botón en `login-form` y `register-form`. Tests RTL.
4. **Docs**: actualizar `README`/`DESIGN` y este documento; añadir variables al
   `.env.example`.
5. **Solicitud US**: (en paralelo desde el día 1) enviar `SolicitudSSO.pdf` con los
   datos de §2 y esperar alta del *service* para E2E real.

### Workflow git (según notas del proyecto)
- Crear rama desde `develop` (o `main`): `feature/sso-uvus`.
- Abrir **Pull Request hacia `develop`** en `Alex-GF/SPHERE`.
- Si aparecen *fixes* en la misma PR, atenderlos ahí y seguir el flujo.

---

## 10. Riesgos / preguntas abiertas

- **Alta de la US es el bloqueante real** para probar end-to-end; iniciar ya el trámite.
- **CAS vs SAML**: confirmar con la US que CAS está disponible para apps externas a
  `ev.us.es`; si solo ofrecen SAML para terceros, añadir un `UsSamlProvider implements
  IdentityProvider` (la interfaz, el controlador y todo el frontend no cambian).
- **Política de vinculación de cuentas**: para UVUS **NO se auto-vincula** por email
  (SPHERE no verifica el email; §6.1/§11.3): si el email institucional ya existe como
  cuenta local, se crea cuenta separada. La auto-vinculación por email queda reservada a
  proveedores que verifican el email (Google), no a UVUS.
- **`role` por defecto** para usuarios US: `'USER'` (no conceder `ADMIN` automáticamente).
- **Endpoints CAS exactos** (`/serviceValidate` vs `/p3/serviceValidate`, dominio
  `sso.us.es`): confirmar en la documentación que entreguen en el alta.

---

## 11. Hallazgos de la segunda revisión (problemas que se habían escapado)

Tras leer en detalle middlewares, permisos, servicios y router, estos son los puntos
que **no estaban bien valorados** en la primera versión y que son bloqueantes o de riesgo:

### 11.1 (BLOQUEANTE) Las rutas no funcionan solo con crear el `*Routes.ts`
`authenticationMiddleware` + `authorizationMiddleware` son **globales** y el de
autorización **deniega por defecto** (`403`) todo path sin regla en `ROUTE_PERMISSIONS`
(`config/permissions.ts`). Además **las reglas se evalúan en orden, primera que casa
gana**, y existe un catch-all `/users/**` (con `allowedUserRoles`) que **capturaría**
`/users/auth/sso/...` exigiendo token. → Hay que **añadir una regla `isPublic: true`**
(`/users/auth/sso/**`, GET) **por encima** de la regla `/users/**`. Mi afirmación original
de que "las rutas SSO van sin AuthenticationMiddleware" era **incorrecta**: el middleware
es global; lo que las hace públicas es la flag `isPublic` en el registro de permisos.

### 11.2 (BLOQUEANTE) `ensurePersonalOrganizationForUser` lanza CONFLICT por colisión de nombre
Crea la org personal con `name = username.toLowerCase()` y **lanza `CONFLICT`** si ya
existe una org personal con ese nombre. El `SSOController` del compañero envuelve esa
llamada en un `catch {}` vacío → si el UVUS colisiona, el usuario quedaría **sin org
personal** (invariante del sistema rota), sin error visible. → El **sufijado de
`username` debe hacerse antes** y la creación de la org **no** debe silenciarse: si
falla, hacer rollback del usuario (como hace `register`, que asume la org se crea sí o sí).

### 11.3 (SEGURIDAD) No existe verificación de email en SPHERE
Confirmado: no hay ningún flujo de verificación/confirmación de email. Por tanto
**auto-vincular cuentas SSO con cuentas locales por email es un vector de account
takeover**. Se cambia el default a **no fusionar automáticamente** (§6.1).

### 11.4 `CacheService`: sin `del`, y `set` tiene guardia de conflicto
`CacheService` solo expone `get` y `set` (no hay `delete`). Además `set` **lanza
`CONFLICT`** si la clave ya existe con un valor distinto. Implicaciones para el
*one-time code*:
- Para **invalidar** el code tras `exchange` no se puede borrar: o se re-hace
  `set(key, mismoValor, 1)` (TTL 1s; funciona porque el valor es idéntico y no dispara
  el conflicto, truco del compañero) **o** se añade un método `del()` al servicio
  (más limpio; requiere tocar `CacheService`).
- Las claves de code son aleatorias (`crypto.randomBytes`), así que el conflicto por
  colisión es despreciable.
- TTL por defecto de `set` es **300s**; pasar explícitamente el TTL corto (≤30s).

### 11.5 `VITE_API_URL` es **relativo** (`/api/v1`)
El frontend usa `VITE_API_URL=/api/v1` (proxy de Vite/nginx). Consecuencias:
- El botón "Continuar con UVUS" como `href` relativo (`/api/v1/users/auth/sso/us/initiate`)
  **funciona** para la redirección de navegador (resuelve contra el origin actual).
- Pero el **backend** necesita URLs **absolutas** para: `SSO_US_CALLBACK_URL` (la que se
  registra como `service` en la US y debe ser idéntica en `login` y `serviceValidate`)
  y `FRONTEND_URL` (destino del redirect tras el callback). Detrás de **nginx** hay que
  componer la URL pública real (dominio + `BASE_URL_PATH`), no `localhost`.

### 11.6 El modelo no tiene los campos que usa el controller del compañero (recordatorio)
Ya señalado en §4.1, pero confirmado contra el modelo real: `UserMongoose` **no** tiene
`phone`/`avatar`/`userType` top-level (van en `settings`/`role`). `userRepository.create`
hace `new UserMongoose(data).save()`, que dispara `pre('save')` (hash de password solo
si está presente y modificado, y genera token legacy). Encaja con hacer `password`
condicional según `identities` (obligatorio solo si el usuario no tiene identidad externa).

### 11.7 Variables de entorno: nombres reales del repo
Backend (`api/.env*`): ya existen `JWT_SECRET`, `JWT_EXPIRATION`, `BASE_URL_PATH`,
`SERVER_PORT`, `SERVER_HOST`, `REDIS_URL`. **Añadir nuevas**: `SSO_US_CAS_URL`,
`SSO_US_CALLBACK_URL`, `FRONTEND_URL`. Frontend (`frontend/.env*`): `VITE_API_URL` ya
existe; no hace falta nueva var si el botón usa `VITE_API_URL`.

### 11.8 (menor) Regex de email del modelo y emails US
El `match` del schema es `/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/`. Acepta
`usuario@alum.us.es` y `usuario@us.es`, pero conviene **probarlo explícitamente** con
correos reales de la US en los tests (dominios multinivel y posibles guiones).

### 11.9 El runner es Vitest y los tests arrancan el servidor real (Redis + Mongo)
`api/src/test/utils/testApp.ts` llama a `initializeServer()`, que inicializa Mongo y
Redis de verdad y siembra la BBDD. Implicaciones:
- Los tests de integración del SSO (callback/exchange) usan **Redis real**: hay que tener
  levantado el entorno (`docker/dev`, `pnpm run dev:setup`) antes de `pnpm test`.
- Ficheros `*.test.ts`, API de `vitest` (`describe/it/expect`, `beforeAll/afterAll`),
  y `supertest` para HTTP. Hay utilidades reutilizables en `test/utils/`.
- Las unitarias de `UsCasProvider.handleCallback` deben **mockear `fetch`**
  (`vi.stubGlobal`/`vi.fn`) para no llamar a la US.

### 11.10 (IMPORTANTE para que funcione a la primera) Los nombres de atributo CAS de la US no están confirmados
El controller del compañero asume `<cas:givenName>`, `<cas:sn>`, `<cas:mail>`. **El CAS
real de la US puede devolver otros nombres** (p. ej. `<cas:schacSn1>`, `<cas:uid>`, o los
atributos dentro de `<cas:attributes>` solo si se usa `/p3/serviceValidate`). Si los
nombres no coinciden, el usuario se crea con datos vacíos/fallback aunque el login
"funcione". Acciones concretas:
- Usar `/p3/serviceValidate`.
- En la primera integración real, **loguear el XML crudo** de la respuesta de validación
  para ver los nombres exactos y ajustar el parseo.
- No dar por buenos los nombres del controller de investigación sin verificarlos.

### 11.11 El test paramétrico de endpoints públicos NO se rompe (verificado)
`auth.test.ts` recorre `getPublicEndpoints()` y construye la ruta con un `switch`; el
caso por defecto genera `${BASE_PATH}{patrón con ** → 'sample'}`. Para la regla
`/users/auth/sso/**` probará `GET /users/auth/sso/sample`, que no casa ninguna de las 3
rutas (`:provider/{initiate,callback,exchange}`) → Express 404 (no es 401/403) → **pasa
sin tocar el test**. Por eso conviene **una sola regla** `/users/auth/sso/**` (GET,
`isPublic`): cubre initiate/callback/exchange de **todos** los proveedores y no obliga a
editar `auth.test.ts`.

### 11.12 Imports sin extensión (ESM) y orden de carga de rutas
- El proyecto es ESM (`"type": "module"`) pero compila con `tsc` + `tsc-alias` y corre con
  `tsx`. Los imports del repo van **sin extensión** (`'../config/container'`). El
  controller del compañero usa `'../config/container.js'`; copiarlo tal cual **no
  compila** con la config actual. Hay que escribir los imports al estilo del repo.
- `routes/index.ts` carga los `*Routes.ts` con `fs.readdirSync` (orden alfabético) y
  Express resuelve por orden de registro. `SSORoutes.ts` se carga antes que
  `UserRoutes.ts`, pero además no hay colisión: `/users/:username` solo casa un segmento
  (`/users/auth`), no `/users/auth/sso/:provider/...`. No requiere cambios, pero conviene
  mantener el prefijo profundo `/users/auth/sso/:provider/...`.

### 11.13 Migraciones: formato `ts-migrate-mongoose` (no obligatoria con `identities[]`)
Con el modelo `identities[]` **no hace falta migración**: los usuarios existentes tienen
`password` y `identities` ausente/vacío, coherente con el `password` condicional
(`required` solo si no hay identidades) y con el índice `sparse` (ignora documentos sin el
campo). Las búsquedas por `identities.providerId` simplemente no los devuelven, que es lo
correcto. *(Opcional, por limpieza: una migración que ponga `identities: []`.)* Formato:
las migraciones (`api/src/main/migrations/mongo/`, config `api/migrate.ts`) exportan
`up(connection)`/`down(connection)` y corren con `npx migrate up`.

### 11.14 (hardening) Quitar el `code` de la URL tras el intercambio
La página `/sso/callback?code=...` queda en el historial del navegador. Tras canjear el
code (un solo uso, TTL corto), limpiar la query con `history.replaceState` antes de
navegar a `/`.
