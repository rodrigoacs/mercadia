import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
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

      CREATE TABLE IF NOT EXISTS decks (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        format VARCHAR(50),
        cover_image_uri TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS deck_cards (
        id SERIAL PRIMARY KEY,
        deck_id INTEGER REFERENCES decks(id) ON DELETE CASCADE,
        qty INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        set_code VARCHAR(50),
        image_uri TEXT,
        mana_cost VARCHAR(50),
        type_line VARCHAR(255),
        color_identity VARCHAR(50),
        is_commander BOOLEAN DEFAULT FALSE
      );
    `)
    console.log('📦 Tabelas do cofre e de decks verificadas/criadas com sucesso no PostgreSQL.')
  } catch (err) {
    console.error('Erro crítico ao inicializar o banco de dados:', err)
  } finally {
    client.release()
  }
}