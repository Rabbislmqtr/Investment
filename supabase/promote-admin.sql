-- Run this after your first admin user signs up.
-- Replace the email address before running.

update public.profiles
set role = 'admin'
where email = 'admin@example.com';
