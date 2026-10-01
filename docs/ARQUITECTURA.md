# ARQUITECTURA — POS Básico IA (Prueba Técnica Lead AI-Native)

> **Autor:** Erick Burgos · **Licencia:** MIT (ver `LICENSE` en la raíz del monorepo).

> **Estatus:** DECISIÓN VINCULANTE. Este documento es el blueprint que los implementadores siguen LITERALMENTE. Lo que no esté aquí, no se improvisa: se pregunta. Lo que contradiga este documento, el revisor de código lo rechaza en code review.
> **Stack fijo (NO negociable):** Backend `Node.js + Express + Sequelize` · Frontend `Vue.js 2 + Vuetify + Axios` · DB `MySQL 8 vía Docker`.
> **Repo:** `ErickGBR/pos-basic-ia` · **Directorio de trabajo:** clon local (inicia vacío).

---

## 0. Decisiones fuertes (leer primero — 6 decisiones que cierran ambigüedades)

| # | Decisión | Justificación |
|---|----------|---------------|
| D1 | **Monorepo con dos apps separadas:** `backend/` y `frontend/` + `scripts/` y `docs/` en raíz. Cada app tiene su propio `src/`. | La prueba no define layout. Un solo `src/` mezclaría dos runtimes y rompería SRP a nivel repo. Dos `src/` permiten capas independientes por app. |
| D2 | **La venta NUNCA usa el ORM para escribir.** El único camino de escritura de ventas es `CALL sp_registrar_venta(:detalle_json, @pos_venta_id)` vía `sequelize.query` — precedido de `SET @pos_venta_id = NULL` y seguido de `SELECT @pos_venta_id AS id`, las tres consultas sobre la MISMA conexión (ver UC-3). Los modelos `Venta/VentaDetalle` existen SOLO para lectura (listados). | Cumple "SP realmente usado por la app" de forma auditable y evita doble camino de escritura (ORM vs SP) que divergiría. |
| D3 | **Precio editable por ítem y congelado en el detalle.** El cliente envía `precio_unitario` por línea (por defecto el `precio` vigente del producto); el SP persiste ese valor en `venta_detalle.precio_unitario` y calcula `subtotal = cantidad * precio_unitario`. El `precio` de `productos` es solo valor sugerido/default. | Requisito de Reglas de Oro. Evita que un cambio futuro de precio reescriba la historia. |
| D4 | **Baja de producto = borrado FÍSICO CONDICIONADO FAIL-CLOSED (no existe columna `activo`).** El repository de escritura DEBE verificar integridad referencial antes de borrar y solo borra si el producto NO tiene ventas asociadas; si tiene ventas lanza `ConflictError` (409) explicando que no se puede eliminar porque tiene historial de ventas. Si la verificación NO puede realizarse (por ejemplo, si la tabla `venta_detalle` no existiera todavía), el borrado NO se ejecuta y el error se propaga. Prohibido `destroy()` ciego sin verificación previa en todo el codebase y prohibido un guard que devuelva "sin historial de ventas" cuando en realidad no pudo verificar (fail-OPEN). | No hay columna `activo` por schema fijado por el operador. Se preserva el historial: borrar un producto con ventas rompería FK o dejaría huérfanos, por eso la baja se condiciona a no tener ventas, y ante duda o fallo de verificación se DENIEGA el borrado (fail-closed), nunca se permite. |
| D5 | **Sin framework de DI externo. Inyección manual por constructor + único `container.js`. Sin `vue-router`, sin `pinia/vuex`, sin `nestjs/typeorm/mongoose`.** Dependencias backend permitidas: `express, sequelize, mysql2, cors, dotenv`. Frontend: `vue@2, vuetify@2, axios`. | La prueba exige dependencias mínimas y prohíbe esos paquetes. El frontend es una sola vista POS (ventas + productos por tabs de Vuetify), no necesita router ni store global: estado local del componente + capa `api/`. |
| D6 | **Perímetro de fases y ramas (plan de 5 fases).** `feature/products` entrega SOLO el módulo de productos (capa de datos, repos, service, controller, routes, endpoints y frontend de productos); la ausencia del módulo de ventas en esa rama es intencional y NO es un defecto. `feature/sales` entrega el módulo de ventas completo, incluida la única y obligatoria `sp_registrar_venta`. `ProductionEnv` es la rama donde conviven ambos, creada con merge `--no-ff`. El árbol §3 describe ese estado final integrado, no el alcance de cada rama. | El gate de cada rama se evalúa contra su propio alcance, y el requisito de la prueba técnica del Stored Procedure se cumple y se audita en `feature/sales`, no en `feature/products`. Cierra el falso bloqueante B1 del revisor de código (gate 1). |

