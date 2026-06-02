// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AU LABS Hub â€” Vercel Serverless Function
// Secure proxy: runs the full Claude agentic loop server-side.
// The Anthropic key never touches the browser.
// Tool execution (Supabase CRUD) also happens here.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-haiku-4-5';
const MAX_TOKENS    = 1024;
const MAX_LOOPS     = 8;

// â”€â”€ Supabase helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function sbHeaders() {
  return {
    'apikey':        process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };
}
const SB = () => process.env.SUPABASE_URL;

async function sbGet(table, filter = '') {
  const url = `${SB()}/rest/v1/${table}?order=created_at.desc${filter ? '&' + filter : ''}`;
  const r = await fetch(url, { headers: sbHeaders() });
  const rows = await r.json();
  return rows.map(row => ({ ...row.data, id: row.id }));
}

async function sbInsert(table, id, data) {
  const url = `${SB()}/rest/v1/${table}`;
  await fetch(url, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify({ id, data }),
  });
}

async function sbUpdate(table, id, patch) {
  const url = `${SB()}/rest/v1/${table}?id=eq.${id}`;
  // First get current
  const getUrl = `${SB()}/rest/v1/${table}?id=eq.${id}`;
  const r = await fetch(getUrl, { headers: sbHeaders() });
  const rows = await r.json();
  if (!rows.length) return { error: 'No encontrado' };
  const current = rows[0].data;
  const updated = { ...current, ...patch };
  await fetch(url, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify({ data: updated }),
  });
  return updated;
}

async function sbDelete(table, id) {
  const url = `${SB()}/rest/v1/${table}?id=eq.${id}`;
  await fetch(url, { method: 'DELETE', headers: sbHeaders() });
}

async function sbChatSave(role, content) {
  const url = `${SB()}/rest/v1/chat_history`;
  await fetch(url, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify({ role, content }),
  });
}

// â”€â”€ Tool definitions for Claude â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TOOLS = [
  {
    name: 'get_resumen',
    description: 'Obtiene el estado actual del hub: tareas activas y pedidos con sus IDs. Usar antes de actualizar o para responder consultas de estado.',
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
    description: 'Actualiza campos de una tarea existente. Requiere el ID exacto (obtenerlo con get_resumen).',
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
    description: 'Crea un nuevo pedido de impresiÃ³n 3D.',
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
    description: 'Actualiza un pedido existente. Requiere el ID (obtenerlo con get_resumen).',
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
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
];

