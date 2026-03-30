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
    `)
    console.log('📦 Tabela historico_cartas verificada/criada com sucesso no PostgreSQL.')
  } catch (err) {
    console.error('Erro ao inicializar o banco de dados:', err)
  } finally {
    client.release()
  }
}