**Ambigüedades de la prueba resueltas por la arquitecta (no improvisar):**

1. *Schema no especificado* → se fija (requerimiento confirmado por el operador): `productos(id, nombre, precio DECIMAL(10,2), codigo_barras VARCHAR UNIQUE, createdAt, updatedAt)`, `ventas(id, total, createdAt)`, `venta_detalle(id, venta_id FK, producto_id FK, cantidad, precio_unitario, subtotal)`. NOTA DE ALCANCE: NO existen columnas `precio_compra`, `stock` ni `activo` porque el operador las excluyó del requerimiento; por eso no hay control de inventario ni baja lógica.
2. *Firma del SP no especificada* → se fija: `sp_registrar_venta(IN p_detalle JSON, OUT p_venta_id INT)`. `p_detalle` es array JSON `[{producto_id, cantidad, precio_unitario}]`. El SP valida que cada producto existe, calcula `subtotal = cantidad * precio_unitario` y el `total`, inserta `ventas` + `venta_detalle` en UNA transacción (NO descuenta stock: no existe). Devuelve `p_venta_id`. Cualquier error hace `ROLLBACK` + `SIGNAL`.
3. *Búsqueda de productos* → `GET /api/productos?q=` busca por coincidencia parcial en `nombre` (`nombre LIKE %q%`) y exacta en `codigo_barras` (`codigo_barras = q`). Si `q` está vacío, lista todo. Sin filtro por `activo` (no existe). Orden `createdAt DESC`, paginación `page/limit`.
4. *Paginación* → `?page=1&limit=20` (defaults). Respuesta `{ data, meta: { total, page, limit } }`. Sin paginación cursor: innecesaria para la escala de la prueba.
5. *Migraciones vs SQL* → Migraciones Sequelize son fuente autoritativa. `scripts/schema.sql` es espejo reproducible y `scripts/sp_registrar_venta.sql` es la definición canónica del SP. En caso de conflicto, manda la migración.

---

## 1. Diagrama de capas del backend (de fuera hacia adentro)

```
HTTP ──> routes (Express Router) ──> controllers ──> services ──> repositories ──> models (Sequelize) ──> MySQL 8
                                        │                │               │
                                        │                │               └── ÚNICA capa que importa Sequelize / define modelos / hace query crudo
                                        │                └── ÚNICA capa con lógica de negocio + reglas + orquestación (llama al SP para ventas)
                                        └── ÚNICA capa que toca req/res (parsea, llama al service, mapea status HTTP). CERO lógica de negocio.
              routes: SOLO mapea verbo+ruta → controller + middlewares. CERO lógica.
```

### 1.1 Responsabilidad por capa (qué SÍ / qué NO)

