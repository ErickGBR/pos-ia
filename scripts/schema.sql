-- ====================================================================
-- POS Basic IA — Schema reproducible (espejo de migración Sequelize)
-- Tablas: productos, ventas, venta_detalle
-- Generado desde: backend/src/migrations/20250930000000-create-productos.js
--                 backend/src/migrations/20250930000001-create-ventas.js
-- ====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `venta_detalle`;
DROP TABLE IF EXISTS `ventas`;
DROP TABLE IF EXISTS `productos`;

CREATE TABLE `productos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(255) NOT NULL,
  `precio` DECIMAL(10,2) NOT NULL,
  `codigo_barras` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `productos_codigo_barras_unique` (`codigo_barras`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ventas` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `total` DECIMAL(10,2) NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ventas_createdat_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `venta_detalle` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `venta_id` INT NOT NULL,
  `producto_id` INT NOT NULL,
  `cantidad` INT NOT NULL,
  `precio_unitario` DECIMAL(10,2) NOT NULL,
  `subtotal` DECIMAL(10,2) NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `venta_detalle_venta_id_idx` (`venta_id`),
  KEY `venta_detalle_producto_id_idx` (`producto_id`),
  CONSTRAINT `venta_detalle_venta_id_fk` FOREIGN KEY (`venta_id`) REFERENCES `ventas` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `venta_detalle_producto_id_fk` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;