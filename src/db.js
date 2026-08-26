import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('❌ Erro inesperado em cliente ocioso do pool PostgreSQL:', err)
})

export const initDB = async () => {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS historico_cartas (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        name VARCHAR(255) NOT NULL,
        set_code VARCHAR(100) NOT NULL,
        num VARCHAR(50),
        extras VARCHAR(100),
        qty INTEGER NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        total_price DECIMAL(10, 2) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_historico_data ON historico_cartas (date);
      CREATE INDEX IF NOT EXISTS idx_historico_nome_set ON historico_cartas (name, set_code);

      CREATE TABLE IF NOT EXISTS decks (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        format VARCHAR(50) DEFAULT 'Commander',
        cover_image_uri VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS deck_cards (
        id SERIAL PRIMARY KEY,
        deck_id INTEGER REFERENCES decks(id) ON DELETE CASCADE,
        qty INTEGER NOT NULL DEFAULT 1,
        name VARCHAR(255) NOT NULL,
        set_code VARCHAR(100),
        image_uri VARCHAR(500),
        mana_cost VARCHAR(50),
        type_line VARCHAR(255),
        color_identity VARCHAR(50),
        is_commander BOOLEAN DEFAULT FALSE
      );

      -- Antes só existia via 'DROP TABLE' destrutivo dentro de
      -- updateMetadata.js (apagava is_manual_override a cada resync).
      -- Esse DROP foi removido de lá — o schema correto vive aqui agora.
      CREATE TABLE IF NOT EXISTS metadata_cartas (
        name VARCHAR(255) NOT NULL,
        set_code VARCHAR(100) NOT NULL,
        num VARCHAR(50) NOT NULL,
        extras VARCHAR(100) NOT NULL,
        color_identity VARCHAR(50),
        mana_cost VARCHAR(50),
        cmc DECIMAL(10, 2),
        type_line VARCHAR(255),
        rarity VARCHAR(50),
        oracle_text TEXT,
        legalities JSONB,
        image_uri TEXT,
        scryfall_set VARCHAR(50),
        is_manual_override BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (name, set_code, num, extras)
      );
      ALTER TABLE metadata_cartas ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN DEFAULT FALSE;
      ALTER TABLE metadata_cartas ADD COLUMN IF NOT EXISTS scryfall_set VARCHAR(50);

      -- Cache local do bulk data do Scryfall. Só é recriada do zero por
      -- syncScryfall.js — e ali o DROP é seguro, porque é dado 100%
      -- espelhado da API externa, sem nenhum override seu dentro.
      CREATE TABLE IF NOT EXISTS scryfall_cards (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        lang VARCHAR(10),
        set_code VARCHAR(20),
        collector_number VARCHAR(50),
        image_normal VARCHAR(500),
        image_art_crop VARCHAR(500),
        mana_cost VARCHAR(100),
        type_line VARCHAR(255),
        color_identity VARCHAR(50),
        card_data JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_scryfall_name ON scryfall_cards (name);

      CREATE TABLE IF NOT EXISTS set_translations (
        liga_name TEXT PRIMARY KEY,
        scryfall_code TEXT NOT NULL
      );
    `)
    console.log('📦 Schema completo verificado/criado com sucesso no PostgreSQL.')
  } catch (err) {
    console.error('Erro crítico ao inicializar o banco de dados:', err)
    throw err
  } finally {
    client.release()
  }
}
