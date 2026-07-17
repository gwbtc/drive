// Minimal SSE reader over fetch streaming, shared by the e2e suites.

export class SseReader {
  events: Array<{ event: string; data: any }> = [];
  private controller = new AbortController();
  private done: Promise<void>;

  constructor(url: string, cookie: string) {
    this.done = (async () => {
      const r = await fetch(url, {
        headers: { cookie, accept: 'text/event-stream' },
        signal: this.controller.signal,
      });
      if (!r.ok || !r.body) throw new Error(`SSE ${url} → ${r.status}`);
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message';
            const dataLines: string[] = [];
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            if (dataLines.length) {
              let data: any = dataLines.join('\n');
              try {
                data = JSON.parse(data);
              } catch {
                /* keep raw string (e.g. heartbeats) */
              }
              this.events.push({ event, data });
            }
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') throw e;
      }
    })();
  }

  facts(type?: string): any[] {
    const fs = this.events.filter((e) => e.event === 'fact').map((e) => e.data);
    return type ? fs.filter((f) => f?.type === type) : fs;
  }

  async close() {
    this.controller.abort();
    await this.done.catch(() => {});
  }
}

// Poll `fn` until it returns non-undefined or the deadline passes. Facts
// flush on behn ticks and cross fake-ames, so deadlines are generous.
export async function waitFor<T>(
  fn: () => T | undefined | Promise<T | undefined>,
  ms = 30000,
  step = 500,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${ms}ms`);
    await new Promise((res) => setTimeout(res, step));
  }
}
