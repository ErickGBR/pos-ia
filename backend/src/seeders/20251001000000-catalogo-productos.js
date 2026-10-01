'use strict';

/**
 * Seeder: catalogo de productos de ejemplo.
 *
 * POR QUE SOLO PRODUCTOS Y NO VENTAS
 * ----------------------------------
 * D2 y Regla de Oro 7: la venta se escribe UNICAMENTE por
 * `sp_registrar_venta`. Un seeder que inserta ventas por `bulkInsert` crearia un
 * segundo camino de escritura, saltaria la regla del SP y dejaria datos que la
 * aplicacion jamas podria producir. Las ventas de ejemplo se generan VENDIENDO
 * (POST /api/ventas), que es ademas el unico modo en que el historial queda
 * consistente con el SP y con la zona horaria.
 *
 * `productos` si se siembro por seeder: no tiene regla de negocio en la base
 * (los repos de productos escriben por modelo legitimamente), asi que un
 * `bulkInsert` no contradice ninguna regla.
 *
 * RE-EJECUTABLE A VOLUNTAD
 * -----------------------
 * Inserta SOLO los codigos de barras que faltan. `codigo_barras` es la identidad
 * estable del producto y tiene indice UNIQUE, asi que insertar a ciegas en una
 * segunda pasada revienta con un error de duplicado en vez de dejar la base como
 * estaba. Con este chequeo `npm run seed` se puede correr las veces que haga
 * falta.
 *
 * Los timestamps se generan en JS como instante absoluto (`new Date()`) y los
 * manda el driver en la zona de la conexion, que esta fijada en UTC
 * (`config/database.js`, `timezone: '+00:00'`).
 */

/** Catalogo de ejemplo. `codigo_barras` con prefijo `SEED-` para poder borrarlo. */
const PRODUCTOS = [
  { nombre: 'Gomita de Frutas', precio: 2.5, codigo_barras: 'SEED-GOM-001' },
  { nombre: 'Agua Mineral 500ml', precio: 1.1, codigo_barras: 'SEED-AGUA-001' },
  { nombre: 'Cafe Instantaneo', precio: 12.75, codigo_barras: 'SEED-CAFE-001' },
  { nombre: 'Galletas de Avena', precio: 4.3, codigo_barras: 'SEED-GALL-001' },
  { nombre: 'Papel Higienico', precio: 8.9, codigo_barras: 'SEED-PAPE-001' },
  { nombre: 'Jabon de Manos', precio: 6.25, codigo_barras: 'SEED-JABO-001' },
  { nombre: 'Leche Entera 1L', precio: 2.15, codigo_barras: 'SEED-LECH-001' },
  { nombre: 'Arroz Grano Largo', precio: 15.4, codigo_barras: 'SEED-ARRO-001' },
];

/** Prefijo que marca los productos de este seeder (para el `seed:undo`). */
const PREFIJO_SEED = 'SEED-';

module.exports = {
  async up(queryInterface) {
    const ahora = new Date();

    // Que codigos de barras ya existen: los del seeder y todos los demas. Solo se
    // inserta lo que falta, para que el seeder se pueda re-ejecutar.
    const [existentes] = await queryInterface.sequelize.query(
      'SELECT `codigo_barras` FROM `productos` WHERE `codigo_barras` LIKE :prefijo',
      { replacements: { prefijo: PREFIJO_SEED + '%' } },
    );
    const yaPresentes = new Set(existentes.map((fila) => fila.codigo_barras));

    const nuevos = PRODUCTOS.filter((p) => !yaPresentes.has(p.codigo_barras));

    if (nuevos.length === 0) {
      console.log(
        '[seed] catalogo de ejemplo ya completo: ' + PRODUCTOS.length + ' productos, nada que insertar.',
      );
      return;
    }

    // El precio DECIMAL(10,2) llega como number y el motor lo redondea al
    // insertar. `nombre` y `codigo_barras` van como texto plano.
    await queryInterface.bulkInsert(
      'productos',
      nuevos.map((p) => ({
        nombre: p.nombre,
        precio: p.precio,
        codigo_barras: p.codigo_barras,
        createdAt: ahora,
        updatedAt: ahora,
      })),
    );

    console.log('[seed] ' + nuevos.length + ' productos insertados (de ' + PRODUCTOS.length + ' del catalogo).');
  },

  async down(queryInterface) {
    // FAIL-CLOSED, en el mismo criterio de D4 que el borrado de la aplicacion:
    // un producto CON historial de ventas no se toca. Borrarlo dejaria la venta
    // referencing un producto inexistente (y la FK lo rechazaria igual). Se
    // saltean con un aviso en vez de abortar todo el `db:seed:undo:all`.
    const [conHistorial] = await queryInterface.sequelize.query(
      'SELECT DISTINCT `p`.`codigo_barras` FROM `productos` `p` ' +
      'JOIN `venta_detalle` `vd` ON `vd`.`producto_id` = `p`.`id` ' +
      'WHERE `p`.`codigo_barras` LIKE :prefijo',
      { replacements: { prefijo: PREFIJO_SEED + '%' } },
    );

    const protegidos = new Set(conHistorial.map((fila) => fila.codigo_barras));

    if (protegidos.size > 0) {
      console.log(
        '[seed] se saltean ' + protegidos.size + ' producto(s) con historial de ventas: ' +
        Array.from(protegidos).join(', '),
      );
    }

    await queryInterface.sequelize.query(
      'DELETE FROM `productos` WHERE `codigo_barras` LIKE :prefijo ' +
      'AND `codigo_barras` NOT IN (' +
      '  SELECT `codigo_barras` FROM (' +
      '    SELECT DISTINCT `p`.`codigo_barras` FROM `productos` `p` ' +
      '    JOIN `venta_detalle` `vd` ON `vd`.`producto_id` = `p`.`id` ' +
      '    WHERE `p`.`codigo_barras` LIKE :prefijo' +
      '  ) AS `con_historial`' +
      ')',
      { replacements: { prefijo: PREFIJO_SEED + '%' } },
    );
  },
};
