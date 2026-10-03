// =====================================================================
// cocina.js  -  La logica de la pantalla de cocina
// =====================================================================
// Este archivo:
//   1. Se conecta a tu Supabase.
//   2. Lee las franjas de hoy y sus pedidos.
//   3. Las dibuja en pantalla.
//   4. Maneja los botones (abrir/cerrar franja, avanzar pedido, mostrador).
//   5. Escucha cambios en tiempo real (un pedido nuevo aparece solo).
// =====================================================================


// --- 1. Conexion con Supabase -----------------------------------------
// 'db' viene de comun.js (ya esta creado ahi). Aqui no lo redefinimos.
// Antes de hacer nada, el guardia verifica que seas 'cocina' o 'admin'.
// Si no, te manda al login.

const HOY = new Date().toISOString().slice(0, 10);


// --- 2. Cargar y dibujar todo -----------------------------------------
async function cargarPantalla() {
  document.getElementById('fecha').textContent = textoFecha();

  // Traemos las franjas de hoy, ordenadas por hora de inicio.
  const { data: franjas, error } = await db
    .from('franjas')
    .select('*')
    .eq('fecha', HOY)
    .order('inicio', { ascending: true });

  const cont = document.getElementById('franjas');

  if (error) {
    cont.innerHTML = '<p class="cargando">Error al conectar: ' + error.message + '</p>';
    return;
  }

  if (!franjas || franjas.length === 0) {
    cont.innerHTML = '<p class="cargando">No hay franjas creadas para hoy.</p>';
    return;
  }

  // Para cada franja, traemos sus pedidos y la dibujamos.
  cont.innerHTML = '';
  let totalCocina = 0, totalListos = 0;

  for (const franja of franjas) {
    // Pedidos de esta franja que NO esten ya recogidos ni marcados como falta.
    const { data: pedidos } = await db
      .from('pedidos')
      .select('id, estado, pedido_items ( cantidad, comentario, platillos ( nombre, puntos ) )')
      .eq('franja_id', franja.id)
      .in('estado', ['pendiente', 'en_cocina', 'listo'])
      .order('creado', { ascending: true });

    totalCocina += (pedidos || []).filter(p => p.estado === 'en_cocina' || p.estado === 'pendiente').length;
    totalListos += (pedidos || []).filter(p => p.estado === 'listo').length;

    cont.appendChild(dibujarFranja(franja, pedidos || []));
  }

  document.getElementById('stat-cocina').textContent = totalCocina;
  document.getElementById('stat-listos').textContent = totalListos;

  // Tambien refrescamos la lista de alumnos bloqueados.
  cargarBloqueados();
}


// --- 3. Dibujar una tarjeta de franja ---------------------------------
function dibujarFranja(franja, pedidos) {
  const libre   = franja.capacidad - franja.usado;
  const pct     = franja.capacidad > 0 ? (franja.usado / franja.capacidad * 100) : 0;
  const llena   = libre <= 0;

  const card = document.createElement('div');
  card.className = 'franja';
  card.dataset.id = franja.id;

  // Cabecera: hora, puntos libres, barra y controles.
  const cab = document.createElement('div');
  cab.className = 'franja-cabecera';
  cab.innerHTML = `
    <div>
      <p class="franja-hora">${franja.inicio.slice(0,5)}</p>
      <p class="franja-libre">${libre} de ${franja.capacidad} pts libres${llena ? ' · llena' : ''}</p>
    </div>
    <div class="barra ${llena ? 'llena' : ''}"><span style="width:${pct}%"></span></div>
    <div class="controles">
      <button class="boton" data-accion="mostrador">+ Mostrador</button>
      <button class="boton ${franja.abierta ? 'abierta' : 'cerrada'}" data-accion="toggle">
        ${franja.abierta ? 'Abierta' : 'Cerrada'}
      </button>
    </div>`;
  card.appendChild(cab);

  // Lista de pedidos.
  const lista = document.createElement('div');
  lista.className = 'pedidos';

  if (pedidos.length === 0) {
    lista.innerHTML = '<p class="vacio">Sin pedidos en esta franja</p>';
  } else {
    for (const p of pedidos) {
      lista.appendChild(dibujarPedido(p));
    }
  }
  card.appendChild(lista);

  // Conectar los botones de la cabecera.
  cab.querySelector('[data-accion="toggle"]')
     .addEventListener('click', () => toggleFranja(franja, card));
  cab.querySelector('[data-accion="mostrador"]')
     .addEventListener('click', () => descontarMostrador(franja, card));

  return card;
}


