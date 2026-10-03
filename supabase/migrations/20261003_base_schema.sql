-- CafeTec: esquema base completo para un proyecto nuevo de Supabase.
-- Ejecutar antes de 202610030002_identity_verification.sql.

create extension if not exists pgcrypto;

create table if not exists public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  correo text not null unique,
  nombre text,
  rol text not null default 'alumno' check (rol in ('alumno', 'cocina', 'admin', 'pendiente')),
  faltas integer not null default 0 check (faltas >= 0),
  bloqueado boolean not null default false,
  creado timestamptz not null default now()
);

create table if not exists public.config (
  id integer primary key default 1 check (id = 1),
  hora_apertura time not null default '08:00',
  hora_cierre time not null default '14:00',
  capacidad_franja integer not null default 100 check (capacidad_franja > 0),
  check (hora_apertura < hora_cierre)
);

insert into public.config (id) values (1) on conflict (id) do nothing;

create table if not exists public.platillos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(trim(nombre)) between 2 and 100),
  precio numeric(10,2) not null check (precio > 0),
  puntos integer not null check (puntos > 0),
  categoria text not null default 'Comida' check (categoria in ('Comida', 'Bebidas', 'Postres', 'Snacks')),
  creado timestamptz not null default now()
);

create table if not exists public.disponibilidad_dia (
  platillo_id uuid not null references public.platillos(id) on delete cascade,
  fecha date not null,
  activo boolean not null default true,
  primary key (platillo_id, fecha)
);

create table if not exists public.franjas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  inicio time not null,
  capacidad integer not null check (capacidad > 0),
  usado integer not null default 0 check (usado >= 0),
  abierta boolean not null default true,
  creado timestamptz not null default now(),
  unique (fecha, inicio),
  check (usado <= capacidad)
);

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id),
  franja_id uuid not null references public.franjas(id),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_cocina', 'listo', 'recogido', 'no_recogido', 'cancelado')),
  creado timestamptz not null default now()
);

create table if not exists public.pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  platillo_id uuid not null references public.platillos(id),
  cantidad integer not null check (cantidad > 0 and cantidad <= 20),
  comentario text not null default '' check (char_length(comentario) <= 240),
  precio_unitario numeric(10,2) not null check (precio_unitario > 0),
  puntos_unitarios integer not null check (puntos_unitarios > 0)
);

create index if not exists pedidos_usuario_idx on public.pedidos(usuario_id, creado desc);
create index if not exists pedidos_franja_idx on public.pedidos(franja_id, creado);
create index if not exists franjas_fecha_idx on public.franjas(fecha, inicio);
create index if not exists disponibilidad_fecha_idx on public.disponibilidad_dia(fecha, activo);

create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.usuarios where id = auth.uid();
$$;

grant execute on function public.mi_rol() to authenticated;

create or replace function public.crear_perfil_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuarios (id, correo, nombre, rol)
  values (
    new.id,
    lower(new.email),
    nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''),
    case
      when lower(new.email) like '%@costagrande.tecnm.mx' then 'alumno'
      else 'pendiente'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists crear_perfil_al_registrar on auth.users;
create trigger crear_perfil_al_registrar
after insert on auth.users
for each row execute function public.crear_perfil_usuario();

