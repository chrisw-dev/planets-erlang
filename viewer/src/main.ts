import './style.css'

type Body = { name: string; color: string; diameter: number; x: number; y: number; parent?: string | null }
type Frame = { type: 'frame'; tick: number; simulatedDays: number; bodies: Body[] }

type FocusMode = 'system' | 'earth-moon'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header class="topbar">
    <div><p class="eyebrow">Erlang actor simulation</p><h1>Orbital Mechanics Sandbox</h1></div>
    <div class="status"><span id="status-dot"></span><span id="status">Connecting</span></div>
  </header>
  <main>
    <section class="stage" aria-label="Solar system visualization">
      <canvas id="orbit-canvas"></canvas>
      <div class="readout"><span>SIMULATED TIME</span><strong id="time">0.0 days</strong></div>
      <div class="readout frame"><span>FRAME</span><strong id="frame">-</strong></div>
    </section>
    <aside class="controls" aria-label="Simulation controls">
      <div class="control-group"><p class="label">Simulation</p><button id="start" class="primary">Start simulation</button><button id="pause">Pause display</button><button id="reset">Reset</button><button id="focus-earth">Focus Earth/Moon</button></div>
      <div class="control-group"><label class="switch"><input id="trails" type="checkbox" checked><span>Orbital trails</span></label><p class="hint">Drag to pan. Scroll to zoom.</p></div>
      <div class="legend" id="legend"></div>
    </aside>
  </main>
`

const canvas = document.querySelector<HTMLCanvasElement>('#orbit-canvas')!
const context = canvas.getContext('2d')!
const status = document.querySelector<HTMLSpanElement>('#status')!
const statusDot = document.querySelector<HTMLSpanElement>('#status-dot')!
const time = document.querySelector<HTMLElement>('#time')!
const frameText = document.querySelector<HTMLElement>('#frame')!
const legend = document.querySelector<HTMLElement>('#legend')!
const startButton = document.querySelector<HTMLButtonElement>('#start')!
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!
const focusButton = document.querySelector<HTMLButtonElement>('#focus-earth')!
const trailsToggle = document.querySelector<HTMLInputElement>('#trails')!

let frame: Frame | undefined
let paused = false
let scale = 1
let offsetX = 0
let offsetY = 0
let dragging = false
let lastPointer = { x: 0, y: 0 }
let focusMode: FocusMode = 'system'
const trails = new Map<string, Array<{ x: number; y: number }>>()

const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws'
const socket = new WebSocket(`${wsProtocol}://${location.hostname}:8787/stream`)
socket.addEventListener('open', () => setStatus('Ready'))
socket.addEventListener('close', () => setStatus('Disconnected'))
socket.addEventListener('error', () => setStatus('Bridge unavailable'))
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(String(data)) as
    | Frame
    | { type: 'complete' }
    | { type: 'error'; message: string }
    | { type: 'status'; status: 'running' | 'ready' }

  if (message.type === 'status') {
    setStatus(message.status === 'running' ? 'Running' : 'Ready')
  } else if (message.type === 'frame' && !paused) {
    frame = message
    recordTrails(message)
    updateReadout(message)
    draw()
  } else if (message.type === 'complete') {
    setStatus('Complete')
  } else if (message.type === 'error') {
    setStatus(message.message)
  }
})

startButton.addEventListener('click', () => {
  if (socket.readyState !== WebSocket.OPEN) return setStatus('Disconnected')
  clearScene()
  socket.send(JSON.stringify({ type: 'start' }))
  setStatus('Running')
})
resetButton.addEventListener('click', () => {
  if (socket.readyState !== WebSocket.OPEN) return setStatus('Disconnected')
  clearScene()
  socket.send(JSON.stringify({ type: 'reset' }))
  setStatus('Ready')
})
pauseButton.addEventListener('click', () => {
  paused = !paused
  pauseButton.textContent = paused ? 'Resume display' : 'Pause display'
})
focusButton.addEventListener('click', () => {
  focusMode = focusMode === 'earth-moon' ? 'system' : 'earth-moon'
  setFocusLabel()
  draw()
})

canvas.addEventListener('wheel', (event) => {
  event.preventDefault()
  scale *= event.deltaY > 0 ? 0.88 : 1.14
  scale = Math.max(0.3, Math.min(scale, 12))
  draw()
}, { passive: false })
canvas.addEventListener('pointerdown', (event) => { dragging = true; lastPointer = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId) })
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return
  offsetX += event.clientX - lastPointer.x
  offsetY += event.clientY - lastPointer.y
  lastPointer = { x: event.clientX, y: event.clientY }
  draw()
})
canvas.addEventListener('pointerup', () => { dragging = false })
window.addEventListener('resize', draw)

