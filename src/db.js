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

  async updateAISettings(data) {
    const { personality_prompt, business_description, welcome_message, goals, restrictions } = data
    await pool.query(`
      UPDATE ai_settings SET
        personality_prompt   = COALESCE($1, personality_prompt),
        business_description = COALESCE($2, business_description),
        welcome_message      = COALESCE($3, welcome_message),
        goals                = COALESCE($4, goals),
        restrictions         = COALESCE($5, restrictions),
        updated_at           = NOW()
      WHERE id = (SELECT id FROM ai_settings LIMIT 1)
    `, [personality_prompt, business_description, welcome_message, goals, restrictions])
    return this.getAISettings()
  },

  async getConversations() {
    const { rows } = await pool.query(`
      SELECT
        conv.id,
        conv.last_message_at,
        c.phone,
        c.name,
        c.first_contact_at,
        (SELECT content FROM messages WHERE conversation_id = conv.id ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT sender  FROM messages WHERE conversation_id = conv.id ORDER BY created_at DESC LIMIT 1) AS last_sender,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = conv.id)::int AS message_count
      FROM conversations conv
      JOIN contacts c ON c.id = conv.contact_id
      ORDER BY conv.last_message_at DESC NULLS LAST
      LIMIT 100
    `)
    return rows
  },

  async getMessages(conversationId) {
    const { rows } = await pool.query(`
      SELECT id, sender, type, content, created_at
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
    `, [conversationId])
    return rows
  },

  async getStats() {
    const msgs24h = await pool.query(`
      SELECT COUNT(*) as total FROM messages
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `)
    const contacts = await pool.query(`SELECT COUNT(*) as total FROM contacts`)
    const total    = await pool.query(`SELECT COUNT(*) as total FROM messages`)
    return {
      messages_24h:    parseInt(msgs24h.rows[0].total),
      total_contacts:  parseInt(contacts.rows[0].total),
      total_messages:  parseInt(total.rows[0].total),
    }
  }
}
