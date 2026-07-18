import './style.css'

type Body = { name: string; color: string; diameter: number; x: number; y: number }
type Frame = { type: 'frame'; tick: number; simulatedDays: number; bodies: Body[] }

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
      <div class="control-group"><p class="label">Simulation</p><button id="start" class="primary">Start simulation</button><button id="pause">Pause display</button><button id="reset">Reset</button></div>
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
const trailsToggle = document.querySelector<HTMLInputElement>('#trails')!

let frame: Frame | undefined
let paused = false
let scale = 1
let offsetX = 0
let offsetY = 0
let dragging = false
let lastPointer = { x: 0, y: 0 }
const trails = new Map<string, Array<{ x: number; y: number }>>()

const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws'
const socket = new WebSocket(`${wsProtocol}://${location.hostname}:8787/stream`)
socket.addEventListener('open', () => setStatus('Ready'))
socket.addEventListener('close', () => setStatus('Disconnected'))
socket.addEventListener('error', () => setStatus('Bridge unavailable'))
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(String(data)) as Frame | { type: 'complete' } | { type: 'error'; message: string }
  if (message.type === 'frame' && !paused) {
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
  clearScene()
  socket.send(JSON.stringify({ type: 'start' }))
  setStatus('Running')
})
resetButton.addEventListener('click', () => {
  clearScene()
  socket.send(JSON.stringify({ type: 'reset' }))
  setStatus('Ready')
})
pauseButton.addEventListener('click', () => {
  paused = !paused
  pauseButton.textContent = paused ? 'Resume display' : 'Pause display'
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

function updateReadout(next: Frame) {
  time.textContent = `${next.simulatedDays.toFixed(1)} days`
  frameText.textContent = String(next.tick)
  legend.innerHTML = next.bodies.map((body) => `<span><i style="background:${body.color}"></i>${body.name}</span>`).join('')
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

  const maxRadius = Math.max(...frame.bodies.map((body) => Math.hypot(body.x, body.y)), 1)
  const auPixels = (Math.min(bounds.width, bounds.height) * 0.42 / maxRadius) * scale
  const centerX = bounds.width / 2 + offsetX
  const centerY = bounds.height / 2 + offsetY
  const point = (position: { x: number; y: number }) => ({ x: centerX + position.x * auPixels, y: centerY + position.y * auPixels })

  context.strokeStyle = 'rgba(183, 211, 205, 0.17)'
  context.lineWidth = 1
  frame.bodies.filter((body) => body.name !== 'Sun').forEach((body) => { context.beginPath(); context.arc(centerX, centerY, Math.hypot(body.x, body.y) * auPixels, 0, Math.PI * 2); context.stroke() })
  if (trailsToggle.checked) frame.bodies.forEach((body) => drawTrail(body, point))
  frame.bodies.forEach((body) => {
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
  time.textContent = '0.0 days'
  frameText.textContent = '-'
  legend.innerHTML = ''
  draw()
}