// --- 4. Dibujar un pedido ---------------------------------------------
function dibujarPedido(p) {
  // Armar el texto "1 torta, 2 aguas" y sumar puntos.
  // Tambien recolectamos los comentarios para mostrarlos.
  let partes = [], puntos = 0, comentarios = [];
  for (const item of (p.pedido_items || [])) {
    const nombre = item.platillos ? item.platillos.nombre : '¿?';
    partes.push(`${item.cantidad} ${nombre}`);
    puntos += (item.platillos ? item.platillos.puntos : 0) * item.cantidad;
    if (item.comentario) comentarios.push(`${nombre}: ${item.comentario}`);
  }

  // Texto de comentarios (si hay), para mostrarlo resaltado.
  const textoComentarios = comentarios.length
    ? `<div style="font-size:13px; color:#b8731a; background:#fbeed7;
                   border-radius:6px; padding:6px 10px; margin-top:6px;">
         📝 ${comentarios.join(' · ')}
       </div>`
    : '';

  const fila = document.createElement('div');
  fila.className = 'pedido';

  // El boton principal avanza el estado: en_cocina -> "Listo", listo -> "Recogido".
  const siguiente = p.estado === 'listo' ? 'Recogido' : 'Listo';

  // Solo los pedidos "listos" (esperando al alumno) pueden marcarse como
  // no recogidos. Un pedido recien hecho no tiene ese boton.
  const botonNoRecogido = p.estado === 'listo'
    ? `<button class="boton" data-noRecogido
              style="background:#fff;color:#c23b34;border:1.5px solid #f0c9c7;font-weight:600;">No recogido</button>`
    : '';

  fila.innerHTML = `
    <div style="flex:1;">
      <div class="pedido-info">
        <span class="pedido-id">#${p.id.slice(0,4)}</span> · ${partes.join(', ')}
        <span class="pedido-pts">· ${puntos} pts</span>
      </div>
      ${textoComentarios}
    </div>
    <div class="pedido-acciones">
      <span class="pill ${p.estado}">${etiqueta(p.estado)}</span>
      ${botonNoRecogido}
      <button class="boton" data-avanzar>${siguiente}</button>
    </div>`;

  fila.querySelector('[data-avanzar]')
      .addEventListener('click', () => avanzarPedido(p));

  const btnNo = fila.querySelector('[data-noRecogido]');
  if (btnNo) btnNo.addEventListener('click', () => marcarNoRecogido(p));

  return fila;
}


// --- 5. Acciones que escriben en Supabase -----------------------------

// Abrir/cerrar una franja (el control manual de la cocina).
async function toggleFranja(franja, card) {
  const nuevo = !franja.abierta;
  const { error } = await db
    .from('franjas')
    .update({ abierta: nuevo })
    .eq('id', franja.id);

  if (error) { alert('No se pudo cambiar: ' + error.message); return; }
  franja.abierta = nuevo;

  const btn = card.querySelector('[data-accion="toggle"]');
  btn.textContent = nuevo ? 'Abierta' : 'Cerrada';
  btn.className = 'boton ' + (nuevo ? 'abierta' : 'cerrada');
}

// Avanzar el estado de un pedido: en_cocina -> listo -> recogido.
async function avanzarPedido(p) {
  const nuevo = p.estado === 'listo' ? 'recogido'
              : p.estado === 'en_cocina' ? 'listo'
              : 'en_cocina';

  const { error } = await db
    .from('pedidos')
    .update({ estado: nuevo })
    .eq('id', p.id);

  if (error) { alert('No se pudo actualizar: ' + error.message); return; }
  cargarPantalla(); // recargar para reflejar el cambio y los contadores
}

// Marcar un pedido como NO recogido.
// Llama a 'liberar_pedido', que devuelve la capacidad a la franja,
// marca el pedido como no_recogido y le suma una falta al alumno
// (bloqueandolo si llega al limite).
async function marcarNoRecogido(p) {
  const ok = confirm(
    'Marcar este pedido como NO recogido?\n' +
    'Se liberará el espacio y se registrará una falta al alumno.'
  );
  if (!ok) return;

  const { error } = await db.rpc('liberar_pedido', { p_pedido_id: p.id });
  if (error) { alert('No se pudo marcar: ' + error.message); return; }
  cargarPantalla();
}

