// =====================================================================
// alumno.js  -  Logica de la pantalla del alumno
// =====================================================================
// Tres vistas: login -> menu -> elegir franja.
// Al confirmar, llama a la funcion 'crear_pedido' de Supabase, que es
// la que protege la capacidad (el candado que vimos).
// =====================================================================

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

function fechaLocalISO(fecha = new Date()) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const HOY = fechaLocalISO();

// Estado en memoria mientras el alumno arma su pedido.
let usuario      = null;   // el usuario logueado
let modoRegistro = false;  // false = entrar, true = registrarse
let carrito      = {};     // { platillo_id: { nombre, precio, puntos, cant } }
let franjaElegida = null;
let fueraDeHorario = false;   // true si la cafeteria esta cerrada ahora
let horarioCafe = { apertura: '08:00', cierre: '14:00' };
let perfilActual = null;

// Atajos para mostrar/ocultar vistas.
function verVista(cual) {
  for (const v of ['login', 'verificacion', 'menu', 'franja', 'seguimiento', 'pedidos']) {
    document.getElementById('vista-' + v).classList.toggle('oculto', v !== cual);
  }
}
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


// --- 1. LOGIN / REGISTRO ----------------------------------------------

document.getElementById('btn-modo').addEventListener('click', () => {
  modoRegistro = !modoRegistro;
  document.getElementById('btn-entrar').textContent = modoRegistro ? 'Crear cuenta y enviar credencial' : 'Entrar';
  document.getElementById('btn-modo').textContent =
    modoRegistro ? '¿Ya tienes cuenta? Entrar' : '¿No tienes cuenta? Regístrate';
  document.querySelectorAll('.registro-solo').forEach(el => el.classList.toggle('oculto', !modoRegistro));
  document.getElementById('clave').autocomplete = modoRegistro ? 'new-password' : 'current-password';
  aviso('aviso-login', '', '');
});

document.getElementById('credencial').addEventListener('change', (e) => {
  const archivo = e.target.files && e.target.files[0];
  const preview = document.getElementById('credencial-preview');
  if (!archivo) { preview.classList.add('oculto'); return; }
  if (!validarImagen(archivo)) { e.target.value = ''; preview.classList.add('oculto'); return; }
  preview.src = URL.createObjectURL(archivo);
  preview.classList.remove('oculto');
});

function validarImagen(archivo) {
  if (!archivo || !['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type)) {
    aviso('aviso-login', 'La credencial debe ser una imagen JPG, PNG o WebP.', 'error');
    return false;
  }
  if (archivo.size > 5 * 1024 * 1024) {
    aviso('aviso-login', 'La imagen supera el límite de 5 MB.', 'error');
    return false;
  }
  return true;
}

async function subirCredencial(archivo, nombre, matricula) {
  if (!usuario || !validarImagen(archivo)) throw new Error('Selecciona una credencial válida.');
  const extension = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }[archivo.type];
  const ruta = `${usuario.id}/credencial.${extension}`;
  const { error: errorSubida } = await db.storage
    .from('credenciales')
    .upload(ruta, archivo, { upsert: true, contentType: archivo.type });
  if (errorSubida) throw errorSubida;

  const { error: errorRegistro } = await db.rpc('registrar_credencial', {
    p_nombre: nombre,
    p_matricula: matricula,
    p_ruta: ruta
  });
  if (errorRegistro) throw errorRegistro;
}

