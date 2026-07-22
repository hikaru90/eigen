export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function formatCsvRow(values: string[]): string {
  return values.map(escapeCsvField).join(',')
}

export function formatTimestamp(date: Date): string {
  return date.toISOString()
}

export function buildCsv(headers: readonly string[], rows: string[][]): string {
  const lines = [formatCsvRow([...headers]), ...rows.map((row) => formatCsvRow(row))]
  return `${lines.join('\n')}\n`
}
