DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'evolution') THEN
    CREATE DATABASE evolution;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'clinica') THEN
    CREATE DATABASE clinica;
  END IF;
END
$$;