document.getElementById('btn-entrar').addEventListener('click', async () => {
  const btn = document.getElementById('btn-entrar');
  const textoOriginal = btn.textContent;
  const correo = document.getElementById('correo').value.trim();
  const clave  = document.getElementById('clave').value;

  if (!correo || !clave) {
    aviso('aviso-login', 'Llena correo y contraseña.', 'error');
    return;
  }
  // Validacion rapida del dominio (la BD tambien lo valida).
  if (!correo.toLowerCase().endsWith('@costagrande.tecnm.mx')) {
    aviso('aviso-login', 'Usa tu correo institucional @costagrande.tecnm.mx', 'error');
    return;
  }

  if (clave.length < 8) {
    aviso('aviso-login', 'La contraseña debe tener al menos 8 caracteres.', 'error');
    return;
  }

  if (modoRegistro) {
    const nombre = document.getElementById('nombre').value.trim();
    const matricula = document.getElementById('matricula').value.trim().toUpperCase();
    const confirmar = document.getElementById('clave-confirmar').value;
    const archivo = document.getElementById('credencial').files[0];
    if (!nombre || !/^[A-Z0-9]{6,20}$/.test(matricula)) {
      aviso('aviso-login', 'Escribe tu nombre completo y una matrícula válida.', 'error'); return;
    }
    if (clave !== confirmar) {
      aviso('aviso-login', 'Las contraseñas no coinciden.', 'error'); return;
    }
    if (!archivo || !validarImagen(archivo)) {
      aviso('aviso-login', 'La foto de tu credencial es obligatoria.', 'error'); return;
    }

    btn.disabled = true; btn.textContent = 'Creando cuenta…';
    const { data, error } = await db.auth.signUp({
      email: correo,
      password: clave,
      options: {
        data: { nombre, matricula },
        emailRedirectTo: `${window.location.origin}/alumnoscafe/index.html`
      }
    });
    if (error) {
      aviso('aviso-login', error.message, 'error');
      btn.disabled = false; btn.textContent = textoOriginal; return;
    }
    usuario = data.user;
    if (!data.session) {
      aviso('aviso-login', 'Cuenta creada. Confirma tu correo y después entra para completar la verificación.', 'ok');
      modoRegistro = true;
      document.getElementById('btn-modo').click();
      btn.disabled = false; btn.textContent = 'Entrar';
      return;
    }
    try {
      btn.textContent = 'Subiendo credencial…';
      await subirCredencial(archivo, nombre, matricula);
      await iniciarSesion();
    } catch (e) {
      aviso('aviso-login', e.message || 'No se pudo subir la credencial.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = textoOriginal;
    }
    return;
  }

  btn.disabled = true; btn.textContent = 'Entrando…';
  const { data, error } = await db.auth.signInWithPassword({ email: correo, password: clave });
  if (error) {
    aviso('aviso-login', error.message, 'error');
    btn.disabled = false; btn.textContent = textoOriginal; return;
  }

  usuario = data.user;
  await iniciarSesion();
  btn.disabled = false; btn.textContent = textoOriginal;
});

async function salir() {
  await db.auth.signOut();
  usuario = null; perfilActual = null; carrito = {}; franjaElegida = null;
  verVista('login');
}

document.getElementById('btn-salir').addEventListener('click', salir);
document.getElementById('btn-salir-verificacion').addEventListener('click', salir);


// --- 2. MENU DEL DIA --------------------------------------------------

async function iniciarSesion() {
  const { data: perfil, error } = await db
    .from('usuarios')
    .select('id, correo, nombre, matricula, rol, bloqueado, verificacion_estado, verificacion_notas, credencial_path')
    .eq('id', usuario.id)
    .maybeSingle();

  if (error) {
    verVista('login');
    aviso('aviso-login', 'No se pudo consultar tu perfil: ' + error.message, 'error');
    return;
  }

  perfilActual = perfil;
  if (perfil && perfil.rol && perfil.rol !== 'alumno') {
    await db.auth.signOut();
    usuario = null;
    verVista('login');
    aviso('aviso-login', 'Esta entrada es exclusiva para estudiantes. El personal debe usar su acceso.', 'error');
    return;
  }

  if (!perfil || perfil.verificacion_estado !== 'aprobada') {
    mostrarVerificacion(perfil);
    return;
  }

  document.getElementById('quien').textContent = perfil.nombre || usuario.email;
  verVista('menu');
  await cargarMenu();
}

function mostrarVerificacion(perfil) {
  const estado = perfil ? perfil.verificacion_estado : 'pendiente';
  const tieneFoto = Boolean(perfil && perfil.credencial_path);
  document.getElementById('verificacion-correo').textContent = usuario.email;
  const titulo = document.getElementById('verificacion-titulo');
  const texto = document.getElementById('verificacion-texto');
  const icono = document.getElementById('verificacion-icono');
  const notas = document.getElementById('verificacion-notas');
  const reenvio = document.getElementById('reenvio-credencial');

  if (estado === 'rechazada') {
    icono.textContent = '⚠️'; titulo.textContent = 'Necesitamos otra fotografía';
    texto.textContent = 'Corrige la observación y vuelve a enviar tu credencial.';
  } else if (!tieneFoto) {
    icono.textContent = '📷'; titulo.textContent = 'Falta tu credencial';
    texto.textContent = 'Sube una fotografía legible para que administración valide tu identidad.';
  } else {
    icono.textContent = '⏳'; titulo.textContent = 'Validación pendiente';
    texto.textContent = 'Administración revisará que la credencial coincida con tu cuenta institucional.';
  }
  notas.textContent = perfil && perfil.verificacion_notas ? perfil.verificacion_notas : '';
  notas.classList.toggle('oculto', !notas.textContent);
  reenvio.classList.toggle('oculto', estado === 'pendiente' && tieneFoto);
  verVista('verificacion');
}

document.getElementById('btn-reenviar-credencial').addEventListener('click', async () => {
  const archivo = document.getElementById('credencial-reenvio').files[0];
  if (!archivo || !validarImagen(archivo)) return;
  const meta = usuario.user_metadata || {};
  const nombre = (perfilActual && perfilActual.nombre) || meta.nombre || '';
  const matricula = (perfilActual && perfilActual.matricula) || meta.matricula || '';
  const btn = document.getElementById('btn-reenviar-credencial');
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    await subirCredencial(archivo, nombre, matricula);
    perfilActual = { ...(perfilActual || {}), nombre, matricula, credencial_path: 'enviada', verificacion_estado: 'pendiente', verificacion_notas: null };
    mostrarVerificacion(perfilActual);
  } catch (e) {
    const notas = document.getElementById('verificacion-notas');
    notas.textContent = e.message || 'No se pudo enviar la credencial.';
    notas.classList.remove('oculto');
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar nuevamente';
  }
});