| Capa | SÍ hace | NO hace (PROHIBIDO) |
|------|---------|---------------------|
| **`routes/`** (Express Router) | Declara `router.get/post/put/delete(patch)`, adjunta middlewares de validación, delega al controller. | ❌ Ninguna lógica de negocio. ❌ Ningún `try/catch` de negocio. ❌ Ningún acceso a service-repository-model directo salvo vía controller. ❌ Ninguna validación inline (va en `middlewares/validate.js`). |
| **`controllers/`** | Extrae `req.params/query/body`, invoca UN caso de uso del service, traduce resultado a `res.status().json()` y errores de dominio a códigos HTTP (ver §4). Envuelve con `asyncHandler`. | ❌ PROHIBIDO importar `sequelize`, `Sequelize`, `mysql2`, modelos (`require('../models/...')`), o hacer `sequelize.query` / `findAll` / `findByPk` / cualquier query. ❌ PROHIBIDO validar reglas de negocio (existencia, precio ≤ 0, duplicados). Solo validación de forma (tipos/requeridos) delegada al middleware. ❌ PROHIBIDO tocar `req/res` fuera de esta capa (el service jamás recibe `req` ni `res`). |
| **`services/`** | Contiene los casos de uso (§4). Valida reglas de negocio, orquesta repositories, abre transacciones cuando corresponde, invoca el SP para ventas. Recibe dependencias por constructor. Lanza errores de dominio (`NotFoundError`, `ValidationError`, `ConflictError`). | ❌ PROHIBIDO importar Express (`req/res/next`), Sequelize, o modelos. ❌ PROHIBIDO construir SQL a mano salvo el `CALL` al SP (única excepción, y vive solo en `repositories/sequelize-venta-write.repository.js`; el service jamás contiene SQL). ❌ PROHIBIDO instanciar repositories con `new` dentro de métodos (solo vía constructor inyectado desde `container.js`). |
| **`repositories/`** | Única capa que habla con la BD: usa modelos Sequelize o `sequelize.query` (solo para el SP). Implementa interfaces de `interfaces/` (`ProductoReadRepository`, `ProductoWriteRepository`, `VentaReadRepository`, `VentaWriteRepository`). CRUD de productos + lecturas de ventas. | ❌ PROHIBIDO contener lógica de negocio (no valida existencia/duplicados, no calcula totales, no decide status HTTP). ❌ PROHIBIDO abrir transacciones (la transacción vive en el service o dentro del SP, nunca en el repository). ❌ PROHIBIDO exponer Sequelize al exterior (devuelve objetos planos/entidades, no instancias acopladas si se puede evitar; como mínimo no filtra `req`). |
| **`models/`** (Sequelize) | Define `Producto`, `Venta`, `VentaDetalle` + asociaciones + migraciones. `Venta/VentaDetalle` son de SOLO LECTURA (no se hace `create` sobre ellos en app). | ❌ PROHIBIDO importar models fuera de `repositories/` y `container.js`. Si un controller/service importa un modelo, el review se rechaza automáticamente. |
| **`middlewares/`** | `asyncHandler`, `validate` (forma: campos requeridos/tipos), `errorHandler` (mapea error dominio → HTTP). | ❌ PROHIBIDO lógica de negocio. |
| **`config/` + `container.js`** | `config/` lee env y crea instancia Sequelize. `container.js` es el COMPOSITION ROOT: el ÚNICO archivo que conoce Sequelize + modelos + repositories + services + controllers juntos y los cablea. | ❌ PROHIBIDO que cualquier otro archivo haga `new Service()` / `new Repository()` / `new Sequelize()`. Todo el cableado vive aquí. |

**Regla de importación (gateable por grep):** las flechas de dependencia solo apuntan hacia adentro. `routes → controllers → services → repositories → models`. Jamás al revés, jamás saltos (`controller → repository` o `service → model` están prohibidos).

---

## 2. Mapeo SOLID, capa por capa (con fragmentos ilustrativos — van en este documento, NO son archivos reales)

> Los snippets siguientes son ILUSTRATIVOS del contrato. Los implementadores los expanden siguiendo §3 y §4 sin cambiar las firmas ni las reglas.

### SRP — Una razón para cambiar por clase

* **Controller no valida reglas de negocio; service no toca `req/res`.**
* `ProductoController` cambia solo si cambia el shape HTTP. `ProductoService` cambia solo si cambia la regla de negocio. `ProductoRepository` cambia solo si cambia el acceso a datos.

```js
// controllers/producto.controller.js (ILUSTRATIVO)
class ProductoController {
  constructor(productoService) { this.service = productoService; } // inyección por constructor
  crear = async (req, res) => {
    const dto = { nombre: req.body.nombre, codigoBarras: req.body.codigo_barras, precio: req.body.precio };
    const creado = await this.service.crear(dto); // CERO reglas aquí
    return res.status(201).json(creado);
  };
}
// services/producto.service.js (ILUSTRATIVO)
class ProductoService {
  constructor(productoWriteRepo, productoReadRepo) { this.write = productoWriteRepo; this.read = productoReadRepo; }
  async crear(dto) {
    if (!dto.nombre || dto.precio <= 0) throw new ValidationError('Datos de producto inválidos');
    const dup = await this.read.buscarPorCodigoBarras(dto.codigoBarras);
    if (dup) throw new ConflictError('Código de barras duplicado');
    return this.write.crear(dto); // el service JAMÁS toca req/res
  }
}
```

### OCP — Abierto a extensión, cerrado a modificación (Strategy)

*Agregar un nuevo tipo de movimiento de venta (ej. `devolución`, `descuento_global`) sin modificar `VentaService`.*

```js
// services/venta-strategies.js (ILUSTRATIVO)
class VentaNormalStrategy {
  construirLineas(carrito) { return carrito.map(i => ({ producto_id: i.productoId, cantidad: i.cantidad, precio_unitario: i.precioUnitario })); }
}
// Mañana: class DevolucionStrategy { construirLineas(carrito) { /* cantidades negativas validadas */ } }
// services/venta.service.js (ILUSTRATIVO)
class VentaService {
  constructor(ventaWriteRepo, strategies = {}) { this.repo = ventaWriteRepo; this.strategies = strategies; }
  async registrar(carrito, tipo = 'normal') {
    const strategy = this.strategies[tipo];
    if (!strategy) throw new ValidationError('Tipo de movimiento no soportado');
    const lineas = strategy.construirLineas(carrito); // OCP: nuevo tipo = nueva clase, sin tocar este método
    return this.repo.registrarConSP(lineas);
  }
}
// container.js registra: strategies: { normal: new VentaNormalStrategy() }
```

