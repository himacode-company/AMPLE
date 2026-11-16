'use strict';
// Mailpit (the inbox that catches every email PHP sends), through its official API on
// 127.0.0.1 only, plus a tiny SMTP client for "ample mail test" (no PHP / Apache needed).
//   ample mail          the latest messages
//   ample mail test     send a test email
//   ample mail clear    delete every message
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const settings = require('./settings');
const { log } = require('./logger');

const api = () => `http://127.0.0.1:${settings.load().ports.mailpit}/mailpit/api/v1`;

async function request(path, options = {}) {
  let res;
  try {
    const { user, pass } = settings.load().mailpitAuth;
    res = await fetch(api() + path, {
      ...options, signal: AbortSignal.timeout(8000),
      headers: { ...(options.headers || {}), Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') },
    });
  } catch {
    throw new Error('Mailpit is not answering. Start it: ample start mailpit');
  }
  if (!res.ok) throw new Error(`Mailpit answered HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// The latest messages: { total, unread, messages: [{ id, from, fromName, to, subject, snippet, time, read, attachments, tags, size }] }
async function list(limit = 20) {
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  const r = await request(`/messages?limit=${n}`);
  return {
    total: r.total || 0, unread: r.unread || 0,
    messages: (r.messages || []).map((m) => ({
      id: String(m.ID), subject: m.Subject || '', snippet: m.Snippet || '',
      from: m.From ? m.From.Address : '', fromName: m.From ? m.From.Name || '' : '',
      to: (m.To || []).map((x) => x.Address).join(', '),
      time: Date.parse(m.Created) || null, read: !!m.Read, attachments: m.Attachments || 0,
      tags: Array.isArray(m.Tags) ? m.Tags.map(String) : [], size: m.Size || 0,
    })),
  };
}

async function clear() {
  await request('/messages', { method: 'DELETE' });
  log('Mailpit', 'CLEAR', 'all messages deleted');
  return true;
}

// ---- a tiny SMTP client (Mailpit accepts any sender, no login) ----------------------------
function smtpSend({ from, to, data }) {
  const port = settings.load().ports.smtp;
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.setTimeout(10000);
    let buf = '';
    const steps = [
      [null, 220],                       // greeting
      [`EHLO ${os.hostname() || 'localhost'}`, 250],
      [`MAIL FROM:<${from}>`, 250],
      [`RCPT TO:<${to}>`, 250],
      ['DATA', 354],
      [data + '\r\n.', 250],
      ['QUIT', 221],
    ];
    let i = 0;
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.on('timeout', () => fail(new Error('Mailpit did not answer (SMTP timeout)')));
    sock.on('error', () => fail(new Error(`Mailpit is not receiving email on port ${port}. Start it: ample start mailpit`)));
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // A reply is complete when its last line is "123 text" (not "123-text").
      const lines = buf.split('\r\n');
      const last = lines.slice(0, -1).reverse().find((l) => /^\d{3}[ -]/.test(l));
      if (!last || last[3] !== ' ') return;
      const code = Number(last.slice(0, 3));
      buf = '';
      if (code !== steps[i][1]) return fail(new Error(`SMTP: expected ${steps[i][1]}, got "${last}"`));
      i += 1;
      if (i >= steps.length) { sock.end(); return resolve(); }
      sock.write(steps[i][0] + '\r\n');
    });
  });
}

async function sendTest() {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  const from = 'ample@localhost', to = 'test@example.com';
  const boundary = 'ample-' + crypto.randomBytes(8).toString('hex');
  const text = `Hello from AMPLE!\r\n\r\nThis test email was sent at ${time} to Mailpit (SMTP 127.0.0.1:${settings.load().ports.smtp}).\r\nIf you can read it here, email from your projects works too.`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:20px auto;border:1px solid #e3ded5;border-radius:12px;overflow:hidden">`
    + `<div style="background:#15171c;color:#fff;padding:16px 22px;font-weight:700;font-size:18px">AMPLE <span style="color:#f08a24;font-size:12px;letter-spacing:1.5px">TEST</span></div>`
    + `<div style="padding:22px;color:#1c1a17;line-height:1.6"><h2 style="margin:0 0 8px;color:#b35a0c">Hello from AMPLE!</h2>`
    + `<p>This test email was sent at <b>${time}</b> to Mailpit.</p><p>If you can read it here, email from your projects works too.</p></div></div>`;
  const data = [
    `From: AMPLE <${from}>`, `To: Test <${to}>`, `Subject: AMPLE test email ${time}`, `Date: ${now.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@ample.localhost>`, 'X-Tags: ample', 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', '', text, '',
    `--${boundary}`, 'Content-Type: text/html; charset=utf-8', '', html, '',
    `--${boundary}--`,
  ].join('\r\n').replace(/^\./gm, '..'); // SMTP: a line starting with "." is doubled
  await smtpSend({ from, to, data });
  log('Mailpit', 'TEST', `test email sent (${time})`);
  return { subject: `AMPLE test email ${time}` };
}

module.exports = { list, clear, sendTest };
