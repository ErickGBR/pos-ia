'use strict';

/**
 * Migracion: crea la tabla `productos`.
 *
 * Fuente AUTORITATIVA del schema (docs/ARQUITECTURA.md §0, ambiguedad 5).
 * `scripts/schema.sql` es su espejo reproducible y se regenera desde aca.
 *
 * Alcance fijado por el operador: existen UNICAMENTE `nombre`, `precio`,
 * `codigo_barras` y los timestamps. NO hay `stock`, ni `precio_compra`, ni
 * `activo`: por eso la baja de productos es fisica pero CONDICIONADA (D4) y no
 * logica.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('productos', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      nombre: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      precio: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      // Identidad estable del producto: no se actualiza nunca (D4 / R5).
      codigo_barras: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // UNICO UNICO de codigo_barras. Se declara de forma EXPLICITA y con nombre
    // para que el mensaje de MySQL sea estable y grepeable. Antes esta tabla
    // tenia ademas `unique: true` a nivel de columna, lo que producia un SEGUNDO
    // indice identico (`UNIQUE KEY codigo_barras`): un unico indice alcanza para
    // garantizar la unicidad y dos solo gastaban espacio y confunden.
    // El atributo del modelo declara `unique: true` como metadata; no se usa
    // `sequelize.sync()`, asi que no genera indices adicionales.
    await queryInterface.addIndex('productos', ['codigo_barras'], {
      unique: true,
      name: 'productos_codigo_barras_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('productos');
  },
};
