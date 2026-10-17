import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
}

export interface DevServerOptions {
  port: number
  host?: string
  /** Builds the site; called at start and after every change under `watch`. */
  build: () => Record<string, string>
  /** Subscribes to source changes and returns an unsubscribe function. */
  watch?: (onChange: () => void) => () => void
  onRebuild?: (error: unknown | undefined) => void
}

export interface DevServer {
  url: string
  rebuild(): void
  close(): Promise<void>
}

/** `almanac site serve`: serves the built files from memory and live-reloads open pages. */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  let files = options.build()
  const clients = new Set<ServerResponse>()

  const rebuild = () => {
    try {
      files = options.build()
      options.onRebuild?.(undefined)
    } catch (error) {
      options.onRebuild?.(error)
      return
    }
    for (const client of clients) client.write('event: reload\ndata: {}\n\n')
  }

  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/')
    if (path === '/__almanac/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      response.write(': connected\n\n')
      clients.add(response)
      request.on('close', () => clients.delete(response))
      return
    }
    const name = path === '/' ? 'index.html' : path.slice(1)
    const body = files[name]
    if (body === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }
    response.writeHead(200, { 'content-type': TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    response.end(body)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host ?? '127.0.0.1', () => resolve())
  })

  let timer: NodeJS.Timeout | undefined
  const unsubscribe = options.watch?.(() => {
    clearTimeout(timer)
    timer = setTimeout(rebuild, 80)
  })

  const address = server.address() as AddressInfo
  return {
    url: `http://${address.address === '::1' ? 'localhost' : address.address}:${address.port}/`,
    rebuild,
    close: () =>
      new Promise<void>((resolve) => {
        clearTimeout(timer)
        unsubscribe?.()
        for (const client of clients) client.end()
        server.close(() => resolve())
      }),
  }
}
