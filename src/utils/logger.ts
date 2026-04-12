import { createConsola, LogLevels } from 'consola'

const logger = createConsola({
	level: LogLevels.debug,
	formatOptions: {
		date: true,
		colors: false,
	},
})

export default logger

/**
 * Sync phase logger.
 * Provides structured, human-readable sync progress logging.
 */
export class SyncLogger {
	private phaseStart = 0
	private syncStart = 0
	private taskCounts: Record<string, { total: number; success: number; failed: number }> = {}

	startSync() {
		this.syncStart = Date.now()
		this.taskCounts = {}
		logger.info('═══════════════════════════════════════')
		logger.info('🔄 Sync started')
		logger.info('═══════════════════════════════════════')
	}

	startPhase(name: string, detail?: string) {
		this.phaseStart = Date.now()
		const msg = detail ? `▶ ${name}: ${detail}` : `▶ ${name}`
		logger.info(msg)
	}

	endPhase(name: string, detail?: string) {
		const elapsed = Date.now() - this.phaseStart
		const msg = detail
			? `✓ ${name} completed (${elapsed}ms): ${detail}`
			: `✓ ${name} completed (${elapsed}ms)`
		logger.info(msg)
	}

	phaseError(name: string, error: unknown) {
		const elapsed = Date.now() - this.phaseStart
		logger.error(`✗ ${name} failed (${elapsed}ms):`, error)
	}

	logDecisionSummary(decisions: Record<string, number>) {
		const parts = Object.entries(decisions)
			.filter(([, count]) => count > 0)
			.map(([type, count]) => `${type}: ${count}`)
			.join(', ')
		logger.info(`📋 Task decisions: ${parts || '(none)'}`)
	}

	logTaskStart(index: number, total: number, taskName: string, path: string) {
		logger.info(`  [${index}/${total}] ${taskName}: ${path}`)
	}

	logTaskResult(index: number, total: number, taskName: string, path: string, success: boolean, elapsed: number, errorMsg?: string) {
		if (!this.taskCounts[taskName]) {
			this.taskCounts[taskName] = { total: 0, success: 0, failed: 0 }
		}
		this.taskCounts[taskName].total++

		if (success) {
			this.taskCounts[taskName].success++
			// Only log individual success for file operations, not for mkdir/noop
			if (elapsed > 3000) {
				logger.warn(`  [${index}/${total}] ${taskName}: ${path} — slow (${elapsed}ms)`)
			}
		} else {
			this.taskCounts[taskName].failed++
			logger.error(`  ✗ [${index}/${total}] ${taskName}: ${path} — FAILED: ${errorMsg ?? 'unknown error'}`)
		}
	}

	endSync(failedCount: number) {
		const totalElapsed = Date.now() - this.syncStart
		logger.info('───────────────────────────────────────')
		logger.info(`🏁 Sync finished in ${this.formatDuration(totalElapsed)}`)

		// Print task summary
		const entries = Object.entries(this.taskCounts)
		if (entries.length > 0) {
			logger.info('📊 Summary:')
			for (const [name, counts] of entries) {
				if (counts.failed > 0) {
					logger.info(`   ${name}: ${counts.success}✓ / ${counts.failed}✗ (of ${counts.total})`)
				} else {
					logger.info(`   ${name}: ${counts.total}✓`)
				}
			}
		}

		if (failedCount > 0) {
			logger.error(`⚠ ${failedCount} task(s) failed`)
		} else {
			logger.info('✅ All tasks succeeded')
		}
		logger.info('═══════════════════════════════════════')
	}

	private formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`
		if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
		const m = Math.floor(ms / 60000)
		const s = Math.round((ms % 60000) / 1000)
		return `${m}m${s}s`
	}
}

export const syncLogger = new SyncLogger()