### LSP — Contrato único de Repository sustituible por un fake

*Todo repository implementa la interfaz de `interfaces/`. Un fake de test respeta la misma firma y es intercambiable sin romper el service.*

```js
// interfaces/producto-read.repository.js (ILUSTRATIVO — contrato)
class ProductoReadRepository {
  async listar(filtros) { throw new Error('No implementado'); }
  async buscarPorCodigoBarras(codigo) { throw new Error('No implementado'); }
}
// repositories/sequelize-producto-read.repository.js la implementa con Sequelize.
// tests/fakes/fake-producto-read.repository.js la implementa en memoria con la MISMA firma.
// El service no distingue: funciona con cualquiera (LSP).
```

### ISP — Interfaces segregadas

**Decisión: SÍ segregar.** `ProductoReadRepository` vs `ProductoWriteRepository`, `VentaReadRepository` vs `VentaWriteRepository`.

*Justificación:* los casos de uso de lectura (listar/buscar) y escritura (crear/actualizar/eliminar, registrar venta vía SP) cambian por razones distintas y tienen permisos distintos (lectura nunca escribe; `VentaWrite` solo expone `registrarConSP`). Una interfaz gorda `ProductoRepository` obligaría a los services de lectura a depender de métodos de escritura que no usan, violando ISP y ensanchando el blast radius. Segregadas, el `ProductoService.listar` solo recibe el read repo; el test fake de lectura no necesita implementar escrituras.

```js
// interfaces/ (ILUSTRATIVO)
class ProductoReadRepository { async listar(f); async buscarPorId(id); async buscarPorCodigoBarras(c); }
class ProductoWriteRepository { async crear(d); async actualizar(id, d); async eliminar(id); }
class VentaReadRepository { async listar(p); async obtenerPorId(id); }
class VentaWriteRepository { async registrarConSP(lineas); } // ÚNICO método de escritura de ventas
```

### DIP — Los services dependen de interfaces; solo `container.js` conoce Sequelize

*Sin framework de DI externo. Inyección manual por constructor. El composition root es el ÚNICO lugar que importa `sequelize`, modelos y repositories concretos.*

```js
// container.js — COMPOSITION ROOT, ÚNICO que conoce Sequelize (ILUSTRATIVO)
const { Sequelize } = require('sequelize');
const databaseConfig = require('./config/database'); // + appConfig de ./config/app
const definirModelos = require('./models'); // ./models/index.js → { Producto, Venta, VentaDetalle }
const sequelize = new Sequelize(configuracionDeBase()); // única instanciación (con guard fail-fast por entorno)
const { Producto } = definirModelos(sequelize);
const SequelizeProductoReadRepo = require('./repositories/sequelize-producto-read.repository');
const ProductoService = require('./services/producto.service');
const productoReadRepo = new SequelizeProductoReadRepo(Producto);
const productoService = new ProductoService(productoWriteRepo, productoReadRepo);
// NINGÚN otro archivo hace `require('sequelize')` ni `require('../models/...')`.
module.exports = { productoService, ventaService, productoController, ventaController };
```

---

## 3. Árbol de directorios completo y definitivo (hasta 2 niveles dentro de cada `src/`)

> Decisión D1: dos apps. Nombres exactos, sin renombres ni carpetas extra sin aprobación. `container.js` va en `backend/src/container.js`. `scripts/*.sql` en raíz.

