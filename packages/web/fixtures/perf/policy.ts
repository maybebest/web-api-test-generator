export function shouldCollectPerformance(enabled: boolean, projectName: string): boolean {
  return enabled && projectName !== 'setup' && projectName !== 'chromium-auth';
}
