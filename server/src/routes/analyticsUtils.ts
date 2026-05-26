import { AttributionReport } from '../services/portfolioAttributionService';
import { CompatibilityReport } from '../services/protocolCompatibilityService';
import { StrategyHealthScore } from '../services/strategyHealthService';
import { DataSourceReliability } from '../services/yieldReliabilityService';

// Analytics Helper Functions

export function validateAttributionRequest(walletAddress: string, startTime: string, endTime: string): { valid: boolean; error?: string } {
  // Basic validation
  if (!walletAddress || !startTime || !endTime) return { valid: false, error: 'Missing required parameters' };
  
  // Validate timestamp format and range
  const start = new Date(startTime);
  const end = new Date(endTime);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return { valid: false, error: 'Invalid timestamp format' };
  if (start >= end) return { valid: false, error: 'Start time must be before end time' };
  
  // Check if time window is reasonable (max 1 year)
  const maxWindow = 365 * 24 * 60 * 60 * 1000; // 1 year in ms
  if (end.getTime() - start.getTime() > maxWindow) return { valid: false, error: 'Time window too large (max 1 year)' };
  
  return { valid: true };
}

interface ProtocolReport {
  protocols?: Array<{ protocolName: string; status: string; criticalIssues?: number }>;
  issues?: Array<{ severity: string }>;
}

export function formatAttributionReport(report: AttributionReport): any {
  return {
    ...report,
    formattedDate: new Date().toISOString(),
    totalAttribution: (report as any).breakdown?.reduce((sum: number, item: { contribution: number }) => sum + item.contribution, 0) || 0,
  };
}

export function formatCompatibilityReport(report: CompatibilityReport): any {
  return {
    ...report,
    formattedDate: new Date().toISOString(),
    criticalIssues: (report as any).issues?.filter((issue: { severity: string }) => issue.severity === 'critical') || [],
  };
}

export function formatHealthScore(score: StrategyHealthScore): any {
  const overallScore = score.overallScore;
  return {
    ...score,
    status: overallScore >= 80 ? 'healthy' : overallScore >= 60 ? 'degraded' : 'critical',
    formattedDate: new Date().toISOString(),
  };
}

export function getCriticalHealthAlerts(scores: StrategyHealthScore[]): Array<{
  strategyId: string;
  severity: string;
  message: string;
  timestamp: string;
}> {
  return scores
    .filter(score => score.overallScore < 60)
    .map(score => ({
      strategyId: score.strategyId || 'unknown',
      severity: score.overallScore < 40 ? 'critical' : 'warning',
      message: `Strategy health score: ${score.overallScore}`,
      timestamp: new Date().toISOString(),
    }));
}

export function formatReliabilityScore(reliability: DataSourceReliability): any {
  const score = reliability.reliabilityScore;
  return {
    ...reliability,
    status: score >= 80 ? 'reliable' : score >= 60 ? 'moderate' : 'unreliable',
    formattedDate: new Date().toISOString(),
  };
}

export function getWeightedProviderSelection(providers: DataSourceReliability[]): any[] {
  return providers
    .map(provider => ({
      ...provider,
      weight: provider.reliabilityScore / 100,
    }))
    .sort((a, b) => b.weight - a.weight);
}

export function isProtocolSafeForExecution(protocolName: string, report: ProtocolReport): boolean {
  const protocolStatus = report.protocols?.find((p: { protocolName: string; status: string; criticalIssues?: number }) => p.protocolName === protocolName);
  return protocolStatus?.status === 'compatible' && (protocolStatus?.criticalIssues ?? 0) === 0;
}
