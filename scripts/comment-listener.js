#!/usr/bin/env node
/**
 * comment-listener.js — Realtime listener for task comments.
 *
 * On new non-pif comment: spawns a Claude session that handles everything —
 * reads context, marks 👀, processes the request, and posts a reply.
 *
 * Boots with the anon key, fetches the service role key from the logins table
 * (encrypted with AES-256-GCM), then creates the real Supabase client.
 *
 * Runs as systemd service: comment-listener.service
 */

const { createClient } = require('@supabase/supabase-js')
const { spawn } = require('child_process')
const crypto = require('crypto')

const SB_URL = process.env.PIF_SUPABASE_URL
const SB_ANON_KEY = process.env.PIF_SUPABASE_ANON_KEY
const CREDS_PASSWORD = process.env.PIF_CREDS_PASSWORD
const MC_API_TOKEN = process.env.MC_API_TOKEN || ''
const MC_API_PORT = process.env.API_PORT || '8091'

if (!SB_URL || !SB_ANON_KEY || !CREDS_PASSWORD) {
  console.error('Missing PIF_SUPABASE_URL, PIF_SUPABASE_ANON_KEY, or PIF_CREDS_PASSWORD')
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
 * Fetch tenant's connector tokens via the internal MC API endpoint.
 * Returns { connector_tokens: { CONNECTOR_TOKEN_X: "..." } } or null on failure.
 */
async function fetchConnectorTokens() {
  if (!MC_API_TOKEN) return null
  try {
    const res = await fetch(`http://127.0.0.1:${MC_API_PORT}/api/internal/claude-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mc-token': MC_API_TOKEN,
      },
      body: JSON.stringify({ tenant_id: process.env.PIF_TENANT_ID }),
    })
    const json = await res.json()
    if (json.status === 'ok' && json.connector_tokens) {
      return json.connector_tokens
    }
    log(`Connector token fetch: ${json.status} — ${json.error || 'no tokens'}`)
    return null
  } catch (err) {
    log(`Failed to fetch connector tokens: ${err.message}`)
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
      author: 'pif',
      content: 'Hit an error processing this comment. Check logs or ping me on Telegram.',
    }),
  }).catch(err => log(`Failed to post error reply: ${err.message}`))
}

function handleComment(payload) {
  const row = payload.new || {}
  if (!row.task_id || row.author === 'pif') return
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
3. If Pavol is asking you to DO something — do it. You have full tool access.
4. Post your reply: insert into task_comments (task_id, author, content) values ('${taskId}', 'pif', '<your reply>').
5. Format your reply for readability — markdown, bullet points, structure over walls of text.
6. Do NOT post to task_comments more than once.
7. If you change a task's status, FIRST insert a transition record: insert into task_status_transitions (task_id, from_status, to_status, changed_by) values ('<task_id>', '<old_status>', '<new_status>', 'pif'). Then update the task. The DB trigger skips duplicates within 5 seconds.
8. NEVER restart comment-listener.service or comment-listener — you ARE running inside it. Restarting it kills your own session mid-work. If you need to restart other services (mission-control-api, nginx, etc.), that's fine. Just not comment-listener.`

  const resumePrompt = `New follow-up comment on the same task.

Comment ID: ${commentId}
Author: ${author}
Comment: ${content}

Steps:
1. Mark this comment as seen: update task_comments set seen_at = now() where id = '${commentId}'.
2. You already have the task context from earlier in this session. If you need to refresh, re-fetch the task and comment thread from Supabase.
3. If Pavol is asking you to DO something — do it. You have full tool access.
4. Post your reply: insert into task_comments (task_id, author, content) values ('${taskId}', 'pif', '<your reply>').
5. Do NOT post to task_comments more than once.
6. If you change a task's status, FIRST insert a transition record: insert into task_status_transitions (task_id, from_status, to_status, changed_by) values ('<task_id>', '<old_status>', '<new_status>', 'pif'). Then update the task.
7. NEVER restart comment-listener.service — you ARE running inside it. Restarting it kills your own session.`

  const env = { ...process.env }
  delete env.CLAUDECODE // allow nested sessions

  // Inject connector tokens as env vars (e.g. CONNECTOR_TOKEN_GOOGLE_CALENDAR=ya29.xxx)
  const connectorTokens = await fetchConnectorTokens()
  if (connectorTokens) {
    for (const [key, value] of Object.entries(connectorTokens)) {
      env[key] = value
    }
    const tokenCount = Object.keys(connectorTokens).length
    if (tokenCount > 0) {
      log(`[${taskId.slice(0, 8)}] Injected ${tokenCount} connector token(s) as env vars`)
    }
  }

  const args = [
    '-p', isResume ? resumePrompt : firstPrompt,
    '--permission-mode', 'dontAsk',
    '--output-format', 'json',
  ]
  if (isResume) {
    args.push('--resume', existingSessionId)
  }

  const child = spawn('claude', args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Capture only the tail of stdout — we only need the final JSON line
  let stdoutTail = ''
  child.stdout.on('data', (chunk) => {
    stdoutTail = (stdoutTail + chunk.toString()).slice(-5000)
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-500) })

  child.on('close', (code) => {
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
    log(`[${taskId.slice(0, 8)}] Failed to spawn: ${err.message}`)
    taskSessions.delete(taskId)
    postErrorReply(taskId)
    onSessionDone()
  })
}

async function init() {
  log('Fetching service role key via pif-creds...')

  try {
    SB_KEY = require('child_process')
      .execSync('pif-creds get Supabase', { encoding: 'utf8', timeout: 10000 })
      .trim()
  } catch (err) {
    console.error(`Failed to get service role key via pif-creds: ${err.message}`)
    process.exit(1)
  }

  log('Service role key loaded — starting realtime subscription')

  // Create the real client with the service role key
  supabase = createClient(SB_URL, SB_KEY)

  // --- Recover missed comments ---
  // Two cases: (1) unseen comments, (2) seen but unanswered (session died mid-work)
  try {
    // Case 1: Never seen at all
    const { data: unseen, error: unseenErr } = await supabase
      .from('task_comments')
      .select('*')
      .is('seen_at', null)
      .neq('author', 'pif')
      .order('created_at', { ascending: true })

    if (unseenErr) {
      log(`Warning: failed to check unseen comments: ${unseenErr.message}`)
    }

    // Case 2: Seen but no pif reply came after — session was killed mid-work.
    // Check comments from the last 2 hours where seen_at is set but no pif comment
    // follows on the same task. Uses RPC to avoid complex client-side joins.
    let unanswered = []
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const { data: recentSeen, error: seenErr } = await supabase
        .from('task_comments')
        .select('*')
        .neq('author', 'pif')
        .not('seen_at', 'is', null)
        .gte('created_at', twoHoursAgo)
        .order('created_at', { ascending: true })

      if (!seenErr && recentSeen) {
        // Group by task, check if each has a pif reply after it
        const taskIds = [...new Set(recentSeen.map(c => c.task_id))]
        for (const tid of taskIds) {
          const taskComments = recentSeen.filter(c => c.task_id === tid)
          const lastNonPif = taskComments[taskComments.length - 1]
          // Check if there's a pif reply after this comment
          const { data: pifReplies } = await supabase
            .from('task_comments')
            .select('id')
            .eq('task_id', tid)
            .eq('author', 'pif')
            .gt('created_at', lastNonPif.created_at)
            .limit(1)
          if (!pifReplies || pifReplies.length === 0) {
            unanswered.push(lastNonPif)
          }
        }
      }
    } catch (err) {
      log(`Warning: unanswered-comment check failed: ${err.message}`)
    }

    const missed = [...(unseen || []), ...unanswered]
    // Deduplicate by comment ID
    const seen = new Set()
    const deduped = missed.filter(c => {
      if (seen.has(c.id)) return false
      seen.add(c.id)
      return true
    })

    if (deduped.length > 0) {
      log(`Recovering ${deduped.length} missed comment(s) from before restart`)
      for (const row of deduped) {
        enqueue({ new: row })
      }
    } else {
      log('No missed comments to recover')
    }
  } catch (err) {
    log(`Warning: missed-comment recovery failed: ${err.message}`)
  }

  // --- Subscribe to realtime (new comments going forward) ---
  const channel = supabase
    .channel('comment-listener')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'task_comments',
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
