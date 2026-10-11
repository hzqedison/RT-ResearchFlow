// Native PDF dependencies must not be initialized while the workbench is booting.
// Import and construction failures are handled by the document tool like parse errors.
export async function extractResearchPdfText(data: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data })
  try {
    return (await parser.getText({ first: 24 })).text
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}