function setStatus(value: string) {
  status.textContent = value
  statusDot.className = value === 'Running' ? 'running' : value === 'Complete' || value === 'Ready' ? 'ready' : 'offline'
}

function setFocusLabel() {
  focusButton.textContent = focusMode === 'earth-moon' ? 'Show full system' : 'Focus Earth/Moon'
}

function updateReadout(next: Frame) {
  time.textContent = `${next.simulatedDays.toFixed(1)} days`
  frameText.textContent = String(next.tick)
  legend.replaceChildren(...next.bodies.map((body) => { const span = document.createElement('span'); const dot = document.createElement('i'); dot.style.backgroundColor = body.color; span.append(dot, document.createTextNode(body.name)); return span }))
}

function recordTrails(next: Frame) {
  next.bodies.forEach((body) => {
    const trail = trails.get(body.name) ?? []
    trail.push({ x: body.x, y: body.y })
    if (trail.length > 120) trail.shift()
    trails.set(body.name, trail)
  })
}

function draw() {
  const bounds = canvas.getBoundingClientRect()
  const pixelRatio = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(bounds.width * pixelRatio))
  canvas.height = Math.max(1, Math.floor(bounds.height * pixelRatio))
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, bounds.width, bounds.height)
  if (!frame) return

  const currentFrame = frame
  const earthBody = currentFrame.bodies.find((body) => body.name === 'Earth')
  const moonBody = currentFrame.bodies.find((body) => body.name === 'Moon')
  const focusRadius = focusMode === 'earth-moon' && earthBody && moonBody
    ? Math.max(Math.hypot(moonBody.x - earthBody.x, moonBody.y - earthBody.y) * 3, 0.01)
    : Math.max(...currentFrame.bodies.map((body) => Math.hypot(body.x, body.y)), 1)
  const auPixels = (Math.min(bounds.width, bounds.height) * 0.42 / focusRadius) * scale
  const centerX = bounds.width / 2 + offsetX + (earthBody && focusMode === 'earth-moon' ? -earthBody.x * auPixels : 0)
  const centerY = bounds.height / 2 + offsetY + (earthBody && focusMode === 'earth-moon' ? -earthBody.y * auPixels : 0)
  const point = (position: { x: number; y: number }) => ({ x: centerX + position.x * auPixels, y: centerY + position.y * auPixels })

  context.strokeStyle = 'rgba(183, 211, 205, 0.17)'
  context.lineWidth = 1
  currentFrame.bodies.filter((body) => body.name !== 'Sun').forEach((body) => {
    const parentBody = currentFrame.bodies.find((candidate) => candidate.name === body.parent)
    const guideCenter = parentBody ? point(parentBody) : point({ x: 0, y: 0 })
    const guideRadius = parentBody
      ? Math.hypot(body.x - parentBody.x, body.y - parentBody.y) * auPixels
      : Math.hypot(body.x, body.y) * auPixels
    context.beginPath()
    context.arc(guideCenter.x, guideCenter.y, guideRadius, 0, Math.PI * 2)
    context.stroke()
  })
  if (trailsToggle.checked) currentFrame.bodies.forEach((body) => drawTrail(body, point))
  currentFrame.bodies.forEach((body) => {
    const position = point(body)
    const radius = body.name === 'Sun' ? 11 : Math.max(3, Math.min(8, Math.log10(body.diameter) * 1.25))
    context.beginPath()
    context.fillStyle = body.color
    context.shadowBlur = body.name === 'Sun' ? 28 : 8
    context.shadowColor = body.color
    context.arc(position.x, position.y, radius, 0, Math.PI * 2)
    context.fill()
    context.shadowBlur = 0
  })
}

function drawTrail(body: Body, point: (position: { x: number; y: number }) => { x: number; y: number }) {
  const trail = trails.get(body.name)
  if (!trail || trail.length < 2) return
  context.beginPath()
  trail.forEach((position, index) => { const target = point(position); index ? context.lineTo(target.x, target.y) : context.moveTo(target.x, target.y) })
  context.strokeStyle = `${body.color}88`
  context.lineWidth = 1.25
  context.stroke()
}

function clearScene() {
  frame = undefined
  trails.clear()
  focusMode = 'system'
  setFocusLabel()
  time.textContent = '0.0 days'
  frameText.textContent = '-'
  legend.innerHTML = ''
  draw()
}

setFocusLabel()
