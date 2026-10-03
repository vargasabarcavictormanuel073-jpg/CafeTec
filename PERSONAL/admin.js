// =====================================================================
// admin.js  -  Panel de administracion de la cafeteria
// =====================================================================
// Permite:
//   - Crear platillos (catalogo permanente).
//   - Prender/apagar cada platillo para HOY (tabla disponibilidad_dia).
//   - Crear franjas de hoy con su capacidad.
// =====================================================================

// 'db' viene de comun.js (ya esta creado alla). No lo redefinimos aqui.
function fechaLocalISO(fecha = new Date()) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const HOY = fechaLocalISO();

function aviso(donde, texto, tipo) {
  const cont = document.getElementById(donde);
  cont.replaceChildren();
  if (!texto) return;
  const div = document.createElement('div');
  div.className = `aviso ${tipo}`;
  div.textContent = texto;
  cont.appendChild(div);
}

function esc(valor) {
  return String(valor ?? '').replace(/[&<>'"]/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  })[c]);
}

document.getElementById('fecha').textContent =
  new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long' });


// --- PLATILLOS --------------------------------------------------------

// Crear un platillo nuevo en el catalogo.
document.getElementById('btn-add-platillo').addEventListener('click', async () => {
  const nombre = document.getElementById('p-nombre').value.trim();
  const categoria = document.getElementById('p-categoria').value;
  const precio = parseFloat(document.getElementById('p-precio').value);
  const puntos = parseInt(document.getElementById('p-puntos').value);

  if (!nombre || isNaN(precio) || isNaN(puntos) || precio <= 0 || puntos <= 0) {
    aviso('aviso-platillo', 'Llena nombre, precio y puntos con valores válidos.', 'error');
    return;
  }

  const { error } = await db.from('platillos').insert({ nombre, precio, puntos, categoria });
  if (error) { aviso('aviso-platillo', error.message, 'error'); return; }

  aviso('aviso-platillo', 'Platillo agregado.', 'ok');
  document.getElementById('p-nombre').value = '';
  document.getElementById('p-precio').value = '';
  document.getElementById('p-puntos').value = '';
  cargarPlatillos();
});

// Listar todos los platillos y su disponibilidad de hoy.
async function cargarPlatillos() {
  const { data: platillos, error } = await db
    .from('platillos')
    .select('*')
    .order('nombre', { ascending: true });

  const cont = document.getElementById('lista-platillos');
  if (error) { cont.innerHTML = `<p class="vacio">Error: ${error.message}</p>`; return; }
  if (!platillos || platillos.length === 0) {
    cont.innerHTML = '<p class="vacio">Aún no hay platillos. Agrega el primero arriba.</p>';
    return;
  }

  // Traemos que esta disponible hoy para saber como pintar cada interruptor.
  const { data: disp } = await db
    .from('disponibilidad_dia')
    .select('platillo_id, activo')
    .eq('fecha', HOY);

  const activoHoy = {};
  for (const d of (disp || [])) activoHoy[d.platillo_id] = d.activo;

  cont.innerHTML = '';
  for (const p of platillos) {
    const on = activoHoy[p.id] === true;
    cont.appendChild(dibujarItemPlatillo(p, on));
  }
}

// Dibuja un platillo en modo NORMAL (con sus botones de editar/eliminar).
function dibujarItemPlatillo(p, on) {
  const div = document.createElement('div');
  div.className = 'item';
  div.innerHTML = `
    <div style="flex:1;">
      <div class="nom">${esc(p.nombre)}</div>
      <div class="det">${esc(p.categoria || 'Comida')} · $${Number(p.precio).toFixed(2)} · ${Number(p.puntos)} pts</div>
    </div>
    <div style="display:flex; align-items:center; gap:10px;">
      <button data-editar title="Editar"
        style="background:#fff; border:1.5px solid #ece7df; border-radius:9px; width:34px; height:34px; cursor:pointer; font-size:15px;">✏️</button>
      <button data-eliminar title="Eliminar"
        style="background:#fff; border:1.5px solid #f0c9c7; border-radius:9px; width:34px; height:34px; cursor:pointer; font-size:15px;">🗑️</button>
      <span class="etq">${on ? 'Disponible hoy' : 'No disponible'}</span>
      <label class="switch">
        <input type="checkbox" ${on ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </div>`;

  div.querySelector('input').addEventListener('change', (e) =>
    cambiarDisponibilidad(p.id, e.target.checked, div));
  div.querySelector('[data-editar]').addEventListener('click', () =>
    convertirAEdicion(p, div, on));
  div.querySelector('[data-eliminar]').addEventListener('click', () =>
    eliminarPlatillo(p));

  return div;
}

// Convierte el renglón en campos editables en línea.
function convertirAEdicion(p, div, on) {
  div.innerHTML = `
    <div style="flex:1; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
      <input id="e-nombre" value="${esc(p.nombre)}"
        style="flex:1; min-width:120px; padding:8px 10px; border:1.5px solid #ece7df; border-radius:9px; font-family:inherit; font-size:14px;" />
      <select id="e-categoria"
        style="padding:8px 10px; border:1.5px solid #ece7df; border-radius:9px; font-family:inherit; font-size:14px; background:#fff;">
        ${['Comida','Bebidas','Postres','Snacks'].map(c =>
          `<option value="${c}" ${p.categoria===c?'selected':''}>${c}</option>`).join('')}
      </select>
      <input id="e-precio" type="number" value="${p.precio}" min="0" step="0.5"
        style="width:80px; padding:8px 10px; border:1.5px solid #ece7df; border-radius:9px; font-family:inherit; font-size:14px;" />
      <input id="e-puntos" type="number" value="${p.puntos}" min="1"
        style="width:70px; padding:8px 10px; border:1.5px solid #ece7df; border-radius:9px; font-family:inherit; font-size:14px;" />
    </div>
    <div style="display:flex; gap:8px; margin-left:10px;">
      <button data-guardar class="boton" style="padding:8px 14px;">Guardar</button>
      <button data-cancelar style="background:#fff; border:1.5px solid #ece7df; border-radius:9px; padding:8px 12px; cursor:pointer; font-family:inherit; font-size:13px; color:#8a8378;">Cancelar</button>
    </div>`;

  div.querySelector('[data-guardar]').addEventListener('click', () => guardarEdicion(p, div));
  div.querySelector('[data-cancelar]').addEventListener('click', () => {
    const nuevo = dibujarItemPlatillo(p, on);
    div.replaceWith(nuevo);
  });
}

// Guarda los cambios del platillo editado.
async function guardarEdicion(p, div) {
  const nombre    = div.querySelector('#e-nombre').value.trim();
  const categoria = div.querySelector('#e-categoria').value;
  const precio    = parseFloat(div.querySelector('#e-precio').value);
  const puntos    = parseInt(div.querySelector('#e-puntos').value);

  if (!nombre || isNaN(precio) || isNaN(puntos) || precio <= 0 || puntos <= 0) {
    aviso('aviso-platillo', 'Revisa los valores antes de guardar.', 'error');
    return;
  }

  const { error } = await db
    .from('platillos')
    .update({ nombre, categoria, precio, puntos })
    .eq('id', p.id);

  if (error) { aviso('aviso-platillo', error.message, 'error'); return; }
  aviso('aviso-platillo', 'Platillo actualizado.', 'ok');
  cargarPlatillos();
}

// Elimina un platillo. Si ya tiene pedidos, no se puede: se sugiere desactivar.
async function eliminarPlatillo(p) {
  const ok = confirm(`¿Eliminar "${p.nombre}" del catálogo?`);
  if (!ok) return;

  const { error } = await db.from('platillos').delete().eq('id', p.id);

  if (error) {
    // El error tipico es por la llave foranea (ya esta en pedidos).
    aviso('aviso-platillo',
      `No se puede eliminar "${p.nombre}" porque ya tiene pedidos en el historial. ` +
      `Mejor desactívalo con el interruptor para sacarlo del menú.`, 'error');
    return;
  }
  aviso('aviso-platillo', 'Platillo eliminado.', 'ok');
  cargarPlatillos();
}

// Prender/apagar un platillo para hoy.
// Usa 'upsert': si ya existe la fila (platillo+fecha) la actualiza,
// si no existe la crea. Asi no duplicamos.
async function cambiarDisponibilidad(platilloId, activo, div) {
  const { error } = await db
    .from('disponibilidad_dia')
    .upsert(
      { platillo_id: platilloId, fecha: HOY, activo },
      { onConflict: 'platillo_id,fecha' }
    );

  if (error) {
    aviso('aviso-platillo', error.message, 'error');
    return;
  }
  div.querySelector('.etq').textContent = activo ? 'Disponible hoy' : 'No disponible';
}


// --- FRANJAS ----------------------------------------------------------

// Crear una franja de hoy.
document.getElementById('btn-add-franja').addEventListener('click', async () => {
  const inicio    = document.getElementById('f-inicio').value;       // "09:00"
  const capacidad = parseInt(document.getElementById('f-capacidad').value);

  if (!inicio || isNaN(capacidad) || capacidad <= 0) {
    aviso('aviso-franja', 'Pon una hora y una capacidad válida.', 'error');
    return;
  }

  const { error } = await db.from('franjas').insert({
    fecha: HOY, inicio, capacidad, usado: 0, abierta: true
  });

  if (error) {
    // El error mas comun: ya existe una franja a esa hora (restriccion unica).
    const msg = error.message.includes('duplicate') || error.message.includes('unique')
      ? 'Ya existe una franja a esa hora.'
      : error.message;
    aviso('aviso-franja', msg, 'error');
    return;
  }

  aviso('aviso-franja', 'Franja creada.', 'ok');
  document.getElementById('f-inicio').value = '';
  document.getElementById('f-capacidad').value = '';
  cargarFranjas();
});

// Listar franjas de hoy.
async function cargarFranjas() {
  const { data, error } = await db
    .from('franjas')
    .select('*')
    .eq('fecha', HOY)
    .order('inicio', { ascending: true });

  const cont = document.getElementById('lista-franjas');
  if (error) { cont.innerHTML = `<p class="vacio">Error: ${error.message}</p>`; return; }
  if (!data || data.length === 0) {
    cont.innerHTML = '<p class="vacio">Aún no hay franjas para hoy.</p>';
    return;
  }

  cont.innerHTML = '';
  for (const f of data) {
    cont.appendChild(dibujarFilaFranja(f));
  }
}

// Dibuja una franja en modo NORMAL (con botones editar/eliminar).
function dibujarFilaFranja(f) {
  const libre = f.capacidad - f.usado;
  const div = document.createElement('div');
  div.className = 'franja-row';
  div.innerHTML = `
    <span style="flex:1;"><strong>${f.inicio.slice(0,5)}</strong> · ${libre}/${f.capacidad} pts libres
      <span class="det" style="margin-left:6px;">${f.abierta ? 'Abierta' : 'Cerrada'}</span>
    </span>
    <div style="display:flex; gap:8px;">
      <button data-editar title="Editar capacidad"
        style="background:#fff; border:1.5px solid #ece7df; border-radius:9px; width:32px; height:32px; cursor:pointer; font-size:14px;">✏️</button>
      <button data-eliminar title="Eliminar"
        style="background:#fff; border:1.5px solid #f0c9c7; border-radius:9px; width:32px; height:32px; cursor:pointer; font-size:14px;">🗑️</button>
    </div>`;

  div.querySelector('[data-editar]').addEventListener('click', () => convertirFranjaAEdicion(f, div));
  div.querySelector('[data-eliminar]').addEventListener('click', () => eliminarFranja(f));
  return div;
}

// Convierte la fila en edición de capacidad.
function convertirFranjaAEdicion(f, div) {
  div.innerHTML = `
    <span style="flex:1;"><strong>${f.inicio.slice(0,5)}</strong></span>
    <div style="display:flex; gap:8px; align-items:center;">
      <input id="ef-cap" type="number" value="${f.capacidad}" min="${f.usado}"
        style="width:90px; padding:7px 10px; border:1.5px solid #ece7df; border-radius:9px; font-family:inherit; font-size:14px;" />
      <span class="det">pts</span>
      <button data-guardar class="boton" style="padding:7px 13px;">Guardar</button>
      <button data-cancelar style="background:#fff; border:1.5px solid #ece7df; border-radius:9px; padding:7px 11px; cursor:pointer; font-family:inherit; font-size:13px; color:#8a8378;">✕</button>
    </div>`;

  div.querySelector('[data-guardar]').addEventListener('click', () => guardarFranja(f, div));
  div.querySelector('[data-cancelar]').addEventListener('click', () => {
    div.replaceWith(dibujarFilaFranja(f));
  });
}

// Guarda la nueva capacidad de la franja.
async function guardarFranja(f, div) {
  const nuevaCap = parseInt(div.querySelector('#ef-cap').value);

  if (isNaN(nuevaCap) || nuevaCap <= 0) {
    aviso('aviso-franja', 'Pon una capacidad válida.', 'error');
    return;
  }
  // No se puede bajar la capacidad por debajo de lo ya usado.
  if (nuevaCap < f.usado) {
    aviso('aviso-franja', `Esta franja ya usa ${f.usado} pts; no puedes bajar de ahí.`, 'error');
    return;
  }

  const { error } = await db
    .from('franjas')
    .update({ capacidad: nuevaCap })
    .eq('id', f.id);

  if (error) { aviso('aviso-franja', error.message, 'error'); return; }
  aviso('aviso-franja', 'Franja actualizada.', 'ok');
  cargarFranjas();
}

// Elimina una franja. Si tiene pedidos, no se puede: se sugiere cerrarla.
async function eliminarFranja(f) {
  const ok = confirm(`¿Eliminar la franja de las ${f.inicio.slice(0,5)}?`);
  if (!ok) return;

  const { error } = await db.from('franjas').delete().eq('id', f.id);

  if (error) {
    aviso('aviso-franja',
      `No se puede eliminar la franja de las ${f.inicio.slice(0,5)} porque ya tiene pedidos. ` +
      `Mejor ciérrala desde la pantalla de cocina para que no aparezca a los alumnos.`, 'error');
    return;
  }
  aviso('aviso-franja', 'Franja eliminada.', 'ok');
  cargarFranjas();
}


// --- RESUMEN DEL DÍA --------------------------------------------------

async function cargarResumen(fecha) {
  // Traemos los pedidos de esa fecha (unimos con franja para filtrar por dia),
  // junto con sus items y platillos para sumar dinero y contar.
  const { data, error } = await db
    .from('pedidos')
    .select('estado, franjas!inner ( fecha ), pedido_items ( cantidad, precio_unitario, platillos ( nombre, precio ) )')
    .eq('franjas.fecha', fecha);

  const elPedidos   = document.getElementById('r-pedidos');
  const elDinero    = document.getElementById('r-dinero');
  const elRecogidos = document.getElementById('r-recogidos');
  const elTop       = document.getElementById('r-top');

  if (error) { elTop.innerHTML = `<p class="vacio">Error: ${error.message}</p>`; return; }

  const pedidos = data || [];
  let totalDinero = 0;
  let recogidos = 0;
  const conteoPlatillos = {};   // nombre -> cantidad total

  for (const p of pedidos) {
    if (p.estado === 'recogido') recogidos++;
    // No contamos los no_recogidos en el dinero (no fueron venta).
    const cuenta = p.estado !== 'no_recogido';

    for (const it of (p.pedido_items || [])) {
      const pl = it.platillos;
      if (!pl) continue;
      if (cuenta) totalDinero += Number(it.precio_unitario ?? pl.precio) * it.cantidad;
      conteoPlatillos[pl.nombre] = (conteoPlatillos[pl.nombre] || 0) + it.cantidad;
    }
  }

  elPedidos.textContent   = pedidos.length;
  elDinero.textContent    = '$' + totalDinero.toFixed(2);
  elRecogidos.textContent = recogidos;

  // Top de platillos: ordenar por cantidad, mostrar los primeros.
  const top = Object.entries(conteoPlatillos).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (top.length === 0) {
    elTop.innerHTML = '<p class="vacio">Sin pedidos en este día.</p>';
  } else {
    elTop.innerHTML = '';
    const maxCant = top[0][1];   // para las barras proporcionales
    for (const [nombre, cant] of top) {
      const pct = Math.round((cant / maxCant) * 100);
      const fila = document.createElement('div');
      fila.style.cssText = 'margin-bottom:10px;';
      fila.innerHTML = `
        <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:3px;">
          <span>${esc(nombre)}</span>
          <span style="font-weight:600;">${cant}</span>
        </div>
        <div style="height:7px; background:#ece7df; border-radius:4px; overflow:hidden;">
          <span style="display:block; height:100%; width:${pct}%; background:#1b396a; border-radius:4px;"></span>
        </div>`;
      elTop.appendChild(fila);
    }
  }
}

// Al cambiar la fecha, recargar el resumen.
document.getElementById('resumen-fecha').addEventListener('change', (e) => {
  cargarResumen(e.target.value);
});


// --- CUENTAS Y VERIFICACION DE IDENTIDAD -----------------------------

let usuariosAdmin = [];

async function cargarUsuarios() {
  const cont = document.getElementById('lista-usuarios');
  cont.innerHTML = '<p class="vacio">Cargando cuentas…</p>';
  const { data, error } = await db.rpc('listar_cuentas_admin');

  if (error) {
    cont.textContent = 'No se pudieron cargar las cuentas: ' + error.message;
    return;
  }
  usuariosAdmin = data || [];
  document.getElementById('u-total').textContent = usuariosAdmin.length;
  document.getElementById('u-pendientes').textContent = usuariosAdmin.filter(u => u.rol === 'alumno' && u.verificacion_estado === 'pendiente').length;
  document.getElementById('u-bloqueados').textContent = usuariosAdmin.filter(u => u.bloqueado).length;
  dibujarUsuarios();
}

function usuariosFiltrados() {
  const texto = document.getElementById('u-buscar').value.trim().toLowerCase();
  const filtro = document.getElementById('u-filtro').value;
  return usuariosAdmin.filter(u => {
    const coincide = !texto || [u.nombre, u.correo, u.matricula]
      .some(v => String(v || '').toLowerCase().includes(texto));
    if (!coincide) return false;
    if (filtro === 'todos') return true;
    if (filtro === 'bloqueada') return u.bloqueado;
    if (filtro === 'personal') return u.rol === 'admin' || u.rol === 'cocina';
    return u.verificacion_estado === filtro;
  });
}

function dibujarUsuarios() {
  const cont = document.getElementById('lista-usuarios');
  const lista = usuariosFiltrados();
  cont.replaceChildren();
  if (!lista.length) {
    const vacio = document.createElement('p');
    vacio.className = 'vacio'; vacio.textContent = 'No hay cuentas con este filtro.';
    cont.appendChild(vacio); return;
  }
  for (const u of lista) cont.appendChild(tarjetaUsuario(u));
}

function tarjetaUsuario(u) {
  const card = document.createElement('article');
  card.className = 'usuario-card';
  const info = document.createElement('div');
  info.className = 'usuario-info';
  const nombre = document.createElement('strong');
  nombre.textContent = u.nombre || u.correo || 'Sin nombre';
  const datos = document.createElement('span');
  datos.textContent = [u.correo, u.matricula, u.rol].filter(Boolean).join(' · ');
  const etiquetas = document.createElement('div');
  etiquetas.className = 'usuario-etiquetas';
  etiquetas.appendChild(etiquetaUsuario(u.verificacion_estado || 'sin_verificar'));
  if (!u.correo_confirmado) etiquetas.appendChild(etiquetaUsuario('correo sin confirmar'));
  if (u.bloqueado) etiquetas.appendChild(etiquetaUsuario('bloqueada'));
  if (Number(u.faltas) > 0) etiquetas.appendChild(etiquetaUsuario(`${u.faltas} faltas`));
  info.append(nombre, datos, etiquetas);

  const acciones = document.createElement('div');
  acciones.className = 'usuario-acciones';
  if (u.credencial_path) acciones.appendChild(botonUsuario('Ver credencial', 'secundario', () => verCredencial(u)));
  if (u.rol === 'alumno' && u.credencial_path && u.verificacion_estado !== 'aprobada') {
    acciones.appendChild(botonUsuario('Aprobar', 'aprobar', () => revisarUsuario(u, 'aprobada')));
  }
  if (u.rol === 'alumno' && u.credencial_path && u.verificacion_estado !== 'rechazada') {
    acciones.appendChild(botonUsuario('Rechazar', 'rechazar', () => revisarUsuario(u, 'rechazada')));
  }
  if (u.bloqueado) acciones.appendChild(botonUsuario('Desbloquear', 'secundario', () => desbloquearDesdeAdmin(u)));
  const selectorRol = document.createElement('select');
  selectorRol.className = 'usuario-rol';
  selectorRol.setAttribute('aria-label', `Perfil de ${u.nombre || u.correo}`);
  for (const rol of ['alumno', 'cocina', 'admin']) {
    const opcion = document.createElement('option');
    opcion.value = rol;
    opcion.textContent = rol === 'alumno' ? 'Alumno' : rol === 'cocina' ? 'Cocina' : 'Administrador';
    opcion.selected = u.rol === rol;
    selectorRol.appendChild(opcion);
  }
  selectorRol.addEventListener('change', () => cambiarRolUsuario(u, selectorRol));
  acciones.appendChild(selectorRol);
  card.append(info, acciones);
  return card;
}

function etiquetaUsuario(texto) {
  const span = document.createElement('span');
  span.className = 'usuario-estado estado-' + String(texto).replace(/\s+/g, '-');
  span.textContent = String(texto).replace('_', ' ');
  return span;
}

function botonUsuario(texto, clase, accion) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = `usuario-btn ${clase}`; btn.textContent = texto;
  btn.addEventListener('click', accion);
  return btn;
}

async function verCredencial(u) {
  const { data, error } = await db.storage.from('credenciales').createSignedUrl(u.credencial_path, 300);
  if (error) { aviso('aviso-usuarios', error.message, 'error'); return; }
  document.getElementById('credencial-alumno').textContent = u.nombre || u.correo;
  document.getElementById('credencial-datos').textContent = [u.matricula, u.correo].filter(Boolean).join(' · ');
  document.getElementById('credencial-imagen').src = data.signedUrl;
  document.getElementById('modal-credencial').showModal();
}

async function revisarUsuario(u, estado) {
  let notas = null;
  if (estado === 'rechazada') {
    notas = prompt('Explica qué debe corregir el estudiante:');
    if (notas === null) return;
    if (!notas.trim()) { aviso('aviso-usuarios', 'Escribe el motivo del rechazo.', 'error'); return; }
  } else if (!confirm(`¿Aprobar la identidad de ${u.nombre || u.correo}?`)) return;

  const { error } = await db.rpc('revisar_credencial', {
    p_usuario_id: u.id,
    p_estado: estado,
    p_notas: notas
  });
  if (error) { aviso('aviso-usuarios', error.message, 'error'); return; }
  aviso('aviso-usuarios', estado === 'aprobada' ? 'Credencial aprobada.' : 'Credencial rechazada.', 'ok');
  cargarUsuarios();
}

async function desbloquearDesdeAdmin(u) {
  if (!confirm(`¿Desbloquear a ${u.nombre || u.correo}?`)) return;
  const { error } = await db.rpc('desbloquear_alumno', { p_usuario_id: u.id });
  if (error) { aviso('aviso-usuarios', error.message, 'error'); return; }
  cargarUsuarios();
}

async function cambiarRolUsuario(u, selector) {
  const nuevoRol = selector.value;
  if (nuevoRol === u.rol) return;
  if (!confirm(`¿Cambiar el perfil de ${u.nombre || u.correo} a ${nuevoRol}?`)) {
    selector.value = u.rol;
    return;
  }
  selector.disabled = true;
  const { error } = await db.rpc('cambiar_rol_usuario', {
    p_usuario_id: u.id,
    p_rol: nuevoRol
  });
  selector.disabled = false;
  if (error) {
    selector.value = u.rol;
    aviso('aviso-usuarios', error.message, 'error');
    return;
  }
  aviso('aviso-usuarios', 'Perfil actualizado correctamente.', 'ok');
  cargarUsuarios();
}

document.getElementById('u-buscar').addEventListener('input', dibujarUsuarios);
document.getElementById('u-filtro').addEventListener('change', dibujarUsuarios);
document.getElementById('btn-recargar-usuarios').addEventListener('click', cargarUsuarios);
document.getElementById('btn-cerrar-credencial').addEventListener('click', () => document.getElementById('modal-credencial').close());


// --- HORARIO DE ATENCIÓN ----------------------------------------------

let horarioActual = { apertura: '08:00', cierre: '14:00', capacidad: 100 };

async function cargarHorario() {
  const { data, error } = await db
    .from('config')
    .select('hora_apertura, hora_cierre, capacidad_franja')
    .eq('id', 1);

  if (!error && data && data.length > 0) {
    horarioActual = {
      apertura: data[0].hora_apertura.slice(0,5),
      cierre:   data[0].hora_cierre.slice(0,5),
      capacidad: data[0].capacidad_franja || 100
    };
  } else if (error) {
    console.error('Error al cargar horario:', error);
  }
  pintarHorarioVista();
}

// Muestra el horario fijo (modo vista).
function pintarHorarioVista() {
  document.getElementById('v-apertura').textContent = horarioActual.apertura;
  document.getElementById('v-cierre').textContent = horarioActual.cierre;
  const sub = document.getElementById('horario-sub');
  if (sub) sub.textContent =
    `Franjas cada 30 min · ${horarioActual.capacidad} pts de capacidad cada una.`;
  document.getElementById('horario-vista').style.display = 'flex';
  document.getElementById('horario-edicion').style.display = 'none';
}

// Pasa a modo edición (al tocar Modificar).
document.getElementById('btn-modificar-horario').addEventListener('click', () => {
  document.getElementById('h-apertura').value = horarioActual.apertura;
  document.getElementById('h-cierre').value   = horarioActual.cierre;
  document.getElementById('h-capacidad').value = horarioActual.capacidad;
  document.getElementById('horario-vista').style.display = 'none';
  document.getElementById('horario-edicion').style.display = 'block';
  aviso('aviso-horario', '', '');
});

// Cancelar edición: volver a la vista sin guardar.
document.getElementById('btn-cancelar-horario').addEventListener('click', () => {
  pintarHorarioVista();
  aviso('aviso-horario', '', '');
});

// Guardar el horario.
document.getElementById('btn-guardar-horario').addEventListener('click', async () => {
  const apertura = document.getElementById('h-apertura').value;
  const cierre   = document.getElementById('h-cierre').value;
  const capacidad = parseInt(document.getElementById('h-capacidad').value);

  if (!apertura || !cierre) {
    aviso('aviso-horario', 'Pon la hora de apertura y de cierre.', 'error');
    return;
  }
  if (apertura >= cierre) {
    aviso('aviso-horario', 'La apertura debe ser antes del cierre.', 'error');
    return;
  }
  if (isNaN(capacidad) || capacidad <= 0) {
    aviso('aviso-horario', 'Pon una capacidad válida por franja.', 'error');
    return;
  }

  const { error } = await db
    .from('config')
    .update({ hora_apertura: apertura, hora_cierre: cierre, capacidad_franja: capacidad })
    .eq('id', 1);

  if (error) { aviso('aviso-horario', error.message, 'error'); return; }

  horarioActual = { apertura, cierre, capacidad };
  pintarHorarioVista();
  aviso('aviso-horario', 'Horario actualizado. Las franjas de mañana usarán esta configuración.', 'ok');
});


// --- Arrancar (con guardia de rol) ------------------------------------
// Solo admin puede ver esta pantalla.
(async () => {
  const rol = await exigirRol(['admin']);
  if (!rol) return;          // el guardia ya redirigio

  // Inicializar el resumen con la fecha de hoy.
  const inputFecha = document.getElementById('resumen-fecha');
  inputFecha.value = HOY;
  cargarResumen(HOY);

  // Generar las franjas de hoy si aún no existen.
  await db.rpc('generar_franjas_dia', { p_fecha: HOY });

  cargarHorario();
  cargarPlatillos();
  cargarFranjas();
  cargarUsuarios();
})();
