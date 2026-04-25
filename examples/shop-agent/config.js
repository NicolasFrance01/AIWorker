/**
 * examples/shop-agent/config.js
 * Ejemplo: Agente para una tienda online.
 * Muestra cómo usar acciones con slot-filling, catálogo, carrito y más.
 *
 * Para probarlo:
 *   node api/server.js --config examples/shop-agent/config.js
 * (O copia el contenido de module.exports a tu agent.config.js)
 */

'use strict';

// ── Datos de ejemplo (en un proyecto real, vendrían de tu DB) ─────────────────
const catalog = [
    { id: 1, name: 'Remera Básica', price: 2500, stock: 15, category: 'ropa' },
    { id: 2, name: 'Pantalón Jean', price: 7500, stock: 8, category: 'ropa' },
    { id: 3, name: 'Zapatillas Running', price: 18000, stock: 3, category: 'calzado' },
    { id: 4, name: 'Campera Deportiva', price: 12000, stock: 5, category: 'ropa' },
    { id: 5, name: 'Gorra Logo', price: 1800, stock: 20, category: 'accesorios' },
];

const orders = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
function searchProducts(query) {
    const q = query.toLowerCase();
    return catalog.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
}

function formatProduct(p) {
    return `• **${p.name}** — $${p.price.toLocaleString('es-AR')} (stock: ${p.stock})`;
}

