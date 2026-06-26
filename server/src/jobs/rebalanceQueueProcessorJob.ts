import { PartialFillConfig, rebalanceQueueService } from '../services/rebalanceQueueService';
import {
  rebalanceExecutorService,
  ExecutionAttempt,
} from '../services/rebalanceExecutorService';

/**
 * Rebalance Queue Processor Job
 *
 * Processes items from the rebalance queue:
 * - Handles retries of failed executions
 * - Processes deferred entries when ready
 * - Manages partial fills and follow-ups
 * - Prevents replay of stale intents
 *
 * Can be triggered via cron schedule or called directly.
 */

export interface JobConfig {
  enabled: boolean;
  schedule?: string; // Cron expression (optional if triggered manually)
  batchSize: number; // Process N items per job run
  enableRetries: boolean;
  enableDeferredProcessing: boolean;
  partialFillConfig?: Partial<PartialFillConfig>;
  logResults: boolean;
}

let jobHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the rebalance queue processor job.
 * Runs on an interval to process pending and deferred items.
 */
export function startRebalanceQueueProcessorJob(
  config: Partial<JobConfig> = {},
): void {
  const finalConfig: JobConfig = {
    enabled: config.enabled !== false,
    batchSize: config.batchSize ?? 10,
    enableRetries: config.enableRetries !== false,
    enableDeferredProcessing: config.enableDeferredProcessing !== false,
    partialFillConfig: config.partialFillConfig,
    logResults: config.logResults !== false,
  };

  if (!finalConfig.enabled) {
    console.log('Rebalance queue processor job is disabled');
    return;
  }

  // Run job every 30 seconds
  const intervalMs = 30000;
  console.log(
    `Starting rebalance queue processor job (interval: ${intervalMs}ms, batch size: ${finalConfig.batchSize})`,
  );

  jobHandle = setInterval(async () => {
    try {
      await runRebalanceQueueProcessorJob(finalConfig);
    } catch (error) {
      console.error('Rebalance queue processor job failed:', error);
    }
  }, intervalMs);
}

/**
 * Stop the rebalance queue processor job.
 */
export function stopRebalanceQueueProcessorJob(): void {
  if (jobHandle) {
    clearInterval(jobHandle);
    jobHandle = null;
    console.log('Rebalance queue processor job stopped');
  }
}

/**
 * Run the rebalance queue processor job.
 * Processes retries, deferred items, and handles failures.
 */
export async function runRebalanceQueueProcessorJob(config: JobConfig): Promise<{
  success: boolean;
  processedRetries: number;
  processedDeferred: number;
  failedProcessing: number;
  timestamp: string;
}> {
  const startTime = Date.now();
  let processedRetries = 0;
  let processedDeferred = 0;
  let failedProcessing = 0;

  try {
    // Process retries
    if (config.enableRetries) {
      const pendingRetries = await rebalanceQueueService.getPendingRetries();
      const toProcess = pendingRetries.slice(0, config.batchSize);

      if (config.logResults && toProcess.length > 0) {
        console.log(`Processing ${toProcess.length} pending retries...`);
      }

      for (const entry of toProcess) {
        try {
          await processQueueEntry(entry, config);
          processedRetries++;
        } catch (error) {
          console.error(`Failed to process retry for entry ${entry.id}:`, error);
          failedProcessing++;

          // Record the failure
          await rebalanceQueueService.recordFailedAttempt(
            entry.id,
            `Job processing failed: ${error instanceof Error ? error.message : String(error)}`,
            config.partialFillConfig,
          );
        }
      }
    }

    // Process deferred items
    if (config.enableDeferredProcessing) {
      const deferredEntries = await rebalanceQueueService.getDeferredEntries();
      const toProcess = deferredEntries.slice(0, config.batchSize);

      if (config.logResults && toProcess.length > 0) {
        console.log(`Processing ${toProcess.length} deferred entries...`);
      }

      for (const entry of toProcess) {
        try {
          await processQueueEntry(entry, config);
          processedDeferred++;
        } catch (error) {
          console.error(`Failed to process deferred entry ${entry.id}:`, error);
          failedProcessing++;

          // Record the failure
          await rebalanceQueueService.recordFailedAttempt(
            entry.id,
            `Job processing failed: ${error instanceof Error ? error.message : String(error)}`,
            config.partialFillConfig,
          );
        }
      }
    }

    if (config.logResults) {
      const elapsed = Date.now() - startTime;
      console.log(
        `Rebalance queue processor job completed: ` +
        `${processedRetries} retries, ${processedDeferred} deferred, ` +
        `${failedProcessing} failed (${elapsed}ms)`,
      );
    }

    return {
      success: failedProcessing === 0,
      processedRetries,
      processedDeferred,
      failedProcessing,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Rebalance queue processor job error:', error);
    return {
      success: false,
      processedRetries,
      processedDeferred,
      failedProcessing,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Process a single queue entry through the real relayer-backed execution pipeline.
 *
 * Steps:
 *  1. Acquire idempotency lock — prevents duplicate submissions on worker restart.
 *  2. Mark entry as PROCESSING in the database.
 *  3. Run dry-run validation before any submission.
 *  4. Submit via RebalanceExecutorService (builds XDR → relayer fee-bump → submit → confirm).
 *  5. Record real transaction hash and execution metadata.
 *  6. On failure, classify the error and record it for retry scheduling.
 */
async function processQueueEntry(entry: any, config: JobConfig): Promise<void> {
  const attempt: ExecutionAttempt = {
    entryId: entry.id,
    attemptNumber: (entry.attemptCount ?? 0) + 1,
    startedAt: new Date(),
    status: 'pending',
  };

  // Idempotency guard: skip if this entry is already being processed in this
  // worker process (e.g. job overlaps due to slow execution).
  if (rebalanceExecutorService['isLocked']?.(entry.id)) {
    if (config.logResults) {
      console.log(`Entry ${entry.id} already in-flight — skipping duplicate`);
    }
    return;
  }

  // Mark as processing before any network calls so concurrent workers see it.
  await rebalanceQueueService.markAsProcessing(entry.id);

  try {
    const executionResult = await rebalanceExecutorService.execute(entry, attempt);

    // Record real execution result — no fake hashes.
    await rebalanceQueueService.recordPartialExecution(
      entry.id,
      executionResult,
      config.partialFillConfig,
    );

    if (config.logResults) {
      console.log(
        `Entry ${entry.id} executed: tx=${executionResult.transactionHash} ` +
        `fill=${executionResult.filledPercentage}%`,
      );
    }
  } catch (error) {
    const failureClass = rebalanceExecutorService.classifyError(
      error instanceof Error ? error : new Error(String(error)),
    );
    const reason = `[${failureClass}] ${error instanceof Error ? error.message : String(error)}`;

    if (config.logResults) {
      console.error(`Entry ${entry.id} failed (${failureClass}):`, error);
    }

    await rebalanceQueueService.recordFailedAttempt(
      entry.id,
      reason,
      config.partialFillConfig,
    );
  }
}

/**
 * Manually trigger queue processing for testing/admin purposes.
 */
export async function triggerQueueProcessing(
  batchSize = 10,
): Promise<{
  retries: number;
  deferred: number;
  failed: number;
}> {
  const result = await runRebalanceQueueProcessorJob({
    enabled: true,
    batchSize,
    enableRetries: true,
    enableDeferredProcessing: true,
    logResults: true,
  });

  return {
    retries: result.processedRetries,
    deferred: result.processedDeferred,
    failed: result.failedProcessing,
  };
}