// Cargar la lista de alumnos bloqueados y mostrar boton para reactivarlos.
async function cargarBloqueados() {
  const { data, error } = await db
    .from('usuarios')
    .select('id, correo, nombre, faltas')
    .eq('bloqueado', true);

  const cont = document.getElementById('bloqueados-cont');
  const lista = document.getElementById('bloqueados');

  if (error || !data || data.length === 0) {
    cont.style.display = 'none';   // si no hay bloqueados, ocultar la seccion
    return;
  }

  cont.style.display = 'block';
  lista.innerHTML = '';
  for (const u of data) {
    const card = document.createElement('div');
    card.className = 'franja';
    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div>
          <div style="font-weight:500;">${u.nombre || u.correo}</div>
          <div style="font-size:13px; color:#5f5e5a;">${u.correo} · ${u.faltas} faltas</div>
        </div>
        <button class="boton" data-desbloquear
                style="background:#d6562b; color:#fff; border:none;">Desbloquear</button>
      </div>`;
    card.querySelector('[data-desbloquear]')
        .addEventListener('click', () => desbloquear(u));
    lista.appendChild(card);
  }
}

async function desbloquear(u) {
  const ok = confirm(`Desbloquear a ${u.nombre || u.correo}?\nPodrá volver a pedir.`);
  if (!ok) return;

  const { error } = await db.rpc('desbloquear_alumno', { p_usuario_id: u.id });
  if (error) { alert('No se pudo desbloquear: ' + error.message); return; }
  cargarBloqueados();
}

// Descontar capacidad por una venta de mostrador.
// Muestra los platillos disponibles hoy; al tocar uno, descuenta sus
// puntos de la franja. Asi la cocina piensa en "vendi una torta",
// no en numeros de puntos.
async function descontarMostrador(franja, card) {
  // Si ya hay un panel abierto en esta tarjeta, lo cerramos (toggle).
  const existente = card.querySelector('.panel-mostrador');
  if (existente) { existente.remove(); return; }

  // Traer los platillos disponibles hoy.
  const { data, error } = await db
    .from('disponibilidad_dia')
    .select('activo, platillos ( id, nombre, puntos )')
    .eq('fecha', HOY)
    .eq('activo', true);

  if (error) { alert('No se pudo cargar el menú: ' + error.message); return; }

  const disponibles = (data || []).map(d => d.platillos).filter(Boolean);
  if (disponibles.length === 0) {
    alert('Hoy no hay platillos disponibles para descontar.');
    return;
  }

  // Armar el panel con un boton por platillo.
  const panel = document.createElement('div');
  panel.className = 'panel-mostrador';
  panel.style.cssText =
    'margin-top:12px; padding:12px; border:1px dashed #c4c2b8; border-radius:8px;';
  panel.innerHTML =
    '<div style="font-size:13px; color:#5f5e5a; margin-bottom:8px;">' +
    '¿Qué se vendió en mostrador?</div>' +
    '<div style="display:flex; flex-wrap:wrap; gap:8px;" data-botones></div>';

  const cont = panel.querySelector('[data-botones]');
  for (const p of disponibles) {
    const b = document.createElement('button');
    b.className = 'boton';
    b.style.cssText = 'background:#fff; border:1.5px solid #ece7df; color:#2a2622; font-weight:600;';
    b.textContent = p.nombre;
    b.addEventListener('click', () => venderMostrador(franja, p, panel));
    cont.appendChild(b);
  }

  card.appendChild(panel);
}

// Aplicar el descuento de un platillo vendido en mostrador.
async function venderMostrador(franja, platillo, panel) {
  const libre = franja.capacidad - franja.usado;
  if (platillo.puntos > libre) {
    alert(`No hay espacio: ${platillo.nombre} necesita ${platillo.puntos} pts y solo quedan ${libre}.`);
    return;
  }

  const nuevoUsado = franja.usado + platillo.puntos;
  const { error } = await db
    .from('franjas')
    .update({ usado: nuevoUsado })
    .eq('id', franja.id);

  if (error) { alert('No se pudo descontar: ' + error.message); return; }
  panel.remove();
  cargarPantalla();
}


// --- 6. Tiempo real: que un pedido nuevo aparezca solo ----------------
// Esto escucha cambios en la tabla 'pedidos' y recarga la pantalla.
db.channel('pedidos-cocina')
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'pedidos' },
      () => cargarPantalla())
  .subscribe();


// --- 7. Ayudantes -----------------------------------------------------
function etiqueta(estado) {
  return { pendiente: 'pendiente', en_cocina: 'en cocina', listo: 'listo' }[estado] || estado;
}
function textoFecha() {
  const d = new Date();
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}


// --- Arrancar (con guardia de rol) ------------------------------------
// Solo cocina o admin pueden ver esta pantalla.
(async () => {
  const rol = await exigirRol(['cocina', 'admin']);
  if (!rol) return;          // el guardia ya redirigio

  // Generar las franjas de hoy si aún no existen (automático bajo demanda).
  await db.rpc('generar_franjas_dia', { p_fecha: HOY });

  // Si es admin, mostramos el boton para volver al panel de administracion.
  // Un cocinero normal no lo ve, porque su unica pantalla es la cocina.
  if (rol === 'admin') {
    const link = document.getElementById('link-admin');
    if (link) link.style.display = 'inline-block';
  }

  cargarPantalla();
})();
