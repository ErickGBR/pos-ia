# POS Basic IA

**Autor y responsable del proyecto:** Erick Burgos

Sistema de punto de venta (POS) de escritorio con tres piezas: un **catálogo de productos** (alta, edición, búsqueda y baja), una **terminal de ventas** (carrito con precio editable por línea) y un **historial de ventas** con ticket. API REST en Node.js + Express, SPA en Vue 2 + Vuetify y MySQL 8 corriendo en Docker.

> **Aviso:** este repositorio es una **prueba técnica** (Prueba Técnica Lead AI-Native). No es un producto en producción: no hay despliegue, ni usuarios, ni autenticación activa. Ver la sección [Créditos, licencia y aviso](#créditos-licencia-y-aviso).

---

## Índice

1. [Qué es el proyecto y qué hace](#1-qué-es-el-proyecto-y-qué-hace)
2. [Arquitectura por capas](#2-arquitectura-por-capas)
3. [Stack y versiones exactas](#3-stack-y-versiones-exactas)
4. [Requisitos previos](#4-requisitos-previos)
5. [Instalación paso a paso](#5-instalación-paso-a-paso)
6. [Configuración (.env)](#6-configuración-env)
7. [Base de datos](#7-base-de-datos)
8. [Ejecución](#8-ejecución)
9. [Endpoints](#9-endpoints)
10. [Cómo verificar que todo funciona](#10-cómo-verificar-que-todo-funciona)
11. [Estructura del monorepo](#11-estructura-del-monorepo)
12. [Notas y troubleshooting](#12-notas-y-troubleshooting)
13. [Cómo se construyó este proyecto](#13-cómo-se-construyó-este-proyecto)
    - [13.1 Tecnologías de IA](#131-tecnologías-de-ia)
    - [13.2 Roles que participaron](#132-roles-que-participaron)
    - [13.3 Prácticas y proceso](#133-prácticas-y-proceso)
    - [13.4 Tiempo aproximado utilizado](#134-tiempo-aproximado-utilizado)
    - [13.5 Tareas delegadas y revisión del candidato](#135-tareas-delegadas-y-revisión-del-candidato)
    - [13.6 Consideraciones para evaluar o ejecutar](#136-consideraciones-para-evaluar-o-ejecutar)
- [Créditos, licencia y aviso](#créditos-licencia-y-aviso)

---

## 1. Qué es el proyecto y qué hace

POS Basic IA es un punto de venta "basic" que cubre tres flujos:

| Flujo | Qué puede hacer el usuario |
| --- | --- |
| **Catálogo de productos** | Listar, buscar por nombre (parcial) o código de barras (exacto), crear, editar nombre/precio y eliminar productos **que nunca se vendieron**. |
| **Terminal de ventas** | Armar un carrito, editar el precio de cada línea, ver una previsualización del total y registrar la venta. |
| **Historial de ventas** | Ver las ventas paginadas (más reciente primero) y el ticket de una venta con sus líneas. |

Alcance deliberado (`docs/ARQUITECTURA.md` §0, ambigüedad 1, y decisión D4): **no existe inventario ni stock** (la columna no está en el schema, el requerimiento la excluyó), no hay categorías, ni descuentos, ni usuarios, ni roles. Un producto **no se da de baja lógica**: se borra físicamente, y solo si no tiene historial de ventas.

El monorepo tiene dos aplicaciones independientes (`backend/` y `frontend/`) más `scripts/` (SQL) y `docs/` (arquitectura), sin un orquestador de build compartido: cada app tiene su `package.json` y sus dependencias.

---

## 2. Arquitectura por capas

El backend es una arquitectura en capas con inyección de dependencias por constructor y **un único composition root** (`backend/src/container.js`). Las flechas de dependencia solo apuntan hacia adentro:

```
routes ──> controllers ──> services ──> repositories ──> models (Sequelize) ──> MySQL 8
   │            │              │              │
   │            │              │              └── Única capa que habla con la BD / importa Sequelize
   │            │              └── Única capa con lógica de negocio (y con el CALL al SP)
   │            └── Única capa que toca req/res; traduce el resultado a status HTTP
   └── Solo mapea verbo + ruta → middlewares de forma → controller. Cero lógica.
```

**Validación en dos niveles:** `middlewares/validate.js` revisa solo la *forma* (campos presentes y tipos) y deja el resultado en `req.bodyValidado` / `req.queryValidado` / `req.paramsValidado`; las *reglas de negocio* (precio > 0, cantidad > 0, unicidad del código de barras, producto con ventas) viven en `services/`. Los errores de dominio (`NotFoundError`, `ValidationError`, `ConflictError`) los traduce `middlewares/errorHandler.js` a 404 / 400 / 409 — ningún controller elige un `status` a mano.

### Flujo real de una petición (el caso más importante: registrar una venta)

```
Frontend (src/api/ventas.api.js, axios)
   │  POST http://localhost:3000/api/ventas
   │  body: { "items": [ { "productoId": 14, "cantidad": 3, "precioUnitario": 2.5 } ] }
   ▼
app.js  ── express.json() ──> cors({ origin: config.cors.origin }) ──> router /api
   ▼
routes/venta.routes.js
   │  validarBody(esquemaRegistrarVenta)   ← solo FORMA (items es arreglo, tipos)
   ▼
controllers/venta.controller.js
   │  extrae { items, tipo } de req.bodyValidado y llama UN caso de uso
   ▼
services/venta.service.js
   │  reglas de negocio: carrito no vacío, cantidad entera > 0,
   │  precioUnitario >= 0 (puede ser 0), tipo soportado
   ▼
services/venta-strategies.js  (Strategy por tipo de movimiento; hoy solo 'normal')
   │  traduce camelCase → snake_case: { producto_id, cantidad, precio_unitario }
   ▼
repositories/sequelize-venta-write.repository.js   ← ÚNICO archivo con el CALL
   │  SET  @pos_venta_id = NULL
   │  CALL sp_registrar_venta(:detalle_json, @pos_venta_id)
   │  SELECT @pos_venta_id AS id            (las 3 consultas en UNA conexión)
   ▼
MySQL 8 — sp_registrar_venta (autoridad final)
   │  valida línea por línea (producto existe, cantidad > 0, precio >= 0),
   │  subtotal = ROUND(cantidad * precio_unitario, 2),
   │  total = ROUND(SUM(subtotales), 2)
   │  INSERT ventas + INSERT venta_detalle  dentro de UNA transacción  (COMMIT / ROLLBACK)
   ▼
services relee la venta por el read repo  ──>  201 { id, total, createdAt, items }
```

Si algo falla, el camino de errores es: `service` lanza el error de dominio → `errorHandler` → `{ "error": { "code", "message", "detalles" } }` con 400 / 404 / 409 (o 500 si es un fallo técnico real).

### Regla D2: el Stored Procedure es el ÚNICO camino de escritura de ventas

- La aplicación **nunca** escribe `ventas` ni `venta_detalle` con el ORM. Los modelos `Venta` y `VentaDetalle` existen **solo para lectura** (listados y tickets).
- `backend/src/repositories/sequelize-venta-write.repository.js` es el único archivo del proyecto con `CALL sp_registrar_venta`, y su contrato tiene un solo método: `registrarConSP`.
- El SP abre y cierra su **propia** transacción: por eso la capa de datos **no** envuelve el `CALL` en una transacción de Sequelize (un COMMIT implícito del SP desincronizaría al motor).
- El total que responde la API es el que calculó el SP, no una suma hecha en Node: el servicio relee la venta persistida y devuelve eso.

> **Detalle completo (capas, SOLID, contratos UC-1..UC-4, decisiones D1-D6, Reglas de Oro): [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).** Ese documento es el blueprint vinculante; este README es la guía de puesta en marcha.

---

## 3. Stack y versiones exactas

Versiones pedidas por los `package.json` (rango) y **versión realmente instalada** en este entorno (leída de los `node_modules` con `require('<paquete>/package.json').version`):

| Capa | Tecnología | Rango en `package.json` | Instalada (verificada) | Por qué |
| --- | --- | --- | --- | --- |
| Runtime | Node.js | `>=18` (raíz y `frontend/`) | **v24.19.0** | LTS moderno; sin él no hay npm ni `node src/server.js`. |
| Package manager | npm | `>=9` (raíz) | **11.17.0** | Viene con Node; `npm ci` necesita lockfile. |
| HTTP | Express | `^4.19.2` | 4.22.3 | Framework mínimo y estable: routers, middlewares y manejo de errores sin sobreestructura. |
| ORM | Sequelize | `^6.37.3` | 6.37.8 | Da modelos, asociaciones y **`sequelize-cli` para migraciones** (la fuente autoritativa del schema). |
| Driver MySQL | mysql2 | `^3.10.0` | 3.24.5 | Driver que usa Sequelize y que soporta consultas crudas (`CALL`, variables de sesión). |
| CORS | cors | `^2.8.5` | 2.8.6 | El frontend corre en otro origen/puerto en desarrollo; se configura con lista de orígenes (nunca `'*'` en producción). |
| Config | dotenv | `^16.4.5` | 16.6.1 | Lee el `.env` de la raíz por ruta explícita (el cwd de Node es `backend/`). |
| Dev backend | nodemon | `^3.1.0` | 3.1.14 | Recarga automática en `npm run dev`. |
| Migraciones | sequelize-cli | `^6.6.2` | 6.6.5 | Ejecuta `npm run migrate` contra `backend/src/migrations/`. |
| UI | Vue | `^2.7.16` | 2.7.16 | Versión fijada por la prueba (D5): sin migración a Vue 3. |
| Componentes | Vuetify | `^2.7.2` | 2.7.2 | UI kit exigido; aporta tabs, tablas, diálogos y formulario. Todo en una sola vista (sin router ni store global). |
| HTTP client | axios | `^1.7.9` | 1.20.0 | Único punto de salida al backend, encapsulado en `frontend/src/api/`. |
| Polyfills | core-js | `^3.37.1` | 3.50.0 | Requiere `@vue/cli-service` 5 para navegadores soportados. |
| Build | @vue/cli-service | `~5.0.8` | 5.0.9 | Webpack 5: evita el clásico error `ERR_OSSL_EVP_UNSUPPORTED` de Vue CLI 4 con Node 17+. |
| Compilador SFC | vue-template-compiler | `^2.7.16` | 2.7.16 | Debe coincidir en versión exacta con `vue`. |
| Base de datos | MySQL (imagen `mysql:8.0`) | imagen fija | servidor **8.0.46** | MySQL 8 es requisito del SP: `JSON_TABLE` y el manejo de `SIGNAL SQLSTATE '45000'` no existen en 5.7. |
| Infraestructura | Docker Compose (plugin `docker compose`) | v2 o superior | **v5.5.1** (este equipo) | El `docker-compose.yml` usa sintaxis v2 (`docker compose ...`), no el binario legado `docker-compose`. |

Dependencias permitidas (lista blanca D5): backend `express, sequelize, mysql2, cors, dotenv` (+ dev `nodemon, sequelize-cli`); frontend `vue@2, vuetify@2, axios` (+ toolchain de build). **Sin** vue-router, vuex/pinia, TypeScript, NestJS/TypeORM/Mongoose ni framework de DI externo.

---

## 4. Requisitos previos

| Requisito | Versión mínima que funciona | Cómo comprobarlo |
| --- | --- | --- |
| Docker Engine | cualquier versión con soporte de `docker compose` | `docker --version` |
| Plugin Docker Compose | **v2 o superior** (sintaxis `docker compose`) | `docker compose version` → en este equipo: `v5.5.1` |
| Node.js | **>= 18** (`engines` de la raíz y de `frontend/`) | `node -v` → verificado con `v24.19.0` |
| npm | **>= 9** (`engines` de la raíz) | `npm -v` → verificado con `11.17.0` |
| git | cualquiera | `git --version` |
| curl (opcional) | cualquiera | para los chequeos de la sección 10 |

**No hace falta instalar MySQL**: la base corre en el contenedor `mysql:8.0` de `docker-compose.yml`. Tampoco hace falta instalar dependencias en la **raíz** del monorepo: su `package.json` no tiene `dependencies` ni `devDependencies`, solo los scripts `db:*` de Docker.

---

## 5. Instalación paso a paso

Desde una máquina limpia, en orden (cada paso fue verificado en este entorno, salvo donde se indica):

```bash
# 1. Clonar y entrar a la rama que te interese
#    (hay ramas main, feature/products y feature/sales; feature/sales es la
#     que trae productos + ventas + Stored Procedure)
git clone https://github.com/ErickGBR/pos-basic-ia.git
cd pos-basic-ia
git checkout feature/sales

# 2. Variables de entorno: SIEMPRE se copia la plantilla y se edita la copia
cp .env.example .env
#    -> abrí .env y cambiá al menos DB_PASSWORD y DB_ROOT_PASSWORD

# 3. Dependencias de cada app (la raíz no tiene dependencias que instalar)
cd backend  && npm ci && cd ..
cd frontend && npm ci && cd ..

# 4. Levantar MySQL 8 (requiere que .env exista: docker compose lo lee de la raíz)
npm run db:up

# 5. Migraciones (crea productos, ventas y venta_detalle)
cd backend && npm run migrate && cd ..

# 6. Instalar el Stored Procedure — SIN ESTE PASO LAS VENTAS NO FUNCIONAN
docker exec -i pos-basic-ia-db mysql -upos_user -p"$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)" \
  pos_basic_ia < scripts/sp_registrar_venta.sql
```

Alternativas a `npm ci`: `npm install` si querés actualizar dentro del rango del `package.json` (crea/modifica el lockfile).

> **Cómo se verificó esta sección:** `npm ci --dry-run` corrió limpio en `backend/` y `frontend/`, o sea que los lockfiles son consistentes con los `package.json`. `npm run db:up`, `npm run migrate` y la instalación del SP se ejecutaron de verdad. El `npm ci` completo se deja para el evaluador: borra `node_modules`, así que conviene hacerlo con el backend detenido.

---

## 6. Configuración (.env)

**La plantilla es `.env.example` (versionada). El archivo real es `.env` y NUNCA se commitea:** está en `.gitignore` y contiene credenciales. El flujo correcto es siempre:

```bash
cp .env.example .env   # y editar .env
```

El backend lee el `.env` **de la raíz del monorepo** por ruta explícita (`config/database.js` y `config/app.js`), porque el proceso arranca con `cwd = backend/` y un `dotenv.config()` a secas buscaría `backend/.env` y fallaría en silencio. **docker-compose.yml también lo lee desde la raíz**: sin `.env`, `npm run db:up` corta con `falta DB_NAME en .env`.

### Variables del `.env`

| Variable | Ejemplo | Quién la lee | Qué hace |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `config/app.js` | Entorno activo. En `production` **exige** `CORS_ORIGIN` fijo (ver §12) y sin fallbacks la base. |
| `BACKEND_PORT` | `3000` | `config/app.js` | Puerto del API (nombre canónico). |
| `PORT` | `3000` | `config/app.js` | Alias de compatibilidad: se usa si `BACKEND_PORT` no está. |
| `CORS_ORIGIN` | `http://localhost:8080,http://localhost:5173` | `config/app.js` | Orígenes permitidos, **separados por coma**. Se parte por coma y se entrega como array al paquete `cors`. |
| `DB_HOST` | `127.0.0.1` | `config/database.js` | Host MySQL visto desde el backend (en el host, no en la red de Docker). |
| `DB_PORT` | `3307` | `config/database.js`, `docker-compose.yml` | Puerto del **host** mapeado al 3306 del contenedor. |
| `DB_NAME` | `pos_basic_ia` | compose + backend | Base creada en el primer arranque del contenedor. |
| `DB_USER` | `pos_user` | compose + backend | Usuario de aplicación (MySQL no permite que la app use `root`). |
| `DB_PASSWORD` | *cambiar* | compose + backend | Contraseña del usuario de aplicación. |
| `DB_ROOT_PASSWORD` | *cambiar* | `docker-compose.yml` | Contraseña de root **dentro del contenedor**. El compose **falla a propósito** si no está definida. |
| `VUE_APP_API_BASE_URL` | `http://localhost:3000/api` | build de Vue (`frontend/`) | Base URL de axios. |
| `VUE_APP_DEV_SERVER_PORT` | `8080` | `frontend/vue.config.js` | Puerto del dev server de Vue. |
| `VUE_APP_TITLE` | `"POS Basic IA"` | build de Vue | Título. **Va entre comillas** (contiene espacios): sin comillas rompe cualquier `source .env`. |
| `JWT_SECRET` | *cambiar* | — | Declarado y sin uso en esta fase (no hay auth). |

Variables **adicionales que el código lee pero que no están en `.env.example`** (opcionales, con fallback): `DB_TIMEZONE` (default `-03:00`) y `DB_POOL_MAX` (default `10`), ambas en `backend/src/config/database.js`.

### Qué NO se commitea

- ❌ `.env`, `.env.local`, `.env.*.local`, `frontend/.env` → todos en `.gitignore`.
- ❌ Cualquier secreto real (la plantilla solo admite valores de ejemplo).
- ✅ `.env.example` **sí** se versiona: es la lista de variables que existen.

> `frontend/.env` es opcional: `src/api/http.js` y `vue.config.js` traen los mismos defaults en código, así que el build y el dev server funcionan sin él.

---

## 7. Base de datos

### Levantar el contenedor

```bash
npm run db:up        # = docker compose up -d db   (verificado: "Container pos-basic-ia-db Running")
npm run db:logs      # = docker compose logs -f db
npm run db:down      # = docker compose down  (los datos persisten en el volumen pos_basic_ia_db_data)
```

El servicio es `db`, imagen `mysql:8.0`, contenedor `pos-basic-ia-db`, red `pos_basic_ia_net`, volumen `pos_basic_ia_db_data` y arranca con `utf8mb4` / `utf8mb4_unicode_ci`.

### Por qué el puerto del host es 3307 y no 3306

En la máquina de desarrollo **el 3306 ya lo ocupa un MariaDB del sistema**, así que el compose publica `127.0.0.1:3307 → 3306`:

```yaml
ports:
  - "127.0.0.1:${DB_PORT:-3307}:3306"   # bind a 127.0.0.1: MySQL no se expone a la red local
```

- **3307** es el puerto del **host** (el que usan el backend y `sequelize-cli`).
- **3306** es el puerto **interno** del contenedor: no se toca.
- El bind es `127.0.0.1` a propósito: la base no queda expuesta en la LAN.

### Comprobar que quedó sana

```bash
docker inspect --format '{{.State.Health.Status}}' pos-basic-ia-db   # healthy   (verificado)
docker compose ps                                                    # Up (healthy)
```

El healthcheck no mira que el proceso exista: ejecuta `mysqladmin ping` **con credenciales reales**, cada 10 s, con 12 reintentos y 40 s de margen de arranque (el primer arranque de MySQL es lento).

### Migraciones de Sequelize

```bash
cd backend
npm run migrate          # aplica pendientes
npm run migrate:undo     # revierte la última
npm run migrate:undo:all # revierte todo
```

Rutas según `backend/.sequelizerc`: config `src/config/database.js`, migraciones `backend/src/migrations/`, modelos `src/models/`, seeders `src/seeders/`.

Estado verificado en este entorno:

```
Loaded configuration file "src/config/database.js".
Using environment "development".
No migrations were executed, database schema was already up to date.
```

Las migraciones son la **fuente autoritativa** del schema. `scripts/schema.sql` es el espejo reproducible (tablas `productos`, `ventas`, `venta_detalle` con sus FK e índices) y existe por si hay que reconstruir a mano:

```bash
# ⚠️ DESTRUCTIVO: dropea y recrea las tres tablas. No correr contra datos que quieras conservar.
# (comando destructivo: usalo solo sobre una base de datos descartable)
docker exec -i pos-basic-ia-db mysql -upos_user -p"$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)" \
  pos_basic_ia < scripts/schema.sql
```

### Instalar el Stored Procedure (obligatorio)

```bash
docker exec -i pos-basic-ia-db mysql -upos_user -p"$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)" \
  pos_basic_ia < scripts/sp_registrar_venta.sql
```

- Verificado: exit 0; el script empieza con `DROP PROCEDURE IF EXISTS`, así que **es idempotente** (se puede re-correr para actualizar el SP).
- Comprobación:

```bash
docker exec pos-basic-ia-db mysql -upos_user -p"$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)" -N \
  -e "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.routines WHERE routine_schema='pos_basic_ia';"
# sp_registrar_venta    PROCEDURE
```

> **Sin este paso las ventas no funcionan.** El único camino de escritura de ventas del sistema es `CALL sp_registrar_venta(...)` (decisión D2): no hay INSERT de respaldo en la aplicación, ni un fallback con el ORM. Si el procedimiento no existe, el `POST /api/ventas` no puede registrar nada. *(Consecuencia derivada del código; el caso "SP ausente" no se provocó a propósito para no dejar la base rota.)*

### Datos de ejemplo (seeder)

```bash
cd backend
npm run seed        # inserta el catálogo de ejemplo si falta
npm run seed:undo   # lo retira (respeta los productos que ya tienen ventas)
```

Verificado en este entorno: `npm run seed` termina con `[seed] catalogo de ejemplo ya completo: 25 productos, nada que insertar.` — es decir, carga **25 productos** con `codigo_barras` con prefijo `SEED-`, definidos en `backend/src/seeders/20251001000000-catalogo-productos.js`. Es **idempotente**: sólo inserta los códigos que faltan, así que se puede correr las veces que haga falta.

Sólo siembra **productos**, nunca ventas: un seeder que inserte ventas crearía un segundo camino de escritura al margen del Stored Procedure (D2). Las ventas de ejemplo se generan vendiendo de verdad (`POST /api/ventas`).

---

## 8. Ejecución

Backend y frontend se levantan **por separado**, en dos terminales:

**Terminal 1 — API (puerto 3000)**

```bash
cd backend
npm run dev     # nodemon, recarga automática
# o
npm start       # node src/server.js
```

Verificado: el servidor imprime `[api] POS Basico IA escuchando en http://localhost:3000/api` y **se niega a aceptar tráfico si la base no responde** (`server.js` hace `sequelize.authenticate()` antes de `listen()` y sale con `exit(1)` si falla).

**Terminal 2 — Frontend (puerto 8080)**

```bash
cd frontend
npm run serve   # vue-cli-service serve
```

| Servicio | Puerto | URL | Configurado por |
| --- | --- | --- | --- |
| API Express | **3000** | `http://localhost:3000/api` | `BACKEND_PORT` / `PORT` en `.env` |
| Dev server Vue | **8080** | `http://localhost:8080` | `VUE_APP_DEV_SERVER_PORT` |
| MySQL (host) | **3307** | `127.0.0.1:3307` | `DB_PORT` |

`CORS_ORIGIN` del `.env` debe incluir el origen del frontend (`http://localhost:8080`, y `http://localhost:5173` si usá otro dev server): el `cors` del backend **no** tiene fallback a `'*'`.

Build de producción (no server de desarrollo):

```bash
cd frontend && npm run build   # genera frontend/dist/  (verificado: "DONE  Build complete.")
```

---

## 9. Endpoints

Todas las rutas cuelgan de `/api`. Errores: `{ "error": { "code", "message", "detalles?" } }` con `code` ∈ `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_ERROR` (500).

| Método | Ruta | Query / Body | Respuesta |
| --- | --- | --- | --- |
| `GET` | `/api/health` | — | `200` `{"status":"ok"}` (no toca la base) |
| `GET` | `/api/productos` | `?q=&page=&limit=` (`q` opcional; `page` default 1, `limit` default 20, máx 100) | `200` `{ data: [{id, nombre, precio, codigo_barras, createdAt, updatedAt}], meta: {total, page, limit} }` |
| `POST` | `/api/productos` | `{ "nombre": "...", "precio": 9.99, "codigo_barras": "ABC-1" }` | `201` producto creado · `400` forma/regla · `409` código de barras duplicado |
| `PUT` | `/api/productos/:id` | `{ "nombre"?: "...", "precio"?: 8.5 }` (al menos uno) | `200` producto · `400` · `404`. **El `codigo_barras` no se actualiza** (identidad estable: si viene, se ignora) |
| `DELETE` | `/api/productos/:id` | — | `200` `{"id": 14, "eliminado": true}` · `404` · **`409` si el producto tiene ventas** |
| `POST` | `/api/ventas` | `{ "items": [{ "productoId", "cantidad", "precioUnitario" }], "tipo"?: "normal" }` | `201` venta registrada · `400` carrito/reglas · `404` producto inexistente · `409` conflicto reportado por el SP |
| `GET` | `/api/ventas` | `?page=&limit=` (máx 100) | `200` `{ data: [{id, total, createdAt, items}], meta: {total, page, limit} }` (más reciente primero) |
| `GET` | `/api/ventas/:id` | — | `200` ticket con sus líneas · `404` |
| cualquier otra | — | — | `404` con `{ "error": { "code": "INTERNAL_ERROR", "message": "Ocurrio un error inesperado al procesar la peticion." } }` (la ruta existe en el mensaje interno, pero no se filtra al cliente) |

### Contrato real del `POST /api/ventas`

Request:

```bash
curl -X POST http://localhost:3000/api/ventas \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"productoId":14,"cantidad":3,"precioUnitario":2.5}]}'
```

Response `201` (salida real, no inventada):

```json
{
  "id": 39,
  "total": 7.5,
  "createdAt": "2026-10-01 00:51:41",
  "items": [
    { "producto_id": 14, "cantidad": 3, "precio_unitario": 2.5, "subtotal": 7.5 }
  ]
}
```

Notas del contrato:

- `items` es **obligatorio y no puede venir vacío**. Cada línea: `productoId` entero ≥ 1, `cantidad` entero **> 0**, `precioUnitario` número **≥ 0** (0 = cortesía/promo; negativo → 400).
- `precioUnitario` es **editable por línea**: el precio de `productos.precio` es solo el valor sugerido que precarga la UI (decisión D3).
- `total` lo calcula el **servidor** (el SP), no el cliente. Nunca envíes `total` en el body: se ignora porque no forma parte del esquema.
- `tipo` es opcional (default `'normal'`); solo `normal` está registrado en `container.js`, cualquier otro → `400 "Tipo de movimiento no soportado"`.
- `subtotal = ROUND(cantidad * precio_unitario, 2)` y `total = ROUND(SUM(subtotales), 2)`: el total es exactamente la suma de los subtotales.
- Las líneas se devuelven ordenadas por su id en `venta_detalle`.

---

## 10. Cómo verificar que todo funciona

Chequeos mínimos, en orden. Los resultados que siguen son los que se obtuvieron en este entorno, en una corrida **previa a la carga del catálogo del seeder** (`npm run seed`, que hoy deja **25 productos** con prefijo `SEED-`): en tu base los `id` —y a veces los nombres— van a variar, así que usá siempre los que devuelva tu API. Lo que sí importa es el **orden** de los pasos: el caso "producto CON ventas → 409" del paso 6 supone que ese producto es el que vendiste en el paso 5.

**1. La base está sana**

```bash
docker inspect --format '{{.State.Health.Status}}' pos-basic-ia-db   # healthy
```

**2. El API responde**

```bash
curl -s http://localhost:3000/api/health
# {"status":"ok"}
```

**3. El SP está instalado**

```bash
docker exec pos-basic-ia-db mysql -upos_user -p"$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)" -N \
  -e "SELECT ROUTINE_NAME FROM information_schema.routines WHERE routine_schema='pos_basic_ia';"
# sp_registrar_venta
```

**4. Ciclo de productos (201 → 200 → 409 → 200)**

```bash
# 4.1 alta -> 201 (anotá el "id" que devuelve)
curl -s -X POST http://localhost:3000/api/productos -H 'Content-Type: application/json' \
  -d '{"nombre":"Producto prueba","precio":9.99,"codigo_barras":"TMP-001"}'

# 4.2 edición de precio -> 200 (reemplazá 15 por el id del paso anterior)
curl -s -X PUT http://localhost:3000/api/productos/15 -H 'Content-Type: application/json' \
  -d '{"precio":8.5}'

# 4.3 búsqueda -> 200 con meta.total
curl -s "http://localhost:3000/api/productos?q=gomi&limit=3"

# 4.4 mismo código de barras -> 409
curl -s -X POST http://localhost:3000/api/productos -H 'Content-Type: application/json' \
  -d '{"nombre":"Otro","precio":1,"codigo_barras":"TMP-001"}'

# 4.5 baja (sin ventas) -> 200 {"id":15,"eliminado":true}
curl -s -X DELETE http://localhost:3000/api/productos/15
```

**5. Flujo completo de una venta**

```bash
# 5.1 elegir un producto del catálogo
curl -s "http://localhost:3000/api/productos?limit=1"
# -> {"data":[{"id":14,"nombre":"Gomita","precio":2.5,...}]}

# 5.2 registrar la venta (precio editable por línea)
curl -s -X POST http://localhost:3000/api/ventas -H 'Content-Type: application/json' \
  -d '{"items":[{"productoId":14,"cantidad":3,"precioUnitario":2.5}]}'
# 201 -> {"id":39,"total":7.5,"createdAt":"2026-10-01 00:51:41",
#         "items":[{"producto_id":14,"cantidad":3,"precio_unitario":2.5,"subtotal":7.5}]}

# 5.3 el total lo confirmó el servidor: 3 x 2.5 = 7.5 (no lo calculó el navegador)
curl -s http://localhost:3000/api/ventas/39
# 200 -> misma venta con sus líneas

# 5.4 aparece en el historial (más reciente primero)
curl -s "http://localhost:3000/api/ventas?limit=1"
# 200 -> {"data":[{"id":39,"total":7.5,...}],"meta":{"total":...,"page":1,"limit":1}}
```

**6. Reglas de negocio responden como corresponde**

```bash
# cantidad 0 -> 400
curl -s -X POST http://localhost:3000/api/ventas -H 'Content-Type: application/json' \
  -d '{"items":[{"productoId":14,"cantidad":0,"precioUnitario":2.5}]}'
# {"error":{"code":"VALIDATION_ERROR","message":"La linea 1 tiene una cantidad invalida: ..."}}

# carrito vacio -> 400
curl -s -X POST http://localhost:3000/api/ventas -H 'Content-Type: application/json' -d '{"items":[]}'
# {"error":{"code":"VALIDATION_ERROR","message":"items debe tener al menos una linea de producto", ...}}

# producto inexistente -> 404 (lo decide el SP y el service lo traduce a dominio)
curl -s -X POST http://localhost:3000/api/ventas -H 'Content-Type: application/json' \
  -d '{"items":[{"productoId":99999,"cantidad":1,"precioUnitario":1}]}'
# {"error":{"code":"NOT_FOUND","message":"Producto no encontrado con id 99999."}}

# tipo de movimiento no soportado -> 400 (hoy solo existe 'normal')
curl -s -X POST http://localhost:3000/api/ventas -H 'Content-Type: application/json' \
  -d '{"items":[{"productoId":14,"cantidad":1,"precioUnitario":2.5}],"tipo":"devolucion"}'
# {"error":{"code":"VALIDATION_ERROR","message":"Tipo de movimiento no soportado: devolucion",
#  "detalles":{"tipo":"devolucion","soportados":["normal"]}}}

# limit fuera de rango -> 400 (maximo 100)
curl -s "http://localhost:3000/api/productos?limit=500"
# {"error":{"code":"VALIDATION_ERROR","message":"El parametro limit no puede superar 100.", ...}}

# venta inexistente -> 404
curl -s http://localhost:3000/api/ventas/999999                                        # 404

# producto CON ventas -> 409 y NO se borra
curl -s -X DELETE http://localhost:3000/api/productos/14
# {"error":{"code":"CONFLICT","message":"No se puede eliminar: el producto tiene historial de ventas asociado."}}
```

**7. UI en el navegador**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080    # 200 (dev server respondiendo)
```

Abrir `http://localhost:8080`, cargar un producto en la pestaña **Productos**, pasarlo por la **terminal de ventas** y confirmar que la venta recién registrada aparece en **Ventas** con el total del servidor. En la consola del navegador no debe haber errores de CORS ni de red. *(Este último paso es manual: en la sesión que documentó esto sólo se verificó que el dev server responda `200`.)*

**8. Build del frontend**

```bash
cd frontend && npm run build    # DONE Build complete. (verificado, ~16 s)
```

---

## 11. Estructura del monorepo

```
pos-basic-ia/
├── package.json              # raíz: SOLO scripts db:up / db:down / db:logs (sin dependencias)
├── docker-compose.yml        # solo infraestructura MySQL 8 (127.0.0.1:3307 -> 3306)
├── .env.example              # plantilla versionada; .env real está en .gitignore
├── backend/                  # API Node.js + Express + Sequelize
│   ├── .sequelizerc          # rutas de config / models / migrations / seeders
│   ├── package.json          # start, dev, migrate, migrate:undo, seed
│   └── src/
│       ├── server.js         # único listen(); verifica la base antes de aceptar tráfico
│       ├── app.js            # express + cors + rutas + errorHandler (sin lógica)
│       ├── container.js      # ★ composition root: único que instancia y cablea todo
│       ├── config/           # app.js (puerto/CORS/paginación) · database.js (Sequelize)
│       ├── routes/           # producto.routes.js · venta.routes.js (solo mapeo)
│       ├── controllers/      # producto.controller.js · venta.controller.js (req/res)
│       ├── services/         # producto.service.js · venta.service.js · venta-strategies.js
│       ├── repositories/     # read/write de productos y ventas
│       │                     #   ★ sequelize-venta-write.repository.js = ÚNICO CALL al SP
│       ├── interfaces/       # contratos (DIP) de cada repository
│       ├── models/           # Producto · Venta · VentaDetalle (ventas: SOLO LECTURA)
│       ├── migrations/       # fuente autoritativa del schema
│       ├── seeders/          # seeder idempotente: 25 productos de ejemplo (prefijo SEED-)
│       ├── middlewares/      # asyncHandler · validate (forma) · errorHandler (status)
│       └── errors/           # domain-errors.js · sp-error.js
├── frontend/                 # SPA Vue 2 + Vuetify 2 + Axios (sin router ni store global)
│   ├── package.json          # serve · build
│   ├── vue.config.js         # puerto del dev server
│   └── src/
│       ├── main.js · App.vue # layout único con tabs: Punto de venta | Productos | Ventas
│       ├── api/              # http.js · productos.api.js · ventas.api.js (única salida HTTP)
│       └── components/       # VentaTerminal · ProductoLista · VentaLista
├── scripts/
│   ├── schema.sql            # espejo reproducible del schema (⚠ destructivo)
│   └── sp_registrar_venta.sql# definición canónica del Stored Procedure
├── docs/
│   └── ARQUITECTURA.md       # blueprint vinculante (decisiones D1-D6, UC-1..UC-4, Reglas de Oro)
└── .github/workflows/ci.yml  # CI: deps + .env + migraciones + SP + build (sin tests ni deploy)
```

---

## 12. Notas y troubleshooting

### CORS falla cerrado en producción

`config/app.js` **corta el arranque** si `NODE_ENV=production` y `CORS_ORIGIN` es `'*'` o está vacío:

```
CORS_ORIGIN no puede ser "*" ni quedar vacio en produccion: eso deja la API
abierta a CUALQUIER origen. Define la lista explicita de origenes separados
por coma en el .env de la raiz del monorepo ...
```

En `development` sí se tolera `'*'` (curl, Postman y pruebas lo necesitan), pero **no hay fallback a `'*'`** en `app.js`: si falta `config.cors.origin`, la app lanza error en lugar de servirse abierta. `CORS_ORIGIN` es una **lista separada por coma**: el paquete `cors` trata un string como *un* origen literal, por eso se parte y se entrega como array cuando hay más de uno.

Comportamiento verificado cargando sólo el módulo de config (sin levantar el server):

```bash
NODE_ENV=production CORS_ORIGIN='*' node -e "require('./src/config/app.js')"   # revienta con el mensaje de arriba
NODE_ENV=development CORS_ORIGIN='*' node -e "const c=require('./src/config/app.js'); console.log(c.cors)"
# {"origin":"*"}
```

### El precio de venta es editable y el total lo calcula el servidor

- El cliente envía `precioUnitario` por línea; el SP **congela** ese valor en `venta_detalle.precio_unitario` (D3). Un cambio posterior de `productos.precio` no reescribe la historia.
- `subtotal = ROUND(cantidad * precio_unitario, 2)` y `total = ROUND(SUM(subtotales), 2)` los hace **MySQL dentro del SP**. El frontend solo muestra una previsualización.
- El `201` del `POST /api/ventas` devuelve la venta **releída desde la base**: es el total autoritativo, no una suma de Node ni del navegador.
- `productos.precio` es solo el valor sugerido que precarga la terminal, y además tiene regla propia: debe ser **> 0** (en cambio un `precioUnitario` de línea puede ser 0).

### Un producto con ventas no se puede borrar

`DELETE /api/productos/:id` hace baja física **condicionada y fail-closed**: verifica que existe, cuenta el historial en `venta_detalle` y **solo borra si no hay ventas**. Si hay historial:

```json
{"error":{"code":"CONFLICT",
  "message":"No se puede eliminar: el producto tiene historial de ventas asociado.",
  "detalles":{"id":14,"ventas":1}}}
```

y no se borra nada. Si la verificación no puede hacerse (p. ej. `venta_detalle` no existe), el borrado **no** se ejecuta y el error se propaga: nunca se permite un `destroy()` a ciegas. No existe columna `activo` ni baja lógica.

### Otras fallas frecuentes

| Síntoma | Causa y arreglo |
| --- | --- |
| `npm run db:up` falla con `falta DB_NAME en .env` | No existe `.env`. `cp .env.example .env`. |
| El backend sale con `[db] no se pudo conectar` | MySQL no está arriba o mal el `.env`. `npm run db:up` y mirá `docker inspect --format '{{.State.Health.Status}}' pos-basic-ia-db` (esperado: `healthy`). El servidor **no** arranca a medias: hace `authenticate()` antes de `listen()`. |
| `POST /api/ventas` falla porque no existe el procedimiento | Falta el paso 6 de la instalación (instalar `scripts/sp_registrar_venta.sql`). |
| `npm run seed` inserta productos que no quería | **Verificado:** el seeder existe (`backend/src/seeders/20251001000000-catalogo-productos.js`) y carga **25 productos** de ejemplo con prefijo `SEED-`. Es idempotente (sólo inserta códigos que faltan) y `npm run seed:undo` los retira respetando los que ya tienen ventas. Para no cargarlos, simplemente no corras el paso: el catálogo se puede alimentar a mano por la API. |
| El navegador bloquea las llamadas por CORS | `CORS_ORIGIN` no incluye el origen del frontend (`http://localhost:8080`). |
| `Connection refused en 3306` | Estás apuntando al puerto equivocado: en el host es **3307**. |
| El frontend no puede escribir `frontend/.env` | No hace falta: `http.js` y `vue.config.js` traen defaults equivalentes en código. |
| `createdAt` viene con formato distinto | Verificado: el `201` del `POST /api/productos` devuelve ISO UTC (`2026-10-01T03:52:02.832Z`) porque serializa un `Date` del ORM, mientras que las lecturas devuelven la cadena local (`2026-10-01 00:52:02`) por `dateStrings: true`. Es cosmético; no cambia los valores. |
| Los comandos `cd backend && ...` se sienten raros | La raíz no tiene scripts de app: `npm start` / `npm run dev` / `npm run migrate` viven en `backend/package.json`, y `serve` / `build` en `frontend/package.json`. |
| Diferencia con `docs/ARQUITECTURA.md` | Ese documento (§3) menciona `backend/database/migrations/` y `producto.model.js`; **el path y los nombres reales** (verificados en `.sequelizerc` y en el árbol) son `backend/src/migrations/` y `Producto.js` / `Venta.js` / `VentaDetalle.js`. Manda el código. |

---

## 13. Cómo se construyó este proyecto

Esta sección describe el proceso real de desarrollo: con qué herramientas de IA se construyó, qué roles participaron y qué prácticas se aplicaron. Ningún apartado se da por bueno sin verificarlo: lo que se afirma aquí se comprobó contra el código o contra una corrida real.

### 13.1 Tecnologías de IA

| Herramienta | Para qué se usó |
| --- | --- |
| **Claude** (agente orquestador y subagentes especializados) | Planificación, decisiones de arquitectura, implementación por capas y revisión de código. |
| **OpenCode** | Entorno de ejecución de los agentes: lectura/escritura de archivos, shell, git y conexión con las herramientas de verificación. |
| **Playwright** | Verificación automatizada en navegador: carga de la SPA, recorrido de los flujos y capturas como evidencia. Los artefactos `.playwright-mcp/` que dejó esa verificación están en `.gitignore` y **no** se versionan. |

Tecnologías del proyecto en sí (no son IA): **Node.js · Express · Sequelize · MySQL 8 con Stored Procedures · Vue 2 · Vuetify · Axios · Docker Compose** — el stack completo, con versiones, está en la sección [3](#3-stack-y-versiones-exactas).

### 13.2 Roles que participaron

El trabajo se repartió entre agentes identificados **sólo por su rol** (sin nombres propios, ni de personas ni de agentes):

| Rol | Qué le tocó |
| --- | --- |
| **Agente orquestador** | Definió el plan de fases, el orden del trabajo y la integración entre fases; cerró las ambigüedades de la prueba antes de escribir código. |
| **Agente arquitecto de sistemas** | Fijó las decisiones D1-D6, el mapa de capas, los contratos de casos de uso UC-1..UC-4 y las Reglas de Oro en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md). |
| **Agente senior de backend** | Implementó la API por capas: `routes`, `controllers`, `services`, `repositories`, `models`, el composition root `container.js` y los middlewares de validación y errores. |
| **Agente senior de frontend** | Implementó la SPA en Vue 2 + Vuetify (catálogo, terminal de ventas, historial) y la capa `frontend/src/api/` de axios. |
| **Agente de datos** | Migraciones de Sequelize, `scripts/schema.sql`, la definición canónica del Stored Procedure `sp_registrar_venta` y el seeder del catálogo. |
| **Agente de seguridad** | CORS con lista explícita de orígenes y fail-closed en producción, validación de entrada en dos niveles, secretos fuera de git (`.env` ignorado / `.env.example` versionado) y baja de producto fail-closed. |
| **Agente de revisión de código (code review)** | Revisión con **veredicto vinculante** de cada fase antes de integrarla: cualquier desvío del blueprint se rechazaba. |
| **Agente de QA / pruebas** | Verificación con evidencia real: `curl` contra el API corriendo, instalación y ejercicio del SP, reglas de negocio, build del frontend y recorrido en navegador. |
| **Agente de documentación** | `README.md`, `docs/ARQUITECTURA.md` y la documentación inline del código. |

### 13.3 Prácticas y proceso

1. **Planificación por fases antes de escribir código.** Un blueprint de arquitectura con 6 decisiones (D1-D6) que cierran las ambigüedades de la prueba, y un plan de 5 fases con perímetro propio por rama: `feature/products`, `feature/sales` y `ProductionEnv` (integrada con merge `--no-ff`).
2. **Arquitectura por capas estricta:** `routes → controllers → services → repositories → models`. Sin lógica de negocio en los controllers y sin SQL fuera de los repositories — es una regla de importación gateable por grep, no una recomendación.
3. **Principios SOLID aplicados, y dónde:** SRP (una responsabilidad por capa), OCP (Strategy por tipo de movimiento en `services/venta-strategies.js`), LSP/ISP (un interface por repository en `interfaces/`) y DIP (inyección de dependencias por constructor desde un único composition root, `container.js`, sin framework de DI externo).
4. **El Stored Procedure como único camino de escritura de ventas:** cero `INSERT` sobre `ventas`/`venta_detalle` por el ORM; los modelos de ventas son de sólo lectura y el `CALL sp_registrar_venta` vive en un solo repository (`sequelize-venta-write.repository.js`).
5. **Revisión de código con veredicto vinculante antes de integrar cada fase:** la revisión no emitía sugerencias, frenaba el merge.
6. **Verificación con evidencia real:** cada afirmación de este README se comprobó contra el código o contra una corrida real (health, SP instalado, ciclo de productos 201→200→409→200, venta completa, reglas de negocio, build). Nada se da por cierto sin probarlo.
7. **Commits pequeños y con mensajes que explican el por qué, no el qué** (el "qué" ya está en el diff; el mensaje explica la causa y la medición).
8. **Nada se subió a un repositorio remoto durante el desarrollo.** Verificado en este entorno: `git ls-remote origin` no devuelve ninguna referencia y el reflog no contiene entradas de `push`.
9. **Verificación de la persistencia y del acceso desde el navegador.** Dos puntos se ajustaron midiendo la causa raíz, no adivinando:
   - **Zona horaria en la base** (commit `b6dc3b6`): `createdAt` se escribía desplazado y las ventas nuevas caían **al final** del historial. Causa raíz medida: Sequelize abría cada sesión del pool con `SET time_zone = '-03:00'`, así que el `NOW()` que evalúa el SP guardaba una hora incorrecta **en disco** (no era un error de lectura). Se comparó `@@session.time_zone` contra `NOW()` / `UTC_TIMESTAMP()` y se fijó UTC tanto en la sesión como en el contenedor (`--default-time-zone=+00:00` en el compose).
   - **Permisos de origen en el navegador** (commits `0d576ba` y `f532326`): `CORS_ORIGIN` se pasaba al paquete `cors` como un **string** con varios orígenes, que lo trata como *un* origen literal, así que el `Access-Control-Allow-Origin` devolvía la lista pegada y **ningún navegador la matcheaba**: la SPA tenía todas sus llamadas bloqueadas. Se reprodujo con preflights `curl` usando un `Origin` real, se parseó el valor como lista y se agregó el fail-closed en producción.

### 13.4 Tiempo aproximado utilizado

La prueba se resolvió en **3 horas y 20 minutos**.

Ese tiempo es coherente con el historial de commits: **todos** los commits de la rama `ProductionEnv` caen dentro de la ventana de **10:00 a 13:20**. Se puede comprobar sin depender de este README:

```bash
# primer commit de la rama integrada
git log --format='%ad' --date=format:'%H:%M' --reverse ProductionEnv | head -1

# último commit de la rama integrada
git log -1 --format='%ad' --date=format:'%H:%M' ProductionEnv

# cantidad de commits en la ventana
git rev-list --count ProductionEnv
```

El trabajo se organizó por fases con un entregable por rama, y cada fase se integró recién después de su revisión:

| Entregable | Rama | Contenido |
| --- | --- | --- |
| Productos | `feature/products` | Catálogo, búsqueda, alta, edición y baja; schema y migraciones. |
| Ventas | `feature/sales` | Carrito, precio editable, venta persistida vía Stored Procedure, historial. |
| Integración | `ProductionEnv` | Integración de ambos entregables, pruebas, documentación y fixes de verificación. |

### 13.5 Tareas delegadas y revisión del candidato

#### Tareas delegadas

El trabajo se ejecutó con un **agente orquestador** que coordinó subagentes especializados. Las tareas se delegaron por área, no por archivos sueltos, y cada agente recibió su perímetro de escritura y su criterio de aceptación:

| Tarea delegada | Resultado esperado |
| --- | --- |
| Arquitectura por capas | Blueprint con decisiones D1-D6, casos de uso UC-1..UC-4 y reglas de importación. |
| Implementación de backend | API Express por capas `routes → controllers → services → repositories → models`. |
| Implementación de frontend | SPA en Vue 2 + Vuetify: catálogo, terminal de ventas e historial. |
| Datos y Stored Procedure | Migraciones Sequelize, `scripts/schema.sql`, `sp_registrar_venta` y seeder. |
| Revisión de código | Veredicto vinculante antes de integrar cada fase. |
| QA | Ejercitar la API real, el Stored Procedure y los flujos de negocio. |
| Documentación | Este `README.md` y `docs/ARQUITECTURA.md`. |

#### Ejemplos de actividades realizadas con el agente

- Generar las **migraciones de Sequelize** y el script del Stored Procedure `sp_registrar_venta` con su transacción, validaciones y manejo de errores.
- Escribir la **suite de pruebas**: 311 tests de backend y 55 de frontend, con Jest, más ESLint en backend, frontend y raíz.
- Diagnosticar y ajustar el **manejo de zona horaria** de la sesión de MySQL para que `createdAt` se escribiera en UTC y el historial ordenara bien.
- Configurar la **política de CORS** con lista explícita de orígenes y comportamiento fail-closed en producción.

#### Qué revisó y corrigió el candidato

La revisión fue parte del flujo, no un trámite:

1. Cada fase pasó por una **revisión de código con veredicto vinculante** antes de integrarse: la revisión no emitía sugerencias, frenaba el merge.
2. El candidato **revisó personalmente los resultados** de cada agente antes de darlos por buenos, y ajustó lo que no cumplía el criterio de aceptación.
3. Lo mismo con la verificación final: se comprobó contra la API corriendo y contra el navegador, no contra el código leído.

El trabajo se ajustó según el plan definido desde el inicio. **Las correcciones aplicadas durante el desarrollo quedaron registradas en el historial de commits del repositorio**, que es la fuente de verdad para ese detalle: `git log ProductionEnv` las muestra en orden y con su causa.

### 13.6 Consideraciones para evaluar o ejecutar

#### Orden de arranque

El orden importa. Si se salta un paso, algo no va a funcionar:

```bash
# 1. MySQL 8 por Docker (lee el .env de la raíz)
npm run db:up

# 2. Variables de entorno: copiar la plantilla y editar la copia
cp .env.example .env

# 3. Dependencias
(cd backend  && npm install)
(cd frontend && npm install)

# 4. Migraciones (crea productos, ventas y venta_detalle)
(cd backend && npm run migrate)

# 5. Stored Procedure — OBLIGATORIO
#    Sin este paso, el catálogo funciona pero las ventas devuelven error.
#    Ver sección 7 para el comando exacto.

# 6. Datos de ejemplo
(cd backend && npm run seed)
```

> **⚠️ Punto de mayor riesgo al ejecutar la solución:** el paso 5. El registro de ventas escribe **únicamente** a través de `sp_registrar_venta`. Si el procedure no está instalado, la UI deja de permitir registrar ventas.

#### Verificación rápida

```bash
curl localhost:3000/api/salud          # -> {"status":"ok"}
```

Para el recorrido completo por API (alta, edición, búsqueda, duplicado, baja, venta con total confirmado por el servidor, historial, y los casos de error) ver la [sección 10](#10-cómo-verificar-que-todo-funciona).

#### Pruebas y lint

```bash
npm test        # 366 tests (311 backend + 55 frontend)
npm run lint    # ESLint en backend, frontend y raíz
```

#### Qué mirar primero

| Si querés evaluar… | Mirá |
| --- | --- |
| Que el SP sea el único camino de escritura | `backend/src/repositories/sequelize-venta-write.repository.js` — es el único archivo con `CALL sp_registrar_venta`. |
| El contrato del SP | `scripts/sp_registrar_venta.sql`. |
| Que el total lo calcule el servidor | La sección [8.1](#81-el-precio-de-venta-es-editable-y-el-total-lo-calcula-el-servidor). |
| Las decisiones de diseño | `docs/ARQUITECTURA.md`. |

#### Alcance

- Rama a revisar: **`ProductionEnv`**.
- Es una **prueba técnica**, no un producto en producción: sin despliegue, sin autenticación activa, sin usuarios reales.
- No hay `stock` ni `precio_compra` a propósito: el requerimiento los excluía y agregar una columna de inventario sin requisito sería alcance no pedido.

---

## Créditos, licencia y aviso

- **Autor:** Erick Burgos `<eburgosrivas1997@gmail.com>` (historial de commits del repositorio).
- **Repositorio:** <https://github.com/ErickGBR/pos-basic-ia>
- **Blueprint de arquitectura:** [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — decisiones D1-D6, casos de uso UC-1..UC-4 y las 15 Reglas de Oro.
- **Licencia:** **MIT** — archivo [`LICENSE`](LICENSE) a nombre de Erick Burgos, en línea con el `"license": "MIT"` del `package.json` de la raíz.
- **Proceso de desarrollo:** ver [Cómo se construyó este proyecto](#13-cómo-se-construyó-el-proyecto) (tecnologías de IA, roles y prácticas).
- **⚠️ Aviso explícito:** este repositorio es una **prueba técnica**, no un producto en producción. No hay despliegue, ni CI publicado, ni usuarios reales, ni autenticación activa (`JWT_SECRET` está declarado y sin uso). Los datos y credenciales del `.env` son de ejemplo.