```
pos-basic-ia/
├── docker-compose.yml              # MySQL 8 (imagen mysql:8, puerto 3306, volumen persistente, .env)
├── .env.example                    # DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, BACKEND_PORT
├── backend/
│   ├── package.json                # deps permitidas: express, sequelize, mysql2, cors, dotenv (+dev: nodemon, sequelize-cli)
│   ├── .sequelizerc                # paths CLI: config→src/config/database.js, models→src/models, seeders→src/seeders, migrations→src/migrations
│   └── src/
│       ├── app.js                  # crea express, monta routes/, monta errorHandler. NO lógica.
│       ├── server.js               # listen(). Solo arranca; importa app + container.
│       ├── container.js            # ★ COMPOSITION ROOT — único que cablea todo (ver §2 DIP)
│       ├── config/
│       │   ├── app.js              # env + paginación (pagination.maxLimit) y tope de items del carrito (ventas.maxItemsPorCarrito) que consumen los services
│       │   └── database.js         # lee env, exporta config por entorno. Único lugar con `new Sequelize` (vía container.js).
│       ├── routes/
│       │   ├── producto.routes.js  # router CRUD + búsqueda → ProductoController
│       │   └── venta.routes.js     # router registrar + listar → VentaController
│       ├── controllers/
│       │   ├── producto.controller.js
│       │   └── venta.controller.js
│       ├── services/
│       │   ├── producto.service.js
│       │   ├── venta.service.js
│       │   └── venta-strategies.js # Strategy para OCP (VentaNormalStrategy)
│       ├── repositories/
│       │   ├── sequelize-producto-read.repository.js
│       │   ├── sequelize-producto-write.repository.js
│       │   ├── sequelize-venta-read.repository.js
│       │   ├── sequelize-venta-write.repository.js  # ★ ÚNICO archivo con `sequelize.query('CALL sp_registrar_venta...')` (SET + CALL + SELECT, misma conexión)
│       │   └── producto-mapper.js  # mapea filas Sequelize → objetos planos de productos
│       ├── models/
│       │   ├── Producto.js         # define tabla `productos` (factory: module.exports = (sequelize) => Model)
│       │   ├── Venta.js            # SOLO LECTURA (no create/update desde app)
│       │   ├── VentaDetalle.js     # SOLO LECTURA
│       │   └── index.js            # definirModelos(sequelize) + asociaciones (Venta hasMany Detalle as items, etc.)
│       ├── interfaces/
│       │   ├── producto-read.repository.js
│       │   ├── producto-write.repository.js
│       │   ├── venta-read.repository.js
│       │   └── venta-write.repository.js  # UN SOLO método: registrarConSP(lineas)
│       ├── middlewares/
│       │   ├── asyncHandler.js
│       │   ├── validate.js             # validación de FORMA (requeridos/tipos)
│       │   └── errorHandler.js         # mapea NotFound→404, Validation→400, Conflict→409 (respeta err.status)
│       ├── errors/
│       │   ├── domain-errors.js        # NotFoundError, ValidationError, ConflictError, PayloadTooLargeError
│       │   └── sp-error.js             # SpError + comoErrorDelSP/comoErrorDeRango (traduce SIGNAL 45000 y errno fuera de rango)
│       ├── migrations/
│       │   ├── 20250930000000-create-productos.js
│       │   └── 20250930000001-create-ventas.js
│       └── seeders/
│           └── 20251001000000-catalogo-productos.js  # catálogo inicial idempotente
├── frontend/                           # Vue 2 + Vuetify 2 + Axios. SIN vue-router, SIN vuex/pinia.
│   ├── package.json                    # deps permitidas: vue@2, vuetify@2, axios (+ scaffold: core-js)
│   └── src/
│       ├── main.js                     # bootstrap Vue + Vuetify
│       ├── App.vue                     # layout único con tabs: [Productos | Ventas] (Ventas = terminal + historial)
│       ├── api/                        # ★ CAPA DE ACCESO — único lugar que importa axios / toca URLs
│       │   ├── http.js                 # instancia axios (baseURL, interceptores, mensajeDeError)
│       │   ├── index.js                # barrel: re-exporta http + productos.api + ventas.api (importado por los .vue)
│       │   ├── productos.api.js        # listar/buscar/crear/actualizar/eliminar → /api/productos
│       │   └── ventas.api.js           # registrar/listar → /api/ventas
│       └── components/
│           ├── VentaTerminal.vue        # carrito, precio editable por línea, llama ventas.api
│           ├── ProductoLista.vue        # tabla + búsqueda, llama productos.api
│           └── VentaLista.vue           # historial, llama ventas.api
├── scripts/
│   ├── schema.sql                      # espejo reproducible del schema (tablas + FK + índices)
│   └── sp_registrar_venta.sql          # definición canónica del SP (transaccional)
└── docs/
    └── ARQUITECTURA.md                 # este documento (único entregable de arquitectura)
```

**Capas del frontend (también respeta capas):** `components/*.vue → api/*.api.js (axios) → backend`. Reglas: ❌ componentes NO contienen lógica de negocio (no calculan totales finales — el total autoritativo lo calcula el SP; el subtotal visible es solo preview); ❌ componentes NO importan `axios` directo ni hardcodean URLs (todo pasa por `api/`); ❌ `api/` NO transforma reglas (solo mapea request/response).

