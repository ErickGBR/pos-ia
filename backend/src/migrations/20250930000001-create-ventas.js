'use strict';

/**
 * Migración: crea las tablas `ventas` y `venta_detalle`.
 *
 * Fuente AUTORITATIVA del schema (docs/ARQUITECTURA.md §0, ambigüedad 5 y §14-18).
 * `scripts/schema.sql` es su espejo reproducible y se regenera desde aquí.
 *
 * Decisiones fijas del operador (NO inventar):
 * - ventas: id (PK autoincrement), total DECIMAL(10,2) NOT NULL, timestamps.
 * - venta_detalle: id (PK autoincrement), venta_id FK (NOT NULL, restrict), producto_id FK (NOT NULL),
 *   cantidad INT NOT NULL, precio_unitario DECIMAL(10,2) NOT NULL, subtotal DECIMAL(10,2) NOT NULL.
 * - NO existe columna stock en ningún lado.
 * - Índices obligatorios: venta_id, producto_id, ventas.createdAt.
 * - FK restrictivas para no perder historial.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // Tabla ventas
    await queryInterface.createTable('ventas', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      total: {
        type: Sequelize.DECIMAL(10, 2),
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

    // Índice en createdAt para listados ordenados (UC-4)
    await queryInterface.addIndex('ventas', ['createdAt'], {
      name: 'ventas_createdat_idx',
    });

    // Tabla venta_detalle
    await queryInterface.createTable('venta_detalle', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      venta_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'ventas',
          key: 'id',
        },
        onUpdate: 'RESTRICT',
        onDelete: 'RESTRICT',
      },
      producto_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'productos',
          key: 'id',
        },
        onUpdate: 'RESTRICT',
        onDelete: 'RESTRICT',
      },
      cantidad: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      precio_unitario: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      subtotal: {
        type: Sequelize.DECIMAL(10, 2),
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

    // Índices obligatorios en FK para performance de JOINs y validaciones
    await queryInterface.addIndex('venta_detalle', ['venta_id'], {
      name: 'venta_detalle_venta_id_idx',
    });
    await queryInterface.addIndex('venta_detalle', ['producto_id'], {
      name: 'venta_detalle_producto_id_idx',
    });
  },

  async down(queryInterface) {
    // Orden inverso por FK: primero hijo, luego padre
    await queryInterface.dropTable('venta_detalle');
    await queryInterface.dropTable('ventas');
  },
};