#!/usr/bin/env node
/**
 * comment-listener.js — Realtime listener for task comments.
 *
 * On new non-assistant comment: spawns a Claude session that handles everything —
 * reads context, marks 👀, processes the request, and posts a reply.
 *
 * Boots with the anon key, fetches the service role key from the logins table
 * (encrypted with AES-256-GCM), then creates the real Supabase client.
 *
 * Tenant-aware: reads PIF_TENANT_ID and PIF_ASSISTANT_NAME from env (.pif-env).
 * Each instance only processes comments for its own tenant.
 *
 * Runs as systemd service: comment-listener.service
 */

const { createClient } = require('@supabase/supabase-js')
const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SB_URL = process.env.PIF_SUPABASE_URL
const SB_ANON_KEY = process.env.PIF_SUPABASE_ANON_KEY
const CREDS_PASSWORD = process.env.PIF_CREDS_PASSWORD
const TENANT_ID = process.env.PIF_TENANT_ID
const ASSISTANT_NAME = process.env.PIF_ASSISTANT_NAME || 'pif'
const MC_API_TOKEN = process.env.MC_API_TOKEN || ''
const MC_API_PORT = process.env.API_PORT || '8091'

if (!SB_URL || !SB_ANON_KEY || !CREDS_PASSWORD) {
  console.error('Missing PIF_SUPABASE_URL, PIF_SUPABASE_ANON_KEY, or PIF_CREDS_PASSWORD')
  process.exit(1)
}

if (!TENANT_ID) {
  console.error('Missing PIF_TENANT_ID — cannot start without tenant scope')
  process.exit(1)
}

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ')
  console.log(`${ts} ${msg}`)
}

/**
 * Decrypt an AES-256-GCM encrypted string (base64(salt[16] + iv[12] + ciphertext + tag[16]))
 * using PBKDF2-derived key. Mirrors the Web Crypto encrypt() in Mission Control's crypto.ts.
 */
