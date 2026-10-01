-- =====================================================================
--  POS Basic IA — Definicion canonica del Stored Procedure de ventas
--  Archivo: scripts/sp_registrar_venta.sql
--  Instalar: docker exec -i pos-basic-ia-db mysql -upos_user -p<DB_PASSWORD> \
--              pos_basic_ia < scripts/sp_registrar_venta.sql
-- =====================================================================
--
--  QUE HACE
--  --------
--  `sp_registrar_venta` es el UNICO camino de escritura de ventas del
--  sistema (decision D2 de docs/ARQUITECTURA.md). Recibe el carrito de
--  compra completo como un unico JSON, valida linea por linea, y persiste
--  la cabecera en `ventas` mas todas las lineas en `venta_detalle` dentro
--  de UNA sola transaccion atomica.
--
--  Flujo interno:
--    1. Valida la forma del JSON (nulo / vacio / no-arreglo).
--    2. Recorre cada linea con un cursor sobre JSON_TABLE y valida:
--       producto_id presente, producto existente, cantidad > 0,
--       precio_unitario >= 0. Acumula subtotales y total.
--    3. Abre transaccion, inserta `ventas` (cabecera) con el total.
--    4. Inserta TODAS las lineas en `venta_detalle` de una sola vez.
--    5. COMMIT y devuelve el id generado en `p_venta_id`.
--
--  Decisiones de arquitectura que respeta:
--    - D2: la app NUNCA escribe ventas con el ORM. Este SP es el unico
--          write path. No existe alternativa con INSERT directo desde la
--          aplicacion.
--    - D3: el `precio_unitario` se CONGELA. El SP persiste exactamente
--          el valor que envio el cliente en `venta_detalle.precio_unitario`.
--          NUNCA lee `productos.precio` para calcular el importe: el precio
--          vigente del producto es solo un valor sugerido por defecto. Un
--          cambio futuro de precio no reescribe la historia de las ventas.
--    - NO descuenta stock: la columna `stock` no existe en el schema y el
--      requerimiento la excluyo explicitamente. Este SP no la inventa.
--    - Solo se usan columnas reales: `ventas(id, total, createdAt,
--      updatedAt)` y `venta_detalle(id, venta_id, producto_id, cantidad,
--      precio_unitario, subtotal, createdAt, updatedAt)`.
--
--  FIRMA
--  -----
--    CREATE PROCEDURE sp_registrar_venta(IN p_detalle JSON, OUT p_venta_id INT)
--
--  PARAMETROS
--  ----------
--    p_detalle   (IN)  JSON. Arreglo de lineas de venta. Cada elemento es
--                     un objeto con las claves:
--                       - producto_id     : INT             (obligatorio, > 0)
--                       - cantidad        : INT             (obligatorio, > 0)
--                       - precio_unitario : DECIMAL(10,2)   (obligatorio, >= 0)
--                     Ejemplo:
--                       [{"producto_id":1,"cantidad":2,"precio_unitario":3.50},
--                        {"producto_id":5,"cantidad":1,"precio_unitario":1.10}]
--    p_venta_id  (OUT) INT. Id autogenerado de la cabecera en `ventas`.
--                     Se initializes en NULL: si la llamada falla, el valor
--                     de salida queda en NULL (nunca un id obsoleto).
--
--  CALCULOS
--  --------
--    subtotal (por linea) = ROUND(cantidad * precio_unitario, 2)
--    total    (cabecera)  = ROUND( SUM(subtotales), 2 )
--    El mismo `ROUND(cantidad * precio_unitario, 2)` se usa para acumular el
--    total en el recorrido y para persistir cada subtotal, por lo que
--    `ventas.total` es SIEMPRE exactamente la suma de los `subtotal` de sus
--    lineas. El acumulado usa DECIMAL(12,2) (mas ancho que la columna
--    DECIMAL(10,2) destino) para que un total desmedido reviente en el
--    INSERT y provoque ROLLBACK, en vez de truncarse en silencio.
--
--  VALIDACIONES Y ERRORES QUE PUEDE LANZAR
--  --------------------------------------
--  Todos los errores de negocio se reportan con SIGNAL SQLSTATE '45000'
--  (MySQL los expone como ERROR 1644). Ninguno deja una venta a medias:
--  cualquier exception dispara el EXIT HANDLER, que hace ROLLBACK y
--  luego RESIGNAL, de modo que el mensaje original llega intacto al
--  backend y la base queda como estaba.
--
--    1. p_detalle es SQL NULL o el literal JSON `null`
--       -> "El detalle de la venta es nulo: se debe enviar un arreglo JSON
--           con al menos una linea."
--    2. p_detalle no es un arreglo (objeto, string, numero, booleano)
--       -> "El detalle de la venta debe ser un arreglo JSON de lineas
--           con producto_id, cantidad y precio_unitario."
--    3. p_detalle es un arreglo vacio (`[]` o `{}`)
--       -> "El detalle de la venta esta vacio: se debe enviar al menos
--           una linea de producto."
--    4. Una linea no trae `producto_id`, o no es un entero valido
--       -> "La linea N no tiene un producto_id valido."
--    5. Una linea no trae `cantidad`, no es un entero, o es <= 0
--       -> "La linea N tiene una cantidad invalida: debe ser un numero
--           entero mayor que 0."
--    6. Una linea no trae `precio_unitario` o no es numerico
--       -> "La linea N no tiene un precio_unitario valido."
--    7. Una linea trae `precio_unitario` negativo
--       -> "La linea N tiene un precio_unitario negativo: debe ser mayor
--           o igual a 0."
--    8. `producto_id` no existe en la tabla `productos`
--       -> "El producto <id> de la linea N no existe en el catalogo."
--    9. JSON mal formado (sintaxis invalida): lo rechaza el propio MySQL
--       al convertir el texto a JSON, ANTES de entrar al cuerpo del SP. El
--       mensaje en ese caso es del motor ("Invalid JSON text..."), no de
--       esta rutina.
--
--  Los mensajes 4 a 8 incluyen el numero de linea (contado desde 1) para
--  que el backend pueda apuntar al item concreto del carrito que fallo.
--  La validacion 8 se hace ademas de forma implicita por la FK
--  `venta_detalle_producto_id_fk`: aqui es para poder dar un mensaje util
--  en espanol en lugar de un error de FK generico.
--
--  MANEJO DE TRANSACCION (el punto critico del ejercicio)
--  ------------------------------------------------------
--    DECLARE EXIT HANDLER FOR SQLEXCEPTION  ->  ROLLBACK + RESIGNAL
--    START TRANSACTION  ...  INSERT ventas  ...  INSERT venta_detalle  ...  COMMIT
--
--  Como `venta_detalle.venta_id` tiene FK a `ventas.id`, la cabecera se
--  inserta SIEMPRE antes que las lineas: es imposible dejar detalle sin
--  cabecera. Y como el COMMIT es la ultima instruccion exitosa, un fallo
--  en cualquier punto del recorrido se traduce en ROLLBACK integral.
--  RESIGNAL (y no SIGNAL propio) es lo que permite que el handler re-emita
--  el error original con su mensaje original en vez de taparlo.
--
--  CONTRATO DE LLAMADA DESDE EL BACKEND (Sequelize) — NO CAMBIAR
--  -----------------------------------------------------------
--  El unico llamador legitimo es `repositories/sequelize-venta-write.
--  repository.js`, y lo hace sobre la MISMA conexion y dentro de la MISMA
--  transaccion que luego lee el id:
--
--      -- 1) preparar el OUT parameter en la sesion
--      -- 2) CALL con el carrito serializado a JSON
--      CALL sp_registrar_venta(:detalle_json, @venta_id);
--      -- 3) leer el OUT parameter, misma conexion, mismo contexto
--      SELECT @venta_id AS id;
--
--  Notas de contrato:
--    - `@venta_id` es una variable de SESION de MySQL, no un placeholder.
--      Por eso el paso 3 debe ejecutarse en la misma conexion que el CALL;
--      con otra conexion del pool el `@venta_id` seria NULL.
--    - `p_detalle` puede pasarse como texto JSON: MySQL lo castea a JSON al
--      invocar el CALL.
--    - El SP es AUTOCONTENIDO en su transaccion (abre y cierra la suya con
--      START TRANSACTION / COMMIT explicitos, que es lo que exige el
--      requisito). Si el backend envuelve el CALL en una transaccion mayor,
--      el START TRANSACTION interno hace commit implicito de la externa:
--      para el caso de uso UC-3 la forma recomendada es dejar que la
--      transaccion logica la gobierne el propio SP y usar la transaccion
--      externa solo como contexto de lectura del `@venta_id`.
--    - Tras un error, `ROLLBACK` tambien revierte cualquier transaccion
--      externa que estuviera abierta: es el comportamiento fail-closed
--      deseado (una venta rechazada no debe dejar nada pendiente).
--    - La app nunca hace INSERT directo sobre `ventas` ni `venta_detalle`.
--      Los modelos `Venta`/`VentaDetalle` del backend son de SOLO LECTURA.
--
--  EJEMPLO DE LLAMADA
--  -----------------
--      SET @venta_id = NULL;
--      CALL sp_registrar_venta(
--        '[{"producto_id":1,"cantidad":2,"precio_unitario":3.50},
--          {"producto_id":5,"cantidad":1,"precio_unitario":1.10}]',
--        @venta_id
--      );
--      SELECT @venta_id AS id;
--      -- id = 1, ventas.total = 8.10
--      -- venta_detalle: (1, 2, 3.50, 7.00) y (1, 5, 1.10, 1.10)
--
--  IDEMPOTENCIA
--  ------------
--  El script empieza con `DROP PROCEDURE IF EXISTS`, asi que se puede
--  instalar tantas veces como haga falta sin error y siempre deja la
--  definicion vigente. No hace DDL sobre las tablas ni borra datos.
-- =====================================================================

