#!/usr/bin/env node
/**
 * pif-creds — Manage credentials in the Mission Control logins table.
 *
 * The logins table is the single source of truth for all credentials.
 * ~/.pif-env only holds the bootstrap trio: SUPABASE_URL, ANON_KEY, CREDS_PASSWORD.
 *
 * Read commands (via Supabase REST):
 *   pif-creds get <service>           Print decrypted password for a service
 *   pif-creds get <service> --notes   Print decrypted notes for a service
 *   pif-creds get <service> --json    Print full record as JSON (decrypted)
 *   pif-creds list                    List all service names
 *   pif-creds export                  Print shell export statements for all services
 *
 * Write commands (via MC API):
 *   pif-creds set <service> <password> [--url URL] [--username USER] [--notes NOTES]
 *   pif-creds delete <service>        Delete a credential by service name
 */

const crypto = require('crypto')

const SB_URL = process.env.PIF_SUPABASE_URL
const SB_ANON_KEY = process.env.PIF_SUPABASE_ANON_KEY
const SB_SERVICE_ROLE_KEY = process.env.PIF_SUPABASE_SERVICE_ROLE_KEY
const CREDS_PASSWORD = process.env.PIF_CREDS_PASSWORD

// MC API for write operations
const MC_API_URL = process.env.MC_API_URL || 'https://meetpif.com'
const MC_TENANT_TOKEN = process.env.MC_TENANT_TOKEN   // HMAC-scoped, preferred
const MC_API_TOKEN = process.env.MC_API_TOKEN          // admin fallback
const PIF_TENANT_ID = process.env.PIF_TENANT_ID

// Prefer service_role key (bypasses RLS). Fall back to anon for backward compat.
const SB_AUTH_KEY = SB_SERVICE_ROLE_KEY || SB_ANON_KEY

if (!SB_URL || !SB_AUTH_KEY || !CREDS_PASSWORD) {
  console.error('Missing PIF_SUPABASE_URL, PIF_SUPABASE_SERVICE_ROLE_KEY (or PIF_SUPABASE_ANON_KEY), or PIF_CREDS_PASSWORD')
  process.exit(1)
}

// --- Encryption (same PBKDF2 + AES-256-GCM scheme as decrypt) ---

function encrypt(plaintext, password) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256')
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Format: salt(16) + iv(12) + ciphertext + authTag(16), base64-encoded
  return Buffer.concat([salt, iv, encrypted, authTag]).toString('base64')
}

function decrypt(encoded, password) {
  const data = Buffer.from(encoded, 'base64')
  const salt = data.subarray(0, 16)
  const iv = data.subarray(16, 28)
  const ciphertext = data.subarray(28)
  const authTag = ciphertext.subarray(ciphertext.length - 16)
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16)

  const key = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, null, 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// --- Supabase reads ---

async function fetchLogins(filter) {
  // Tenant Pifs use the RPC function (RLS blocks direct table access for anon key)
  if (PIF_TENANT_ID) {
    const body = { p_tenant_id: PIF_TENANT_ID }
    if (filter) body.p_service_name = filter
    const res = await fetch(
      `${SB_URL}/rest/v1/rpc/get_tenant_logins`,
      {
        method: 'POST',
        headers: {
          'apikey': SB_AUTH_KEY,
          'Authorization': `Bearer ${SB_AUTH_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )
    if (!res.ok) {
      console.error(`Supabase RPC error: ${res.status} ${res.statusText}`)
      process.exit(1)
    }
    return res.json()
  }

  // Admin Pif uses direct table access (service_role key bypasses RLS)
  const qs = filter ? `&service_name=eq.${encodeURIComponent(filter)}` : ''
  const res = await fetch(
    `${SB_URL}/rest/v1/logins?select=id,service_name,url,username,encrypted_password,encrypted_notes${qs}`,
    {
      headers: {
        'apikey': SB_AUTH_KEY,
        'Authorization': `Bearer ${SB_AUTH_KEY}`,
      },
    }
  )
  if (!res.ok) {
    console.error(`Supabase error: ${res.status} ${res.statusText}`)
    process.exit(1)
  }
  return res.json()
}

function decryptRecord(record) {
  const result = {
    service_name: record.service_name,
    url: record.url,
    username: record.username,
    password: null,
    notes: null,
  }
  try {
    result.password = decrypt(record.encrypted_password, CREDS_PASSWORD)
  } catch (e) {
    result.password = `[decrypt failed: ${e.message}]`
  }
  if (record.encrypted_notes) {
    try {
      result.notes = decrypt(record.encrypted_notes, CREDS_PASSWORD)
    } catch (e) {
      result.notes = `[decrypt failed: ${e.message}]`
    }
  }
  return result
}

// Sanitize service name into a shell variable prefix: "HubSpot (duvo.ai)" → "HUBSPOT_DUVO_AI"
function toVarPrefix(serviceName) {
  return serviceName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

// --- MC API writes ---

function requireWriteEnv() {
  const token = MC_TENANT_TOKEN || MC_API_TOKEN
  if (!token) {
    console.error('Missing MC_TENANT_TOKEN or MC_API_TOKEN — required for write operations')
    process.exit(1)
  }
  if (!PIF_TENANT_ID) {
    console.error('Missing PIF_TENANT_ID — required for write operations')
    process.exit(1)
  }
}

async function mcApiRequest(method, path, body) {
  const token = MC_TENANT_TOKEN || MC_API_TOKEN
  const res = await fetch(`${MC_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-mc-token': token,
      'x-mc-tenant-id': PIF_TENANT_ID,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`MC API error: ${res.status} ${text}`)
    process.exit(1)
  }
  return res.json()
}

// Parse --flag value pairs from args
function parseFlags(args) {
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1]
      i++
    }
  }
  return flags
}

