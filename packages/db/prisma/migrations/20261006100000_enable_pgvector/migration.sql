-- pgvector is installed for later phases. Doing it in a migration means every new database (including the test database) gets it.
CREATE EXTENSION IF NOT EXISTS vector;
