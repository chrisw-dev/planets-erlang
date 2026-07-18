import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { WebSocketServer } from 'ws'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = '/tmp/planets-erl-viewer'
const clients = new Set()
let simulation

const socketServer = new WebSocketServer({ port: 8787, path: '/stream' })
socketServer.on('connection', (socket) => {
  clients.add(socket)
  socket.send(JSON.stringify({ type: 'status', status: simulation ? 'running' : 'ready' }))
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'start') startSimulation()
    if (message.type === 'reset') stopSimulation()
  })
  socket.on('close', () => clients.delete(socket))
})

async function startSimulation() {
  stopSimulation()
  await mkdir(buildDir, { recursive: true })
  const modules = ['physics.erl', 'planet.erl', 'sim_clock.erl', 'solar_system.erl']
  const compile = spawn('erlc', ['-o', buildDir, ...modules], { cwd: root })
  let errors = ''
  compile.stderr.on('data', (chunk) => { errors += chunk })
  compile.on('close', (code) => {
    if (code !== 0) return broadcast({ type: 'error', message: errors || 'Erlang compilation failed' })
    simulation = spawn('erl', ['-noshell', '-pa', buildDir, '-s', 'solar_system', 'start_stream', '-s', 'init', 'stop'], { cwd: root })
    let pending = ''
    simulation.stdout.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      lines.filter(Boolean).forEach((line) => {
        try { broadcast(JSON.parse(line)) } catch { broadcast({ type: 'error', message: `Invalid frame: ${line}` }) }
      })
    })
    simulation.stderr.on('data', (chunk) => console.error(chunk.toString()))
    simulation.on('close', () => { simulation = undefined })
  })
}

function stopSimulation() {
  if (simulation && !simulation.killed) simulation.kill('SIGTERM')
  simulation = undefined
}

function broadcast(message) {
  const payload = JSON.stringify(message)
  clients.forEach((client) => { if (client.readyState === client.OPEN) client.send(payload) })
}

console.log('Orbit bridge listening at ws://localhost:8787/stream')