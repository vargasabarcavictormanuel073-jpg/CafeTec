-- CafeTec: verificacion de identidad y operaciones seguras.
-- Ejecutar en Supabase SQL Editor con una cuenta propietaria del proyecto.

alter table public.usuarios add column if not exists matricula text;
alter table public.usuarios add column if not exists credencial_path text;
alter table public.usuarios add column if not exists verificacion_estado text;
alter table public.usuarios add column if not exists verificacion_notas text;
alter table public.usuarios add column if not exists verificado_en timestamptz;
alter table public.usuarios add column if not exists verificado_por uuid;
alter table public.usuarios enable row level security;

-- No bloquear a quienes ya usaban la app antes de esta migracion.
update public.usuarios
set verificacion_estado = 'aprobada'
where verificacion_estado is null;

alter table public.usuarios
  alter column verificacion_estado set default 'pendiente';

alter table public.usuarios
  alter column verificacion_estado set not null;

alter table public.usuarios drop constraint if exists usuarios_verificacion_estado_check;
alter table public.usuarios add constraint usuarios_verificacion_estado_check
  check (verificacion_estado in ('pendiente', 'aprobada', 'rechazada'));

create unique index if not exists usuarios_matricula_unica
  on public.usuarios (lower(matricula))
  where matricula is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'credenciales',
  'credenciales',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "alumno sube su credencial" on storage.objects;
create policy "alumno sube su credencial"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'credenciales'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "alumno reemplaza su credencial" on storage.objects;
create policy "alumno reemplaza su credencial"
on storage.objects for update to authenticated
using (
  bucket_id = 'credenciales'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'credenciales'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "alumno ve su credencial" on storage.objects;
create policy "alumno ve su credencial"
on storage.objects for select to authenticated
using (
  bucket_id = 'credenciales'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.mi_rol() = 'admin'
  )
);

drop policy if exists "admin ve usuarios" on public.usuarios;
create policy "admin ve usuarios"
on public.usuarios for select to authenticated
using (public.mi_rol() = 'admin' or id = auth.uid());

drop policy if exists "admin actualiza usuarios" on public.usuarios;
create policy "admin actualiza usuarios"
on public.usuarios for update to authenticated
using (public.mi_rol() = 'admin')
with check (public.mi_rol() = 'admin');

create or replace function public.registrar_credencial(
  p_nombre text,
  p_matricula text,
  p_ruta text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_correo text := lower(auth.jwt() ->> 'email');
  v_matricula text := upper(trim(p_matricula));
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesion.';
  end if;
  if v_correo not like '%@costagrande.tecnm.mx' then
    raise exception 'Usa tu correo institucional.';
  end if;
  if trim(coalesce(p_nombre, '')) = '' then
    raise exception 'Escribe tu nombre completo.';
  end if;
  if v_matricula !~ '^[A-Z0-9]{6,20}$' then
    raise exception 'La matricula no tiene un formato valido.';
  end if;
  if p_ruta not like v_uid::text || '/%' then
    raise exception 'La ruta de la credencial no es valida.';
  end if;

  insert into public.usuarios (
    id, correo, nombre, matricula, rol, faltas, bloqueado,
    credencial_path, verificacion_estado, verificacion_notas
  ) values (
    v_uid, v_correo, trim(p_nombre), v_matricula, 'alumno', 0, false,
    p_ruta, 'pendiente', null
  )
  on conflict (id) do update set
    nombre = excluded.nombre,
    matricula = excluded.matricula,
    credencial_path = excluded.credencial_path,
    verificacion_estado = 'pendiente',
    verificacion_notas = null,
    verificado_en = null,
    verificado_por = null;
end;
$$;

grant execute on function public.registrar_credencial(text, text, text) to authenticated;

create or replace function public.revisar_credencial(
  p_usuario_id uuid,
  p_estado text,
  p_notas text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.mi_rol() <> 'admin' then
    raise exception 'Solo un administrador puede revisar credenciales.';
  end if;
  if p_estado not in ('aprobada', 'rechazada') then
    raise exception 'Estado de revision invalido.';
  end if;

  update public.usuarios set
    verificacion_estado = p_estado,
    verificacion_notas = nullif(trim(coalesce(p_notas, '')), ''),
    verificado_en = case when p_estado = 'aprobada' then now() else null end,
    verificado_por = case when p_estado = 'aprobada' then auth.uid() else null end
  where id = p_usuario_id;

  if not found then raise exception 'Usuario no encontrado.'; end if;
end;
$$;

grant execute on function public.revisar_credencial(uuid, text, text) to authenticated;

create or replace function public.listar_cuentas_admin()
returns table (
  id uuid,
  correo text,
  nombre text,
  matricula text,
  rol text,
  faltas integer,
  bloqueado boolean,
  verificacion_estado text,
  verificacion_notas text,
  credencial_path text,
  creado timestamptz,
  ultimo_acceso timestamptz,
  correo_confirmado boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if public.mi_rol() <> 'admin' then
    raise exception 'Solo un administrador puede listar las cuentas.';
  end if;

  return query
  select
    a.id,
    a.email::text,
    u.nombre::text,
    u.matricula::text,
    coalesce(u.rol::text, 'alumno'),
    coalesce(u.faltas, 0)::integer,
    coalesce(u.bloqueado, false),
    coalesce(u.verificacion_estado, 'pendiente')::text,
    u.verificacion_notas::text,
    u.credencial_path::text,
    a.created_at,
    a.last_sign_in_at,
    a.email_confirmed_at is not null
  from auth.users a
  left join public.usuarios u on u.id = a.id
  order by a.created_at desc;
end;
$$;

grant execute on function public.listar_cuentas_admin() to authenticated;

create or replace function public.validar_identidad_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_bloqueado boolean;
begin
  select verificacion_estado, bloqueado
  into v_estado, v_bloqueado
  from public.usuarios
  where id = new.usuario_id;

  if coalesce(v_estado, 'pendiente') <> 'aprobada' then
    raise exception 'Tu credencial estudiantil aun no ha sido aprobada.';
  end if;
  if coalesce(v_bloqueado, false) then
    raise exception 'Tu cuenta esta bloqueada. Acude a la cafeteria.';
  end if;
  return new;
end;
$$;

drop trigger if exists validar_identidad_antes_de_pedido on public.pedidos;
create trigger validar_identidad_antes_de_pedido
before insert on public.pedidos
for each row execute function public.validar_identidad_pedido();

create or replace function public.vender_mostrador(
  p_franja_id uuid,
  p_puntos integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.mi_rol() not in ('admin', 'cocina') then
    raise exception 'No tienes permiso para registrar ventas de mostrador.';
  end if;
  if p_puntos <= 0 then raise exception 'Puntos invalidos.'; end if;

  update public.franjas
  set usado = usado + p_puntos
  where id = p_franja_id
    and abierta = true
    and usado + p_puntos <= capacidad;

  if not found then
    raise exception 'La franja esta cerrada o ya no tiene capacidad.';
  end if;
end;
$$;

grant execute on function public.vender_mostrador(uuid, integer) to authenticated;