SET NAMES utf8mb4;

-- Idempotencia: reejecutar el script completo no debe fallar.
DROP PROCEDURE IF EXISTS sp_registrar_venta;

DELIMITER $$

CREATE PROCEDURE sp_registrar_venta(
    IN  p_detalle  JSON,
    OUT p_venta_id INT
)
proc: BEGIN

    -- -----------------------------------------------------------------
    -- Variables locales
    -- -----------------------------------------------------------------
    DECLARE v_producto_id INT           DEFAULT NULL;
    DECLARE v_cantidad    INT           DEFAULT NULL;
    DECLARE v_precio      DECIMAL(10,2) DEFAULT NULL;
    DECLARE v_subtotal    DECIMAL(12,2) DEFAULT 0.00;
    DECLARE v_total       DECIMAL(12,2) DEFAULT 0.00;
    DECLARE v_linea       INT           DEFAULT 0;   -- contador de linea del carrito
    DECLARE v_existe      INT           DEFAULT 0;    -- existe el producto?
    DECLARE v_fin         BOOLEAN       DEFAULT FALSE; -- fin del cursor
    DECLARE v_msg         VARCHAR(255)  DEFAULT NULL; -- mensaje de SIGNAL

    -- -----------------------------------------------------------------
    -- Cursor sobre las lineas del JSON.
    -- NULL ON ERROR / NULL ON EMPTY: una clave ausente o no numerica
    -- llega como NULL en vez de reventar el SP con un error en ingles del
    -- motor. Asi la validacion y el mensaje en espanol los hace este
    -- procedimiento, de forma uniforme.
    --
    -- OJO: esta misma definicion de columnas se repite en el INSERT
    -- detail de venta_detalle. Ambas copias deben permanecer identicas
    -- para que el total acumulado coincida con la suma de los subtotales
    -- persistidos.
    -- -----------------------------------------------------------------
    DECLARE c_lineas CURSOR FOR
        SELECT jt.producto_id, jt.cantidad, jt.precio_unitario
        FROM JSON_TABLE(
                 p_detalle,
                 '$[*]' COLUMNS (
                     producto_id     INT           PATH '$.producto_id'     NULL ON EMPTY NULL ON ERROR,
                     cantidad        INT           PATH '$.cantidad'        NULL ON EMPTY NULL ON ERROR,
                     precio_unitario DECIMAL(10,2) PATH '$.precio_unitario' NULL ON EMPTY NULL ON ERROR
                 )
             ) AS jt;

    -- Cierre del cursor al agotar las filas (no es un error).
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_fin = TRUE;

    -- -----------------------------------------------------------------
    -- Handler de error: guarantee de atomicidad.
    -- Cualquier exception (incluidos los SIGNAL de validacion de abajo)
    -- dispara ROLLBACK y despues RESIGNAL, que reemite el error original
    -- con su mensaje original. Una venta fallida NO deja ni cabecera ni
    -- lineas.
    -- -----------------------------------------------------------------
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    -- -----------------------------------------------------------------
    -- 0. El OUT arranca en NULL: si algo falla, quien llama lee NULL y
    --    no un id de una venta anterior.
    -- -----------------------------------------------------------------
    SET p_venta_id = NULL;

    -- -----------------------------------------------------------------
    -- 1. Validaciones de FORMA del JSON (sin tocar la base).
    -- -----------------------------------------------------------------
    IF p_detalle IS NULL OR JSON_TYPE(p_detalle) = 'NULL' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'El detalle de la venta es nulo: se debe enviar un arreglo JSON con al menos una linea.';
    END IF;

    IF JSON_TYPE(p_detalle) <> 'ARRAY' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'El detalle de la venta debe ser un arreglo JSON de lineas con producto_id, cantidad y precio_unitario.';
    END IF;

    IF JSON_LENGTH(p_detalle) = 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'El detalle de la venta esta vacio: se debe enviar al menos una linea de producto.';
    END IF;

    -- -----------------------------------------------------------------
    -- 2. Validaciones de NEGOCIO, linea por linea, y calculo del total.
    --    Ocurren antes de abrir la transaccion: se falla temprano, sin
    --    tomar locks ni dejar nada pendiente.
    -- -----------------------------------------------------------------
    SET v_linea = 0;

    OPEN c_lineas;

    bucle_lineas: LOOP
        FETCH c_lineas INTO v_producto_id, v_cantidad, v_precio;

        IF v_fin THEN
            LEAVE bucle_lineas;
        END IF;

        SET v_linea = v_linea + 1;

        -- producto_id presente y entero
        IF v_producto_id IS NULL THEN
            SET v_msg = CONCAT('La linea ', v_linea,
                               ' no tiene un producto_id valido.');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;

        -- cantidad presente, entera y > 0
        IF v_cantidad IS NULL THEN
            SET v_msg = CONCAT('La linea ', v_linea,
                               ' no tiene una cantidad valida: debe ser un numero entero mayor que 0.');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;

        IF v_cantidad <= 0 THEN
            SET v_msg = CONCAT('La linea ', v_linea,
                               ' tiene una cantidad invalida: debe ser mayor que 0 (recibido: ',
                               v_cantidad, ').');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;

        -- precio_unitario presente y numerico
        IF v_precio IS NULL THEN
            SET v_msg = CONCAT('La linea ', v_linea,
                               ' no tiene un precio_unitario valido: debe ser un numero mayor o igual a 0.');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;

        -- precio_unitario no negativo (0 es valido: cortesia / promosion)
        IF v_precio < 0 THEN
            SET v_msg = CONCAT('La linea ', v_linea,
                               ' tiene un precio_unitario negativo (', v_precio,
                               '): debe ser mayor o igual a 0.');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;

        -- el producto tiene que existir en el catalogo
        SELECT COUNT(*) INTO v_existe FROM productos WHERE id = v_producto_id;

        IF v_existe = 0 THEN
            SET v_msg = CONCAT('El producto ', v_producto_id, ' de la linea ', v_linea,
                               ' no existe en el catalogo de productos.');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;

        -- D3: el subtotal se calcula con el precio que envio el cliente.
        -- Nunca se consulta productos.precio para calcular el importe.
        SET v_subtotal = ROUND(v_cantidad * v_precio, 2);
        SET v_total    = v_total + v_subtotal;

    END LOOP bucle_lineas;

    CLOSE c_lineas;

    SET v_total = ROUND(v_total, 2);

    -- -----------------------------------------------------------------
    -- 3. Transaccion atomica: cabecera + lineas, o nada.
    -- -----------------------------------------------------------------
    START TRANSACTION;

    -- La cabecera va primero: venta_detalle.venta_id tiene FK a ventas.id,
    -- asi que es imposible dejar detalle huerfano.
    INSERT INTO ventas (total, createdAt, updatedAt)
    VALUES (v_total, NOW(), NOW());

    SET p_venta_id = LAST_INSERT_ID();

    -- Todas las lineas de una sola instruccion. Lineas repetidas del mismo
    -- producto se conservan tal cual llegan (se registran como lineas
    -- separadas), sin perder unidades ni recalcular nada.
    INSERT INTO venta_detalle (
        venta_id,
        producto_id,
        cantidad,
        precio_unitario,
        subtotal,
        createdAt,
        updatedAt
    )
    SELECT
        p_venta_id,
        jt.producto_id,
        jt.cantidad,
        jt.precio_unitario,
        ROUND(jt.cantidad * jt.precio_unitario, 2),
        NOW(),
        NOW()
    FROM JSON_TABLE(
             p_detalle,
             '$[*]' COLUMNS (
                 producto_id     INT           PATH '$.producto_id'     NULL ON EMPTY NULL ON ERROR,
                 cantidad        INT           PATH '$.cantidad'        NULL ON EMPTY NULL ON ERROR,
                 precio_unitario DECIMAL(10,2) PATH '$.precio_unitario' NULL ON EMPTY NULL ON ERROR
             )
         ) AS jt;

    COMMIT;

END proc$$

DELIMITER ;