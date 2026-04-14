require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const Database = require('better-sqlite3');
const { Resend } = require('resend');
const { google } = require('googleapis');

const app = express();
app.use(function(req,res,next){res.setHeader('Content-Security-Policy',"script-src 'self' 'unsafe-inline' fonts.googleapis.com images.unsplash.com");next()});
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(function(req,res,next){res.setHeader('Content-Security-Policy',"script-src 'self' 'unsafe-inline' fonts.googleapis.com images.unsplash.com");next()});

app.use(express.static(path.join(__dirname)));

// ─── BASE DE DATOS ───────────────────────────────────────────
const db = new Database('reservas.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS reservas_hotel (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT,
    telefono TEXT,
    checkin TEXT NOT NULL,
    checkout TEXT NOT NULL,
    tipo_habitacion TEXT NOT NULL,
    huespedes INTEGER NOT NULL,
    peticiones TEXT,
    estado TEXT DEFAULT 'confirmada',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// ─── EMAIL ────────────────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);

async function enviarConfirmacion(reserva) {
  if (!reserva.email) return;
  try {
    await resend.emails.send({
      from: 'Hotel Miramar <onboarding@resend.dev>',
      to: reserva.email,
      subject: `Reserva confirmada - Hotel Miramar #HM-${reserva.id}`,
      html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px;border-top:4px solid #2D6A4F;">
        <h1 style="color:#2D6A4F;font-weight:400;">Hotel Miramar</h1>
        <p style="color:#6B7280;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.2em;">El Arenal, Mallorca</p>
        <h2 style="color:#2D6A4F;font-weight:400;">Reserva confirmada</h2>
        <p>Hola <strong>${reserva.nombre}</strong>, tu reserva ha sido confirmada.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <tr><td style="color:#6B7280;padding:10px 0;border-bottom:1px solid #f3f4f6;">Referencia</td><td style="color:#2D6A4F;padding:10px 0;border-bottom:1px solid #f3f4f6;font-weight:500;">#HM-${reserva.id}</td></tr>
          <tr><td style="color:#6B7280;padding:10px 0;border-bottom:1px solid #f3f4f6;">Habitacion</td><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;">${reserva.tipo_habitacion}</td></tr>
          <tr><td style="color:#6B7280;padding:10px 0;border-bottom:1px solid #f3f4f6;">Check-in</td><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;">${reserva.checkin}</td></tr>
          <tr><td style="color:#6B7280;padding:10px 0;border-bottom:1px solid #f3f4f6;">Check-out</td><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;">${reserva.checkout}</td></tr>
          <tr><td style="color:#6B7280;padding:10px 0;">Huespedes</td><td style="padding:10px 0;">${reserva.huespedes}</td></tr>
        </table>
        <p style="color:#6B7280;font-size:0.8rem;margin-top:2rem;">Check-in: 15:00h · Check-out: 11:00h · Parking gratuito<br>Cancelacion gratuita hasta 48h antes: +34 971 XXX XXX</p>
      </div>`
    });
  } catch (e) {
    console.error('Error email:', e.message);
  }
}

async function enviarNotificacionAdmin(reserva) {
  if (!process.env.ADMIN_EMAIL) return;
  try {
    await resend.emails.send({
      from: 'Hotel Miramar Bot <onboarding@resend.dev>',
      to: process.env.ADMIN_EMAIL,
      subject: `Nueva reserva #HM-${reserva.id} - ${reserva.nombre} (${reserva.tipo_habitacion})`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:30px;border-top:4px solid #2D6A4F;">
        <h2 style="color:#2D6A4F;">Nueva reserva - Hotel Miramar</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:20px;">
          <tr style="background:#f5f5f5;"><td style="padding:10px;font-weight:bold;">ID</td><td style="padding:10px;">#HM-${reserva.id}</td></tr>
          <tr><td style="padding:10px;font-weight:bold;">Nombre</td><td style="padding:10px;">${reserva.nombre}</td></tr>
          <tr style="background:#f5f5f5;"><td style="padding:10px;font-weight:bold;">Email</td><td style="padding:10px;">${reserva.email || '-'}</td></tr>
          <tr><td style="padding:10px;font-weight:bold;">Habitacion</td><td style="padding:10px;">${reserva.tipo_habitacion}</td></tr>
          <tr style="background:#f5f5f5;"><td style="padding:10px;font-weight:bold;">Check-in</td><td style="padding:10px;">${reserva.checkin}</td></tr>
          <tr><td style="padding:10px;font-weight:bold;">Check-out</td><td style="padding:10px;">${reserva.checkout}</td></tr>
          <tr style="background:#f5f5f5;"><td style="padding:10px;font-weight:bold;">Huespedes</td><td style="padding:10px;">${reserva.huespedes}</td></tr>
          <tr><td style="padding:10px;font-weight:bold;">Peticiones</td><td style="padding:10px;">${reserva.peticiones || '-'}</td></tr>
        </table>
      </div>`
    });
  } catch (e) {
    console.error('Error email admin:', e.message);
  }
}

// ─── GOOGLE CALENDAR ──────────────────────────────────────────
async function crearEventoCalendario(reserva) {
  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || "").split("\\n").join("\n"),
      scopes: ['https://www.googleapis.com/auth/calendar']
    });
    const calendar = google.calendar({ version: 'v3', auth });
    const hab = { estandar: 'Habitación Estándar', vista_mar: 'Habitación Vista Mar', familiar: 'Suite Familiar' };
    await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      resource: {
        summary: `🏨 ${reserva.nombre} — ${hab[reserva.tipo_habitacion] || reserva.tipo_habitacion}`,
        description: `Huéspedes: ${reserva.huespedes}\nEmail: ${reserva.email || '—'}\nTeléfono: ${reserva.telefono || '—'}\nPeticiones: ${reserva.peticiones || '—'}\nReserva #HM-${reserva.id}`,
        start: { date: reserva.checkin, timeZone: 'Europe/Madrid' },
        end: { date: reserva.checkout, timeZone: 'Europe/Madrid' },
        colorId: '2'
      }
    });
    console.log(`Evento creado en Google Calendar para reserva #HM-${reserva.id}`);
  } catch (error) {
    console.error('Error Google Calendar:', error.message);
  }
}


