/**
 * Minimal TTY spinner for the CLI. Writes a rotating character + label to
 * stderr so the user knows something is happening during long network calls
 * that would otherwise appear to hang.
 *
 * - No-op when stderr is not a TTY (CI, pipes, --json consumers).
 * - Timer is `.unref()`d so it never keeps the process alive.
 * - `pause()` / `resume()` let other writers (logger, progress bar) emit
 *   clean lines without fighting the spinner.
 */
export class Spinner {
  private static readonly FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private static readonly INTERVAL_MS = 100;

  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private label: string;
  private readonly enabled: boolean;
  private paused = false;

  constructor(label: string, opts: { enabled?: boolean } = {}) {
    this.label = label;
    this.enabled = opts.enabled ?? process.stderr.isTTY === true;
  }

  start(): void {
    if (!this.enabled || this.timer) {return;}
    this.render();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % Spinner.FRAMES.length;
      this.render();
    }, Spinner.INTERVAL_MS);
    this.timer.unref?.();
  }

  setLabel(label: string): void {
    this.label = label;
    if (this.enabled && this.timer && !this.paused) {
      this.render();
    }
  }

  pause(): void {
    if (!this.enabled || this.paused) {return;}
    this.paused = true;
    this.clearLine();
  }

  resume(): void {
    if (!this.enabled || !this.paused) {return;}
    this.paused = false;
    this.render();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.enabled) {
      this.clearLine();
    }
  }

  private render(): void {
    if (this.paused) {return;}
    process.stderr.write(`\r${Spinner.FRAMES[this.frame]} ${this.label}`);
  }

  private clearLine(): void {
    process.stderr.write('\r\x1b[K');
  }
}
