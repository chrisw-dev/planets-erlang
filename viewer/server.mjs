import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import WebSocket, { WebSocketServer } from 'ws'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = '/tmp/planets-erl-viewer'
const clients = new Set()
let simulation
let compile
let runId = 0

const socketServer = new WebSocketServer({ port: 8787, path: '/stream' })
socketServer.on('listening', () => {
  console.log('Orbit bridge listening at ws://localhost:8787/stream')
})
socketServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('Orbit bridge could not start: port 8787 is already in use. Stop the existing bridge or use it instead.')
  } else {
    console.error('Orbit bridge could not start:', error.message)
  }
  process.exitCode = 1
})
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
  const currentRunId = runId
  await mkdir(buildDir, { recursive: true })
  if (currentRunId !== runId) return
  const modules = ['physics.erl', 'planet.erl', 'sim_clock.erl', 'solar_system.erl']
  const currentCompile = spawn('erlc', ['-o', buildDir, ...modules], { cwd: root })
  compile = currentCompile
  let errors = ''
  currentCompile.stderr.on('data', (chunk) => { errors += chunk })
  currentCompile.on('close', (code) => {
    if (currentRunId !== runId || compile !== currentCompile) return
    compile = undefined
    if (code !== 0) return broadcast({ type: 'error', message: errors || 'Erlang compilation failed' })
    const currentSimulation = spawn('erl', ['-noshell', '-pa', buildDir, '-s', 'solar_system', 'start_stream', '-s', 'init', 'stop'], { cwd: root })
    simulation = currentSimulation
    let pending = ''
    currentSimulation.stdout.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      lines.filter(Boolean).forEach((line) => {
        try { broadcast(JSON.parse(line)) } catch { broadcast({ type: 'error', message: `Invalid frame: ${line}` }) }
      })
    })
    currentSimulation.stderr.on('data', (chunk) => console.error(chunk.toString()))
    currentSimulation.on('close', () => {
      if (simulation === currentSimulation) simulation = undefined
    })
  })
}

function stopSimulation() {
  runId += 1
  if (compile && !compile.killed) compile.kill('SIGTERM')
  compile = undefined
  if (simulation && !simulation.killed) simulation.kill('SIGTERM')
  simulation = undefined
}

function broadcast(message) {
  const payload = JSON.stringify(message)
  clients.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(payload) })
}