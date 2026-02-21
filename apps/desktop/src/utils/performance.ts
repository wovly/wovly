/**
 * Performance Tracking Utility
 * Tracks timing metrics for query processing stages
 */

interface Metric {
  start: number;
  duration: number | null;
}

interface MetricsMap {
  [key: string]: Metric;
}

interface MetricsResult {
  [key: string]: number | null;
  total: number;
}

export class PerformanceTracker {
  private readonly label: string;
  private readonly metrics: MetricsMap;
  private readonly startTime: number;

  constructor(label: string = 'Query') {
    this.label = label;
    this.metrics = {};
    this.startTime = Date.now();
  }

  /**
   * Start tracking a specific metric
   */
  start(label: string): void {
    this.metrics[label] = {
      start: Date.now(),
      duration: null,
    };
  }

  /**
   * End tracking a specific metric
   */
  end(label: string): void {
    if (this.metrics[label]) {
      this.metrics[label].duration = Date.now() - this.metrics[label].start;
    }
  }

  /**
   * Get duration of a specific metric
   * @returns Duration in milliseconds or null if not found
   */
  getDuration(label: string): number | null {
    return this.metrics[label]?.duration ?? null;
  }

  /**
   * Get total elapsed time
   * @returns Total duration in milliseconds
   */
  getTotalDuration(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get all metrics as an object
   * @returns Metrics object with durations and total
   */
  getMetrics(): MetricsResult {
    const result: MetricsResult = { total: 0 };

    for (const [label, metric] of Object.entries(this.metrics)) {
      result[label] = metric.duration;
    }

    result.total = this.getTotalDuration();
    return result;
  }

  /**
   * Print metrics to console
   * @returns Metrics object for chaining
   */
  report(): MetricsResult {
    // Performance metrics report (console output disabled for linting)
    return this.getMetrics();
  }

  /**
   * Get formatted report as string
   * @returns Formatted report string
   */
  getReport(): string {
    const metrics = this.getMetrics();
    let report = `\n[Performance] ${this.label} Metrics:\n`;

    for (const [label, duration] of Object.entries(metrics)) {
      if (duration !== null) {
        report += `  ${label}: ${duration}ms\n`;
      }
    }

    return report;
  }
}
