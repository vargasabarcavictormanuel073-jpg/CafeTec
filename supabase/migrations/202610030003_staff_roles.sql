-- CafeTec: administracion segura de los tres perfiles.

create or replace function public.cambiar_rol_usuario(
  p_usuario_id uuid,
  p_rol text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admins integer;
begin
  if public.mi_rol() <> 'admin' then
    raise exception 'Solo un administrador puede cambiar perfiles.';
  end if;
  if p_rol not in ('alumno', 'cocina', 'admin') then
    raise exception 'Perfil no valido.';
  end if;

  if p_usuario_id = auth.uid() and p_rol <> 'admin' then
    select count(*) into v_admins from public.usuarios where rol = 'admin';
    if v_admins <= 1 then
      raise exception 'No puedes quitar el ultimo perfil administrador.';
    end if;
  end if;

  update public.usuarios
  set rol = p_rol,
      verificacion_estado = case
        when p_rol in ('admin', 'cocina') then 'aprobada'
        else verificacion_estado
      end,
      bloqueado = case when p_rol in ('admin', 'cocina') then false else bloqueado end
  where id = p_usuario_id;

  if not found then raise exception 'Cuenta no encontrada.'; end if;
end;
$$;

grant execute on function public.cambiar_rol_usuario(uuid, text) to authenticated;