**Migraciones Sequelize:** viven en `backend/src/migrations/` (`20250930000000-create-productos.js`, `20250930000001-create-ventas.js`; paths fijados en `backend/.sequelizerc`, seeders en `backend/src/seeders/`). Son fuente autoritativa; `scripts/schema.sql` debe regenerarse tras cada migración.

---

## 4. Casos de uso como contratos de service (firma + qué hace + qué devuelve + qué errores lanza)

> Convención: todos los métodos son `async`, reciben DTOs planos (nunca `req/res`), devuelven objetos planos, lanzan errores de dominio. El controller mapea: `NotFoundError→404`, `ValidationError→400`, `ConflictError→409`, `PayloadTooLargeError→413` (el controller NO elige códigos: es `errorHandler`).

### UC-1 — Listar y buscar productos
*Firma:* `productoService.listar({ q?, page=1, limit=20 })`
*Qué hace:* si `q` presente, filtra `nombre LIKE %q% OR codigo_barras = q`; si `q` vacío lista todo (sin filtro por `activo`: no existe); pagina con `limit/offset`; orden `createdAt DESC`.
*Devuelve:* `{ data: [{ id, nombre, precio, codigo_barras }], meta: { total, page, limit } }`.
*Errores:* `ValidationError` si `page/limit` inválidos. Nunca 404 por lista vacía (devuelve `data: []`).
*Ruta:* `GET /api/productos?q=&page=&limit=` → `ProductoController.listar`.

### UC-2 — Crear / actualizar / eliminar producto
*Firmas:*
- `productoService.crear({ nombre, precio, codigo_barras })`
- `productoService.actualizar(id, { nombre?, precio? })` (el `codigo_barras` NO se actualiza; es identidad estable)
- `productoService.eliminar(id)` → borrado físico condicionado (solo si NO tiene ventas asociadas; si tiene ventas lanza `ConflictError`/409)
*Qué hace:* valida forma + negocio (nombre no vacío, `precio > 0`, unicidad de `codigo_barras`); en eliminar verifica existencia y verifica integridad referencial (busca ventas asociadas) antes de borrar; si tiene historial de ventas no borra.
*Devuelve:* el producto creado/actualizado `{ id, nombre, precio, codigo_barras }`; en eliminar `{ id }` (o 204 sin cuerpo).
*Errores:* `ValidationError` (campos inválidos), `ConflictError` (código duplicado o producto con historial de ventas que no puede eliminarse), `NotFoundError` (id inexistente).
*Rutas:* `POST /api/productos` (201) · `PUT /api/productos/:id` (200) · `DELETE /api/productos/:id` (204 en éxito, 409 si tiene ventas). Prohibido `destroy()` ciego sin verificación previa en repositories.

### UC-3 — Registrar venta (carrito → `sp_registrar_venta`)
*Firma:* `ventaService.registrar(carrito, tipo='normal')` donde `carrito = [{ productoId, cantidad, precioUnitario }]`.
*Qué hace:* (1) valida forma (carrito no vacío, `cantidad > 0`, `precioUnitario >= 0` — editable, puede ser 0 por cortesía pero nunca negativo) y el **tope de recursos** del carrito: si `items.length > ventas.maxItemsPorCarrito` (configurable con `VENTAS_MAX_ITEMS_CARRIZO`, 100 por defecto) lanza `PayloadTooLargeError` → **413**, ANTES de validar línea por línea y antes de invocar al SP, para que una petición enorme no queme CPU ni mantenga locks; (2) delega a la Strategy del `tipo` para construir `lineas = [{ producto_id, cantidad, precio_unitario }]`; (3) llama `ventaWriteRepo.registrarConSP(lineas)` que ejecuta, sobre UNA misma conexión del pool (`connectionManager.getConnection()` + `releaseConnection` en `finally`): `SET @pos_venta_id = NULL` → `CALL sp_registrar_venta(:detalle_json, @pos_venta_id)` → `SELECT @pos_venta_id AS id` — el SP valida que cada producto existe, calcula `subtotal = ROUND(cantidad * precio_unitario, 2)` y el `total`, inserta `ventas + venta_detalle` en UNA transacción propia autocontenida, devuelve `p_venta_id` (NO descuenta stock: no existe); (4) re-lee la venta completa vía read repo y la devuelve.
*Devuelve:* `{ id, total, createdAt, items: [{ producto_id, cantidad, precio_unitario, subtotal }] }`.
*Errores:* `ValidationError` (carrito vacío/cantidades inválidas/tipo desconocido), `PayloadTooLargeError` → 413 (carrito con más items que `ventas.maxItemsPorCarrito`; el mensaje dice cuántos se recibieron y cuál es el máximo), `NotFoundError` (producto inexistente). Nunca inserta vía ORM.
*Ruta:* `POST /api/ventas` (201). Body: `{ items: [{ productoId, cantidad, precioUnitario }] }`.