async function main() {
  const [,, cmd, ...args] = process.argv

  if (cmd === 'list') {
    const rows = await fetchLogins()
    for (const r of rows) console.log(r.service_name)
    return
  }

  if (cmd === 'get') {
    const service = args[0]
    const flag = args[1]
    if (!service) {
      console.error('Usage: pif-creds get <service> [--notes|--json]')
      process.exit(1)
    }
    const rows = await fetchLogins(service)
    if (!rows.length) {
      console.error(`No login found for service: ${service}`)
      process.exit(1)
    }
    const rec = decryptRecord(rows[0])
    if (flag === '--json') {
      console.log(JSON.stringify(rec, null, 2))
    } else if (flag === '--notes') {
      console.log(rec.notes || '')
    } else {
      console.log(rec.password)
    }
    return
  }

  if (cmd === 'export') {
    const rows = await fetchLogins()
    for (const row of rows) {
      const rec = decryptRecord(row)
      const prefix = toVarPrefix(rec.service_name)
      if (rec.password && !rec.password.startsWith('[decrypt')) {
        console.log(`export ${prefix}_PASSWORD=${JSON.stringify(rec.password)}`)
      }
      if (rec.username) {
        console.log(`export ${prefix}_USERNAME=${JSON.stringify(rec.username)}`)
      }
    }
    return
  }

  if (cmd === 'set') {
    const service = args[0]
    const password = args[1]
    if (!service || !password) {
      console.error('Usage: pif-creds set <service> <password> [--url URL] [--username USER] [--notes NOTES]')
      process.exit(1)
    }
    requireWriteEnv()

    const flags = parseFlags(args.slice(2))
    const encryptedPassword = encrypt(password, CREDS_PASSWORD)
    const encryptedNotes = flags.notes ? encrypt(flags.notes, CREDS_PASSWORD) : null

    // Check if service already exists — update instead of duplicate insert
    const existing = await fetchLogins(service)
    if (existing.length > 0) {
      const body = {
        service_name: service,
        encrypted_password: encryptedPassword,
        url: flags.url || existing[0].url || null,
        username: flags.username || existing[0].username || null,
        encrypted_notes: encryptedNotes || existing[0].encrypted_notes || null,
      }
      await mcApiRequest('PUT', `/api/logins/${existing[0].id}`, body)
      console.log(`Updated: ${service}`)
    } else {
      const body = {
        service_name: service,
        encrypted_password: encryptedPassword,
        url: flags.url || null,
        username: flags.username || null,
        encrypted_notes: encryptedNotes || null,
      }
      await mcApiRequest('POST', '/api/logins', body)
      console.log(`Saved: ${service}`)
    }
    return
  }

  if (cmd === 'delete') {
    const service = args[0]
    if (!service) {
      console.error('Usage: pif-creds delete <service>')
      process.exit(1)
    }
    requireWriteEnv()

    const existing = await fetchLogins(service)
    if (!existing.length) {
      console.error(`No login found for service: ${service}`)
      process.exit(1)
    }
    await mcApiRequest('DELETE', `/api/logins/${existing[0].id}`)
    console.log(`Deleted: ${service}`)
    return
  }

  console.error(`Usage:
  pif-creds get <service>           Decrypted password
  pif-creds get <service> --notes   Decrypted notes
  pif-creds get <service> --json    Full record as JSON
  pif-creds list                    List service names
  pif-creds export                  Shell export statements
  pif-creds set <service> <pass>    Save/update a credential
    [--url URL] [--username USER] [--notes NOTES]
  pif-creds delete <service>        Delete a credential`)
  process.exit(1)
}

main()
