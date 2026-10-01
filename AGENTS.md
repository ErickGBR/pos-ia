# AGENTS.md — POS Basic IA

Instrucciones para cualquier agente de IA que trabaje en este repositorio. Es el estándar abierto: `CLAUDE.md` es la variante específica de Claude Code y **no** contradice este archivo.

## Qué es el proyecto

Punto de venta con tres flujos: catálogo de productos (CRUD con baja lógica), terminal de ventas (carrito → venta) e historial de ventas.

- **Backend**: Node.js + Express + Sequelize. Rutas bajo `/api`.
- **Frontend**: SPA en Vue 2 + Vuetify + Axios.
- **Base de datos**: MySQL 8. **Las ventas se escriben únicamente por el Stored Procedure `sp_registrar_venta`.**

## Comandos

### Backend (`backend/`)

```bash
npm install
npm run dev            # desarrollo con nodemon en :3000
npm start              # producción
npm test               # suite completa
npm run lint
npm run migrate        # migraciones de Sequelize
npm run migrate:undo
```

### Frontend (`frontend/`)

```bash
npm install
npm run serve          # dev server en :8080
npm run build
npm run lint
npm run test:unit
```

### Base de datos

```bash
docker compose up -d          # MySQL en el host, puerto 3307
docker compose down
```

El SP se instala a mano desde `scripts/schema.sql`; no lo crea Sequelize.

## Estructura

```
backend/
  src/
    app.js              composition root: middlewares, rutas, manejo de errores
    server.js           arranque; se niega a aceptar tráfico si la DB no responde
    config/             config de base de datos y de entorno
    models/             modelos Sequelize
    repositories/       acceso a datos. Las ventas salen de aquí en solo lectura
    services/           lógica de negocio; lanza errores de dominio
    controllers/        HTTP: translating, sin lógica
    routes/             definición de endpoints
    middlewares/        validación y manejador de errores
    migrations/
frontend/
  src/
    api/                capa de axios, única que conoce las rutas del backend
    components/         vistas de Vuetify
docs/ARQUITECTURA.md    decisiones D1-D6, casos UC-1..UC-4, Reglas de Oro
scripts/schema.sql      esquema y Stored Procedure
```

## Reglas de Oro

1. **Las ventas solo se escriben por `sp_registrar_venta`.** Cero `INSERT` o `UPDATE` sobre `ventas` y `venta_detalle` desde el ORM. Los modelos `Venta` y `VentaDetalle` existen **solo para lectura**.
2. **Los controllers nunca escriben `res.status(500)` ni eligen códigos a mano.** Lanzan el error de dominio y lo traduce `errorHandler`.
3. **Ningún servicio llama a otro servicio.** Se comunican por el composition root (`container.js`).
4. **El frontend solo habla con el backend por `frontend/src/api/`.** Ningún componente hace axios directo.
5. **Validación en dos niveles**: `validate.js` revisa forma y tipos; el service revisa reglas de negocio.
6. **Ningún secreto se versiona.** `.env` está en `.gitignore`; `.env.example` sí se versiona.
7. **CORS con lista explícita de orígenes**, y fail-closed en producción.

## Contrato de errores

Todas las rutas cuelgan de `/api`. Los errores tienen esta forma:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "detalles": {} } }
```

`code` ∈ `VALIDATION_ERROR` (400) · `NOT_FOUND` (404) · `CONFLICT` (409) · `INTERNAL_ERROR` (500).

Una ruta inexistente devuelve 404 con `code: "INTERNAL_ERROR"`. Es intencional y está documentado en el README.

Endpoint de salud: `GET /api/health` → `{"status":"ok"}`. **No** existe `/api/salud`.

## Git

- `main` es el ancestro: **no se retrocede**. La rama de trabajo es `ProductionEnv`.
- Integración de fases con merge `--no-ff`.
- Asunto de commit en Conventional Commits: `tipo(ámbito): descripción`.
- Nunca `git push --force` sobre `ProductionEnv` sin autorización explícita del operador.

## Verificación

Antes de dar cualquier cosa por terminada:

```bash
cd backend && npm test && npm run lint
cd frontend && npm run test:unit && npm run lint
```

Y contra el API corriendo, no contra supuestos:

```bash
curl -s localhost:3000/api/health
```

Nada se afirma en la documentación sin comprobarlo contra el código o contra una corrida real.