let menuPlatillos = [];                 // platillos disponibles hoy (en memoria)
let categoriaActiva = 'Todos';          // filtro seleccionado
const CATEGORIAS = ['Todos', 'Comida', 'Bebidas', 'Postres', 'Snacks'];

async function cargarMenu() {
  // Revisar el horario de atencion (actualiza fueraDeHorario).
  await verificarHorario();

  // Traemos los platillos ACTIVOS hoy, ahora tambien con su categoria.
  const { data, error } = await db
    .from('disponibilidad_dia')
    .select('activo, platillos ( id, nombre, precio, puntos, categoria )')
    .eq('fecha', HOY)
    .eq('activo', true);

  const cont = document.getElementById('lista-platillos');

  if (error) { cont.textContent = 'Error: ' + error.message; return; }
  if (!data || data.length === 0) { cont.textContent = 'Hoy no hay platillos disponibles.'; return; }

  // Guardar en memoria los platillos (para poder filtrar sin reconsultar).
  menuPlatillos = data.map(f => f.platillos).filter(Boolean);
  categoriaActiva = 'Todos';

  dibujarBarraCategorias();
  dibujarPlatillos();

  // Si esta fuera de horario, mostrar el anuncio.
  if (fueraDeHorario) mostrarModalHorario();
}

// Muestra el modal de fuera de horario.
function mostrarModalHorario() {
  document.getElementById('modal-apertura').textContent = horarioCafe.apertura;
  document.getElementById('modal-cierre').textContent = horarioCafe.cierre;
  document.getElementById('modal-horario').style.display = 'flex';
}

// Dibuja la barra de categorias arriba del menu.
function dibujarBarraCategorias() {
  let barra = document.getElementById('barra-categorias');
  if (!barra) {
    barra = document.createElement('div');
    barra.id = 'barra-categorias';
    barra.style.cssText =
      'display:flex; gap:8px; overflow-x:auto; padding:4px 0 12px; margin-bottom:4px;';
    const cont = document.getElementById('lista-platillos');
    cont.parentNode.insertBefore(barra, cont);
  }

  // Solo mostramos categorias que de verdad tienen platillos hoy (+ "Todos").
  const presentes = new Set(menuPlatillos.map(p => p.categoria || 'Comida'));
  const visibles = CATEGORIAS.filter(c => c === 'Todos' || presentes.has(c));

  barra.innerHTML = '';
  for (const cat of visibles) {
    const activa = cat === categoriaActiva;
    const btn = document.createElement('button');
    btn.textContent = cat;
    btn.style.cssText =
      'white-space:nowrap; padding:8px 16px; border-radius:999px; cursor:pointer;' +
      'font-size:14px; font-weight:600; font-family:inherit; transition:all .15s;' +
      (activa
        ? 'background:#d6562b; color:#fff; border:1.5px solid #d6562b;'
        : 'background:#fff; color:#8a8378; border:1.5px solid #ece7df;');
    btn.addEventListener('click', () => {
      categoriaActiva = cat;
      dibujarBarraCategorias();
      dibujarPlatillos();
    });
    barra.appendChild(btn);
  }
}

