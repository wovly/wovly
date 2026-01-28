import cron from "node-cron";
import { ScheduledTask } from "@wovly/shared";

type TaskHandler = (task: ScheduledTask) => Promise<void>;

export class TaskScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private jobs = new Map<string, cron.ScheduledTask>();

  addTask(task: ScheduledTask, handler: TaskHandler) {
    this.tasks.set(task.id, task);
    if (!task.enabled) {
      return;
    }
    const job = cron.schedule(task.cron, () => {
      void handler(task);
    });
    this.jobs.set(task.id, job);
  }

  stopTask(taskId: string) {
    const job = this.jobs.get(taskId);
    if (job) {
      job.stop();
    }
  }

  listTasks() {
    return Array.from(this.tasks.values());
  }
}
