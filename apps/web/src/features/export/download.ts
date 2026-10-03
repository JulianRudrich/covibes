/** Hands a file to the browser's downloads, under the name given. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started by then; the address is of no use to anyone afterwards.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/** Downloads a text as a file, Markdown unless told otherwise. */
export function downloadText(text: string, fileName: string, type = 'text/markdown'): void {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), fileName);
}
