/**
 * Mock CAS server for local testing of the UVUS SSO flow, standing in for
 * https://sso.us.es/cas while the US integration request is pending.
 *
 * Usage:
 *   npx tsx scripts/mockCasServer.ts            # listens on :9444
 *   # api/.env → SSO_US_CAS_URL=http://localhost:9444/cas
 *
 * Endpoints (mirrors the real CAS contract):
 *   GET /cas/login?service=<url>                → 302 to <url>?ticket=ST-...
 *   GET /cas/p3/serviceValidate?ticket&service  → CAS 3.0 XML (success or failure)
 *
 * The mock user can be overridden with env vars MOCK_CAS_UVUS, MOCK_CAS_MAIL,
 * MOCK_CAS_GIVEN_NAME, MOCK_CAS_SN1, MOCK_CAS_SN2. Tickets are single-use and
 * bound to the exact `service` they were issued for, like in real CAS.
 */
import express from 'express';
import crypto from 'crypto';

const PORT = Number(process.env.MOCK_CAS_PORT ?? 9444);

const mockUser = {
  uvus: process.env.MOCK_CAS_UVUS ?? 'testuvus',
  mail: process.env.MOCK_CAS_MAIL ?? 'testuvus@alum.us.es',
  givenName: process.env.MOCK_CAS_GIVEN_NAME ?? 'Test',
  schacSn1: process.env.MOCK_CAS_SN1 ?? 'Usuario',
  schacSn2: process.env.MOCK_CAS_SN2 ?? 'UVUS',
};

// ticket → service it was issued for (single use)
const tickets = new Map<string, string>();

const app = express();

app.get('/cas/login', (req, res) => {
  const service = req.query.service as string | undefined;
  if (!service) return res.status(400).send('Missing service parameter');

  const ticket = `ST-${crypto.randomBytes(12).toString('hex')}`;
  tickets.set(ticket, service);

  const separator = service.includes('?') ? '&' : '?';
  const target = `${service}${separator}ticket=${encodeURIComponent(ticket)}`;
  console.log(`[mock-cas] login → issuing ${ticket} for service=${service}`);
  return res.redirect(target);
});

app.get(['/cas/p3/serviceValidate', '/cas/serviceValidate'], (req, res) => {
  const ticket = req.query.ticket as string | undefined;
  const service = req.query.service as string | undefined;

  res.type('application/xml');

  const issuedFor = ticket ? tickets.get(ticket) : undefined;
  if (!ticket || !service || issuedFor === undefined || issuedFor !== service) {
    console.log(`[mock-cas] serviceValidate → INVALID (ticket=${ticket}, serviceMatch=${issuedFor === service})`);
    return res.send(
      `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">\n` +
        `  <cas:authenticationFailure code="INVALID_TICKET">Ticket ${ticket} not recognized</cas:authenticationFailure>\n` +
        `</cas:serviceResponse>`
    );
  }

  tickets.delete(ticket); // single use, like real CAS

  console.log(`[mock-cas] serviceValidate → OK for ${mockUser.uvus}`);
  // Mirrors the REAL adAS preproduction response format (captured 10/07/2026):
  // lowercase tags except schacSn1/schacSn2, repeated edupersonaffiliation.
  return res.send(
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` +
      `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess>` +
      `<cas:user>${mockUser.uvus}</cas:user><cas:attributes>` +
      `<cas:edupersonaffiliation>member</cas:edupersonaffiliation>` +
      `<cas:edupersonaffiliation>student</cas:edupersonaffiliation>` +
      `<cas:givenname>${mockUser.givenName}</cas:givenname>` +
      `<cas:mail>${mockUser.mail}</cas:mail>` +
      `<cas:schacSn1>${mockUser.schacSn1}</cas:schacSn1>` +
      `<cas:schacSn2>${mockUser.schacSn2}</cas:schacSn2>` +
      `<cas:uid>${mockUser.uvus}</cas:uid>` +
      `</cas:attributes></cas:authenticationSuccess></cas:serviceResponse>`
  );
});

app.listen(PORT, () => {
  console.log(`[mock-cas] Mock CAS de la US escuchando en http://localhost:${PORT}/cas`);
  console.log(`[mock-cas] Usuario simulado: ${mockUser.uvus} <${mockUser.mail}>`);
});