// â”€â”€ Tool executor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function executeTool(name, input) {
  const today = new Date().toISOString().slice(0, 10);

  if (name === 'get_resumen') {
    const tasks   = await sbGet('tasks');
    const pedidos = await sbGet('pedidos');
    const activas = tasks.filter(t => t.estado !== 'âœ… Finalizado');
    const pedActivos = pedidos.filter(p => !['Entregado', 'Cancelado'].includes(p.estado));
    const ingMes = pedidos
      .filter(p => p.pagado && p.creado >= today.slice(0, 7))
      .reduce((s, p) => s + (p.monto || 0), 0);
    return JSON.stringify({
      today,
      tareas_activas: activas.map(t => ({ id: t.id, titulo: t.titulo, area: t.area, estado: t.estado, fecha: t.fecha, proyecto: t.proyecto, detalle: t.detalle })),
      pedidos_activos: pedActivos.map(p => ({ id: p.id, pedido: p.pedido, cliente: p.cliente, estado: p.estado, monto: p.monto, pagado: p.pagado, fechaEntrega: p.fechaEntrega })),
      stats: {
        total_tareas: tasks.length,
        pendientes: tasks.filter(t => t.estado === 'â¬œ Por hacer').length,
        haciendo: tasks.filter(t => t.estado === 'ðŸ”„ Haciendo').length,
        total_pedidos: pedidos.length,
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
    return JSON.stringify({ ok: true, ...updated });
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
    return JSON.stringify({ ok: true, ...updated });
  }

  if (name === 'eliminar_tarea') {
    await sbDelete('tasks', input.id);
    return JSON.stringify({ ok: true });
  }

  return JSON.stringify({ error: 'Tool desconocido: ' + name });
}

// â”€â”€ System prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildSystem() {
  const today = new Date().toLocaleDateString('es-CL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  return `Eres el agente de operaciones de Carlos, emprendedor chileno en Temuco. Hoy es ${today}.

Negocios de Carlos:
- ðŸ¦º SST: Seguridad y Salud en el Trabajo. Constructora Radalco, 22 trabajadores, 3 centros: Casa Matriz, P. Sauces, Planta Traigen.
- ðŸ—ï¸ CRD: Constructora Radalco Ltda.
- ðŸ½ï¸ ENEFOOD: Catering, licitaciones Mercado PÃºblico. RUT 76.733.233-5.
- ðŸ“ˆ Trading: XAU/USD y BTC/USD, metodologÃ­a SMC/Order Block. Bot @S_Oakmont_bot.
- ðŸ’» ProgramaciÃ³n: SaaS React+Vite+Supabase, sistema IAU, VPS Digital Ocean.
- ðŸ–¨ï¸ ImpresiÃ³n 3D: AU Labs, Bambu Lab P1S, filamentos PLA/PETG/TPU/ASA/Nylon PA12.
- ðŸ  Casa: Pendientes del hogar.

REGLAS DE COMPORTAMIENTO:
1. Habla en espaÃ±ol chileno, informal y directo. Usa "po", "al tiro", "cachai" cuando corresponda.
2. Cuando Carlos mencione algo que pasÃ³ o que va a pasar â†’ USA LAS HERRAMIENTAS para guardarlo. No solo converses.
3. Antes de actualizar/buscar algo â†’ llama get_resumen para tener los IDs correctos.
4. "terminÃ© X" / "ya hice X" â†’ actualizar_tarea a âœ… Finalizado.
5. "estoy en X" / "trabajando en X" â†’ actualizar_tarea o crear_tarea en ðŸ”„ Haciendo.
6. Pedido nuevo â†’ crear_pedido siempre.
7. "Â¿cÃ³mo vamos?" / "resumen" / "quÃ© tengo pendiente" â†’ get_resumen y responde con datos reales.
8. Infieres el Ã¡rea automÃ¡ticamente cuando es obvio (SST â†’ inspecciones, CRD â†’ construcciÃ³n, etc.).
9. Fechas relativas: "maÃ±ana", "el viernes", "la prÃ³xima semana" â†’ calcula desde la fecha de hoy.
10. Montos chilenos: "85 lucas" = 85000, "1 palo" = 1000000, "medio millÃ³n" = 500000.
11. Respuestas cortas â€” mÃ¡ximo 3-4 lÃ­neas. No expliques tu proceso interno.
12. Si algo es ambiguo â†’ UNA sola pregunta, la mÃ¡s importante.`;
}

// â”€â”€ Claude caller â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function callClaude(messages) {
  const r = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-api-key':          process.env.ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     buildSystem(),
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

// â”€â”€ Main handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validate env vars
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });
  if (!process.env.SUPABASE_URL)      return res.status(500).json({ error: 'SUPABASE_URL no configurada' });
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY no configurada' });

  const { history = [] } = req.body; // [{role, content}] â€” last item is the new user message

  // Build messages for Claude (convert string content to proper format)
  let loopMessages = history.map(m => ({ role: m.role, content: m.content }));
  const actions = []; // track what we did

  let iterations = 0;
  let finalText  = '';

  try {
    while (iterations < MAX_LOOPS) {
      iterations++;
      const response = await callClaude(loopMessages);

      if (response.stop_reason === 'end_turn') {
        finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
        break;
      }

      if (response.stop_reason === 'tool_use') {
        const toolBlocks = response.content.filter(b => b.type === 'tool_use');

        // Add assistant message
        loopMessages.push({ role: 'assistant', content: response.content });

        // Execute all tools in parallel
        const results = await Promise.all(
          toolBlocks.map(async tb => {
            const result = await executeTool(tb.name, tb.input);
            actions.push({ tool: tb.name, input: tb.input, result: JSON.parse(result) });
            return {
              type:        'tool_result',
              tool_use_id: tb.id,
              content:     result,
            };
          })
        );

        loopMessages.push({ role: 'user', content: results });
        continue;
      }

      // Fallback: extract text
      finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      break;
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // Persist assistant reply to Supabase chat history
  if (finalText) {
    await sbChatSave('assistant', finalText).catch(() => {});
  }

  return res.json({ reply: finalText || '(sin respuesta)', actions });
}