// Dibuja los platillos, filtrados por la categoria activa.
function dibujarPlatillos() {
  const cont = document.getElementById('lista-platillos');
  const lista = categoriaActiva === 'Todos'
    ? menuPlatillos
    : menuPlatillos.filter(p => (p.categoria || 'Comida') === categoriaActiva);

  cont.innerHTML = '';
  if (lista.length === 0) {
    cont.innerHTML = '<p style="color:#888; text-align:center; padding:10px;">Nada en esta categoría.</p>';
    return;
  }

  for (const p of lista) {
    const cant = carrito[p.id] ? carrito[p.id].cant : 0;
    const div = document.createElement('div');
    div.className = 'platillo';
    div.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div class="platillo-info">
          <div class="nom">${esc(p.nombre)}</div>
          <div class="det">$${Number(p.precio).toFixed(2)}</div>
        </div>
        <div class="cantidad">
          <button data-menos>−</button>
          <span id="cant-${p.id}">${cant}</span>
          <button data-mas>+</button>
        </div>
      </div>
      <input type="text" id="coment-${p.id}" placeholder="Nota: ej. sin cebolla"
             value="${esc(carrito[p.id] ? (carrito[p.id].comentario || '') : '')}"
             style="display:${cant > 0 ? 'block' : 'none'}; width:100%; margin-top:8px; padding:8px 10px;
                    border:1px solid #c4c2b8; border-radius:8px; font-size:13px;" />`;

    div.querySelector('[data-mas]').addEventListener('click', () => cambiarCant(p, +1));
    div.querySelector('[data-menos]').addEventListener('click', () => cambiarCant(p, -1));
    div.querySelector('#coment-' + p.id).addEventListener('input', (e) => {
      if (carrito[p.id]) carrito[p.id].comentario = e.target.value;
    });

    cont.appendChild(div);
  }
}

function cambiarCant(p, delta) {
  // Fuera de horario no se puede armar pedido.
  if (fueraDeHorario) { mostrarModalHorario(); return; }

  const actual = carrito[p.id] ? carrito[p.id].cant : 0;
  const nueva = Math.max(0, actual + delta);

  if (nueva === 0) {
    delete carrito[p.id];
  } else {
    const comentarioPrevio = carrito[p.id] ? carrito[p.id].comentario : '';
    carrito[p.id] = {
      nombre: p.nombre, precio: p.precio, puntos: p.puntos,
      cant: nueva, comentario: comentarioPrevio || ''
    };
  }
  document.getElementById('cant-' + p.id).textContent = nueva;

  // Mostrar el campo de comentario solo si hay al menos 1.
  const campo = document.getElementById('coment-' + p.id);
  if (campo) campo.style.display = nueva > 0 ? 'block' : 'none';

  actualizarResumen();
}

function actualizarResumen() {
  let pts = 0, precio = 0, hayAlgo = false;
  for (const id in carrito) {
    pts    += carrito[id].puntos * carrito[id].cant;
    precio += carrito[id].precio * carrito[id].cant;
    hayAlgo = true;
  }
  document.getElementById('total-precio').textContent = precio.toFixed(2);
  document.getElementById('caja-resumen').style.display = hayAlgo ? 'block' : 'none';
}


// --- 3. ELEGIR FRANJA -------------------------------------------------

document.getElementById('btn-continuar').addEventListener('click', async () => {
  verVista('franja');
  await cargarFranjas();
});
document.getElementById('btn-volver').addEventListener('click', () => verVista('menu'));

