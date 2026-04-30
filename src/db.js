import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export const db = {
  // ── WhatsApp ──────────────────────────────────────────────────────
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
    const msgs24h = await pool.query(`SELECT COUNT(*) as total FROM messages WHERE created_at > NOW() - INTERVAL '24 hours'`)
    const contacts = await pool.query(`SELECT COUNT(*) as total FROM contacts`)
    const total    = await pool.query(`SELECT COUNT(*) as total FROM messages`)
    const convs    = await pool.query(`SELECT COUNT(*) as total FROM conversations`)
    const aiMsgs   = await pool.query(`SELECT COUNT(*) as total FROM messages WHERE sender = 'ai'`)
    return {
      messages_24h:        parseInt(msgs24h.rows[0].total),
      total_contacts:      parseInt(contacts.rows[0].total),
      total_messages:      parseInt(total.rows[0].total),
      total_conversations: parseInt(convs.rows[0].total),
      ai_messages:         parseInt(aiMsgs.rows[0].total),
    }
  },

  async getWeeklyActivity() {
    const { rows } = await pool.query(`
      SELECT
        DATE_TRUNC('day', created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS day,
        COUNT(*) FILTER (WHERE sender = 'client') AS client_msgs,
        COUNT(*) FILTER (WHERE sender = 'ai')     AS ai_msgs
      FROM messages
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY 1 ORDER BY 1
    `)
    return rows.map(r => ({ day: r.day, client: parseInt(r.client_msgs), ai: parseInt(r.ai_msgs) }))
  },

  async getHourlyActivity() {
    const { rows } = await pool.query(`
      SELECT
        EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::int AS hour,
        COUNT(*) AS total
      FROM messages
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY 1 ORDER BY 1
    `)
    const result = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0 }))
    for (const r of rows) result[r.hour].total = parseInt(r.total)
    return result
  },

  // ── Products ──────────────────────────────────────────────────────
  async getProducts() {
    const { rows } = await pool.query(`
      SELECT p.*,
        COALESCE(
          json_agg(json_build_object('id', pi.id, 'name', pi.image_name, 'data', pi.image_data))
          FILTER (WHERE pi.id IS NOT NULL), '[]'
        ) AS images
      FROM products p
      LEFT JOIN product_images pi ON pi.product_id = p.id
      WHERE p.active = true
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `)
    return rows
  },

  async getActiveProducts() {
    const { rows } = await pool.query(`
      SELECT id, name, category, price, description, availability, ai_when, ai_how, keywords, can_send_image
      FROM products
      WHERE active = true
      ORDER BY category, name
    `)
    return rows
  },

  async createProduct(data) {
    const { name, category, price, description, availability, ai_when, ai_how, keywords, can_send_image } = data
    const { rows } = await pool.query(`
      INSERT INTO products (name, category, price, description, availability, ai_when, ai_how, keywords, can_send_image)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [name, category || 'servicio', price || null, description || null, availability || null,
        ai_when || null, ai_how || null, keywords || [], can_send_image || false])
    return rows[0]
  },

  async updateProduct(id, data) {
    const { name, category, price, description, availability, ai_when, ai_how, keywords, can_send_image } = data
    const { rows } = await pool.query(`
      UPDATE products SET
        name          = COALESCE($2, name),
        category      = COALESCE($3, category),
        price         = $4,
        description   = $5,
        availability  = $6,
        ai_when       = $7,
        ai_how        = $8,
        keywords      = COALESCE($9, keywords),
        can_send_image = COALESCE($10, can_send_image),
        updated_at    = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, name, category, price || null, description || null, availability || null,
        ai_when || null, ai_how || null, keywords, can_send_image])
    return rows[0]
  },

  async deleteProduct(id) {
    await pool.query('UPDATE products SET active = false WHERE id = $1', [id])
  },

  async addProductImage(productId, imageData, imageName) {
    const { rows } = await pool.query(`
      INSERT INTO product_images (product_id, image_data, image_name)
      VALUES ($1, $2, $3) RETURNING id, image_name
    `, [productId, imageData, imageName || null])
    return rows[0]
  },

  async deleteProductImage(imageId) {
    await pool.query('DELETE FROM product_images WHERE id = $1', [imageId])
  },

  // ── Catalog images ────────────────────────────────────────────────
  async getCatalogImages() {
    const { rows } = await pool.query(`
      SELECT id, name, description, context_when, image_data, created_at
      FROM catalog_images
      WHERE active = true
      ORDER BY created_at DESC
    `)
    return rows
  },

  async addCatalogImage(data) {
    const { name, description, context_when, image_data } = data
    const { rows } = await pool.query(`
      INSERT INTO catalog_images (name, description, context_when, image_data)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, description, context_when, created_at
    `, [name, description || null, context_when || null, image_data])
    return rows[0]
  },

  async deleteCatalogImage(id) {
    await pool.query('DELETE FROM catalog_images WHERE id = $1', [id])
  },
}
