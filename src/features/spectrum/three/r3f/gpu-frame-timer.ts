interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** Asynchronous GPU queries; never waits for a result or calls gl.finish(). */
export class GpuFrameTimer {
  private readonly extension: TimerExtension | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  revision = 0;
  get supported() {
    return this.extension !== null;
  }

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension(
      "EXT_disjoint_timer_query_webgl2",
    ) as TimerExtension | null;
  }

  poll(): number | undefined {
    const ext = this.extension,
      gl = this.gl;
    if (!ext || gl.isContextLost()) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      this.discard();
      return;
    }
    const query = this.pending[0];
    if (!query || !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
      return;
    this.pending.shift();
    const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
    gl.deleteQuery(query);
    return Number.isFinite(ns) && ns > 0 ? ns / 1e6 : undefined;
  }

  begin() {
    const ext = this.extension,
      gl = this.gl;
    if (!ext || this.active || this.pending.length >= 4 || gl.isContextLost())
      return;
    // Respect other instrumentation sharing this context.
    if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
    const query = gl.createQuery();
    if (query) {
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      this.active = query;
    }
  }

  end() {
    if (!this.active || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  discard() {
    this.revision++;
    this.end();
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending.length = 0;
  }
}
