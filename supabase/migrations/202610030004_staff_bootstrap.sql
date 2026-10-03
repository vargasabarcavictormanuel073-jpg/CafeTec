-- CafeTec: permite crear cuentas de personal sin dar acceso de alumno.
-- Todo correo no institucional queda en rol pendiente hasta que un admin lo promueva.

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
