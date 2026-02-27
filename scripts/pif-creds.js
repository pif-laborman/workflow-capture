#!/usr/bin/env node
/**
 * pif-creds — Fetch credentials from the Mission Control logins table.
 *
 * The logins table is the single source of truth for all credentials.
 * ~/.pif-env only holds the bootstrap trio: SUPABASE_URL, ANON_KEY, CREDS_PASSWORD.
 *
 * Usage:
 *   pif-creds get <service>           Print decrypted password for a service
 *   pif-creds get <service> --notes   Print decrypted notes for a service
 *   pif-creds get <service> --json    Print full record as JSON (decrypted)
 *   pif-creds list                    List all service names
 *   pif-creds export                  Print shell export statements for all services
 */

const crypto = require('crypto')

const SB_URL = process.env.PIF_SUPABASE_URL
const SB_ANON_KEY = process.env.PIF_SUPABASE_ANON_KEY
const CREDS_PASSWORD = process.env.PIF_CREDS_PASSWORD

if (!SB_URL || !SB_ANON_KEY || !CREDS_PASSWORD) {
  console.error('Missing PIF_SUPABASE_URL, PIF_SUPABASE_ANON_KEY, or PIF_CREDS_PASSWORD')
  process.exit(1)
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

async function fetchLogins(filter) {
  const qs = filter ? `&service_name=eq.${encodeURIComponent(filter)}` : ''
  const res = await fetch(
    `${SB_URL}/rest/v1/logins?select=id,service_name,url,username,encrypted_password,encrypted_notes${qs}`,
    {
      headers: {
        'apikey': SB_ANON_KEY,
        'Authorization': `Bearer ${SB_ANON_KEY}`,
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

  console.error(`Usage:
  pif-creds get <service>           Decrypted password
  pif-creds get <service> --notes   Decrypted notes
  pif-creds get <service> --json    Full record as JSON
  pif-creds list                    List service names
  pif-creds export                  Shell export statements`)
  process.exit(1)
}

main()