function decryptField(encoded, password) {
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

/**
 * Fetch tenant's Claude credentials and connector tokens via the internal MC API endpoint.
 * Returns { config_dir, connector_tokens } on success, or null on failure.
 */
async function fetchClaudeConfig() {
  try {
    // HMAC proves this caller is authorized for this specific tenant_id
    const tenantProof = crypto.createHmac('sha256', MC_API_TOKEN).update(TENANT_ID).digest('hex')
    const res = await fetch(`http://127.0.0.1:${MC_API_PORT}/api/internal/claude-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mc-token': MC_API_TOKEN,
        'x-mc-tenant-proof': tenantProof,
      },
      body: JSON.stringify({ tenant_id: TENANT_ID }),
    })
    const json = await res.json()
    if (json.status === 'ok' && json.config_dir) {
      return { config_dir: json.config_dir, connector_tokens: json.connector_tokens || {} }
    }
    log(`Claude config fetch: ${json.status} — ${json.error || 'no config_dir'}`)
    return null
  } catch (err) {
    log(`Failed to fetch Claude config: ${err.message}`)
    return null
  }
}

let SB_KEY // service role key — set during init
let supabase // real client — set during init

// task_id → session_id map for session resumption
// Second comment on the same task resumes the previous session instead of cold-booting
const taskSessions = new Map()

// --- Concurrency control ---
const MAX_CONCURRENT = 3
let activeCount = 0
const queue = [] // FIFO queue of { payload } objects

function enqueue(payload) {
  queue.push({ payload })
  drain()
}

function drain() {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const { payload } = queue.shift()
    activeCount++
    spawnSession(payload)
  }
  if (queue.length > 0) {
    log(`Queue: ${queue.length} comment(s) waiting (${activeCount}/${MAX_CONCURRENT} active)`)
  }
}

function onSessionDone() {
  activeCount--
  drain()
}

function postErrorReply(taskId) {
  fetch(`${SB_URL}/rest/v1/task_comments`, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      task_id: taskId,
      author: ASSISTANT_NAME,
      tenant_id: TENANT_ID,
      content: 'Hit an error processing this comment. Check logs or ping me on Telegram.',
    }),
  }).catch(err => log(`Failed to post error reply: ${err.message}`))
}

function handleComment(payload) {
  const row = payload.new || {}
  if (!row.task_id || row.author === ASSISTANT_NAME) return
  enqueue(payload)
}

async function spawnSession(payload) {
  const { id: commentId, task_id: taskId, author, content } = payload.new || {}

  const existingSessionId = taskSessions.get(taskId)
  const isResume = !!existingSessionId

  log(`[${taskId.slice(0, 8)}] New comment from ${author} — ${isResume ? `resuming session ${existingSessionId.slice(0, 8)}` : 'new session'} (${activeCount}/${MAX_CONCURRENT} active, ${queue.length} queued)`)

  // First comment: full instructions. Follow-up: just the new comment + minimal instructions.
  const firstPrompt = `A comment was posted on a Mission Control task. Handle it.

Task ID: ${taskId}
Comment ID: ${commentId}
Author: ${author}
Comment: ${content}

Steps:
1. Fetch the full task (tasks table, id = '${taskId}') and the comment thread (task_comments table, task_id = '${taskId}', order by created_at asc) from Supabase using MCP.
2. Mark this comment as seen: update task_comments set seen_at = now() where id = '${commentId}'. This shows the 👀 emoji in the UI. Only do this AFTER you've read the context.
3. If the user is asking you to DO something — do it. You have full tool access.
4. Post your reply: insert into task_comments (task_id, author, tenant_id, content) values ('${taskId}', '${ASSISTANT_NAME}', '${TENANT_ID}', '<your reply>').
5. Format your reply for readability — markdown, bullet points, structure over walls of text.
6. Do NOT post to task_comments more than once.
7. If you change a task's status, FIRST insert a transition record: insert into task_status_transitions (task_id, from_status, to_status, changed_by) values ('<task_id>', '<old_status>', '<new_status>', '${ASSISTANT_NAME}'). Then update the task. The DB trigger skips duplicates within 5 seconds.`

  const resumePrompt = `New follow-up comment on the same task.

Comment ID: ${commentId}
Author: ${author}
Comment: ${content}

Steps:
1. Mark this comment as seen: update task_comments set seen_at = now() where id = '${commentId}'.
2. You already have the task context from earlier in this session. If you need to refresh, re-fetch the task and comment thread from Supabase.
3. If the user is asking you to DO something — do it. You have full tool access.
4. Post your reply: insert into task_comments (task_id, author, tenant_id, content) values ('${taskId}', '${ASSISTANT_NAME}', '${TENANT_ID}', '<your reply>').
5. Do NOT post to task_comments more than once.
6. If you change a task's status, FIRST insert a transition record: insert into task_status_transitions (task_id, from_status, to_status, changed_by) values ('<task_id>', '<old_status>', '<new_status>', '${ASSISTANT_NAME}'). Then update the task.`

  // Fetch tenant Claude credentials and connector tokens
  const config = await fetchClaudeConfig()
  const connectorTokens = config ? (config.connector_tokens || {}) : {}
  const configDir = config ? config.config_dir : ''

  if (config) {
    const tokenCount = Object.keys(connectorTokens).length
    if (tokenCount > 0) {
      log(`[${taskId.slice(0, 8)}] Fetched ${tokenCount} connector token(s)`)
    }
  } else {
    log(`[${taskId.slice(0, 8)}] Warning: no Claude config available — session may fail`)
  }

  // Build a safe env file — only vars the Claude session needs.
  // Sensitive vars (MC_API_TOKEN, PIF_CREDS_PASSWORD) are NOT forwarded.
  const safeEnv = {}
  const SAFE_PREFIXES = ['PIF_SUPABASE_URL', 'PIF_SUPABASE_ANON_KEY', 'PIF_TENANT_ID',
    'PIF_ASSISTANT_NAME', 'PIF_TIMEZONE', 'CONNECTOR_TOKEN_', 'CLAUDE_']
  const SAFE_EXACT = ['PATH', 'LANG', 'TERM']
  const BLOCK_EXACT = ['CLAUDECODE', 'MC_API_TOKEN', 'PIF_CREDS_PASSWORD',
    'PIF_SUPABASE_SERVICE_ROLE_KEY']

  for (const [k, v] of Object.entries(process.env)) {
    if (BLOCK_EXACT.includes(k)) continue
    if (SAFE_EXACT.includes(k) || SAFE_PREFIXES.some(p => k.startsWith(p))) {
      safeEnv[k] = v
    }
  }
  // Add connector tokens
  for (const [k, v] of Object.entries(connectorTokens)) {
    safeEnv[k] = v
  }
  if (configDir) safeEnv.CLAUDE_CONFIG_DIR = configDir

  const callerUser = os.userInfo().username
  const callerHome = os.homedir()
  const isAdmin = (callerUser === 'root')

  const claudeArgs = [
    '-p', isResume ? resumePrompt : firstPrompt,
    '--permission-mode', 'dontAsk',
    '--output-format', 'json',
  ]
  if (isResume) {
    claudeArgs.push('--resume', existingSessionId)
  }

  let child
  let envFilePath = null

  if (isAdmin) {
    // Admin tenant — full access, no sandbox. MCP tools need localhost.
    // Do NOT override CLAUDE_CONFIG_DIR — admin uses its own ~/.claude credentials.
    // Only inject connector tokens.
    const env = { ...process.env }
    delete env.CLAUDECODE
    for (const [k, v] of Object.entries(connectorTokens)) {
      env[k] = v
    }
    child = spawn('claude', claudeArgs, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } else {
    // Tenant user — sandboxed via systemd-run. Only safe env vars forwarded.
    const envFileName = `.claude-env-${taskId.slice(0, 8)}-${Date.now()}.tmp`
    envFilePath = path.join(callerHome, envFileName)

    const envLines = Object.entries(safeEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
    fs.writeFileSync(envFilePath, envLines, { mode: 0o600 })

    child = spawn('sudo', [
      '/usr/local/bin/claude-sandbox-cl', callerUser, envFilePath, '--', ...claudeArgs
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  // Clean up env file when process exits (only relevant for sandboxed sessions)
  const cleanupEnvFile = () => {
    if (envFilePath) {
      try { fs.unlinkSync(envFilePath) } catch {}
    }
  }

  // Capture only the tail of stdout — we only need the final JSON line
  let stdoutTail = ''
  child.stdout.on('data', (chunk) => {
    stdoutTail = (stdoutTail + chunk.toString()).slice(-5000)
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-500) })

  child.on('close', (code) => {
    cleanupEnvFile()
    if (code === 0) {
      // Parse session_id from JSON output
      try {
        const result = JSON.parse(stdoutTail.trim())
        if (result.session_id) {
          taskSessions.set(taskId, result.session_id)
          log(`[${taskId.slice(0, 8)}] Session completed (session=${result.session_id.slice(0, 8)}, cost=$${(result.total_cost_usd || 0).toFixed(3)})`)
        } else {
          log(`[${taskId.slice(0, 8)}] Session completed (no session_id in output)`)
        }
      } catch {
        log(`[${taskId.slice(0, 8)}] Session completed (could not parse JSON output)`)
      }
    } else {
      log(`[${taskId.slice(0, 8)}] Session failed (exit ${code}): ${stderr.slice(0, 300)}`)
      // Clear cached session on failure — next comment will cold-boot
      taskSessions.delete(taskId)
      postErrorReply(taskId)
    }
    onSessionDone()
  })

  child.on('error', (err) => {
    cleanupEnvFile()
    log(`[${taskId.slice(0, 8)}] Failed to spawn: ${err.message}`)
    taskSessions.delete(taskId)
    postErrorReply(taskId)
    onSessionDone()
  })
}

async function init() {
  log(`Starting comment-listener for tenant ${TENANT_ID.slice(0, 8)}... (assistant: ${ASSISTANT_NAME})`)
  log('Fetching service role key from logins table...')

  // Use anon key + RPC to fetch the service role key (direct table query blocked by RLS for tenants)
  const anonClient = createClient(SB_URL, SB_ANON_KEY)
  const { data: rpcData, error: rpcError } = await anonClient
    .rpc('get_tenant_logins', { p_tenant_id: TENANT_ID })

  const data = (rpcData || []).find(r => r.service_name === 'Supabase')

  if (rpcError || !data) {
    console.error(`Failed to fetch service role key: ${rpcError?.message || 'no Supabase login for this tenant'}`)
    process.exit(1)
  }

  try {
    SB_KEY = decryptField(data.encrypted_password, CREDS_PASSWORD)
  } catch (err) {
    console.error(`Failed to decrypt service role key: ${err.message}`)
    process.exit(1)
  }

  log('Service role key loaded — starting realtime subscription')

  // Create the real client with the service role key
  supabase = createClient(SB_URL, SB_KEY)

  // --- Recover missed comments (unseen, non-assistant, tenant-scoped) ---
  // If seen_at is null, it was never processed — respond regardless of age.
  try {
    const { data: missed, error: missedErr } = await supabase
      .from('task_comments')
      .select('*')
      .is('seen_at', null)
      .eq('tenant_id', TENANT_ID)
      .neq('author', ASSISTANT_NAME)
      .order('created_at', { ascending: true })

    if (missedErr) {
      log(`Warning: failed to check missed comments: ${missedErr.message}`)
    } else if (missed && missed.length > 0) {
      log(`Recovering ${missed.length} missed comment(s) from before restart`)
      for (const row of missed) {
        enqueue({ new: row })
      }
    } else {
      log('No missed comments to recover')
    }
  } catch (err) {
    log(`Warning: missed-comment recovery failed: ${err.message}`)
  }

  // --- Subscribe to realtime (new comments going forward, tenant-scoped) ---
  const channel = supabase
    .channel('comment-listener')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'task_comments',
      filter: `tenant_id=eq.${TENANT_ID}`,
    }, handleComment)
    .subscribe((status) => {
      log(`Realtime subscription: ${status}`)
    })

  // Graceful shutdown
  const shutdown = (sig) => {
    log(`${sig} received — exiting`)
    supabase.removeChannel(channel)
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  log('Comment listener started — waiting for comments')
}

init()