// ── Configuración del agente ──────────────────────────────────────────────────
module.exports = {
    agent: {
        name: 'ShopBot',
        language: 'es',
        tone: 'friendly',
        avatar: '🛍',
        role: 'asistente de compras',
        welcomeMessage: '¡Bienvenido/a a nuestra tienda! 🛍 Soy ShopBot, tu asistente de compras. Podés buscar productos, ver el catálogo o hacer un pedido. ¿En qué te ayudo?',
    },

    memory: {
        maxHistory: 30,
        persistSessions: false,
    },

    server: {
        port: 3001, // Puerto diferente para no conflictuar con el agente default
        cors: true,
    },

    debug: false,

    actions: [
        // ── Ver catálogo completo ────────────────────────────────────────────────
        {
            name: 'viewCatalog',
            description: 'Ver el catálogo completo de productos',
            triggers: ['catálogo', 'catalogo', 'todos los productos', 'qué tienen',
                'qué vendés', 'ver todo', 'ver productos', 'listado'],
            intents: ['search', 'info'],
            slots: [],
            priority: 8,
            handler: async (params, ctx) => {
                const lines = catalog.map(formatProduct).join('\n');
                return `🛍 **Nuestro catálogo:**\n\n${lines}\n\n¿Cuál te interesa?`;
            },
        },

        // ── Buscar producto ──────────────────────────────────────────────────────
        {
            name: 'searchProduct',
            description: 'Buscar un producto específico',
            triggers: ['buscar', 'busco', 'tenés', 'tienen', 'quiero', 'necesito',
                'hay', 'tiene', 'buscarme'],
            intents: ['search', 'buy'],
            slots: [
                {
                    name: 'query',
                    question: 'qué producto estás buscando',
                    required: true,
                    type: 'string',
                },
            ],
            priority: 7,
            handler: async (params, ctx) => {
                const results = searchProducts(params.query);
                if (results.length === 0) {
                    return `Lo siento, no encontré productos que coincidan con "${params.query}". ¿Querés ver el catálogo completo?`;
                }
                const lines = results.map(formatProduct).join('\n');
                return `🔍 Encontré ${results.length} producto(s):\n\n${lines}\n\n¿Querés saber más de alguno?`;
            },
        },

        // ── Ver precio de un producto ────────────────────────────────────────────
        {
            name: 'getPrice',
            description: 'Consultar precio de un producto',
            triggers: ['precio', 'cuesta', 'vale', 'cuánto cuesta', 'cuánto vale',
                'cuánto sale', 'valor'],
            intents: ['buy', 'question'],
            slots: [
                {
                    name: 'productName',
                    question: 'de qué producto querés saber el precio',
                    required: true,
                    type: 'string',
                },
            ],
            priority: 9,
            handler: async (params, ctx) => {
                const results = searchProducts(params.productName);
                if (results.length === 0) {
                    return `No encontré un producto llamado "${params.productName}". ¿Querés ver el catálogo?`;
                }
                if (results.length === 1) {
                    const p = results[0];
                    return `💰 El **${p.name}** cuesta **$${p.price.toLocaleString('es-AR')}** y hay ${p.stock} disponibles. ¿Lo querés comprar?`;
                }
                const lines = results.map(formatProduct).join('\n');
                return `Encontré varios que coinciden:\n\n${lines}`;
            },
        },

        // ── Agregar al carrito ────────────────────────────────────────────────────
        {
            name: 'addToCart',
            description: 'Agregar un producto al carrito de compras',
            triggers: ['agregar', 'añadir', 'comprar', 'quiero comprar', 'llevar',
                'me llevo', 'agrégame', 'poneme'],
            intents: ['buy'],
            slots: [
                {
                    name: 'productName',
                    question: 'qué producto querés agregar al carrito',
                    required: true,
                    type: 'string',
                },
                {
                    name: 'quantity',
                    question: 'cuántas unidades querés',
                    required: false,
                    type: 'number',
                    entityKey: 'number',
                },
            ],
            priority: 10,
            handler: async (params, ctx) => {
                const results = searchProducts(params.productName);
                if (results.length === 0) {
                    return `No encontré "${params.productName}" en nuestro catálogo. ¿Querés ver qué tenemos?`;
                }

                const product = results[0];
                const qty = parseInt(params.quantity) || 1;

                if (qty > product.stock) {
                    return `Lo siento, solo tenemos ${product.stock} unidades disponibles de **${product.name}**.`;
                }

                // Guardar en carrito de la sesión
                const cart = ctx.working.cart || [];
                const existing = cart.find(i => i.id === product.id);
                if (existing) {
                    existing.qty += qty;
                } else {
                    cart.push({ id: product.id, name: product.name, price: product.price, qty });
                }
                ctx.memory.setWorking(ctx.sessionId, 'cart', cart);

                const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
                return `✅ Agregué **${qty}x ${product.name}** ($${(product.price * qty).toLocaleString('es-AR')}) a tu carrito.\n\n🛒 Total del carrito: **$${total.toLocaleString('es-AR')}**\n\n¿Querés confirmar el pedido o seguir comprando?`;
            },
        },

        // ── Ver carrito ───────────────────────────────────────────────────────────
        {
            name: 'viewCart',
            description: 'Ver el carrito de compras actual',
            triggers: ['carrito', 'ver carrito', 'mi carrito', 'qué tengo',
                'mis productos', 'lo que elegí'],
            intents: ['info'],
            slots: [],
            priority: 8,
            handler: async (params, ctx) => {
                const cart = ctx.working.cart || [];
                if (cart.length === 0) {
                    return '🛒 Tu carrito está vacío. ¿Querés ver el catálogo?';
                }
                const lines = cart.map(i => `• ${i.qty}x **${i.name}** — $${(i.price * i.qty).toLocaleString('es-AR')}`).join('\n');
                const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
                return `🛒 **Tu carrito:**\n\n${lines}\n\n💰 **Total: $${total.toLocaleString('es-AR')}**\n\n¿Confirmo el pedido?`;
            },
        },

        // ── Confirmar pedido ──────────────────────────────────────────────────────
        {
            name: 'confirmOrder',
            description: 'Confirmar y finalizar el pedido',
            triggers: ['confirmar', 'confirmo', 'finalizar', 'hacer pedido',
                'pagar', 'checkout', 'listo'],
            intents: ['affirmation'],
            slots: [],
            priority: 6,
            handler: async (params, ctx) => {
                const cart = ctx.working.cart || [];
                if (cart.length === 0) {
                    return '🛒 Tu carrito está vacío. Primero agregá productos.';
                }

                const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
                const orderId = 'ORD-' + Date.now().toString().slice(-6);
                const order = {
                    id: orderId,
                    items: [...cart],
                    total,
                    status: 'pendiente',
                    createdAt: new Date().toISOString(),
                    user: ctx.user,
                };

                orders.push(order);
                ctx.memory.setWorking(ctx.sessionId, 'cart', []);
                ctx.memory.setWorking(ctx.sessionId, 'lastOrder', orderId);

                const lines = cart.map(i => `• ${i.qty}x ${i.name}`).join('\n');
                return `🎉 **¡Pedido confirmado!**\n\n📋 N° de pedido: **${orderId}**\n\n${lines}\n\n💰 Total: **$${total.toLocaleString('es-AR')}**\n\nTe contactaremos pronto para coordinar la entrega. ¡Gracias por tu compra! 😊`;
            },
        },

        // ── Vaciar carrito ────────────────────────────────────────────────────────
        {
            name: 'clearCart',
            description: 'Vaciar el carrito de compras',
            triggers: ['vaciar carrito', 'borrar carrito', 'empezar de nuevo',
                'limpiar carrito', 'quitar todo'],
            intents: [],
            slots: [],
            handler: async (params, ctx) => {
                ctx.memory.setWorking(ctx.sessionId, 'cart', []);
                return '🗑 Carrito vaciado. ¿Querés empezar de cero?';
            },
        },
    ],
};
