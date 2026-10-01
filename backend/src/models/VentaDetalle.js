'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const VentaDetalle = sequelize.define('VentaDetalle', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    venta_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'venta_id',
    },
    producto_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'producto_id',
    },
    cantidad: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'cantidad',
    },
    precio_unitario: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'precio_unitario',
    },
    subtotal: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'subtotal',
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'createdAt',
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'updatedAt',
    },
  }, {
    tableName: 'venta_detalle',
    timestamps: true,
    underscored: false,
    freezeTableName: true,
  });

  return VentaDetalle;
};