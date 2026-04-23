import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export const db = {
  async upsertContact(phone, name) {
    const { rows } = await pool.query(`
      INSERT INTO contacts (phone, name, last_contact_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (phone) DO UPDATE 
        SET last_contact_at = NOW(),
            name = COALESCE($2, contacts.name)
      RETURNING *
    `, [phone, name])

    const contact = rows[0]

    let conv = await pool.query(
      'SELECT id FROM conversations WHERE contact_id = $1 ORDER BY last_message_at DESC LIMIT 1',
      [contact.id]
    )

    if (conv.rows.length === 0) {
      conv = await pool.query(
        'INSERT INTO conversations (contact_id) VALUES ($1) RETURNING *',
        [contact.id]
      )
    }

    contact.conversation_id = conv.rows[0].id
    return contact
  },

  async saveMessage(conversationId, sender, content) {
    await pool.query(`
      INSERT INTO messages (conversation_id, sender, type, content)
      VALUES ($1, $2, 'text', $3)
    `, [conversationId, sender, content])

    await pool.query(
      'UPDATE conversations SET last_message_at = NOW() WHERE id = $1',
      [conversationId]
    )
  },

  async getRecentMessages(conversationId, limit = 10) {
    const { rows } = await pool.query(`
      SELECT sender, content FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [conversationId, limit])
    return rows.reverse()
  },

  async getAISettings() {
    const { rows } = await pool.query('SELECT * FROM ai_settings LIMIT 1')
    return rows[0]
  },

  async getStats() {
    const msgs = await pool.query(`
      SELECT COUNT(*) as total FROM messages 
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `)
    const contacts = await pool.query(`
      SELECT COUNT(*) as total FROM contacts
    `)
    return {
      messages_24h: parseInt(msgs.rows[0].total),
      total_contacts: parseInt(contacts.rows[0].total)
    }
  }
}
