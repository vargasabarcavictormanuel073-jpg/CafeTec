-- CafeTec: fotografías públicas para el catálogo de platillos.

alter table public.platillos
  add column if not exists imagen_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'platillos', 'platillos', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admin consulta fotos de platillos" on storage.objects;
create policy "admin consulta fotos de platillos"
on storage.objects for select to authenticated
using (bucket_id = 'platillos' and public.mi_rol() = 'admin');

drop policy if exists "admin sube fotos de platillos" on storage.objects;
create policy "admin sube fotos de platillos"
on storage.objects for insert to authenticated
with check (bucket_id = 'platillos' and public.mi_rol() = 'admin');

drop policy if exists "admin actualiza fotos de platillos" on storage.objects;
create policy "admin actualiza fotos de platillos"
on storage.objects for update to authenticated
using (bucket_id = 'platillos' and public.mi_rol() = 'admin')
with check (bucket_id = 'platillos' and public.mi_rol() = 'admin');

drop policy if exists "admin elimina fotos de platillos" on storage.objects;
create policy "admin elimina fotos de platillos"
on storage.objects for delete to authenticated
using (bucket_id = 'platillos' and public.mi_rol() = 'admin');