async function cargarFranjas() {
  franjaElegida = null;
  document.getElementById('btn-confirmar').disabled = true;
  // Costo en puntos del pedido actual.
  let costo = 0;
  for (const id in carrito) costo += carrito[id].puntos * carrito[id].cant;

  // Solo franjas de hoy, abiertas.
  const { data, error } = await db
    .from('franjas')
    .select('*')
    .eq('fecha', HOY)
    .eq('abierta', true)
    .order('inicio', { ascending: true });

  const cont = document.getElementById('lista-franjas');
  if (error) { cont.textContent = 'Error: ' + error.message; return; }
  if (!data || data.length === 0) { cont.textContent = 'No hay horarios disponibles ahora.'; return; }

  cont.innerHTML = '';
  for (const f of data) {
    const libre = f.capacidad - f.usado;
    const cabe  = libre >= costo;

    const div = document.createElement('div');
    div.className = 'franja-op' + (cabe ? '' : ' llena');
    div.innerHTML = `
      <div>
        <div class="hora">${f.inicio.slice(0,5)}</div>
        <div class="libre">${cabe ? 'Disponible' : 'Lleno'}</div>
      </div>
      <div>${cabe ? '' : '✕'}</div>`;

    if (cabe) {
      div.addEventListener('click', () => {
        document.querySelectorAll('.franja-op').forEach(e => e.classList.remove('sel'));
        div.classList.add('sel');
        franjaElegida = f.id;
        document.getElementById('btn-confirmar').disabled = false;
      });
    }
    cont.appendChild(div);
  }
}


// --- 4. CONFIRMAR (aqui entra crear_pedido) ---------------------------

// Revisa si la hora actual esta dentro del horario de atencion.
// Verifica el horario contra la hora actual y actualiza el estado global.
// Devuelve true si estamos dentro del horario.
async function verificarHorario() {
  const { data, error } = await db
    .from('config')
    .select('hora_apertura, hora_cierre')
    .eq('id', 1);

  // Si no se puede leer, no bloqueamos (mejor dejar pedir que trabar todo).
  if (error || !data || data.length === 0) {
    fueraDeHorario = false;
    return true;
  }

  horarioCafe = {
    apertura: data[0].hora_apertura.slice(0,5),
    cierre:   data[0].hora_cierre.slice(0,5)
  };

  const ahora = new Date();
  const hh = String(ahora.getHours()).padStart(2, '0');
  const mm = String(ahora.getMinutes()).padStart(2, '0');
  const horaActual = `${hh}:${mm}`;

  fueraDeHorario = (horaActual < horarioCafe.apertura || horaActual >= horarioCafe.cierre);
  return !fueraDeHorario;
}


document.getElementById('btn-confirmar').addEventListener('click', async () => {
  if (!franjaElegida) return;

  // Doble seguro: si está fuera de horario, no confirmar.
  if (!(await verificarHorario())) { mostrarModalHorario(); return; }

  // Armar el arreglo de items como lo espera la funcion.
  const items = [];
  for (const id in carrito) {
    items.push({
      platillo_id: id,
      cantidad: carrito[id].cant,
      comentario: carrito[id].comentario || ''
    });
  }

  const btn = document.getElementById('btn-confirmar');
  btn.disabled = true;
  btn.textContent = 'Confirmando…';

  // Llamada a la funcion de Supabase. 'rpc' ejecuta funciones de BD.
  const { data, error } = await db.rpc('crear_pedido', {
    p_usuario_id: usuario.id,
    p_franja_id:  franjaElegida,
    p_items:      items
  });

  if (error) {
    // La funcion lanza mensajes claros (sin espacio, franja cerrada, etc.)
    aviso('aviso-pedido', error.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Confirmar pedido';
    return;
  }

  // Exito: el pedido se creo. 'data' es el id del pedido nuevo.
  carrito = {}; franjaElegida = null;
  btn.disabled = false;
  btn.textContent = 'Confirmar pedido';
  aviso('aviso-pedido', '', '');

  // Ir a la pantalla de seguimiento de ESTE pedido.
  iniciarSeguimiento(data);
});


// --- 5. SEGUIMIENTO DEL PEDIDO EN VIVO --------------------------------

let canalSeguimiento = null;   // la suscripcion en tiempo real
let pedidoSeguidoId  = null;
let estadoPrevio     = null;   // para detectar cuando pasa a "listo"

const PASOS = [
  { clave: 'pendiente', etiqueta: 'Recibido' },
  { clave: 'en_cocina', etiqueta: 'En cocina' },
  { clave: 'listo',     etiqueta: 'Listo' }
];

async function iniciarSeguimiento(pedidoId) {
  pedidoSeguidoId = pedidoId;
  estadoPrevio = null;
  verVista('seguimiento');
  await refrescarSeguimiento();

  // Escuchar cambios de ESTE pedido en tiempo real.
  if (canalSeguimiento) db.removeChannel(canalSeguimiento);
  canalSeguimiento = db
    .channel('seg-' + pedidoId)
    .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: 'id=eq.' + pedidoId },
        () => refrescarSeguimiento())
    .subscribe();
}

