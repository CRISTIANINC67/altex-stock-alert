// Varianta de rezerva: rulata de GitHub Actions, starea sta in state.json (pastrat prin actions/cache).
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { check } from './core.js'

let before = null
try { before = readFileSync('state.json', 'utf8') } catch {}
const { state, result } = await check(process.env, before ? JSON.parse(before) : {})
const after = JSON.stringify(state)
if (after !== before) {
  writeFileSync('state.json', after)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n')
}
console.log(JSON.stringify({ ...result, ...state }))
