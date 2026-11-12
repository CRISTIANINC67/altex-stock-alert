import { check } from './core.js'

export default {
  async scheduled(_event, env) {
    const before = await env.STATE.get('state')
    const { state, result } = await check(env, before ? JSON.parse(before) : {})
    const after = JSON.stringify(state)
    if (after !== before) await env.STATE.put('state', after) // KV gratuit: 1000 scrieri/zi, deci scriem doar la schimbare
    console.log(JSON.stringify({ ...result, ...state }))
  },
}
