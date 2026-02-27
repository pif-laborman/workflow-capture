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

let SB_KEY // service role key — set during init
let supabase // real client — set during init

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
  const { id: commentId, task_id: taskId, author, content } = payload.new || {}
  if (!taskId || author === 'pif') return

  log(`[${taskId.slice(0, 8)}] New comment from ${author} — spawning session`)

  const prompt = `A comment was posted on a Mission Control task. Handle it.

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
6. Do NOT post to task_comments more than once.`

  const env = { ...process.env }
  delete env.CLAUDECODE // allow nested sessions

  const child = spawn('claude', [
    '-p', prompt,
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
  ], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Drain pipes to prevent buffer deadlock
  child.stdout.on('data', () => {})
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString().slice(-500) })

  child.on('close', (code) => {
    if (code === 0) {
      log(`[${taskId.slice(0, 8)}] Session completed`)
    } else {
      log(`[${taskId.slice(0, 8)}] Session failed (exit ${code}): ${stderr.slice(0, 300)}`)
      postErrorReply(taskId)
    }
  })

  child.on('error', (err) => {
    log(`[${taskId.slice(0, 8)}] Failed to spawn: ${err.message}`)
    postErrorReply(taskId)
  })
}

async function init() {
  log('Fetching service role key from logins table...')

  // Use anon key to read the logins table (RLS allows anon CRUD)
  const anonClient = createClient(SB_URL, SB_ANON_KEY)
  const { data, error } = await anonClient
    .from('logins')
    .select('encrypted_password')
    .eq('service_name', 'Supabase')
    .single()

  if (error || !data) {
    console.error(`Failed to fetch service role key: ${error?.message || 'no data'}`)
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
