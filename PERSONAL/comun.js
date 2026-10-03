// =====================================================================
// comun.js  -  Conexion a Supabase y "guardia" de roles
// =====================================================================
// Lo usan el login, la cocina y el admin.
// =====================================================================

// --- Tus datos de Supabase (los MISMOS de siempre) -------------------
const SUPABASE_URL  = "https://wnsagtdoqfdxuqgyjeyo.supabase.co";
const SUPABASE_ANON = "sb_publishable_tFi6dNz6vl39FTTLbsevQQ_459aaN0J";


const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// --- Saber el rol del usuario logueado --------------------------------
// Llama a la funcion 'mi_rol()' que creamos en la base de datos.
async function obtenerRol() {
  const { data: sesion } = await db.auth.getSession();
  if (!sesion.session) return null;            // no hay nadie logueado

  const { data, error } = await db.rpc('mi_rol');
  if (error) return null;
  return data;                                 // 'alumno' | 'cocina' | 'admin' | 'pendiente'
}

// --- Guardia: proteger una pantalla -----------------------------------
// Se llama al cargar cocina.html o admin.html.
// Si el usuario no esta logueado o no tiene el rol permitido,
// lo manda de vuelta al login.
async function exigirRol(rolesPermitidos) {
  const rol = await obtenerRol();

  if (!rol) {
    // No hay sesion -> al login.
    window.location.href = 'login.html';
    return null;
  }
  if (!rolesPermitidos.includes(rol)) {
    // Tiene sesion pero rol equivocado -> al login con aviso.
    alert('No tienes permiso para esta pantalla.');
    window.location.href = 'login.html';
    return null;
  }
  return rol;  // todo bien, puede quedarse
}

// --- Cerrar sesion (lo usan los botones "Salir") ----------------------
async function cerrarSesion() {
  await db.auth.signOut();
  window.location.href = 'login.html';
}