const HABITACIONES = {
  'estandar':  { nombre: 'Habitacion Estandar',  precio: 89,  capacidad: 2, total: 15 },
  'vista_mar': { nombre: 'Habitacion Vista Mar',  precio: 129, capacidad: 2, total: 10 },
  'familiar':  { nombre: 'Suite Familiar',        precio: 189, capacidad: 4, total: 5  }
};

function habitacionesOcupadas(tipo, checkin, checkout) {
  const r = db.prepare(`
    SELECT COUNT(*) as total FROM reservas_hotel
    WHERE tipo_habitacion = ? AND estado != 'cancelada'
    AND checkin < ? AND checkout > ?
  `).get(tipo, checkout, checkin);
  return r.total || 0;
}

function hayDisponibilidad(tipo, checkin, checkout) {
  const hab = HABITACIONES[tipo];
  if (!hab) return false;
  return habitacionesOcupadas(tipo, checkin, checkout) < hab.total;
}

function crearReserva(datos) {
  const result = db.prepare(`
    INSERT INTO reservas_hotel (nombre, email, telefono, checkin, checkout, tipo_habitacion, huespedes, peticiones)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(datos.nombre, datos.email || '', datos.telefono || '', datos.checkin, datos.checkout, datos.tipo_habitacion, datos.huespedes, datos.peticiones || '');
  return result.lastInsertRowid;
}

// ─── TOOLS IA ─────────────────────────────────────────────────
const tools = [
  {
    name: 'comprobar_disponibilidad',
    description: 'Comprueba si hay habitaciones disponibles para las fechas indicadas',
    input_schema: {
      type: 'object',
      properties: {
        tipo_habitacion: { type: 'string', enum: ['estandar', 'vista_mar', 'familiar'] },
        checkin: { type: 'string', description: 'Fecha entrada YYYY-MM-DD' },
        checkout: { type: 'string', description: 'Fecha salida YYYY-MM-DD' }
      },
      required: ['tipo_habitacion', 'checkin', 'checkout']
    }
  },
  {
    name: 'ver_habitaciones_disponibles',
    description: 'Muestra que habitaciones hay disponibles para unas fechas',
    input_schema: {
      type: 'object',
      properties: {
        checkin: { type: 'string' },
        checkout: { type: 'string' },
        huespedes: { type: 'number' }
      },
      required: ['checkin', 'checkout']
    }
  },
  {
    name: 'hacer_reserva',
    description: 'Realiza una reserva de habitacion en el hotel',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        email: { type: 'string' },
        telefono: { type: 'string' },
        tipo_habitacion: { type: 'string', enum: ['estandar', 'vista_mar', 'familiar'] },
        checkin: { type: 'string' },
        checkout: { type: 'string' },
        huespedes: { type: 'number' },
        peticiones: { type: 'string' }
      },
      required: ['nombre', 'tipo_habitacion', 'checkin', 'checkout', 'huespedes']
    }
  },
  {
    name: 'cancelar_reserva',
    description: 'Cancela una reserva por nombre y fecha de check-in',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        checkin: { type: 'string' }
      },
      required: ['nombre', 'checkin']
    }
  }
];

const SYSTEM_PROMPT = `Eres el asistente virtual del Hotel Miramar, hotel en primera linea de playa en El Arenal, Mallorca.
Responde SIEMPRE en el idioma del cliente (espanol, ingles o aleman).

HABITACIONES:
- estandar: Habitacion Estandar, 89 euros/noche, hasta 2 personas, 22m2, vista jardin
- vista_mar: Habitacion Vista Mar, 129 euros/noche, hasta 2 personas, 28m2, terraza privada con vistas al mar
- familiar: Suite Familiar, 189 euros/noche, hasta 4 personas, 48m2, salon y kitchenette

SERVICIOS: Desayuno buffet incluido (7:30-10:30h), piscina exterior (mayo-octubre), parking gratuito, WiFi gratis, acceso playa 50m, restaurante propio, alquiler bicicletas.

POLITICA: Check-in 15:00h, check-out 11:00h. Cancelacion gratuita hasta 48h antes.

CONTACTO: +34 971 XXX XXX | info@hotelmiramar.es | Carrer de la Mar, 24, El Arenal, Mallorca.

RESERVAS: Pide nombre, email, fechas checkin/checkout, tipo habitacion y numero huespedes. Usa SIEMPRE las herramientas para comprobar disponibilidad antes de confirmar.

Hoy es ${new Date().toISOString().split('T')[0]}. Se breve, amable y profesional.`;

function processTool(toolName, toolInput) {
  if (toolName === 'comprobar_disponibilidad') {
    const disponible = hayDisponibilidad(toolInput.tipo_habitacion, toolInput.checkin, toolInput.checkout);
    const hab = HABITACIONES[toolInput.tipo_habitacion];
    return JSON.stringify({
      disponible,
      tipo: hab ? hab.nombre : toolInput.tipo_habitacion,
      precio_noche: hab ? hab.precio : null,
      mensaje: disponible
        ? `Hay disponibilidad. Precio: ${hab.precio} euros/noche.`
        : `No hay disponibilidad para esas fechas.`
    });
  }
  if (toolName === 'ver_habitaciones_disponibles') {
    const disponibles = Object.entries(HABITACIONES)
      .filter(([key, hab]) => {
        const disp = hayDisponibilidad(key, toolInput.checkin, toolInput.checkout);
        const apta = !toolInput.huespedes || hab.capacidad >= toolInput.huespedes;
        return disp && apta;
      })
      .map(([key, hab]) => ({ tipo: key, nombre: hab.nombre, precio: hab.precio, capacidad: hab.capacidad }));
    return JSON.stringify({
      disponibles,
      mensaje: disponibles.length > 0
        ? `Disponibles: ${disponibles.map(h => `${h.nombre} (${h.precio} euros/noche)`).join(', ')}`
        : 'No hay habitaciones disponibles para esas fechas.'
    });
  }
  if (toolName === 'hacer_reserva') {
    if (!hayDisponibilidad(toolInput.tipo_habitacion, toolInput.checkin, toolInput.checkout)) {
      return JSON.stringify({ success: false, mensaje: 'No hay disponibilidad. Prueba otras fechas o habitacion.' });
    }
    const id = crearReserva(toolInput);
    const reserva = { id, ...toolInput };
    enviarConfirmacion(reserva);
    enviarNotificacionAdmin(reserva);
    crearEventoCalendario(reserva);
    return JSON.stringify({ success: true, id, mensaje: `Reserva #HM-${id} confirmada. Se enviara confirmacion por email.` });
  }
  if (toolName === 'cancelar_reserva') {
    const reserva = db.prepare(`
      SELECT * FROM reservas_hotel WHERE LOWER(nombre) = LOWER(?) AND checkin = ? AND estado != 'cancelada'
    `).get(toolInput.nombre, toolInput.checkin);
    if (!reserva) return JSON.stringify({ success: false, mensaje: 'No se encontro ninguna reserva. Verifica el nombre y la fecha de entrada.' });
    db.prepare('UPDATE reservas_hotel SET estado = ? WHERE id = ?').run('cancelada', reserva.id);
    return JSON.stringify({ success: true, mensaje: `Reserva #HM-${reserva.id} cancelada correctamente.` });
  }
  return JSON.stringify({ error: 'Herramienta no encontrada' });
}

// ─── ENDPOINTS ────────────────────────────────────────────────
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    let currentMessages = [...messages];
    let response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      tools,
      messages: currentMessages
    });
    while (response.stop_reason === 'tool_use') {
      const toolBlock = response.content.find(b => b.type === 'tool_use');
      if (!toolBlock) break;
      const result = processTool(toolBlock.name, toolBlock.input);
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolBlock.id, content: result }] }
      ];
      response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        tools,
        messages: currentMessages
      });
    }
    const textBlock = response.content.find(b => b.type === 'text');
    res.json({ reply: textBlock ? textBlock.text : 'Lo siento, ha habido un error.' });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Error al conectar con la IA' });
  }
});

app.get('/admin/reservas', (req, res) => res.json(db.prepare('SELECT * FROM reservas_hotel ORDER BY checkin').all()));
app.patch('/admin/reservas/:id/cancelar', (req, res) => {
  db.prepare('UPDATE reservas_hotel SET estado = ? WHERE id = ?').run('cancelada', req.params.id);
  res.json({ success: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Hotel Miramar corriendo en http://localhost:${PORT}`));




