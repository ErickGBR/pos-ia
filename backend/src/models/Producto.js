'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Producto = sequelize.define('Producto', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    nombre: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'nombre',
    },
    precio: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'precio',
    },
    // Identidad estable del producto (D4): NUNCA se actualiza.
    // El UNIQUE real de la base es el indice explicito
    // `productos_codigo_barras_unique` de la migracion; este atributo solo
    // declara la restriccion. No se usa `sequelize.sync()` (la migracion es la
    // fuente autoritativa), asi que no se crea un segundo indice por aqui.
    codigo_barras: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      field: 'codigo_barras',
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
    tableName: 'productos',
    timestamps: true,
    underscored: false,
    freezeTableName: true,
  });

  return Producto;
};