async function refrescarSeguimiento() {
  const { data, error } = await db
    .from('pedidos')
    .select('estado, franjas ( inicio ), pedido_items ( cantidad, comentario, platillos ( nombre ) )')
    .eq('id', pedidoSeguidoId)
    .single();

  if (error || !data) return;

  pintarEstado(data.estado, data.franjas ? data.franjas.inicio : null);

  // Detalle del pedido (qué pidió).
  let lineas = [];
  for (const it of (data.pedido_items || [])) {
    const nom = it.platillos ? it.platillos.nombre : '';
    let linea = `${it.cantidad} ${nom}`;
    if (it.comentario) linea += ` (${it.comentario})`;
    lineas.push(linea);
  }
  document.getElementById('seg-detalle').textContent = lineas.join(' · ');

  // Si acaba de pasar a "listo", avisar fuerte.
  if (data.estado === 'listo' && estadoPrevio && estadoPrevio !== 'listo') {
    avisarListo();
  }
  estadoPrevio = data.estado;
}

function pintarEstado(estado, horaFranja) {
  const icono = document.getElementById('seg-icono');
  const texto = document.getElementById('seg-texto');
  const sub   = document.getElementById('seg-sub');

  const mapa = {
    pendiente:  { ic: '⏳', tx: 'Pedido recibido', sb: 'La cocina lo verá pronto' },
    en_cocina:  { ic: '👨‍🍳', tx: 'En preparación',  sb: 'Están cocinando tu pedido' },
    listo:      { ic: '✅', tx: '¡Listo para recoger!', sb: 'Pasa por él en la cafetería' },
    recogido:   { ic: '🎉', tx: 'Pedido recogido',  sb: '¡Buen provecho!' },
    no_recogido:{ ic: '❌', tx: 'No recogido',       sb: 'Este pedido no se recogió' }
  };
  const m = mapa[estado] || mapa.pendiente;
  icono.textContent = m.ic;
  texto.textContent = m.tx;
  sub.textContent = (estado === 'listo' && horaFranja)
    ? `Horario: ${horaFranja.slice(0,5)}`
    : m.sb;

  // Pintar los pasos (línea de progreso).
  const cont = document.getElementById('seg-pasos');
  const idxActual = PASOS.findIndex(p => p.clave === estado);
  cont.innerHTML = '';
  PASOS.forEach((paso, i) => {
    const hecho = idxActual >= 0 && i <= idxActual;
    const div = document.createElement('div');
    div.style.cssText = 'flex:1; text-align:center; font-size:12px;';
    div.innerHTML = `
      <div style="width:26px; height:26px; border-radius:50%; margin:0 auto 6px;
                  background:${hecho ? '#d6562b' : '#e2e0d8'};
                  color:${hecho ? '#fff' : '#888'};
                  display:flex; align-items:center; justify-content:center; font-size:14px;">
        ${hecho ? '✓' : (i + 1)}
      </div>
      <span style="color:${hecho ? '#d6562b' : '#888'};">${paso.etiqueta}</span>`;
    cont.appendChild(div);
  });
}

