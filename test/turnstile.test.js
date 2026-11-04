import { describe, expect, it } from 'vitest'
import { startChallengeServer } from '../src/turnstile.js'

describe('startChallengeServer', () => {
  it('serves the widget and accepts only its own state', async () => {
    const { url, token, close } = await startChallengeServer({ sitekey: '1x00000000000000000000AA' })
    try {
      const page = await (await fetch(url)).text()
      expect(page).toContain('data-sitekey="1x00000000000000000000AA"')
      const state = page.match(/state=([0-9a-f]{32})/)[1]
      expect((await fetch(`${url}callback?state=wrong&token=x`)).status).toBe(400)
      expect((await fetch(`${url}callback?state=${state}&token=XXXX.DUMMY.TOKEN.XXXX`)).status).toBe(200)
      expect(await token).toBe('XXXX.DUMMY.TOKEN.XXXX')
    }
    finally {
      close()
    }
  })

  it('escapes the sitekey and requires one', async () => {
    const { url, close } = await startChallengeServer({ sitekey: '"><script>' })
    const page = await (await fetch(url)).text()
    close()
    expect(page).not.toContain('"><script>')
    await expect(startChallengeServer({ sitekey: '' })).rejects.toThrow(/sitekey/)
  })
})
