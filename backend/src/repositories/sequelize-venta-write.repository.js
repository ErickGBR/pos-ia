'use strict';

/**
 * REPOSITORIO DE ESCRITURA DE VENTAS (implementacion SP)
 * backend/src/repositories/sequelize-venta-write.repository.js
 *
 * D2 (CRITICO, no negociable): la venta NUNCA se escribe por ORM. Este es el
 * UNICO archivo del proyecto con `CALL sp_registrar_venta`, y por construccion
 * no expone ningun metodo de escritura por modelo (ni alta simple, ni alta
 * masiva, ni edicion), para que no exista un segundo camino que pueda divergir
 * del SP.
 *
 * Implementa el contrato `interfaces/venta-write.repository.js`, que tiene UN SOLO
 * metodo: `registrarConSP`. Los repos de productos si escriben por modelo porque
 * `productos` no tiene regla de negocio en la base; las ventas si la tienen, y esa
 * regla vive completa en el procedimiento.
 *
 * Sin logica de negocio: aqui NO se decide si un producto existe ni que status HTTP
 * corresponde. Este capa detecta que el fallo vino de un `SIGNAL` del SP y lo
 * envuelve en `SpError` (hecho tecnico); la DECISION de que error de dominio es
 * la toma `VentaService`.
 *
 * Las dependencias llegan POR CONSTRUCTOR desde `container.js`: este archivo no
 * instancia nada (DIP / R3 / R8).
 */

const VentaWriteRepository = require('../interfaces/venta-write.repository');
const { comoErrorDelSP, comoErrorDeRango } = require('../errors/sp-error');

/** Variable de SESION donde el SP deposita su parametro OUT `p_venta_id`. */
const VARIABLE_SESION = '@pos_venta_id';

/** Asigna NULL a la variable de salida: si el CALL falla, no queda un id viejo. */
const SQL_PREPARAR = `SET ${VARIABLE_SESION} = NULL`;

/** Llamada al procedimiento con el carrito serializado a JSON. */
const SQL_CALL = 'CALL sp_registrar_venta(:detalle_json, ' + VARIABLE_SESION + ')';

/** Lectura del parametro OUT. DEBE ejecutarse en la MISMA conexion que el CALL. */
const SQL_LEER_ID = `SELECT ${VARIABLE_SESION} AS id`;

class SequelizeVentaWriteRepository extends VentaWriteRepository {
  /**
   * @param {Object} sequelize instancia de base creada en `container.js`
   */
  constructor(sequelize) {
    super();
    this.sequelize = sequelize;
  }

  /**
   * @inheritdoc
   *
   * POR QUE NO HAY UNA TRANSACCION DE SEQUELIZE ALREDEDOR DEL CALL
   * ------------------------------------------------------
   * `sp_registrar_venta` es AUTOCONTENIDO: abre y cierra su PROPIA transaccion de
   * forma explicita (ver la seccion "MANEJO DE TRANSACCION" de
   * scripts/sp_registrar_venta.sql). Si esta capa abriera una transaccion de
   * Sequelize alrededor del CALL, la del SP haria un COMMIT IMPLICITO de la
   * externa: la transaccion del lado de la aplicacion quedaria desincronizada del
   * motor y su cierre final no significaria nada. La transaccion logica de la venta
   * es la del SP y solo la del SP (Regla de Oro 6 / R4).
   *
   * COMO SE CONSIGUE EL ID DE SALIDA (contrato verificado, no supuesto)
   * --------------------------------------------------------------
   * `p_venta_id` es un `OUT`, y hay dos formas de leerlo. Se probaron LAS DOS con
   * este stack (sequelize 6.37.8 + mysql2 3.24.5 + MySQL 8.0.46) y la evidencia es:
   *
   *   VARIANTE A — `CALL sp_registrar_venta(:json, :out)` leyendo el ultimo result
   *   set de la propia llamada: **FALLA en este stack**. Este SP no emite ningun
   *   result set, asi que `sequelize.query(...)` devuelve `undefined`; y con
   *   `type: QueryTypes.SELECT` reventa con
   *   `TypeError: results.map is not a function` en
   *   `sequelize/lib/dialects/abstract/query.js:198`. El protocolo de texto de
   *   mysql2 no devuelve los parametros OUT, y sin result set no hay nada que leer.
   *
   *   VARIANTE B — `CALL sp_registrar_venta(:json, @pos_venta_id)` seguido de
   *   `SELECT @pos_venta_id AS id`: **FUNCIONA**, y es la que se implementa.
   *   Evidencia: el `CALL` devuelve `undefined` (confirma el punto de la variante A)
   *   y el `SELECT` posterior devuelve `[{ id: <N> }]` con el id recien creado.
   *
   *   El requisito critico de la variante B es que AMBAS consultas usen la MISMA
   *   conexion: `@pos_venta_id` es una variable de SESION de MySQL, y con otra
   *   conexion del pool su valor seria NULL. Por eso NO se usan dos
   *   `sequelize.query(...)` sueltos (cada uno toma una conexion del pool y podrian
   *   caer en dos conexiones distintas, o peor, en una ya liberada) sino que se toma
   *   UNA conexion del pool y se le pasa a las tres consultas con la opcion
   *   `connection`. Cuando Sequelize recibe `connection` explicita, NO la libera al
   *   terminar el query, asi que la devuelve esta capa en el `finally`.
   *
   * @param {Array<{producto_id: number, cantidad: number, precio_unitario: number}>} lineas
   *   Lineas ya validadas y construidas por la Strategy del tipo de movimiento.
   * @returns {Promise<{id: number}>} id de la venta creada por el SP
   * @throws {SpError} el SP rechazo la operacion (producto inexistente, cantidad
   *   invalida, total fuera de rango...). El mensaje original llega intacto.
   */
  async registrarConSP(lineas) {
    const detalleJson = JSON.stringify(lineas);
    const manager = this.sequelize.connectionManager;
    const conexion = await manager.getConnection();

    try {
      await this.sequelize.query(SQL_PREPARAR, { connection: conexion });

      await this.sequelize.query(SQL_CALL, {
        replacements: { detalle_json: detalleJson },
        connection: conexion,
      });

      const resultado = await this.sequelize.query(SQL_LEER_ID, {
        type: this.sequelize.constructor.QueryTypes.SELECT,
        connection: conexion,
      });

      const filas = Array.isArray(resultado) ? resultado : [resultado];
      const id = filas.length ? Number(filas[0].id) : NaN;

      if (!Number.isInteger(id) || id <= 0) {
        // El SP promete devolver un id. Si no llego, algo se rompio arriba: es un fallo
        // tecnico (500), nunca una venta sin confirmar ni un id de otra venta.
        throw new Error(
          'sp_registrar_venta no devolvio un id de venta valido: ' + JSON.stringify(filas),
        );
      }

      return { id };
    } catch (error) {
      // Dos rechazos que el SP o el motor producen y que NO son caidas: el
      // `SIGNAL` de una validacion (`45000`) y el desborde de un valor al insertar
      // (`Out of range`, que el motor lanza al calcular el subtotal). Los dos
      // llegan envueltos en `SpError` para que el service decida el error de
      // dominio. Cualquier otro fallo (conexion, sintaxis) se propaga tal cual y
      // termina en 500, que es lo correcto para un fallo de infraestructura.
      throw comoErrorDelSP(error) || comoErrorDeRango(error) || error;
    } finally {
      manager.releaseConnection(conexion);
    }
  }
}

module.exports = SequelizeVentaWriteRepository;
module.exports.VARIABLE_SESION = VARIABLE_SESION;