create or replace function public.generar_franjas_dia(p_fecha date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apertura time;
  v_cierre time;
  v_capacidad integer;
begin
  if auth.uid() is null or public.mi_rol() not in ('admin', 'cocina') then
    raise exception 'No tienes permiso para generar franjas.';
  end if;

  select hora_apertura, hora_cierre, capacidad_franja
  into v_apertura, v_cierre, v_capacidad
  from public.config where id = 1;

  insert into public.franjas (fecha, inicio, capacidad)
  select p_fecha, hora::time, v_capacidad
  from generate_series(
    p_fecha + v_apertura,
    p_fecha + v_cierre - interval '30 minutes',
    interval '30 minutes'
  ) as hora
  on conflict (fecha, inicio) do nothing;
end;
$$;

grant execute on function public.generar_franjas_dia(date) to authenticated;

create or replace function public.crear_pedido(
  p_usuario_id uuid,
  p_franja_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido_id uuid := gen_random_uuid();
  v_costo integer;
  v_items_solicitados integer;
  v_items_validos integer;
  v_franja public.franjas%rowtype;
begin
  if auth.uid() is null or auth.uid() <> p_usuario_id then
    raise exception 'No puedes crear pedidos para otra cuenta.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene platillos.';
  end if;

  select * into v_franja from public.franjas where id = p_franja_id for update;
  if not found or not v_franja.abierta then raise exception 'La franja ya no está disponible.'; end if;
  if v_franja.fecha <> current_date then raise exception 'Solo puedes pedir para hoy.'; end if;

  v_items_solicitados := jsonb_array_length(p_items);

  with solicitados as (
    select
      (item ->> 'platillo_id')::uuid as platillo_id,
      greatest(1, least(20, (item ->> 'cantidad')::integer)) as cantidad
    from jsonb_array_elements(p_items) item
  )
  select sum(p.puntos * s.cantidad)::integer, count(*)::integer
  into v_costo, v_items_validos
  from solicitados s
  join public.platillos p on p.id = s.platillo_id
  join public.disponibilidad_dia d on d.platillo_id = p.id and d.fecha = current_date and d.activo;

  if v_costo is null or v_items_validos <> v_items_solicitados then
    raise exception 'El pedido contiene platillos no disponibles.';
  end if;
  if v_franja.usado + v_costo > v_franja.capacidad then raise exception 'La franja ya no tiene suficiente espacio.'; end if;

  insert into public.pedidos (id, usuario_id, franja_id) values (v_pedido_id, p_usuario_id, p_franja_id);

  insert into public.pedido_items (
    pedido_id, platillo_id, cantidad, comentario, precio_unitario, puntos_unitarios
  )
  select
    v_pedido_id,
    p.id,
    greatest(1, least(20, (item ->> 'cantidad')::integer)),
    left(coalesce(item ->> 'comentario', ''), 240),
    p.precio,
    p.puntos
  from jsonb_array_elements(p_items) item
  join public.platillos p on p.id = (item ->> 'platillo_id')::uuid
  join public.disponibilidad_dia d on d.platillo_id = p.id and d.fecha = current_date and d.activo;

  update public.franjas set usado = usado + v_costo where id = p_franja_id;
  return v_pedido_id;
end;
$$;

grant execute on function public.crear_pedido(uuid, uuid, jsonb) to authenticated;

create or replace function public.liberar_pedido(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_puntos integer;
begin
  if public.mi_rol() not in ('admin', 'cocina') then raise exception 'No tienes permiso.'; end if;
  select * into v_pedido from public.pedidos where id = p_pedido_id for update;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  if v_pedido.estado in ('recogido', 'no_recogido', 'cancelado') then raise exception 'El pedido ya está cerrado.'; end if;

  select coalesce(sum(cantidad * puntos_unitarios), 0)::integer
  into v_puntos from public.pedido_items where pedido_id = p_pedido_id;

  update public.pedidos set estado = 'no_recogido' where id = p_pedido_id;
  update public.franjas set usado = greatest(0, usado - v_puntos) where id = v_pedido.franja_id;
  update public.usuarios
  set faltas = faltas + 1,
      bloqueado = (faltas + 1 >= 3)
  where id = v_pedido.usuario_id;
end;
$$;

grant execute on function public.liberar_pedido(uuid) to authenticated;

create or replace function public.desbloquear_alumno(p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.mi_rol() not in ('admin', 'cocina') then raise exception 'No tienes permiso.'; end if;
  update public.usuarios set bloqueado = false, faltas = 0 where id = p_usuario_id and rol = 'alumno';
end;
$$;

grant execute on function public.desbloquear_alumno(uuid) to authenticated;

alter table public.usuarios enable row level security;
alter table public.config enable row level security;
alter table public.platillos enable row level security;
alter table public.disponibilidad_dia enable row level security;
alter table public.franjas enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;

drop policy if exists "usuarios leen perfiles permitidos" on public.usuarios;
create policy "usuarios leen perfiles permitidos" on public.usuarios for select to authenticated
using (id = auth.uid() or public.mi_rol() in ('admin', 'cocina'));

drop policy if exists "admin actualiza perfiles" on public.usuarios;
create policy "admin actualiza perfiles" on public.usuarios for update to authenticated
using (public.mi_rol() = 'admin')
with check (public.mi_rol() = 'admin');

drop policy if exists "config lectura autenticada" on public.config;
create policy "config lectura autenticada" on public.config for select to authenticated using (true);
drop policy if exists "config admin escribe" on public.config;
create policy "config admin escribe" on public.config for all to authenticated
using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

drop policy if exists "platillos lectura autenticada" on public.platillos;
create policy "platillos lectura autenticada" on public.platillos for select to authenticated using (true);
drop policy if exists "platillos admin escribe" on public.platillos;
create policy "platillos admin escribe" on public.platillos for all to authenticated
using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

drop policy if exists "disponibilidad lectura autenticada" on public.disponibilidad_dia;
create policy "disponibilidad lectura autenticada" on public.disponibilidad_dia for select to authenticated using (true);
drop policy if exists "disponibilidad admin escribe" on public.disponibilidad_dia;
create policy "disponibilidad admin escribe" on public.disponibilidad_dia for all to authenticated
using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

drop policy if exists "franjas lectura autenticada" on public.franjas;
create policy "franjas lectura autenticada" on public.franjas for select to authenticated using (true);
drop policy if exists "franjas personal escribe" on public.franjas;
create policy "franjas personal escribe" on public.franjas for all to authenticated
using (public.mi_rol() in ('admin', 'cocina')) with check (public.mi_rol() in ('admin', 'cocina'));

drop policy if exists "pedidos lectura por rol" on public.pedidos;
create policy "pedidos lectura por rol" on public.pedidos for select to authenticated
using (usuario_id = auth.uid() or public.mi_rol() in ('admin', 'cocina'));
drop policy if exists "pedidos personal actualiza" on public.pedidos;
create policy "pedidos personal actualiza" on public.pedidos for update to authenticated
using (public.mi_rol() in ('admin', 'cocina')) with check (public.mi_rol() in ('admin', 'cocina'));

drop policy if exists "items lectura por pedido" on public.pedido_items;
create policy "items lectura por pedido" on public.pedido_items for select to authenticated
using (exists (
  select 1 from public.pedidos p
  where p.id = pedido_id and (p.usuario_id = auth.uid() or public.mi_rol() in ('admin', 'cocina'))
));

grant select on public.config, public.platillos, public.disponibilidad_dia, public.franjas, public.pedidos, public.pedido_items, public.usuarios to authenticated;
grant insert, update, delete on public.platillos, public.disponibilidad_dia, public.franjas to authenticated;
grant update on public.pedidos, public.usuarios to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.pedidos;
exception when duplicate_object then null;
end $$;
