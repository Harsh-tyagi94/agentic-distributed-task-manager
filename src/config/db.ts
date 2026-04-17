// src/db.ts
import pg from "pg"
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DB_URL,
});

export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params)
}
