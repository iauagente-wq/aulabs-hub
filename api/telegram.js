// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AU LABS Hub â€” Telegram Webhook
// Recibe mensajes y fotos de Carlos, corre el agente IA con visiÃ³n,
// guarda en Supabase y responde por Telegram.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TG_API   = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const ANT_API  = 'https://api.anthropic.com/v1/messages';
const MODEL_V  = 'claude-sonnet-4-5';   // visiÃ³n (fotos de boletas)
const MODEL_T  = 'claude-haiku-4-5';    // texto rÃ¡pido
const MAX_LOOP = 8;

// â”€â”€ Supabase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SB = () => process.env.SUPABASE_URL;
const sbH = () => ({
  'apikey':        process.env.SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  'Content-Type':  'application/json',
  'Prefer':        'return=representation',
});

async function sbGet(table) {
  const r = await fetch(`${SB()}/rest/v1/${table}?order=created_at.desc`, { headers: sbH() });
  const rows = await r.json();
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({ ...row.data, id: row.id }));
}

async function sbInsert(table, id, data) {
  await fetch(`${SB()}/rest/v1/${table}`, {
    method: 'POST', headers: sbH(),
    body: JSON.stringify({ id, data }),
  });
}

async function sbUpdate(table, id, patch) {
  const r = await fetch(`${SB()}/rest/v1/${table}?id=eq.${id}`, { headers: sbH() });
  const rows = await r.json();
  if (!rows.length) return null;
  const updated = { ...rows[0].data, ...patch };
  await fetch(`${SB()}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH', headers: sbH(),
    body: JSON.stringify({ data: updated }),
  });
  return updated;
}

async function sbDelete(table, id) {
  await fetch(`${SB()}/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE', headers: sbH() });
}

// Historial de chat por chat_id de Telegram
async function getChatHistory(chatId) {
  const url = `${SB()}/rest/v1/chat_history?telegram_chat_id=eq.${chatId}&order=created_at.asc&limit=30`;
  const r = await fetch(url, { headers: sbH() });
  const rows = await r.json();
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({ role: row.role, content: row.content }));
}

async function saveChatMsg(chatId, role, content) {
  await fetch(`${SB()}/rest/v1/chat_history`, {
    method: 'POST', headers: sbH(),
    body: JSON.stringify({ role, content, telegram_chat_id: chatId }),
  });
}

// â”€â”€ Telegram helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function tgSend(chatId, text, extra = {}) {
  await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:    chatId,
      text:       text.slice(0, 4096), // Telegram limit
      parse_mode: 'HTML',
      ...extra,
    }),
  });
}