function avisarListo() {
  // Sonido.
  const audio = document.getElementById('sonido-listo');
  if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
  // Vibracion si el dispositivo lo soporta.
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

// Botón "Nuevo pedido": volver al menú.
document.getElementById('btn-nuevo').addEventListener('click', () => {
  if (canalSeguimiento) { db.removeChannel(canalSeguimiento); canalSeguimiento = null; }
  verVista('menu');
  actualizarResumen();
  cargarMenu();
});


// --- 6. MIS PEDIDOS (lista) -------------------------------------------

// Botones de navegacion hacia/desde la lista.
document.getElementById('btn-mis-pedidos').addEventListener('click', () => abrirMisPedidos());
document.getElementById('btn-ver-pedidos').addEventListener('click', () => {
  if (canalSeguimiento) { db.removeChannel(canalSeguimiento); canalSeguimiento = null; }
  abrirMisPedidos();
});
document.getElementById('btn-volver-menu').addEventListener('click', () => {
  verVista('menu'); actualizarResumen(); cargarMenu();
});

async function abrirMisPedidos() {
  verVista('pedidos');
  const cont = document.getElementById('lista-pedidos');
  cont.textContent = 'Cargando…';

  // Pedidos de hoy de este alumno. Unimos franja (para la hora) y items.
  const { data, error } = await db
    .from('pedidos')
    .select('id, estado, creado, franjas!inner ( fecha, inicio ), pedido_items ( cantidad, platillos ( nombre ) )')
    .eq('usuario_id', usuario.id)
    .eq('franjas.fecha', HOY)
    .order('creado', { ascending: false });

  if (error) { cont.textContent = 'Error: ' + error.message; return; }
  if (!data || data.length === 0) {
    cont.innerHTML = '<p style="color:#888; text-align:center; padding:10px;">No tienes pedidos hoy.</p>';
    return;
  }

  // Separar activos de historial (recogidos / no recogidos).
  const activos    = data.filter(p => ['pendiente','en_cocina','listo'].includes(p.estado));
  const historial  = data.filter(p => ['recogido','no_recogido'].includes(p.estado));

  cont.innerHTML = '';
  if (activos.length)   { cont.appendChild(tituloLista('Activos')); activos.forEach(p => cont.appendChild(filaPedido(p, true))); }
  if (historial.length) { cont.appendChild(tituloLista('Historial')); historial.forEach(p => cont.appendChild(filaPedido(p, false))); }
}

function tituloLista(txt) {
  const h = document.createElement('div');
  h.style.cssText = 'font-size:13px; color:#888; font-weight:600; margin:10px 0 6px;';
  h.textContent = txt;
  return h;
}

function filaPedido(p, esActivo) {
  // Resumen de platillos.
  let partes = [];
  for (const it of (p.pedido_items || [])) {
    const nom = it.platillos ? it.platillos.nombre : '';
    partes.push(`${it.cantidad} ${nom}`);
  }
  const estados = {
    pendiente:'Recibido', en_cocina:'En cocina', listo:'Listo para recoger',
    recogido:'Recogido', no_recogido:'No recogido'
  };
  const colores = {
    pendiente:'#b8731a', en_cocina:'#854f0b', listo:'#27500a',
    recogido:'#5f5e5a', no_recogido:'#a32d2d'
  };

  const fila = document.createElement('div');
  fila.style.cssText =
    'display:flex; justify-content:space-between; align-items:center; gap:10px;' +
    'padding:12px; border:1px solid #e2e0d8; border-radius:8px; margin-bottom:8px;' +
    (esActivo ? 'cursor:pointer;' : 'opacity:0.75;');

  fila.innerHTML = `
    <div>
      <div style="font-size:14px;">${partes.map(esc).join(', ')}</div>
      <div style="font-size:12px; color:#888;">${p.franjas ? p.franjas.inicio.slice(0,5) : ''}</div>
    </div>
    <span style="font-size:12px; font-weight:600; color:${colores[p.estado]}; white-space:nowrap;">
      ${estados[p.estado] || p.estado}
    </span>`;

  // Solo los activos abren el seguimiento al tocarlos.
  if (esActivo) {
    fila.addEventListener('click', () => iniciarSeguimiento(p.id));
  }
  return fila;
}


// Botón "¡Gracias!" del modal de fuera de horario: solo lo cierra.
document.getElementById('btn-modal-gracias').addEventListener('click', () => {
  document.getElementById('modal-horario').style.display = 'none';
});


// --- Al arrancar: ¿ya hay sesion abierta? -----------------------------
(async () => {
  const { data } = await db.auth.getSession();
  if (data.session) {
    usuario = data.session.user;
    iniciarSesion();
  } else {
    verVista('login');
  }
})();