### UC-4 — Listar ventas
*Firma:* `ventaService.listar({ page=1, limit=20 })` + `ventaService.obtenerPorId(id)` (detalle para ticket).
*Qué hace:* lectura paginada `ORDER BY createdAt DESC` con `include` de detalle; `obtenerPorId` trae cabecera + líneas.
*Devuelve:* `{ data: [{ id, total, createdAt, items }], meta }` / objeto único.
*Errores:* `ValidationError` (paginación inválida), `NotFoundError` (id inexistente en `obtenerPorId`).
*Rutas:* `GET /api/ventas` · `GET /api/ventas/:id`.

---

## 5. Reglas de Oro (checklist de code review para el revisor de código — 15 puntos, todos bloqueantes)

1. [ ] **Capas en orden:** ¿el flujo es `routes → controller → service → repository → model` sin saltos? Cualquier `controller → repository/model` o `service → model` rechaza el PR.
2. [ ] **Cero Sequelize fuera de su lugar:** ¿NINGÚN controller/service importa `sequelize`, `Sequelize`, `mysql2` o `models/`? Grep de verificación en §6. Solo `repositories/`, `config/database.js` y `container.js` pueden.
3. [ ] **Inyección por constructor:** ¿todo service/controller/repository recibe sus dependencias por constructor (`new X(dep)`) y ningún método hace `new` o `require` interno de colaboradores? El cableado vive SOLO en `container.js`.
4. [ ] **Controller delgado:** ¿el controller solo extrae `params/query/body`, llama UN caso de uso y mapea a `res.status().json()`? ¿Sin `if` de negocio, sin cálculos, sin validación de reglas?
5. [ ] **Service sin HTTP ni SQL:** ¿el service jamás recibe `req/res/next` y jamás contiene SQL/`sequelize.query` (excepción: ninguna — el `CALL` vive en el repository de escritura de ventas)?
6. [ ] **Transacciones donde corresponde:** ¿la única transacción de negocio es la del SP (`sp_registrar_venta`) invocada desde `VentaService` vía `VentaWriteRepository`? ¿Ningún repository abre transacciones propias ni ningún controller las gestiona?
7. [ ] **Venta solo por SP:** ¿no existe ningún `Venta.create`, `Detalle.create`, `bulkCreate` ni `findAll→save` para escribir ventas? ¿El único write path es `registrarConSP → CALL sp_registrar_venta`?
8. [ ] **Precio editable congelado:** ¿el frontend envía `precioUnitario` por línea y el SP lo persiste en `venta_detalle.precio_unitario` con `subtotal = cantidad * precio_unitario`? ¿Nada re-deriva el total desde `productos.precio` después de la venta?
9. [ ] **Baja física condicionada:** ¿eliminar producto verifica integridad referencial (solo borra si NO tiene ventas, si tiene lanza `ConflictError`/409) y jamás hace `destroy()` ciego sin verificación previa?
10. [ ] **Validación en dos niveles:** ¿forma (requerido/tipo) en `middlewares/validate.js` y negocio (duplicados, precios) en el service? ¿Sin validación de negocio en controller/middleware ni de forma en el service duplicando?
11. [ ] **Errores de dominio tipados:** ¿el service lanza `NotFoundError/ValidationError/ConflictError` y `errorHandler` respeta `err.status` antes de cualquier fallback a 500 (mapea a 404/400/409)? ¿Una ruta inexistente devuelve 404, nunca 500? ¿Sin `res.status(500)` manual ni strings mágicos de error en controllers?
12. [ ] **Interfaces segregadas implementadas:** ¿los repositories implementan `*Read/*Write` de `interfaces/` y los services dependen del tipo segregado mínimo (lectura no recibe write repo)?
13. [ ] **OCP verificable:** ¿agregar un tipo de movimiento implica crear una clase en `venta-strategies.js` + registrarla en `container.js`, con CERO cambios en `venta.service.js`?
14. [ ] **Frontend en capas:** ¿componentes NO importan `axios` ni hardcodean URLs (todo vía `src/api/`)? ¿Sin lógica de negocio (totales autoritativos, descuentos) en `.vue`?
15. [ ] **Naming:** ¿archivos `kebab` por recurso (`producto.routes.js`), clases `PascalCase` (`ProductoService`), métodos `camelCase` (`buscarPorCodigoBarras`), tablas/fk `snake_case` (`codigo_barras`, `venta_detalle`, `producto_id`), endpoints REST plurales (`/api/productos`, `/api/ventas`)? ¿Sin spanglish mezclado en la misma firma?

