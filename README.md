# CafeTec

Aplicación web de cafetería escolar con tres perfiles:

- **Alumno:** registro con correo institucional, matrícula y fotografía obligatoria de credencial; menú, pedidos y seguimiento en vivo.
- **Cocina:** operación por franjas, estados de pedidos, ventas de mostrador y alumnos bloqueados.
- **Administración:** menú, horarios, capacidad, resumen diario, listado de cuentas y aprobación o rechazo de credenciales.

## Rutas

- `/` o `/alumnoscafe/`: acceso de alumnos.
- `/PERSONAL/login.html`: acceso de cocina y administración.
- `/cafeteria/`: acceso directo del personal al tablero de pedidos en tiempo real.

## Configuración de Supabase

1. Configura la URL y la clave pública en `alumnoscafe/config.js` y `PERSONAL/comun.js`.
2. Vincula el proyecto con `supabase link --project-ref <referencia>`.
3. Aplica todas las migraciones en orden con `supabase db push`.
4. Conserva RLS habilitado en las tablas públicas y en `storage.objects`.

Las migraciones crean el esquema completo, Realtime para pedidos, el bucket privado `credenciales`, la verificación de identidad y la administración segura de los perfiles alumno, cocina y administrador.

## Despliegue

Vercel despliega automáticamente la rama `main` del repositorio de GitHub.
