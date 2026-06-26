// Self-contained verification for the Nuxt Vapor repro. Run via `pnpm verify`
// (which builds first). Serves the PROD output, drives a real headless Chromium,
// and asserts behaviour that MATCHES the current patch state of the installed
// `@vue/runtime-vapor` — so it is a regression gate in both the patched and the
// unpatched configuration:
//
//   #1 + #1b patched  -> click reactive, $evtclick=function, templateRef=ref-set:BUTTON, 0 console errors
//   #1 only           -> click reactive but templateRef=ref-NULL  (the #1b surface)
//   no patch          -> button inert: $evtclick=undefined, count frozen (the #1 surface)
//
// A real browser is required: happy-dom/jsdom mis-report this bug.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { globSync, readFileSync, realpathSync } from 'node:fs'
import { chromium } from 'playwright'

// --- detect the patch state of the runtime vue actually resolves to ----------
function patchState() {
  const linked = globSync('node_modules/.pnpm/vue@3.6.0-beta.17*/node_modules/@vue/runtime-vapor')[0]
  if (!linked) throw new Error('could not locate @vue/runtime-vapor')
  const file = realpathSync(linked) + '/dist/runtime-vapor.esm-bundler.js'
  const src = readFileSync(file, 'utf8')
  return {
    has1: src.includes('!isBlock(setupResult) && component.render'),                 // handleSetupResult fix
    has1b: src.includes('const setupState = instance.setupState || {};'),            // setRef fix
    file,
  }
}

function freePort() {
  return new Promise((res) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })
}

async function waitReachable(url, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`server not reachable at ${url}`)
}

async function probe(url) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(250)
    const r = await page.evaluate(async () => {
      const btn = document.querySelector('button')
      const probeEl = document.querySelector('[data-test="probe"]')
      const before = btn ? btn.textContent.trim() : null
      const evtclick = btn ? typeof btn.$evtclick : 'no-button'
      if (btn) btn.click()
      await new Promise((r) => setTimeout(r, 100))
      const after = btn ? btn.textContent.trim() : null
      return {
        hasButton: !!btn,
        before,
        after,
        reactive: before !== after,
        evtclick,
        templateRef: probeEl ? probeEl.textContent.replace('templateRef = ', '').trim() : 'no-probe',
      }
    })
    return { ...r, errors }
  } finally {
    await browser.close()
  }
}

// Each state has its own check list so the assertions match how that state
// actually manifests in THIS repo. Note: here the no-patch case CRASHES (no
// button) rather than going inert — that is Nuxt-vDOM-interop-specific for a
// component with a setup-var template ref (a pure-Vapor root stays inert). The
// no-patch assertion below ("no working interactive button") covers both.
function planFor({ has1, has1b }) {
  if (has1 && has1b)
    return {
      label: '#1 + #1b patched (working)',
      checks: (r) => [
        ['button present', r.hasButton === true],
        ['click reactive (count 0 -> 1)', r.reactive === true],
        ['$evtclick === function', r.evtclick === 'function'],
        ['template ref resolved (ref-set:BUTTON)', r.templateRef === 'ref-set:BUTTON'],
        ['no console errors', r.errors.length === 0],
      ],
    }
  if (has1)
    return {
      label: '#1 only — template ref still broken (#1b live)',
      checks: (r) => [
        ['button present', r.hasButton === true],
        ['click reactive (count 0 -> 1)', r.reactive === true],
        ['$evtclick === function', r.evtclick === 'function'],
        ['template ref is null (#1b surface)', r.templateRef === 'ref-NULL'],
      ],
    }
  return {
    label: 'no patch — app broken (the bug)',
    checks: (r) => [
      // No working/interactive button: inert (simple component) or crashed
      // (this repo's template-ref component). Either way, not interactive.
      ['no working interactive button', !(r.hasButton && r.reactive && r.evtclick === 'function')],
    ],
  }
}

const state = patchState()
const plan = planFor(state)
console.log(`Detected runtime: #1=${state.has1} #1b=${state.has1b} -> expecting: ${plan.label}`)

const port = await freePort()
const url = `http://127.0.0.1:${port}/`
const srv = spawn(process.execPath, ['.output/server/index.mjs'], {
  env: { ...process.env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1' },
  stdio: 'ignore',
})

let r
try {
  await waitReachable(url)
  r = await probe(url)
} finally {
  srv.kill('SIGTERM')
}

const checks = plan.checks(r)

let ok = true
for (const [name, pass] of checks) {
  ok &&= pass
  console.log(`  ${pass ? '✓' : '✗'} ${name}`)
}
console.log(
  `\nObserved: button="${r.before}"->"${r.after}" reactive=${r.reactive} $evtclick=${r.evtclick} templateRef=${r.templateRef} consoleErrors=${r.errors.length}`,
)
console.log(ok ? `\nPASS — behaviour matches "${plan.label}".` : `\nFAIL — behaviour did not match "${plan.label}".`)
if (!ok && r.errors.length) console.log('Console errors:\n  ' + r.errors.join('\n  '))
process.exit(ok ? 0 : 1)