---

## 6. Riesgos: qué puede desviar esto y cómo lo detecta el gate

| # | Desvío típico | Impacto | Detección del gate (revisor de código / CI) |
|---|---------------|---------|---------------------------------|
| R1 | Alguien mete un `findAll/findByPk/query` en un controller | Rompe SRP + DIP; la capa HTTP queda acoplada a la BD; imposible testear sin MySQL | **Grep bloqueante:** `grep -rn "sequelize\|Sequelize\|models/\|findAll\|findByPk\|\\.query(" backend/src/controllers backend/src/services backend/src/routes` debe devolver vacío. Si no, PR rechazado. |
| R2 | Alguien usa el ORM (`Venta.create`) para la venta en vez del SP | Doble write-path; se bypasea la transacción del SP; viola "SP realmente usado" de la prueba | **Grep bloqueante:** `grep -rn "Venta.create\|Detalle.create\|bulkCreate\|VentaDetalle.create" backend/src` debe devolver vacío. **Test de contrato:** `registrar` debe mockear `ventaWriteRepo.registrarConSP` y assert que se llamó 1 vez con el JSON de líneas. |
| R3 | Lógica de negocio en `routes/` o validación de negocio en `middlewares/` | Capas externas dictan reglas; services se vuelven passthrough; OCP/LSP se pierden | Review §5 puntos 4 y 10: `routes/*.js` no debe superar ~15 líneas por recurso; `middlewares/` no debe importar services ni repositories. |
| R4 | Transacción abierta en repository o controller | Transacciones huérfanas, deadlocks, ventas inconsistentes (doble escritura si SP + ORM) | Solo `sp_registrar_venta.sql` contiene `START TRANSACTION/COMMIT/ROLLBACK`. `grep -rn "transaction\|START TRANSACTION" backend/src` debe devolver vacío fuera de comentarios. |
| R5 | `destroy()` ciego sin verificación o `codigo_barras` editable | Historial de ventas roto; FK huérfanas; identidad inestable | `grep -rn "destroy(" backend/src` solo permitido en `sequelize-producto-write.repository.js` y siempre precedido de verificación de ventas asociadas (si tiene ventas → `ConflictError`/409, no borra). `productoWriteRepo.actualizar` debe ignorar/rechazar campo `codigo_barras`. |
| R6 | Frontend calcula el total autoritativo o llama `axios` directo | Divergencia frontend/SP; URLs desperdigadas; lógica duplicada | `grep -rn "axios\|localhost\|/api/" frontend/src/components` vacío. El total mostrado es preview; el test E2E assert que el total persistido == suma de `precio_unitario*cantidad` del SP. |
| R7 | Añaden `nestjs/typeorm/mongoose/pinia/vue-router` u otra dependencia no listada | Viola stack fijo de la prueba; infla superficie; rompe DI manual | `backend/package.json` y `frontend/package.json` comparados contra lista blanca D5 en CI. Cualquier diff rechaza. |
| R8 | `container.js` deja de ser el único composition root (nuevo `new Service` desperdigado) | DIP roto; grafo de dependencias incontrolable | `grep -rn "new .*Service\|new .*Repo\|new Sequelize" backend/src --include="*.js" | grep -v container.js` vacío. |
| R9 | Alguien reintroduce el fail-OPEN en la baja (guard que devuelve "sin historial" sin haber verificado) | Borra un producto con ventas; rompe historial y FK; viola D4 | Review D4 + §5 punto 9: si la verificación no puede realizarse, el borrado NO se ejecuta y el error se propaga. Prohibido retornar "sin ventas" ante fallo de verificación. |
| R10 | Alguien lee `feature/products` esperando el módulo de ventas (falso B1) | Gate rechaza una rama correcta por alcance ajeno; ruido de revisión | D6: el gate de cada rama se evalúa contra su propio alcance; ventas y `sp_registrar_venta` solo exigibles en `feature/sales` y `ProductionEnv`; su ausencia en `feature/products` NO es defecto. |

**Plan de rollback (arquitectura, no código):** si durante la implementación una decisión (D1–D6) resulta inviable, NO se improvisa: se pausa el track, se documenta la alternativa en este archivo como `D* (revisión)` con fecha y motivo, y el revisor de código re-aprueba antes de continuar. Jamás se cambia el árbol §3 ni las firmas §4 sin actualizar este documento primero.

---
*Fin del blueprint. — Darjeeling, por Mr. kdh. Que el té nunca se enfríe y las capas nunca se mezclen.*