async function tgSendTyping(chatId) {
  await fetch(`${TG_API}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }).catch(() => {});
}

async function tgGetFileUrl(fileId) {
  const r = await fetch(`${TG_API}/getFile?file_id=${fileId}`);
  const d = await r.json();
  if (!d.ok) throw new Error('No se pudo obtener el archivo de Telegram');
  return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${d.result.file_path}`;
}

async function downloadBase64(url) {
  const r = await fetch(url);
  const buf = await r.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

// â”€â”€ Tool definitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TOOLS = [
  {
    name: 'get_resumen',
    description: 'Obtiene el estado actual: tareas y pedidos con sus IDs. Llamar antes de actualizar o para responder consultas.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'crear_tarea',
    description: 'Crea una nueva tarea/actividad en la BitÃ¡cora.',
    input_schema: {
      type: 'object',
      properties: {
        titulo:     { type: 'string' },
        area:       { type: 'string', enum: ['ðŸ¦º SST','ðŸ—ï¸ CRD','ðŸ½ï¸ ENEFOOD','ðŸ“ˆ Trading','ðŸ’» ProgramaciÃ³n','ðŸ–¨ï¸ ImpresiÃ³n 3D','ðŸ  Casa'] },
        tipo:       { type: 'string', enum: ['ðŸ“‹ Tarea','âš™ï¸ Avance','ðŸ›’ Compra','ðŸ’¡ Idea','ðŸ“ Nota','â° Recordatorio','ðŸ“‹ InspecciÃ³n'] },
        estado:     { type: 'string', enum: ['â¬œ Por hacer','ðŸ”„ Haciendo','âœ… Finalizado'] },
        proyecto:   { type: 'string' },
        detalle:    { type: 'string' },
        fecha:      { type: 'string', description: 'YYYY-MM-DD' },
        horaInicio: { type: 'string', description: 'HH:MM' },
        horaFin:    { type: 'string', description: 'HH:MM' },
        costoCLP:   { type: 'number' },
      },
      required: ['titulo', 'area', 'tipo', 'estado'],
    },
  },
  {
    name: 'actualizar_tarea',
    description: 'Actualiza campos de una tarea existente. Usar get_resumen primero para obtener el ID.',
    input_schema: {
      type: 'object',
      properties: {
        id:         { type: 'string' },
        titulo:     { type: 'string' },
        estado:     { type: 'string', enum: ['â¬œ Por hacer','ðŸ”„ Haciendo','âœ… Finalizado'] },
        detalle:    { type: 'string' },
        fecha:      { type: 'string' },
        horaInicio: { type: 'string' },
        horaFin:    { type: 'string' },
        costoCLP:   { type: 'number' },
        proyecto:   { type: 'string' },
        tipo:       { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'crear_pedido',
    description: 'Crea un nuevo pedido de impresiÃ³n 3D en AU Labs.',
    input_schema: {
      type: 'object',
      properties: {
        pedido:       { type: 'string' },
        cliente:      { type: 'string' },
        producto:     { type: 'string' },
        estado:       { type: 'string', enum: ['Cotizando','Confirmado','En producciÃ³n','Listo para entrega','Entregado'] },
        monto:        { type: 'number' },
        fechaEntrega: { type: 'string', description: 'YYYY-MM-DD' },
        pagado:       { type: 'boolean' },
        notas:        { type: 'string' },
      },
      required: ['pedido', 'cliente', 'estado'],
    },
  },
  {
    name: 'actualizar_pedido',
    description: 'Actualiza un pedido existente.',
    input_schema: {
      type: 'object',
      properties: {
        id:           { type: 'string' },
        pedido:       { type: 'string' },
        cliente:      { type: 'string' },
        estado:       { type: 'string', enum: ['Cotizando','Confirmado','En producciÃ³n','Listo para entrega','Entregado'] },
        monto:        { type: 'number' },
        fechaEntrega: { type: 'string' },
        pagado:       { type: 'boolean' },
        notas:        { type: 'string' },
        producto:     { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'eliminar_tarea',
    description: 'Elimina una tarea por ID.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'notificar',
    description: 'EnvÃ­a un mensaje de notificaciÃ³n formateado a Carlos por Telegram. Usar para confirmaciones importantes o alertas.',
    input_schema: {
      type: 'object',
      properties: {
        mensaje: { type: 'string', description: 'Mensaje corto con emojis, estilo resumen' },
      },
      required: ['mensaje'],
    },
  },
];

// â”€â”€ Tool executor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function executeTool(name, input, chatId) {
  const today = new Date().toISOString().slice(0, 10);

  if (name === 'get_resumen') {
    const tasks   = await sbGet('tasks');
    const pedidos = await sbGet('pedidos');
    const activas = tasks.filter(t => t.estado !== 'âœ… Finalizado');
    const pedActivos = pedidos.filter(p => !['Entregado','Cancelado'].includes(p.estado));
    const ingMes = pedidos
      .filter(p => p.pagado && p.creado >= today.slice(0, 7))
      .reduce((s, p) => s + (p.monto || 0), 0);
    return JSON.stringify({
      today,
      tareas_activas: activas.map(t => ({
        id: t.id, titulo: t.titulo, area: t.area,
        estado: t.estado, fecha: t.fecha, proyecto: t.proyecto, detalle: t.detalle,
      })),
      pedidos_activos: pedActivos.map(p => ({
        id: p.id, pedido: p.pedido, cliente: p.cliente,
        estado: p.estado, monto: p.monto, pagado: p.pagado, fechaEntrega: p.fechaEntrega,
      })),
      stats: {
        pendientes: tasks.filter(t => t.estado === 'â¬œ Por hacer').length,
        haciendo:   tasks.filter(t => t.estado === 'ðŸ”„ Haciendo').length,
        ingresos_mes_clp: ingMes,
      },
    });
  }

  if (name === 'crear_tarea') {
    const id = '_' + Math.random().toString(36).slice(2, 11);
    const obj = { id, creado: today, horaInicio: '', horaFin: '', costoCLP: null, proyecto: '', detalle: '', fecha: '', ...input };
    await sbInsert('tasks', id, obj);
    return JSON.stringify({ ok: true, id, titulo: obj.titulo });
  }

  if (name === 'actualizar_tarea') {
    const { id, ...patch } = input;
    const updated = await sbUpdate('tasks', id, patch);
    return JSON.stringify({ ok: true, titulo: updated?.titulo, estado: updated?.estado });
  }

  if (name === 'crear_pedido') {
    const id = '_' + Math.random().toString(36).slice(2, 11);
    const obj = { id, creado: today, pagado: false, fechaEntrega: '', notas: '', producto: '', monto: 0, ...input };
    await sbInsert('pedidos', id, obj);
    return JSON.stringify({ ok: true, id, pedido: obj.pedido });
  }

  if (name === 'actualizar_pedido') {
    const { id, ...patch } = input;
    const updated = await sbUpdate('pedidos', id, patch);
    return JSON.stringify({ ok: true, pedido: updated?.pedido, estado: updated?.estado });
  }

  if (name === 'eliminar_tarea') {
    await sbDelete('tasks', input.id);
    return JSON.stringify({ ok: true });
  }

  if (name === 'notificar') {
    // This gets sent as part of the final reply â€” just return ok
    return JSON.stringify({ ok: true, enviado: true });
  }

  return JSON.stringify({ error: 'Tool desconocido: ' + name });
}

// â”€â”€ System prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildSystem(hasImage = false) {
  const today = new Date().toLocaleDateString('es-CL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const hora = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

  return `Eres el agente de operaciones de Carlos, emprendedor chileno en Temuco. Hoy es ${today}, ${hora}.

Hablas con Carlos por Telegram â€” estÃ¡ fuera del PC, en movimiento.

Negocios de Carlos:
- ðŸ¦º SST: Seguridad y Salud en el Trabajo. Constructora Radalco, 22 trabajadores, 3 centros: Casa Matriz, P. Sauces, Planta Traigen.
- ðŸ—ï¸ CRD: Constructora Radalco Ltda.
- ðŸ½ï¸ ENEFOOD: Catering, licitaciones Mercado PÃºblico. RUT 76.733.233-5.
- ðŸ“ˆ Trading: XAU/USD y BTC/USD, metodologÃ­a SMC/Order Block.
- ðŸ’» ProgramaciÃ³n: SaaS React+Vite+Supabase, sistema IAU, VPS Digital Ocean.
- ðŸ–¨ï¸ ImpresiÃ³n 3D: AU Labs, Bambu Lab P1S, PLA/PETG/TPU/ASA/Nylon PA12.
- ðŸ  Casa: Pendientes del hogar.

${hasImage ? `
IMAGEN RECIBIDA â€” INSTRUCCIONES PARA PROCESAR:
Analiza la imagen con atenciÃ³n. Si es:
- BOLETA / TICKET: extrae quÃ© se comprÃ³, monto total, fecha, nombre del local/proveedor â†’ crear_tarea tipo ðŸ›’ Compra con esos datos.
- TRANSFERENCIA / COMPROBANTE PAGO: extrae monto, concepto/glosa, fecha, desde/hacia â†’ registrar segÃºn contexto.
- FACTURA: similar a boleta pero tambiÃ©n extrae RUT emisor si aparece.
- FOTO DE PEDIDO / PIEZA: registrar como avance o referencia de pedido.
Si no puedes leer algÃºn dato con certeza, deja ese campo vacÃ­o â€” no inventes datos.
` : ''}

REGLAS:
1. EspaÃ±ol chileno informal. "po", "al tiro", "cachai", "bacÃ¡n". Directo.
2. SIEMPRE usa las herramientas para guardar â€” no solo converses.
3. Antes de actualizar â†’ get_resumen para obtener IDs.
4. "terminÃ© X" â†’ actualizar_tarea a âœ… Finalizado.
5. "comprÃ© X por $Y" â†’ crear_tarea tipo ðŸ›’ Compra, estado âœ… Finalizado.
6. Pedido nuevo â†’ crear_pedido siempre.
7. "Â¿cÃ³mo vamos?" â†’ get_resumen y responde con resumen real.
8. Infieres el Ã¡rea automÃ¡ticamente.
9. Fechas: "maÃ±ana", "el viernes" â†’ calcula desde hoy.
10. Montos: "85 lucas"=85000, "1 palo"=1000000, "medio palo"=500000.
11. Respuestas CORTAS para Telegram â€” mÃ¡ximo 5 lÃ­neas con emojis.
12. Usa formato Telegram: <b>negrita</b>, <i>cursiva</i>, emojis.`;
}

// â”€â”€ Claude caller â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function callClaude(messages, hasImage = false) {
  const model = hasImage ? MODEL_V : MODEL_T;
  const r = await fetch(ANT_API, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system:     buildSystem(hasImage),
      tools:      TOOLS,
      messages,
    }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic HTTP ${r.status}`);
  }
  return r.json();
}

// â”€â”€ Agentic loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function runAgentLoop(messages, chatId, hasImage = false) {
  let loop = [...messages];
  let iters = 0;

  while (iters < MAX_LOOP) {
    iters++;
    const resp = await callClaude(loop, hasImage && iters === 1);

    if (resp.stop_reason === 'end_turn') {
      return resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
    }

    if (resp.stop_reason === 'tool_use') {
      const toolBlocks = resp.content.filter(b => b.type === 'tool_use');
      loop.push({ role: 'assistant', content: resp.content });

      const results = await Promise.all(
        toolBlocks.map(async tb => ({
          type:        'tool_result',
          tool_use_id: tb.id,
          content:     await executeTool(tb.name, tb.input, chatId),
        }))
      );

      loop.push({ role: 'user', content: results });
      continue;
    }

    return resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }

  return 'AlcancÃ© el lÃ­mite de iteraciones, intenta de nuevo po.';
}

// â”€â”€ Main handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default async function handler(req, res) {
  // Telegram sends POST with the update
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  // Validate env vars
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_URL) {
    console.error('Faltan variables de entorno');
    return res.status(200).json({ ok: true }); // Always 200 to Telegram
  }

  const update = req.body;
  const msg = update.message || update.edited_message;
  if (!msg) return res.status(200).json({ ok: true });

  const chatId   = msg.chat.id;
  const userId   = msg.from?.id;
  const text     = msg.text || msg.caption || '';
  const photos   = msg.photo;
  const document = msg.document;

  // Security: optional user whitelist
  const allowedUser = process.env.TELEGRAM_USER_ID;
  if (allowedUser && String(userId) !== String(allowedUser)) {
    await tgSend(chatId, 'â›” No tengo autorizaciÃ³n para hablar contigo.');
    return res.status(200).json({ ok: true });
  }

  // Special commands
  if (text === '/start') {
    await tgSend(chatId, `ðŸ‘‹ <b>Â¡Hola Carlos!</b> Soy tu agente AU LABS.

Puedo:
ðŸ“ Registrar lo que me cuentes
ðŸ“¸ Leer tus boletas y transferencias
ðŸ“¦ Gestionar pedidos Aulabs
ðŸ“Š Darte resÃºmenes del negocio
âœ… Marcar tareas como listas

CuÃ©ntame quÃ© pasÃ³ hoy po.`);
    return res.status(200).json({ ok: true });
  }

  if (text === '/resumen' || text === '/status') {
    await tgSendTyping(chatId);
    const tasks   = await sbGet('tasks');
    const pedidos = await sbGet('pedidos');
    const today   = new Date().toISOString().slice(0, 10);
    const act = tasks.filter(t => t.estado !== 'âœ… Finalizado').length;
    const hac = tasks.filter(t => t.estado === 'ðŸ”„ Haciendo').length;
    const ped = pedidos.filter(p => !['Entregado','Cancelado'].includes(p.estado)).length;
    const ing = pedidos.filter(p => p.pagado && p.creado >= today.slice(0,7)).reduce((s,p)=>s+(p.monto||0),0);
    await tgSend(chatId, `ðŸ“Š <b>Resumen AU LABS</b>

ðŸ“‹ Tareas activas: <b>${act}</b> (${hac} en progreso)
ðŸ“¦ Pedidos activos: <b>${ped}</b>
ðŸ’° Ingresos del mes: <b>$${ing.toLocaleString('es-CL')}</b>

<i>EnvÃ­ame una foto de boleta o cuÃ©ntame quÃ© pasÃ³.</i>`);
    return res.status(200).json({ ok: true });
  }

  if (text === '/ayuda' || text === '/help') {
    await tgSend(chatId, `ðŸ¤– <b>Comandos disponibles:</b>

/start â€” Bienvenida
/resumen â€” Estado rÃ¡pido del negocio
/pendientes â€” Tareas por hacer
/pedidos â€” Pedidos activos
/ayuda â€” Esta lista

<b>O simplemente cuÃ©ntame en lenguaje normal:</b>
â€¢ "comprÃ© filamento por 28 lucas"
â€¢ "terminÃ© el pedido del hospital"
â€¢ "anota pedido para MatÃ­as, marcos TPU, 35 lucas"
â€¢ [foto de boleta] â†’ lo registro automÃ¡tico`);
    return res.status(200).json({ ok: true });
  }

  if (text === '/pendientes') {
    await tgSendTyping(chatId);
    const tasks = await sbGet('tasks');
    const pend  = tasks.filter(t => t.estado === 'â¬œ Por hacer').slice(0, 8);
    if (!pend.length) {
      await tgSend(chatId, 'âœ… No tienes tareas pendientes po. Todo al dÃ­a.');
    } else {
      const lista = pend.map(t => `â€¢ ${t.area.slice(0,6)} <b>${t.titulo}</b>${t.fecha?' â€” '+fmtDate(t.fecha):''}`).join('\n');
      await tgSend(chatId, `ðŸ“‹ <b>Pendientes (${pend.length})</b>\n\n${lista}`);
    }
    return res.status(200).json({ ok: true });
  }

  if (text === '/pedidos') {
    await tgSendTyping(chatId);
    const pedidos = await sbGet('pedidos');
    const act = pedidos.filter(p => !['Entregado','Cancelado'].includes(p.estado)).slice(0, 8);
    if (!act.length) {
      await tgSend(chatId, 'ðŸ“¦ Sin pedidos activos por ahora.');
    } else {
      const lista = act.map(p => `â€¢ <b>${p.pedido}</b> â€” ${p.estado}\n  ðŸ‘¤ ${p.cliente} | $${(p.monto||0).toLocaleString('es-CL')} ${p.pagado?'âœ…':'ðŸ’³'}`).join('\n\n');
      await tgSend(chatId, `ðŸ“¦ <b>Pedidos activos (${act.length})</b>\n\n${lista}`);
    }
    return res.status(200).json({ ok: true });
  }

  // â”€â”€ Process photo or document â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let imageContent = null;

  if (photos || (document && document.mime_type?.startsWith('image/'))) {
    try {
      await tgSendTyping(chatId);
      const fileId = photos
        ? photos[photos.length - 1].file_id  // largest size
        : document.file_id;

      const fileUrl  = await tgGetFileUrl(fileId);
      const b64      = await downloadBase64(fileUrl);
      const mimeType = document?.mime_type || 'image/jpeg';

      imageContent = { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } };
    } catch (err) {
      await tgSend(chatId, 'âš ï¸ No pude leer la imagen. Intenta reenviarla.');
      return res.status(200).json({ ok: true });
    }
  }

  // â”€â”€ Build message for Claude â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await tgSendTyping(chatId);

  // Load conversation history
  const history = await getChatHistory(chatId);

  // Build user message content
  const userContent = [];
  if (imageContent) userContent.push(imageContent);
  if (text) {
    userContent.push({ type: 'text', text });
  } else if (imageContent) {
    userContent.push({ type: 'text', text: 'Analiza esta imagen y regÃ­strala en mi bitÃ¡cora segÃºn corresponda.' });
  }

  if (!userContent.length) return res.status(200).json({ ok: true });

  // Construct messages array for Claude
  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent },
  ];

  // Save user message to history
  const userText = text || '[imagen]';
  await saveChatMsg(chatId, 'user', userText);

  // Run agent
  try {
    const reply = await runAgentLoop(messages, chatId, !!imageContent);

    // Send reply
    await tgSend(chatId, reply || 'âœ… Listo.');

    // Save assistant reply
    await saveChatMsg(chatId, 'assistant', reply || 'âœ… Listo.');
  } catch (err) {
    console.error('Agent error:', err);
    await tgSend(chatId, `âŒ Error del agente: ${err.message}`);
  }

  return res.status(200).json({ ok: true });
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${parseInt(day)} ${meses[parseInt(m) - 1]}`;
}
